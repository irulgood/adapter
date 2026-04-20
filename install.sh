#!/usr/bin/env bash
set -euo pipefail

APP_NAME="adapter"
SERVICE_NAME="${APP_NAME}"
INSTALL_DIR="/opt/${APP_NAME}"
BRANCH="main"
REPO=""
PORT="5889"
API_TOKEN=""
NODE_MAJOR="20"
TMP_DIR=""
SOURCE_DIR=""

log() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
}

fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "${TMP_DIR}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

usage() {
  cat <<EOF
Usage:
  Local source:
    bash install.sh [--port 5889] [--token TOKEN] [--install-dir /opt/${APP_NAME}]

  From GitHub repo:
    bash install.sh --repo owner/repo [--branch main] [--port 5889] [--token TOKEN]

Options:
  --repo         GitHub repo format owner/repo
  --branch       Branch git, default: main
  --install-dir  Folder instalasi, default: /opt/${APP_NAME}
  --port         Port API adapter, default: 5889
  --token        Token API BotVPN. Jika kosong akan dibuat otomatis.
  --help         Tampilkan bantuan
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      shift
      REPO="${1:-}"
      ;;
    --branch)
      shift
      BRANCH="${1:-}"
      ;;
    --install-dir)
      shift
      INSTALL_DIR="${1:-}"
      ;;
    --port)
      shift
      PORT="${1:-}"
      ;;
    --token)
      shift
      API_TOKEN="${1:-}"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Argumen tidak dikenal: $1"
      ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || fail "Jalankan script ini sebagai root."

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

apt_install_base() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates unzip tar xz-utils gnupg lsb-release
}

install_nodejs() {
  if need_cmd node; then
    local current
    current="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [ -n "$current" ] && [ "$current" -ge 18 ]; then
      log "Node.js v$(node -v | sed 's/^v//') sudah tersedia."
      return
    fi
  fi

  log "Menginstal Node.js ${NODE_MAJOR}.x ..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "${NODE_MAJOR}" > /etc/apt/sources.list.d/nodesource.list
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nodejs
}

resolve_source_dir() {
  if [ -f "./app.js" ] && [ -f "./package.json" ] && [ -f "./.env.example" ]; then
    SOURCE_DIR="$(pwd)"
    log "Pakai source lokal dari ${SOURCE_DIR}"
    return
  fi

  [ -n "$REPO" ] || fail "Source lokal tidak ditemukan. Gunakan --repo owner/repo jika install dari GitHub."

  TMP_DIR="$(mktemp -d)"
  local zip_url="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip"
  local zip_file="${TMP_DIR}/repo.zip"
  log "Mengunduh source dari ${zip_url}"
  curl -fsSL "$zip_url" -o "$zip_file"
  unzip -q "$zip_file" -d "$TMP_DIR"
  SOURCE_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$SOURCE_DIR" ] || fail "Gagal menemukan source adapter setelah download."
  [ -f "${SOURCE_DIR}/app.js" ] || fail "File app.js tidak ditemukan di source repo."
}

generate_token() {
  if need_cmd openssl; then
    openssl rand -hex 24
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
  fi
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

prepare_env() {
  local env_file="${INSTALL_DIR}/.env"

  if [ -f "$env_file" ]; then
    log "File .env sudah ada, mempertahankan nilai yang ada."
  else
    cp "${INSTALL_DIR}/.env.example" "$env_file"
  fi

  if [ -z "$API_TOKEN" ]; then
    local current_token
    current_token="$(grep '^API_TOKEN=' "$env_file" 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$current_token" ] && [ "$current_token" != "ganti_dengan_token_server_botvpn" ]; then
      API_TOKEN="$current_token"
    else
      API_TOKEN="$(generate_token)"
    fi
  fi

  upsert_env "$env_file" "PORT" "$PORT"
  upsert_env "$env_file" "API_TOKEN" "$API_TOKEN"
}

copy_source() {
  mkdir -p "$INSTALL_DIR"
  tar \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.env' \
    -C "$SOURCE_DIR" -cf - . | tar -C "$INSTALL_DIR" -xf -
}

install_dependencies() {
  local npm_bin
  npm_bin="$(command -v npm || true)"
  [ -n "$npm_bin" ] || fail "npm tidak ditemukan setelah instalasi Node.js."
  log "Menginstal dependency npm ..."
  cd "$INSTALL_DIR"
  npm install --omit=dev --no-fund --no-audit
}

install_service() {
  local node_bin
  node_bin="$(command -v node || true)"
  [ -n "$node_bin" ] || fail "Binary node tidak ditemukan."

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Adapter API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
ExecStart=${node_bin} ${INSTALL_DIR}/app.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
}

print_summary() {
  local ip_addr
  ip_addr="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '\n'
  printf '========================================\n'
  printf 'Install selesai\n'
  printf 'Service     : %s\n' "$SERVICE_NAME"
  printf 'Folder      : %s\n' "$INSTALL_DIR"
  printf 'Port        : %s\n' "$PORT"
  printf 'Token       : %s\n' "$API_TOKEN"
  printf 'Health URL  : http://%s:%s/health\n' "${ip_addr:-127.0.0.1}" "$PORT"
  printf 'BotVPN auth : %s\n' "$API_TOKEN"
  printf '========================================\n'
  printf '\n'
  printf 'Perintah penting:\n'
  printf '  systemctl status %s\n' "$SERVICE_NAME"
  printf '  journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '  nano %s/.env\n' "$INSTALL_DIR"
  printf '\n'
}

main() {
  need_cmd apt-get || fail "Installer ini saat ini hanya mendukung Debian/Ubuntu (apt)."
  apt_install_base
  install_nodejs
  resolve_source_dir
  copy_source
  prepare_env
  install_dependencies
  install_service
  print_summary
}

main
