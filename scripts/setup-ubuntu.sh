#!/usr/bin/env bash
set -euo pipefail

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 22 ]; then
  echo "Hobbyfiles requires Node.js 22 or newer (found $(node -v))." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This setup script supports Ubuntu/Debian and WSL Ubuntu." >&2
  exit 1
fi

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  echo "sudo is required to install native preview packages." >&2
  exit 1
fi

"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y \
  redis-server \
  libimage-exiftool-perl \
  ghostscript \
  poppler-utils \
  ffmpeg \
  p7zip-full \
  firejail \
  unrar \
  file

yarn install --frozen-lockfile --production=false
node ./scripts/check-preview-tools.js
yarn prestart

echo "Hobbyfiles dependencies and production assets are ready."
