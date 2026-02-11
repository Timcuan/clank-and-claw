#!/bin/bash
set -euo pipefail

# ==========================================
# 🖥️  CLANK & CLAW VPS SETUP (Debian/Ubuntu)
# ==========================================
# Run: curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

PROJECT_DIR="clank-and-claw"
REPO_URL="https://github.com/Timcuan/clank-and-claw.git"

echo "🚀 Starting Clank & Claw VPS Setup..."

check_endpoint() {
    local url="$1"
    local label="$2"
    if curl -fsS --max-time 8 "$url" >/dev/null 2>&1; then
        echo "✅ ${label} reachable"
    else
        echo "⚠️  ${label} unreachable (check DNS/firewall/gateway)"
    fi
}

check_kubo_api_endpoint() {
    local base="${1%/}"
    local label="$2"
    local code
    code="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' -X POST --data '' "$base/api/v0/version" 2>/dev/null || true)"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
        echo "✅ ${label} reachable"
    else
        echo "⚠️  ${label} unreachable (check kubo service/api bind)"
    fi
}

# ─────────────────────────────────────────
# 1. System Updates
# ─────────────────────────────────────────
echo "📦 Updating system packages..."
$SUDO apt update -y && $SUDO apt upgrade -y

# ─────────────────────────────────────────
# 2. Install Dependencies
# ─────────────────────────────────────────
echo "🛠️  Installing dependencies..."
$SUDO apt install -y curl git build-essential python3 tmux ufw jq dnsutils ca-certificates netcat-openbsd

# ─────────────────────────────────────────
# 3. Install Node.js LTS
# ─────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
    echo "⬇️  Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO -E bash -
    $SUDO apt install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

# ─────────────────────────────────────────
# 4. Clone / Update Repository
# ─────────────────────────────────────────
cd ~
if [ ! -d "${PROJECT_DIR}/.git" ]; then
    echo "📂 Cloning repository..."
    git clone "${REPO_URL}" "${PROJECT_DIR}"
else
    echo "🔄 Pulling latest changes..."
    if ! git -C "${PROJECT_DIR}" pull --ff-only; then
        echo "⚠️  Fast-forward pull failed. Trying safe rebase update..."
        git -C "${PROJECT_DIR}" fetch origin
        git -C "${PROJECT_DIR}" checkout main
        git -C "${PROJECT_DIR}" pull --rebase origin main
    fi
fi

cd "${PROJECT_DIR}"
chmod +x ./vps-manager.sh 2>/dev/null || true

# ─────────────────────────────────────────
# 5. Install NPM Dependencies
# ─────────────────────────────────────────
echo "📦 Installing NPM dependencies..."
npm install --omit=dev

# ─────────────────────────────────────────
# 5.5 Install PM2 (recommended bot runtime)
# ─────────────────────────────────────────
echo "🧰 Ensuring PM2 is installed..."
if ! command -v pm2 >/dev/null 2>&1; then
    if [ -n "$SUDO" ]; then
        $SUDO npm install -g pm2
    else
        npm install -g pm2
    fi
else
    echo "✅ PM2 already installed: $(pm2 -v)"
fi

# ─────────────────────────────────────────
# 6. Setup Environment
# ─────────────────────────────────────────
if [ ! -f ".env" ]; then
    echo "📝 Creating .env from template..."
    if [ -f ".env.vps.example" ]; then
        cp .env.vps.example .env
    elif [ -f ".env.example" ]; then
        cp .env.example .env
    else
        touch .env
        echo "⚠️  No .env template found. Created empty .env"
    fi
    echo ""
    echo "⚠️  IMPORTANT: Edit .env with your PRIVATE_KEY before deploying!"
    echo "   nano .env"
    echo ""
fi

# ─────────────────────────────────────────
# 7. Firewall Configuration
# ─────────────────────────────────────────
echo "🔐 Configuring UFW firewall..."
$SUDO ufw allow OpenSSH
if ! $SUDO ufw status | grep -q "Status: active"; then
    $SUDO ufw --force enable
fi

# ─────────────────────────────────────────
# 8. SSH Hardening (if keys exist)
# ─────────────────────────────────────────
TARGET_USER="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
AUTH_KEYS="${HOME_DIR}/.ssh/authorized_keys"

if [ -s "$AUTH_KEYS" ]; then
    echo "🔐 Enforcing SSH key-only authentication..."
    SSHD_CONFIG="/etc/ssh/sshd_config"
    $SUDO cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak"
    $SUDO sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' "$SSHD_CONFIG"
    $SUDO sed -i 's/^#\?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' "$SSHD_CONFIG"
    $SUDO systemctl reload ssh 2>/dev/null || $SUDO systemctl reload sshd 2>/dev/null || true
else
    echo "⚠️  No SSH keys found. Password auth remains enabled."
fi

# ─────────────────────────────────────────
# 9. Create Helper Scripts
# ─────────────────────────────────────────
echo "📝 Creating helper scripts..."

# Quick deploy script
cat > ~/deploy-token.sh << 'EOF'
#!/bin/bash
cd ~/clank-and-claw
node deploy.js
EOF
chmod +x ~/deploy-token.sh

# OpenClaw runner
cat > ~/openclaw.sh << 'EOF'
#!/bin/bash
cd ~/clank-and-claw
node openclaw-handler.js "$@"
EOF
chmod +x ~/openclaw.sh

# Unified manager launcher
cat > ~/clawctl << 'EOF'
#!/bin/bash
set -euo pipefail
cd ~/clank-and-claw
bash ./vps-manager.sh "$@"
EOF
chmod +x ~/clawctl

cat > ~/claw-wizard.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl wizard
EOF
chmod +x ~/claw-wizard.sh

cat > ~/claw-update.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl update "$@"
EOF
chmod +x ~/claw-update.sh

cat > ~/claw-doctor.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl doctor "$@"
EOF
chmod +x ~/claw-doctor.sh

cat > ~/claw-uninstall.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl uninstall "$@"
EOF
chmod +x ~/claw-uninstall.sh

cat > ~/claw-kubo.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-install --yes "$@"
EOF
chmod +x ~/claw-kubo.sh

# Network diagnostics helper
cat > ~/claw-netcheck.sh << 'EOF'
#!/bin/bash
set -euo pipefail

echo "🔎 Clank & Claw Network Check"
echo "=============================="

check() {
  local label="$1"
  local cmd="$2"
  if bash -lc "$cmd" >/dev/null 2>&1; then
    echo "✅ $label"
  else
    echo "❌ $label"
  fi
}

check "DNS resolve api.telegram.org" "getent hosts api.telegram.org"
check "DNS resolve mainnet.base.org" "getent hosts mainnet.base.org"
check "Telegram API health" "curl -fsS --max-time 8 https://api.telegram.org"
check "Base RPC health" "curl -fsS --max-time 8 -H 'content-type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[]}' https://mainnet.base.org"
check "Gateway pinata" "curl -fsS --max-time 8 https://gateway.pinata.cloud/ipfs"
check "Local Kubo API (optional)" "curl -fsS --max-time 5 -X POST --data '' http://127.0.0.1:5001/api/v0/version"

echo ""
echo "Tips:"
echo "- Verify .env: RPC_URL / RPC_FALLBACK_URLS / TELEGRAM_API_BASES / IPFS_GATEWAYS / CONFIG_STORE_PATH / REQUIRE_CONTEXT / SMART_VALIDATION"
echo "- If DNS unstable: sudo systemctl restart systemd-resolved"
echo "- Use PM2 logs: pm2 logs clanker-bot"
EOF
chmod +x ~/claw-netcheck.sh

# Telegram bot runner
cat > ~/run-bot.sh << 'EOF'
#!/bin/bash
set -euo pipefail
cd ~/clank-and-claw

if pgrep -fa "node .*telegram-bot.js" >/dev/null 2>&1; then
  echo "❌ Bot sudah jalan di proses lain."
  echo "   Hentikan dulu proses lama supaya tidak conflict getUpdates."
  echo "   Cek: pgrep -fa 'telegram-bot.js'"
  exit 1
fi

if command -v pm2 >/dev/null 2>&1; then
  PM2_PID="$(pm2 pid clanker-bot 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "${PM2_PID}" ] && [ "${PM2_PID}" != "0" ]; then
    echo "❌ clanker-bot sedang aktif di PM2 (PID ${PM2_PID})."
    echo "   Gunakan: ~/bot-stop.sh  atau  pm2 stop clanker-bot"
    exit 1
  fi
fi

if [ -x ~/claw-netcheck.sh ]; then
  ~/claw-netcheck.sh || true
fi
echo "🤖 Starting Clank & Claw Telegram Bot..."
echo "   Press Ctrl+C to stop"
node telegram-bot.js
EOF
chmod +x ~/run-bot.sh

# PM2 start helper (recommended)
cat > ~/bot-start.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl start "$@"
EOF
chmod +x ~/bot-start.sh

# Telegram setup helper
cat > ~/bot-setup.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl telegram-setup "$@"
EOF
chmod +x ~/bot-setup.sh

cat > ~/ipfs-setup.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl ipfs-setup "$@"
EOF
chmod +x ~/ipfs-setup.sh

cat > ~/kubo-setup.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-install --yes "$@"
EOF
chmod +x ~/kubo-setup.sh

cat > ~/kubo-status.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-status "$@"
EOF
chmod +x ~/kubo-status.sh

cat > ~/kubo-start.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-start "$@"
EOF
chmod +x ~/kubo-start.sh

cat > ~/kubo-stop.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-stop "$@"
EOF
chmod +x ~/kubo-stop.sh

cat > ~/kubo-restart.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl kubo-restart "$@"
EOF
chmod +x ~/kubo-restart.sh

cat > ~/bot-stop.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl stop "$@"
EOF
chmod +x ~/bot-stop.sh

cat > ~/bot-status.sh << 'EOF'
#!/bin/bash
set -euo pipefail
~/clawctl status "$@"
EOF
chmod +x ~/bot-status.sh

cat > ~/bot-enable-autostart.sh << 'EOF'
#!/bin/bash
set -euo pipefail
if ! command -v pm2 >/dev/null 2>&1; then
  echo "❌ pm2 not installed"
  exit 1
fi

pm2 save
if pm2 startup systemd -u "$(whoami)" --hp "$HOME"; then
  echo "✅ PM2 startup configured"
else
  echo "⚠️  Jalankan command startup PM2 yang ditampilkan di atas (biasanya pakai sudo), lalu:"
  echo "    pm2 save"
fi
EOF
chmod +x ~/bot-enable-autostart.sh

# Ensure log directory exists for PM2 ecosystem
mkdir -p ~/clank-and-claw/logs

# Install/repair Kubo local IPFS (best effort)
echo "🧩 Ensuring local Kubo IPFS is installed..."
if [ -x ~/clawctl ]; then
    ~/clawctl kubo-install --yes || echo "⚠️  Kubo auto-install failed (run ~/claw-kubo.sh manually)"
fi

# Quick network preflight summary
echo "🌐 Running quick network preflight..."
check_endpoint "https://api.telegram.org" "Telegram API"
check_endpoint "https://mainnet.base.org" "Base RPC"
check_endpoint "https://gateway.pinata.cloud/ipfs" "IPFS Gateway"
check_kubo_api_endpoint "http://127.0.0.1:5001" "Local Kubo API (optional)"

# ─────────────────────────────────────────
# Done!
# ─────────────────────────────────────────
echo ""
echo "=========================================="
echo "🎉 SETUP COMPLETE!"
echo "=========================================="
echo ""
echo "📁 Project: ~/clank-and-claw"
echo ""
echo "🚀 Quick Commands:"
echo "   ~/clawctl wizard               # All-in-one install/update/uninstall wizard"
echo "   ~/clawctl doctor               # Preflight check (token/key/rpc/ipfs/pm2)"
echo "   ~/clawctl kubo-install         # Install/repair local Kubo + service"
echo "   ~/clawctl kubo-status          # Check Kubo service/API status"
echo "   ~/clawctl telegram-setup       # Setup + validate Telegram token"
echo "   ~/clawctl ipfs-setup           # Setup IPFS upload backend (Kubo/Pinata/legacy)"
echo "   ~/clawctl shortcuts            # Repair/recreate all home helper shortcuts"
echo "   ~/claw-update.sh               # Safe update: git + npm + tests + restart"
echo "   ~/claw-doctor.sh               # Shortcut doctor check"
echo "   ~/claw-kubo.sh                 # Shortcut Kubo install/repair"
echo "   ~/claw-uninstall.sh            # Clean uninstall (with backup)"
echo "   ~/deploy-token.sh              # Deploy from .env"
echo "   ~/openclaw.sh --file input.json # Deploy from JSON"
echo "   ~/bot-setup.sh                 # Setup + validate Telegram bot token"
echo "   ~/ipfs-setup.sh                # Setup IPFS upload backend"
echo "   ~/kubo-setup.sh                # Install/repair local Kubo"
echo "   ~/kubo-status.sh               # Check Kubo status"
echo "   ~/kubo-start.sh                # Start Kubo service"
echo "   ~/kubo-stop.sh                 # Stop Kubo service"
echo "   ~/kubo-restart.sh              # Restart Kubo service"
echo "   ~/bot-start.sh                 # Start bot with PM2 (recommended)"
echo "   ~/bot-stop.sh                  # Stop PM2 bot"
echo "   ~/bot-status.sh                # Check bot status"
echo "   ~/bot-enable-autostart.sh      # Enable PM2 auto-start on reboot"
echo "   ~/run-bot.sh                   # Start direct (manual, no PM2)"
echo "   ~/claw-netcheck.sh             # Diagnose VPS network/DNS/gateway"
echo ""
echo "🤖 Telegram Bot Setup:"
echo "   1. ~/kubo-status.sh            # Pastikan local Kubo API active"
echo "   2. ~/bot-setup.sh              # Input token/admin + validate to Telegram API"
echo "   3. ~/bot-start.sh"
echo "   4. pm2 logs clanker-bot"
echo ""
echo "💡 Use tmux for persistent sessions:"
echo "   tmux new -s claw"
echo "=========================================="
