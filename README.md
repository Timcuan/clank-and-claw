
# 🐾 Clank & Claw v2.6.4 (Agency Grade)

**The Ultimate Agentic Token Deployment Suite for Base**

Deploy High-Performance ERC-20 tokens via **Telegram Bot** (with premium UI/UX) or **CLI**. Built for speed, reliability, and scale.

![Clanker](https://img.shields.io/badge/Clanker_SDK-v4.2.0-blue)
![Status](https://img.shields.io/badge/Status-Production_Ready-green)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## ✨ Key Features (v2.6.4)

### 🤖 Premium Telegram Agent
- **Dashboard UI**: Real-time deployment status, wallet balance, and storage health.
- **Smart Parsing**: Context-aware input handling. Paste a tweet link, upload an image, or type natural language commands freely.
- **Concurrency Safe**: Multi-user support with isolated session management. No cross-pollution of configs.
- **Rapid Fire Mode**: `/go PEPE "Pepe Token" 2%` for instant setup.
- **Spoofing & Stealth**: Advanced routing for deployment anonymity.

### 🛠️ Robust Core
- **Dual Mode**: Works as a standalone CLI or a persistent Bot.
- **Multi-Provider IPFS**: Fallback support for Pinata, NFT.Storage, and Infura.
- **Gas Optimized**: Smart gas estimation for faster inclusion on Base.
- **Strict Validation**: Pre-flight checks for keys, fees, and metadata.

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/Timcuan/clank-and-claw.git
cd clank-and-claw
npm install
```

### 2. Configuration
Run the interactive setup wizard:
```bash
npm run setup
```
*Follow the prompts to configure your Wallet (Private Key), RPC, and IPFS keys.*

### 3. Usage

#### 🤖 Run the Telegram Bot
```bash
npm run start
```
*Or specifically:* `node telegram-bot.js`

**Bot Commands:**
| Command | Description |
|---------|-------------|
| `/deploy` | Start the interactive wizard |
| `/go <SYMBOL> "<NAME>" <FEES>` | Rapid deployment (skip steps) |
| `/spoof <ADDRESS>` | Enable stealth spoofing to target address |
| `/status` | Check wallet balance & storage providers |
| `/cancel` | Abort current operation |

#### 💻 Run via CLI
Edit `token.json` then run:
```bash
npm run deploy
```

---

## 🧠 Smart Capabilities

### Context Awareness
The bot understands context links (Tweets, Casts) and Social links (Telegram, Website) instantly.
- **Just paste a tweet:** The bot attaches it as deployment context.
- **Paste a website:** The bot adds it to metadata.
- **Upload an image:** The bot uploads to IPFS automatically.

### Concurrency Safety
Uses a session-based architecture where every user's configuration is isolated in memory.
- **No Global State Pollution**: `process.env` is never modified during bot runtime.
- **Thread Locking**: Prevents accidental double-deployments via `isDeploying` locks.

---

## 📁 Project Structure

```
clank-and-claw/
├── telegram-bot.js      # 🤖 Main Bot Logic (Premium UX)
├── clanker-core.js      # ⚙️ Core Deployment Engine
├── deploy.js            # 💻 CLI Entry Point
├── lib/
│   ├── config.js        # 📝 Config Builders (Safe & Legacy)
│   ├── session-manager.js # 🧠 State Management
│   ├── parser.js        # 🔍 Input Analysis
│   ├── validator.js     # 🛡️ Safety Checks
│   └── utils.js         # 🛠️ Helpers
└── token.json           # 📄 Template for CLI 
```

---

## 🛡️ Security

- **Private Keys**: Handled only in memory or read from `.env` (never logged).
- **Strict Mode**: Validation prevents invalid fee structures or missing data.
- **Auto-Cleanup**: Stale sessions are purged automatically after 15 minutes.

---

---

## 🏗️ Production Setup (Server)

To ensure the bot runs 24/7 with auto-restart capabilities, use **PM2**.

1. **Install PM2 globally:**
   ```bash
   npm install pm2 -g
   ```

2. **Start the Bot:**
   ```bash
   pm2 start ecosystem.config.cjs
   ```
   *This starts the bot in background mode with auto-restart on crash and memory leak protection.*

3. **Monitor:**
   ```bash
   pm2 list      # Check status
   pm2 logs      # View live logs
   pm2 monit     # Dashboard
   ```

