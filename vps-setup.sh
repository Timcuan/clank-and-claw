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

# ─────────────────────────────────────────
# 1. System Updates
# ─────────────────────────────────────────
echo "📦 Updating system packages..."
$SUDO apt update -y && $SUDO apt upgrade -y

# ─────────────────────────────────────────
# 2. Install Dependencies
# ─────────────────────────────────────────
echo "🛠️  Installing dependencies..."
$SUDO apt install -y curl git build-essential python3 tmux ufw jq

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
    git -C "${PROJECT_DIR}" pull --ff-only || git -C "${PROJECT_DIR}" reset --hard origin/main
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
echo "   echo '{...}' | ~/openclaw.sh   # Deploy via stdin"
echo ""
echo "📝 First Steps:"
echo "   1. nano ~/clank-and-claw/.env  # Add your PRIVATE_KEY"
echo "   2. ~/deploy-token.sh           # Deploy!"
echo ""
echo "💡 Use tmux for persistent sessions:"
echo "   tmux new -s claw"
echo "=========================================="
