# INSTALL
``` sysctl -w net.ipv6.conf.default.disable_ipv6=1 && \
apt update -y && \
apt install -y git curl && \
curl -L -k -sS https://raw.githubusercontent.com/irulgood/adapter/main/install.sh -o install.sh && \
bash install.sh --repo irulgood/adapter --branch main && \
[ $? -eq 0 ] && rm -f install.sh
```

# Adapter

Adapter API ini dibuat supaya server tunnelV7 bisa merespons endpoint yang dipakai BotVPN.

Fokus versi ini:
- SSH
- VMESS
- VLESS
- TROJAN

Endpoint yang disediakan:
- POST `/vps/sshvpn`
- PATCH `/vps/renewsshvpn/:username/:days`
- DELETE `/vps/deletesshvpn/:username`
- PATCH `/vps/locksshvpn/:username`
- PATCH `/vps/unlocksshvpn/:username`
- GET `/vps/checkconfigsshvpn/:username`
- POST `/vps/changelimipsshvpn`
- POST `/vps/trialsshvpn`
- POST `/vps/vmessall`
- PATCH `/vps/renewvmess/:username/:days`
- DELETE `/vps/deletevmess/:username`
- PATCH `/vps/lockvmess/:username`
- PATCH `/vps/unlockvmess/:username`
- GET `/vps/checkconfigvmess/:username`
- POST `/vps/changelimipvmess`
- POST `/vps/trialvmessall`
- POST `/vps/vlessall`
- PATCH `/vps/renewvless/:username/:days`
- DELETE `/vps/deletevless/:username`
- PATCH `/vps/lockvless/:username`
- PATCH `/vps/unlockvless/:username`
- GET `/vps/checkconfigvless/:username`
- POST `/vps/changelimipvless`
- POST `/vps/trialvlessall`
- POST `/vps/trojanall`
- PATCH `/vps/renewtrojan/:username/:days`
- DELETE `/vps/deletetrojan/:username`
- PATCH `/vps/locktrojan/:username`
- PATCH `/vps/unlocktrojan/:username`
- GET `/vps/checkconfigtrojan/:username`
- POST `/vps/changelimiptrojan`
- POST `/vps/trialtrojanall`

## Catatan
- Adapter ini tidak menangani Shadowsocks dan ZIVPN UDP, karena di BotVPN aslinya dua fitur itu memakai pola backend berbeda.
- Adapter ini mengedit file tunnelV7 langsung, jadi jalankan sebagai root.
- Token autentikasi memakai header `Authorization`, sama seperti BotVPN.

## Instalasi

```bash
apt update && apt install -y nodejs npm
mkdir -p /root/adapter
cp -r . /root/adapter
cd /root/adapter
cp .env.example .env
nano .env
npm install
node app.js
```

Atau dengan PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

## Integrasi ke BotVPN
Isi kolom `domain` server di database BotVPN dengan domain VPS panel ini.
Isi kolom `auth` dengan nilai `API_TOKEN` yang sama.

## Health check
- GET `/health`
- GET `/`
