#!/bin/bash
# Savr — EC2 (Amazon Linux 2023) one-shot bootstrap.
# Paste the whole file into EC2 → Launch → Advanced details → User data.
#
# After boot (a few minutes):
#   * SPA + API on http://<PUBLIC_IP>:3000
#   * API_TOKEN generated at boot: /opt/savr/app/.env and /root/savr-token.txt
#   * Security group must open TCP 3000 to 0.0.0.0/0
#
# Log:  /var/log/savr-bootstrap.log
set -euxo pipefail

exec > >(tee /var/log/savr-bootstrap.log) 2>&1

# 1) System packages (Amazon Linux 2023: dnf)
dnf install -y git nodejs22 || dnf install -y git nodejs

# 2) App source (default branch is main once the repo is tidied)
mkdir -p /opt/savr
if [ ! -d /opt/savr/app/.git ]; then
  git clone --branch main https://github.com/aalok101singh/savr.git /opt/savr/app
fi
cd /opt/savr/app

# 3) Runtime dependencies (lockfile-driven)
npm ci --no-audit --no-fund

# 4) Demo token: generated at boot, never committed to git
DEMO_TOKEN="$(openssl rand -hex 24)"

cat > /opt/savr/app/.env <<ENV
HOST=0.0.0.0
API_PORT=3000
DEMO_MODE=true
API_TOKEN=${DEMO_TOKEN}
ENV

# 5) Rebuild the SPA so the public UI can click Run/Approve (token baked into the bundle)
cd /opt/savr/app/ui
npm ci --no-audit --no-fund
VITE_API_TOKEN="${DEMO_TOKEN}" npx vite build >/dev/null
cd /opt/savr/app

# 6) Owner convenience copy of the token (used for curl smoke tests)
echo "${DEMO_TOKEN}" > /root/savr-token.txt
chmod 400 /root/savr-token.txt

# 7) systemd unit
cat > /etc/systemd/system/savr.service <<'UNIT'
[Unit]
Description=Savr procurement agent API + UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/savr/app
EnvironmentFile=/opt/savr/app/.env
ExecStart=/bin/bash -lc 'npx tsx src/api/server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now savr

# 8) Health probe
sleep 3
curl -fsS http://localhost:3000/health || true