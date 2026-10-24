# Discord Bot Dashboard

Tek bir yönetici için hazırlanmış, yetkilendirilmiş Discord botu kontrol paneli.

## İçindekiler

- Parola korumalı yönetim paneli ve oturum
- Discord bot bağlantı durumu, sunucu sayısı ve güvenli etkinlik kayıtları
- Yalnızca yapılandırılan sunucudaki ses kanalına bağlanma ve ayrılma
- Render için Blueprint dosyası ve /healthz sağlık kontrolü

Bu proje kullanıcı tokenlerini kabul etmez veya self-bot işlemleri yapmaz. Bot tokeni web arayüzüne girilmez; yalnızca dağıtım ortamının secret değişkenlerinde tutulur. Tokeni GitHub'a, loglara veya istemci koduna eklemeyin.

## Yerelde çalıştırma

1. Node.js 20 veya üstünü kurun.
2. .env.example dosyasını .env olarak kopyalayın ve ADMIN_PASSWORD, DISCORD_BOT_TOKEN ve ALLOWED_GUILD_ID değerlerini yerel ortamınızda ayarlayın.
3. npm install çalıştırın.
4. npm start çalıştırın ve http://localhost:3000 adresini açın.

.env Git tarafından izlenmez. Gerçek token veya parola commit etmeyin.

## Discord botu hazırlama

Discord Developer Portal'da kendi bot uygulamanızı oluşturup botu yönetmek istediğiniz tek sunucuya ekleyin. Botun ses kanalında View Channel ve Connect izinleri olmalı. ALLOWED_GUILD_ID yalnızca bu sunucunun ID'si olmalıdır. Arayüz, bu izinli sunucu dışındaki kanallara katılmayı reddeder.

## Render'a dağıtım

Render'da yeni bir Web Service oluşturup bu yeni private GitHub deposunu seçin. Blueprint dosyasını kullanabilir veya Node Web Service olarak kurabilirsiniz. Render Environment bölümünde ADMIN_PASSWORD, DISCORD_BOT_TOKEN ve ALLOWED_GUILD_ID değişkenlerini secret olarak ekleyin; değerleri GitHub'a koymayın. Health check yolu /healthz'dir.

render.yaml varsayılan olarak Free planı seçer; bu plan 24/7 çalışan Discord botu için garanti vermez. Render belgelerine göre Free web servisleri 15 dakika gelen trafik almadıklarında uykuya geçer. Kesintisiz çalışma için Render'da always-on ücretli instance seçin; bu seçim ücret doğurabilir. Uptime kontrolü, Free planın sürekli çalışma garantisi değildir.

## Güvenlik kapsamı

- Tek yönetici parolası, HttpOnly/SameSite oturum çerezi ve giriş hız sınırı kullanılır.
- Bot tokeni yalnızca server-side environment değişkeninden okunur; API yanıtlarına veya arayüze gönderilmez.
- Ses kontrolü yalnızca ALLOWED_GUILD_ID içindeki normal voice kanallarıyla sınırlıdır.
- Kullanıcı tokeni, self-bot, token toplama/yükleme veya rastgele sunuculara katılma desteği yoktur.
- Bu başlangıç sürümü tek bot ve tek yönetici içindir. Çok kullanıcılı ya da çok botlu hizmet olarak yayımlamadan önce ayrı kimlik doğrulama, kalıcı oturum deposu, denetim izi ve secret yönetimi tasarlanmalıdır.
