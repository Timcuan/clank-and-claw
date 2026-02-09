# 🐾 Clank & Claw v2.5

**Agentic Token Deployment Machine**

Deploy ERC-20 tokens on **Base** via Telegram Bot, AI Agent, or CLI with full spoofing support.

## ✨ Key Features

- 🤖 **Telegram Bot** - Deploy from chat with natural language
- 📷 **Auto IPFS** - Send image → instant Pinata upload  
- 🔗 **Smart Parsing** - Paste link → auto-detect platform
- 🎭 **Stealth Mode** - Spoof reward recipients
- 💰 **High Tax** - 1% to 99% unrestricted fees
- 🛡️ **Hardened** - Retry logic, timeouts, error recovery

---

## 🚀 Quick Start

```bash
git clone https://github.com/Timcuan/clank-and-claw.git
cd clank-and-claw && npm install
cp .env.example .env  # Edit with your keys
npm run bot           # Start Telegram bot
```

---

## 🤖 Telegram Bot

### Setup

1. Create bot with [@BotFather](https://t.me/BotFather)
2. Get [Pinata](https://pinata.cloud) API keys
3. Add to `.env`:
```env
TELEGRAM_BOT_TOKEN=123456:ABC...
PINATA_API_KEY=xxx
PINATA_SECRET_KEY=xxx
PRIVATE_KEY=0x...
```
4. Run: `npm run bot`

### Commands

| Command | Description |
|---------|-------------|
| `/go SYMBOL "Name" 10%` | ⚡ Fast deploy |
| `/deploy` | 📝 Step-by-step wizard |
| `/status` | 💰 Check wallet |
| `/config` | ⚙️ Current session |
| `/spoof 0x...` | 🎭 Set stealth address |
| `/cancel` | ❌ Reset session |

### Usage Flow

```
You: /go PEPE "Pepe Token" 10%
Bot: ✅ Token Configured. Send image + link.

You: [send image]
Bot: ✅ Image uploaded! CID: bafkrei...

You: https://x.com/user/status/123
Bot: 🚀 READY TO DEPLOY! Type yes to deploy.

You: yes
Bot: 🎉 DEPLOYED! Address: 0x...
```

### Natural Language

Just describe your token:
```
"Deploy DOGE (Moon Doge) with 5% fees"
```
Bot auto-detects name, symbol, and fees!

### Fee Formats

| Input | Result |
|-------|--------|
| `10%` | 5% + 5% |
| `5% 5%` | 5% + 5% |
| `500bps` | 2.5% + 2.5% |
| `250 250` | 2.5% + 2.5% |

---

## 🎭 Stealth/Spoofing Mode

Redirect all rewards to a hidden wallet:

```
/spoof 0xYourStealthAddress
/go STEALTH "Hidden Token" 20%
```

The stealth address receives all fees without appearing as token admin.

---

## 📁 Project Structure

```
clank-and-claw/
├── telegram-bot.js        # Main Telegram bot
├── deploy.js              # CLI deployment
├── openclaw-handler.js    # AI agent interface
├── clanker-core.js        # SDK wrapper
├── lib/
│   ├── config.js          # Config loader
│   ├── validator.js       # Validation + feedback
│   ├── parser.js          # NL parsing
│   └── ipfs.js            # Pinata uploader
└── .env.example
```

---

## 🤖 AI Agent (OpenClaw)

### JSON Input
```bash
echo '{"name":"Token","symbol":"TKN","image":"bafk..."}' | node openclaw-handler.js
```

### Response
```json
{
  "success": true,
  "address": "0x...",
  "txHash": "0x...",
  "scanUrl": "https://basescan.org/..."
}
```

Use `openclaw-tool.json` for function calling schema.

---

## ⚙️ Configuration

### Required
| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer wallet (0x...) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `PINATA_API_KEY` | For image upload |
| `PINATA_SECRET_KEY` | For image upload |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_ADMIN_IDS` | all | Comma-separated chat IDs |
| `RPC_URL` | mainnet.base.org | Custom RPC |
| `STRICT_MODE` | false | Enforce Blue Badge rules |

---

## 🖥️ VPS Setup

```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

Run bot in background:
```bash
tmux new -s claw
~/run-bot.sh
# Ctrl+B, D to detach
```

---

## 🛡️ Error Handling

The system handles:
- ⚡ Network timeouts (auto-retry)
- 🔄 Rate limits (exponential backoff)
- 💾 Session timeouts (30 min auto-cleanup)
- ❌ Invalid inputs (helpful feedback)
- 💰 Low balance warnings

---

## 📜 License
MIT
