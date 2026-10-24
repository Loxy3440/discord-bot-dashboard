const $ = (id) => document.getElementById(id);
const loginScreen = $('loginScreen');
const loginForm = $('loginForm');
const loginError = $('loginError');
const actionMessage = $('actionMessage');

async function api(url, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, Object.assign({}, opts, { headers, credentials: 'same-origin' }));
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(data.error || 'İstek tamamlanamadı.');
  return data;
}

function showLogin() {
  loginScreen.hidden = false;
  $('passwordInput').focus();
}
function hideLogin() {
  loginScreen.hidden = true;
  loginError.textContent = '';
}
function setAction(message, isError) {
  actionMessage.textContent = message || '';
  actionMessage.classList.toggle('error', Boolean(isError));
}
function setText(id, text) { $(id).textContent = text; }

function renderStatus(status) {
  const setupNotice = $('setupNotice');
  setupNotice.hidden = Boolean(status.botConfigured && status.adminConfigured !== false);
  if (!status.botConfigured) {
    setupNotice.querySelector('p').textContent = 'Render Environment bölümünde ADMIN_PASSWORD, DISCORD_BOT_TOKEN ve ALLOWED_GUILD_ID secret değişkenlerini ayarla. Tokenı bu panele veya GitHub’a yazma.';
  }
  const online = Boolean(status.botReady);
  setText('botStatus', online ? 'Çevrimiçi' : (status.botConfigured ? 'Bağlanıyor / çevrimdışı' : 'Kurulum gerekli'));
  setText('botIdentity', status.botTag || 'Discord botu bekleniyor');
  setText('guildCount', String(status.guildCount || 0));
  const badge = $('voiceBadge');
  if (status.voice) {
    setText('voiceStatus', 'Bağlı');
    setText('voiceCaption', status.voice.channelName || 'Ses kanalında');
    badge.className = 'badge badge-online';
    badge.innerHTML = '<i></i> BAĞLI';
  } else {
    setText('voiceStatus', 'Bağlı değil');
    setText('voiceCaption', 'Kanal seçerek bağlan');
    badge.className = 'badge badge-muted';
    badge.innerHTML = '<i></i> BAĞLI DEĞİL';
  }
}

function renderActivity(entries) {
  const container = $('activityList');
  container.replaceChildren();
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Henüz etkinlik yok.';
    container.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    const event = document.createElement('div');
    event.className = 'activity-event';
    const dot = document.createElement('span');
    dot.className = 'event-dot ' + (entry.level || 'info');
    const message = document.createElement('span');
    message.textContent = entry.message || 'Etkinlik';
    event.append(dot, message);
    const time = document.createElement('time');
    time.className = 'activity-time';
    const date = new Date(entry.timestamp);
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    row.append(event, time);
    container.appendChild(row);
  }
}

async function refresh() {
  if (!loginScreen.hidden) return;
  try {
    const status = await api('/api/status');
    renderStatus(status);
    const logData = await api('/api/activity');
    renderActivity(logData.entries);
  } catch (error) {
    if (error.message !== 'Oturum gerekli.') setAction(error.message, true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('passwordInput').value }) });
    loginForm.reset();
    hideLogin();
    await refresh();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

$('joinButton').addEventListener('click', async () => {
  const channelId = $('channelId').value.trim();
  if (!/^\d{17,20}$/.test(channelId)) return setAction('Geçerli bir Discord ses kanalı ID gir.', true);
  setAction('Bot kanala bağlanıyor…', false);
  try {
    await api('/api/voice/join', { method: 'POST', body: JSON.stringify({ channelId }) });
    setAction('Bot ses kanalına bağlandı.', false);
    await refresh();
  } catch (error) { setAction(error.message, true); }
});

$('leaveButton').addEventListener('click', async () => {
  setAction('Bağlantı kapatılıyor…', false);
  try {
    await api('/api/voice/leave', { method: 'POST', body: '{}' });
    setAction('Bot ses kanalından ayrıldı.', false);
    await refresh();
  } catch (error) { setAction(error.message, true); }
});

$('restartButton').addEventListener('click', async () => {
  if (!window.confirm('Discord botu yeniden başlatılsın mı?')) return;
  setAction('Bot yeniden başlatılıyor…', false);
  try {
    await api('/api/bot/restart', { method: 'POST', body: '{}' });
    setAction('Yeniden başlatma isteği gönderildi.', false);
    window.setTimeout(refresh, 1800);
  } catch (error) { setAction(error.message, true); }
});

$('refreshButton').addEventListener('click', refresh);
$('logoutButton').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
  showLogin();
});

for (const link of document.querySelectorAll('.nav-link')) {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
}

(async function init() {
  try {
    const session = await api('/api/session');
    if (session.authenticated) {
      hideLogin();
      await refresh();
    } else {
      showLogin();
      if (!session.adminConfigured) loginError.textContent = 'Önce ADMIN_PASSWORD secret değişkenini ayarlayın.';
    }
  } catch {
    showLogin();
  }
  window.setInterval(refresh, 15000);
})();
