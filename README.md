# 🐾 Clank & Claw v2.0

Deploy ERC-20 tokens on **Base** blockchain with automated liquidity using **Clanker SDK v4**.

Optimized for **AI Agent** integration and **VPS deployment**.

## 🚀 Quick Start

```bash
git clone https://github.com/Timcuan/clank-and-claw.git
cd clank-and-claw && npm install
cp .env.example .env
# Edit .env with your PRIVATE_KEY
node deploy.js
```

## 📁 Project Structure

```
clank-and-claw/
├── deploy.js              # CLI deployment
├── clanker-core.js        # SDK wrapper
├── openclaw-handler.js    # AI agent interface (JSON in/out)
├── openclaw-tool.json     # AI tool schema
├── lib/
│   ├── config.js          # Configuration loader
│   ├── validator.js       # Validation logic
│   └── utils.js           # Utilities
├── vps-setup.sh           # One-command VPS setup
└── .env.example           # Configuration template
```

---

## 🤖 AI Agent Integration

### Tool Schema
Use `openclaw-tool.json` for your AI agent's function calling definition.

### JSON Input/Output
The handler accepts JSON and returns JSON - perfect for AI agents:

```bash
echo '{"name":"MyToken","symbol":"MTK","image":"bafk..."}' | node openclaw-handler.js
```

**Response:**
```json
{
  "success": true,
  "address": "0x...",
  "txHash": "0x...",
  "scanUrl": "https://basescan.org/address/0x...",
  "logs": [...]
}
```

### Minimal Example
```json
{
  "name": "MyToken",
  "symbol": "MTK",
  "image": "bafkreiesnzcilwuuisbrzznvwqozqlgodz7t7a4amhvpurv65nnjfuodbq"
}
```

### Full Example
```json
{
  "name": "Premium Token",
  "symbol": "PREM",
  "image": "bafkrei...",
  "description": "A premium token with custom fees",
  "admin": "0xYourWallet",
  "fees": {
    "clankerFee": 250,
    "pairedFee": 250
  },
  "context": {
    "platform": "twitter",
    "messageId": "https://x.com/user/status/123456789"
  },
  "socials": {
    "x": "https://x.com/myproject"
  },
  "sniperFees": {
    "startingFee": 666777,
    "endingFee": 41673,
    "secondsToDecay": 15
  },
  "vanity": true,
  "dryRun": false
}
```

### Input Methods
```bash
# Stdin (recommended for AI)
echo '{"name":"Test",...}' | node openclaw-handler.js

# File
node openclaw-handler.js --file config.json

# Environment variable
OPENCLAW_INPUT='{"name":"Test",...}' node openclaw-handler.js
```

---

## 🖥️ VPS Deployment

### One-Command Setup
```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

### After Setup
```bash
nano ~/clank-and-claw/.env   # Add PRIVATE_KEY
~/deploy-token.sh            # Deploy from .env
~/openclaw.sh --file x.json  # Deploy from JSON
```

### What the Script Does
- Installs Node.js LTS, git, tmux, jq, ufw
- Clones/updates the repository
- Creates `.env` from template
- Enables firewall (OpenSSH allowed)
- Hardens SSH (key-only if keys exist)
- Creates helper scripts

---

## ⚙️ Configuration

### Required Fields
| Field | Description |
|-------|-------------|
| `name` | Token name |
| `symbol` | Token ticker |
| `image` | IPFS CID or HTTPS URL |

### Optional Fields
| Field | Default | Description |
|-------|---------|-------------|
| `admin` | from .env | Wallet that owns the token |
| `fees.clankerFee` | 100 | Token side fee (bps) |
| `fees.pairedFee` | 100 | WETH side fee (bps) |
| `vanity` | true | Request vanity address |
| `dryRun` | false | Validate without deploying |
| `strictMode` | false | Enforce Blue Badge requirements |

### Fee Reference
- `100 bps = 1%`
- `500 bps = 5%`
- `1000 bps = 10%`
- No restrictions - set any value 0-9900

---

## 📜 License
MIT
