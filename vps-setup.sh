#!/bin/bash
set -euo pipefail

# ==========================================
# 🖥️  CLANKER VPS SETUP SCRIPT (Debian/Ubuntu)
# ==========================================
# Run this on your VPS:
# curl -sL [URL_TO_THIS_SCRIPT] | bash

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

echo "🚀 Starting Clanker VPS Setup..."

# 1. Update Packages
echo "📦 Updating packages..."
$SUDO apt update -y

# 2. Install Dependencies
echo "🛠️  Installing dependencies..."
$SUDO apt install -y curl git build-essential python3 tmux ufw

# 3. Install Node.js LTS
if ! command -v node >/dev/null 2>&1; then
    echo "⬇️  Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO -E bash -
    $SUDO apt install -y nodejs
fi

# 4. Clone / Update Project
REPO_URL="https://github.com/Timcuan/clank-and-claw.git"
PROJECT_DIR="clank-and-claw"

if [ ! -d "${PROJECT_DIR}/.git" ]; then
    echo "📂 Cloning repository..."
    git clone "${REPO_URL}" "${PROJECT_DIR}"
else
    echo "🔄 Repository already exists. Pulling latest changes..."
    git -C "${PROJECT_DIR}" pull
fi

cd "${PROJECT_DIR}"

# 5. Install NPM Packages
if [ -f "package.json" ]; then
    echo "📦 Installing NPM dependencies..."
    npm install
else
    echo "⚠️  package.json not found. Please ensure you are in the project folder."
fi

# 6. Environment Check
if [ ! -f ".env" ]; then
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo "✅ .env created. PLEASE EDIT IT with your PRIVATE_KEY before deploying."
fi

# 7. Security Hardening (UFW + SSH Key-only if safe)
echo "🔐 Configuring UFW firewall..."
$SUDO ufw allow OpenSSH
if ! $SUDO ufw status | grep -q "Status: active"; then
    $SUDO ufw --force enable
fi

echo "🔐 Checking SSH key-only auth..."
TARGET_USER="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
AUTH_KEYS="${HOME_DIR}/.ssh/authorized_keys"

if [ -s "$AUTH_KEYS" ]; then
    echo "✅ Found authorized_keys for ${TARGET_USER}. Enforcing key-only auth."
    SSHD_CONFIG="/etc/ssh/sshd_config"
    $SUDO cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak"

    $SUDO sed -i 's/^#\\?PasswordAuthentication .*/PasswordAuthentication no/' "$SSHD_CONFIG"
    $SUDO sed -i 's/^#\\?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' "$SSHD_CONFIG"
    $SUDO sed -i 's/^#\\?ChallengeResponseAuthentication .*/ChallengeResponseAuthentication no/' "$SSHD_CONFIG" || true

    if command -v systemctl >/dev/null 2>&1; then
        $SUDO systemctl reload ssh || $SUDO systemctl reload sshd || true
    else
        $SUDO service ssh reload || $SUDO service sshd reload || true
    fi
else
    echo "⚠️  No authorized_keys found for ${TARGET_USER}. Skipping key-only auth."
    echo "    Add your SSH key to ${AUTH_KEYS}, then re-run this script."
fi

echo ""
echo "=========================================="
echo "🎉 SETUP COMPLETE!"
echo "To deploy, run: node deploy.js"
echo "OpenClaw (JSON input): node openclaw-handler.js"
echo "=========================================="
