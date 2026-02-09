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

# ─────────────────────────────────────────
# 5. Install NPM Dependencies
# ─────────────────────────────────────────
echo "📦 Installing NPM dependencies..."
npm install --omit=dev

# ─────────────────────────────────────────
# 6. Setup Environment
# ─────────────────────────────────────────
if [ ! -f ".env" ]; then
    echo "📝 Creating .env from template..."
    cp .env.example .env
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

echo ""
echo "Tips:"
echo "- Verify .env: RPC_URL / RPC_FALLBACK_URLS / TELEGRAM_API_BASES / IPFS_GATEWAYS"
echo "- If DNS unstable: sudo systemctl restart systemd-resolved"
echo "- Use PM2 logs: pm2 logs clanker-bot"
EOF
chmod +x ~/claw-netcheck.sh

# Telegram bot runner
cat > ~/run-bot.sh << 'EOF'
#!/bin/bash
cd ~/clank-and-claw
if [ -x ~/claw-netcheck.sh ]; then
  ~/claw-netcheck.sh || true
fi
echo "🤖 Starting Clank & Claw Telegram Bot..."
echo "   Press Ctrl+C to stop"
node telegram-bot.js
EOF
chmod +x ~/run-bot.sh

# Ensure log directory exists for PM2 ecosystem
mkdir -p ~/clank-and-claw/logs

# Quick network preflight summary
echo "🌐 Running quick network preflight..."
check_endpoint "https://api.telegram.org" "Telegram API"
check_endpoint "https://mainnet.base.org" "Base RPC"
check_endpoint "https://gateway.pinata.cloud/ipfs" "IPFS Gateway"

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
echo "   ~/deploy-token.sh              # Deploy from .env"
echo "   ~/openclaw.sh --file input.json # Deploy from JSON"
echo "   ~/run-bot.sh                   # Start Telegram bot"
echo "   ~/claw-netcheck.sh             # Diagnose VPS network/DNS/gateway"
echo ""
echo "🤖 Telegram Bot Setup:"
echo "   1. nano ~/clank-and-claw/.env  # Add TELEGRAM_BOT_TOKEN"
echo "   2. ~/run-bot.sh"
echo ""
echo "💡 Use tmux for persistent sessions:"
echo "   tmux new -s claw"
echo "=========================================="
