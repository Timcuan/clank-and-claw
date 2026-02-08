#!/bin/bash
# ==========================================
# 📱 CLANKER TERMUX SETUP SCRIPT
# ==========================================
# Run this on your Android device in Termux:
# curl -sL [URL_TO_THIS_SCRIPT] | bash
# Or copy it locally and run: chmod +x setup.sh && ./setup.sh

echo "🚀 Starting Clanker Environment Setup for Termux..."

# 1. Update Packages
echo "📦 Updating Termux packages..."
pkg update -y && pkg upgrade -y

# 2. Install Dependencies
echo "🛠️  Installing Node.js, Git, and Build Tools..."
pkg install -y nodejs-lts git python make clang binutils

# 3. Clone / Setup Project
if [ ! -d "Clanker" ]; then
    echo "📂 Creating project directory..."
    mkdir Clanker
    cd Clanker
else
    cd Clanker
fi

# 4. Install NPM Packages
if [ -f "package.json" ]; then
    echo "📦 Installing NPM dependencies..."
    npm install
else
    echo "⚠️  package.json not found. Please ensure you are in the project folder."
fi

# 5. Environment Check
if [ ! -f ".env" ]; then
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo "✅ .env created. PLEASE EDIT IT with your PRIVATE_KEY before deploying."
fi

echo ""
echo "=========================================="
echo "🎉 SETUP COMPLETE!"
echo "To deploy, run: node deploy.js"
echo "=========================================="
