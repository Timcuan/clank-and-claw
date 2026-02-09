# 🐾 Clank & Claw v2.1

Deploy ERC-20 tokens on **Base** blockchain via CLI, AI Agent, or **Telegram Bot**.

## 🚀 Quick Start

```bash
git clone https://github.com/Timcuan/clank-and-claw.git
cd clank-and-claw && npm install
cp .env.example .env
# Edit .env with your credentials
```

## 📁 Project Structure

```
clank-and-claw/
├── deploy.js              # CLI deployment
├── telegram-bot.js        # 🆕 Telegram bot
├── openclaw-handler.js    # AI agent interface
├── clanker-core.js        # SDK wrapper
├── lib/
│   ├── config.js          # Configuration loader
│   ├── validator.js       # Validation logic
│   ├── parser.js          # 🆕 Link & command parser
│   ├── ipfs.js            # 🆕 IPFS/Pinata uploader
│   └── utils.js           # Utilities
└── .env.example
```

---

## 🤖 Telegram Bot

Deploy tokens directly from Telegram chat!

### Setup

1. Create bot with [@BotFather](https://t.me/BotFather)
2. Get API keys from [Pinata](https://pinata.cloud)
3. Add to `.env`:
```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_ADMIN_IDS=12345678,87654321  # Optional: restrict access
PINATA_API_KEY=your_key
PINATA_SECRET_KEY=your_secret
```
4. Run: `npm run bot`

### Commands

| Command | Description |
|---------|-------------|
| `/deploy` | Start deployment wizard |
| `/quick SYMBOL "Name" 10%` | Quick deploy |
| `/status` | Check wallet balance |
| `/help` | Show help |
| `/cancel` | Cancel current operation |

### Usage Examples

**Wizard Mode:**
```
/deploy
> Pepe Token
> PEPE
> 10%
> [send image]
> https://x.com/user/status/123
> yes
```

**Quick Mode:**
```
/quick DOGE "Dogecoin 2.0" 5%
[send image]
https://x.com/user/status/456
```

**Natural Language:**
```
Deploy PEPE (Pepe Token) with 10% fees
[send image]
https://x.com/user/status/789
```

### Features

- 📷 **Auto IPFS Upload**: Send any image → automatically uploaded to Pinata
- 🔗 **Auto Link Parse**: Send tweet/cast URL → extracted for indexing
- 💬 **Natural Language**: Understands "Deploy SYMBOL (Name) 10%"
- 🛡️ **Admin Restriction**: Limit bot access to specific chat IDs

---

## 🤖 AI Agent Integration

### JSON Interface

```bash
echo '{"name":"Token","symbol":"TKN","image":"bafk..."}' | node openclaw-handler.js
```

**Response:**
```json
{
  "success": true,
  "address": "0x...",
  "txHash": "0x...",
  "scanUrl": "https://basescan.org/...",
  "logs": [...]
}
```

### Tool Schema

Use `openclaw-tool.json` for function calling definitions.

---

## ⚙️ Configuration

### Required

| Field | Description |
|-------|-------------|
| `PRIVATE_KEY` | Deployer wallet |
| `TELEGRAM_BOT_TOKEN` | For Telegram bot |
| `PINATA_API_KEY` | For image upload |
| `PINATA_SECRET_KEY` | For image upload |

### Fee Formats

| Format | Meaning |
|--------|---------|
| `10%` | 5% + 5% split |
| `5% 5%` | Explicit split |
| `500bps` | 500 basis points |
| `250 250` | bps split |

---

## 🖥️ VPS Deployment

```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

### Run Bot in Background

```bash
tmux new -s claw
npm run bot
# Ctrl+B, D to detach
```

---

## 📜 License
MIT
