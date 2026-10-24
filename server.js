const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');
const {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID || '';
const COOKIE_NAME = 'bot_dashboard_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const activity = [];
let discordClient = null;
let activeVoice = null;
let restarting = false;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

function addLog(level, message) {
  activity.unshift({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message });
  if (activity.length > 80) activity.length = 80;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const prefix = name + '=';
  for (const item of header.split(';')) {
    const part = item.trim();
    if (part.startsWith(prefix)) {
      try { return decodeURIComponent(part.slice(prefix.length)); } catch { return ''; }
    }
  }
  return '';
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  const expected = req.protocol + '://' + req.get('host');
  if (!origin || origin !== expected) return res.status(403).json({ error: 'İstek kaynağı doğrulanamadı.' });
  next();
}

function requireAuth(req, res, next) {
  const sid = readCookie(req, COOKIE_NAME);
  const expiresAt = sid ? sessions.get(sid) : null;
  if (!expiresAt || expiresAt < Date.now()) {
    if (sid) sessions.delete(sid);
    return res.status(401).json({ error: 'Oturum gerekli.' });
  }
  next();
}

function equalSecret(candidate, expected) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. Daha sonra tekrar deneyin.' },
});

app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));
app.get('/api/session', (req, res) => {
  const sid = readCookie(req, COOKIE_NAME);
  const expiresAt = sid ? sessions.get(sid) : null;
  const authenticated = Boolean(expiresAt && expiresAt >= Date.now());
  if (sid && expiresAt && expiresAt < Date.now()) sessions.delete(sid);
  res.json({ authenticated, adminConfigured: Boolean(ADMIN_PASSWORD), botConfigured: Boolean(DISCORD_BOT_TOKEN && ALLOWED_GUILD_ID) });
});

app.post('/api/login', sameOrigin, loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD ortam secret'ı ayarlanmamış.' });
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!equalSecret(password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Parola yanlış.' });
  for (const [sid, expiry] of sessions.entries()) if (expiry < Date.now()) sessions.delete(sid);
  if (sessions.size > 200) sessions.clear();
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + SESSION_MS);
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS,
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/logout', sameOrigin, requireAuth, (req, res) => {
  const sid = readCookie(req, COOKIE_NAME);
  if (sid) sessions.delete(sid);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/status', requireAuth, (req, res) => {
  const ready = Boolean(discordClient && discordClient.isReady());
  res.json({
    botConfigured: Boolean(DISCORD_BOT_TOKEN && ALLOWED_GUILD_ID),
    botReady: ready,
    botTag: ready ? discordClient.user.tag : null,
    guildCount: ready ? discordClient.guilds.cache.size : 0,
    allowedGuildConfigured: Boolean(ALLOWED_GUILD_ID),
    voice: activeVoice,
  });
});

app.get('/api/activity', requireAuth, (req, res) => res.json({ entries: activity.slice(0, 40) }));

async function startBot() {
  if (!DISCORD_BOT_TOKEN || !ALLOWED_GUILD_ID) {
    addLog('warning', 'Bot kurulumu bekleniyor: Render secret değişkenlerini ekleyin.');
    return false;
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  discordClient = client;
  client.once('ready', () => addLog('success', 'Discord botu bağlandı: ' + client.user.tag));
  client.on('error', () => addLog('error', 'Discord bağlantı hatası. Token ve bot ayarlarını kontrol edin.'));
  try {
    await client.login(DISCORD_BOT_TOKEN);
    return true;
  } catch {
    if (discordClient === client) discordClient = null;
    try { client.destroy(); } catch {}
    addLog('error', 'Bot başlatılamadı. Secret değerlerini ve Discord Developer Portal ayarlarını kontrol edin.');
    return false;
  }
}

app.post('/api/bot/restart', sameOrigin, requireAuth, async (req, res) => {
  if (restarting) return res.status(409).json({ error: 'Bot zaten yeniden başlatılıyor.' });
  if (!DISCORD_BOT_TOKEN || !ALLOWED_GUILD_ID) return res.status(409).json({ error: 'Önce bot secret değişkenlerini ayarlayın.' });
  restarting = true;
  try {
    if (discordClient) {
      try { discordClient.destroy(); } catch {}
      discordClient = null;
    }
    activeVoice = null;
    const started = await startBot();
    if (!started) return res.status(503).json({ error: 'Bot başlatılamadı; etkinlik kaydını kontrol edin.' });
    addLog('info', 'Bot yönetici tarafından yeniden başlatıldı.');
    return res.json({ ok: true });
  } finally {
    restarting = false;
  }
});

app.post('/api/voice/join', sameOrigin, requireAuth, async (req, res) => {
  if (!discordClient || !discordClient.isReady()) return res.status(503).json({ error: 'Bot şu anda çevrimiçi değil.' });
  if (!ALLOWED_GUILD_ID) return res.status(409).json({ error: 'İzinli sunucu yapılandırılmamış.' });
  const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId.trim() : '';
  if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Geçerli bir ses kanalı ID girin.' });
  try {
    const guild = discordClient.guilds.cache.get(ALLOWED_GUILD_ID) || await discordClient.guilds.fetch(ALLOWED_GUILD_ID);
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildVoice) {
      return res.status(400).json({ error: 'Kanal, yapılandırılan sunucudaki normal bir ses kanalı olmalı.' });
    }
    const me = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    if (!permissions || !permissions.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect])) {
      return res.status(403).json({ error: 'Botun bu kanalda Görüntüleme ve Bağlan izinleri olmalı.' });
    }
    const previous = getVoiceConnection(guild.id);
    if (previous) previous.destroy();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    activeVoice = { channelId: channel.id, channelName: channel.name, guildId: guild.id };
    addLog('success', 'Bot ses kanalına bağlandı: ' + channel.name);
    return res.json({ ok: true, voice: activeVoice });
  } catch {
    const connection = getVoiceConnection(ALLOWED_GUILD_ID);
    if (connection && connection.state.status !== VoiceConnectionStatus.Ready) connection.destroy();
    addLog('error', 'Ses kanalına bağlanılamadı. Botun kanal izinlerini kontrol edin.');
    return res.status(400).json({ error: 'Ses bağlantısı kurulamadı. Sunucu, kanal ID ve bot izinlerini kontrol edin.' });
  }
});

app.post('/api/voice/leave', sameOrigin, requireAuth, (req, res) => {
  if (!ALLOWED_GUILD_ID) return res.status(409).json({ error: 'İzinli sunucu yapılandırılmamış.' });
  const connection = getVoiceConnection(ALLOWED_GUILD_ID);
  if (connection) connection.destroy();
  activeVoice = null;
  addLog('info', 'Bot ses kanalından ayrıldı.');
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  addLog('error', 'Beklenmeyen bir sunucu hatası oluştu.');
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Sunucu hatası.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  addLog('info', 'Dashboard ' + PORT + ' portunda başladı.');
  if (!ADMIN_PASSWORD) addLog('warning', 'ADMIN_PASSWORD ayarlanmadı; yönetici girişi kullanılamaz.');
  if (DISCORD_BOT_TOKEN && ALLOWED_GUILD_ID) startBot();
  else addLog('warning', 'Bot secret değişkenleri yapılandırılmadı.');
});

function shutdown() {
  if (discordClient) {
    try { discordClient.destroy(); } catch {}
    discordClient = null;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
