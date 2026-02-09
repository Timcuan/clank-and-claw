# 🐾 Clank & Claw v2.6

**Agentic Token Deployment Machine**

Deploy ERC-20 tokens on **Base** via Telegram Bot, AI Agent, or CLI.

## ✨ New in v2.6

- 📁 **Separate Configs**: `.env` for system, `token.json` for tokens
- 🆓 **Free IPFS**: NFT.Storage (no credit card needed)
- 🔧 **Setup Wizard**: Interactive first-time setup

---

## 🚀 Quick Start

```bash
git clone https://github.com/Timcuan/clank-and-claw.git
cd clank-and-claw && npm install

# Interactive setup (recommended)
npm run setup

# Or manual: copy and edit .env.example
cp .env.example .env
```

---

## 📁 Config Files

| File | Purpose | When to Edit |
|------|---------|--------------|
| `.env` | System config (keys, API) | Once, at setup |
| `token.json` | Token details | Before each deploy |

### token.json Example

```json
{
  "name": "Pepe Token",
  "symbol": "PEPE",
  "image": "bafkrei...",
  "description": "The next Pepe",
  
  "fees": {
    "total": "10%"
  },
  
  "context": {
    "platform": "twitter",
    "url": "https://x.com/user/status/123"
  },
  
  "socials": {
    "x": "https://x.com/pepe"
  }
}
```

---

## 🆓 IPFS Providers (Free Options)

| Provider | Setup | Credit Card? |
|----------|-------|--------------|
| **NFT.Storage** | nft.storage | ❌ No |
| Pinata | pinata.cloud | ❌ No (free tier) |
| Infura | infura.io | ❌ No (free tier) |

The system auto-fallbacks between providers!

---

## 🤖 Telegram Bot

### Setup
```bash
npm run setup  # Follow prompts
npm run bot    # Start bot
```

### Commands

| Command | Description |
|---------|-------------|
| `/go SYMBOL "Name" 10%` | ⚡ Fast deploy |
| `/deploy` | 📝 Step-by-step |
| `/spoof 0x...` | 🎭 Stealth mode |
| `/status` | 💰 Wallet info |
| `/config` | ⚙️ Current session |

### Usage Flow

```
/go PEPE "Pepe Token" 10%
[send image]
https://x.com/user/status/123
yes
🎉 Deployed!
```

---

## 💻 CLI Deployment

```bash
# Edit token details
nano token.json

# Deploy
npm run deploy

# Or with custom file
node deploy.js mytoken.json

# Legacy: use .env only
node deploy.js --env
```

---

## 🖥️ VPS Deployment

```bash
# Install
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash

# Setup
cd ~/clank-and-claw
npm run setup

# Run bot (background)
tmux new -s claw
npm run bot
# Ctrl+B, D to detach
```

### Quick VPS Commands
```bash
~/run-bot.sh          # Start Telegram bot
~/deploy-token.sh     # Deploy from token.json
```

---

## 🔄 Deployment Flow on VPS

1. **First time**: Run `npm run setup`
2. **Each deploy**: Edit `token.json`, then `npm run deploy`
3. **With bot**: Just use `/go` command in Telegram!

---

## 🎭 Stealth/Spoofing

In token.json:
```json
{
  "advanced": {
    "spoofTo": "0xStealthWallet"
  }
}
```

Or via Telegram:
```
/spoof 0xStealthWallet
/go TOKEN "My Token" 10%
```

---

## 📁 Project Structure

```
clank-and-claw/
├── .env              # System config (keys)
├── token.json        # Token config (per deploy)
├── setup.js          # Interactive setup
├── deploy.js         # CLI deployment
├── telegram-bot.js   # Telegram bot
├── lib/
│   ├── config.js     # Config loader
│   ├── ipfs.js       # Multi-provider uploader
│   ├── parser.js     # NL parsing
│   └── validator.js  # Validation
└── vps-setup.sh      # VPS installer
```

---

## 📜 License
MIT
