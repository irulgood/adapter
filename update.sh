#!/usr/bin/env bash
set -euo pipefail

APP_NAME="adapter"
SERVICE_NAME="${APP_NAME}"
INSTALL_DIR="/opt/${APP_NAME}"
REPO="${1:-}"
BRANCH="${2:-main}"

[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl belum terpasang" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip belum terpasang" >&2; exit 1; }

if [ -z "$REPO" ]; then
  echo "Usage: bash update.sh owner/repo [branch]" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ZIP_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip"
ZIP_FILE="${TMP_DIR}/repo.zip"

curl -fsSL "$ZIP_URL" -o "$ZIP_FILE"
unzip -q "$ZIP_FILE" -d "$TMP_DIR"
SRC_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -f "$SRC_DIR/app.js" ] || { echo "Source adapter tidak valid" >&2; exit 1; }
mkdir -p "$INSTALL_DIR"

tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  -C "$SRC_DIR" -cf - . | tar -C "$INSTALL_DIR" -xf -

cd "$INSTALL_DIR"
npm install --omit=dev --no-fund --no-audit
systemctl restart "$SERVICE_NAME"

echo "Update selesai untuk ${SERVICE_NAME} dari ${REPO}:${BRANCH}"
