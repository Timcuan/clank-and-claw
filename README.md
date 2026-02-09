# 🐾 Clank & Claw v2.0

A professional-grade modular framework for deploying tokens on the **Base** blockchain using the **Clanker SDK v4**.

Optimized for **AI Agent** integration (OpenClaw) and unrestricted tax deployment (1% - 99%).

## 🚀 Features

- **⚡ Unrestricted Tax**: Deploy with any fee level (1% to 99%) without restrictions.
- **🛡️ Strict Mode**: Optional enforcement of Clankerworld "Checklist" for Blue Badge verification.
- **🤖 AI Ready**: Modular architecture and OpenClaw tool schemas for AI agent integration.
- **🔫 Sniper Protection**: Built-in decaying fees to combat launch-day bots.
- **🖥️ VPS Ready**: One-command setup for Debian/Ubuntu servers.

---

## 📁 Project Structure

```
clank-and-claw/
├── deploy.js              # Main CLI entry point
├── clanker-core.js        # Core deployment logic (SDK wrapper)
├── openclaw-handler.js    # AI agent JSON input handler
├── openclaw-tool.json     # OpenClaw tool schema
├── lib/
│   ├── config.js          # Configuration loader
│   ├── validator.js       # Validation logic
│   └── utils.js           # Shared utility functions
├── .env.example           # Configuration template
├── vps-setup.sh           # VPS automation script
└── package.json
```

---

## 🛠️ Installation

1. **Clone the Repo**:
   ```bash
   git clone https://github.com/Timcuan/clank-and-claw.git
   cd clank-and-claw
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your private key, token details, etc.
   ```

---

## 📖 Usage

### ⚙️ Basic Deployment
```bash
node deploy.js
# or
npm run deploy
```

### 🔬 Dry Run (Validation Only)
```bash
DRY_RUN=true node deploy.js
# or
npm test
```

### 🏴‍☠️ High Tax Deployment
Fees are **unrestricted** by default. Simply set your desired fees in `.env`:

```bash
# .env
FEE_CLANKER_BPS="500"   # 5%
FEE_PAIRED_BPS="500"    # 5%
# Total: 10%
```

The script will log: `🏴‍☠️ High Tax Detected (10%). Proceeding as requested.`

---

## 🤖 AI Agent Integration (OpenClaw)

### Schema
Use `openclaw-tool.json` as the tool definition for your AI agent.

### Handler
Send JSON via stdin, `--file`, or `OPENCLAW_INPUT` environment variable:

```bash
echo '{"name": "MyToken", "symbol": "MTK", "image": "ipfs://...", "STRICT_MODE": false}' | node openclaw-handler.js
```

### Direct Import
```javascript
import { deployToken } from './clanker-core.js';

const result = await deployToken({
  name: "MyToken",
  symbol: "MTK",
  image: "https://...",
  // ... full config
});
```

---

## ⚙️ Configuration Reference

### Required
| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Wallet private key (with 0x prefix) |
| `TOKEN_NAME` | Token display name |
| `TOKEN_SYMBOL` | Token ticker symbol |
| `TOKEN_IMAGE` | IPFS CID or HTTPS URL |

### Fees (Static)
| Variable | Default | Description |
|----------|---------|-------------|
| `FEE_TYPE` | `static` | `static` or `dynamic` |
| `FEE_CLANKER_BPS` | `100` | Token side fee (basis points) |
| `FEE_PAIRED_BPS` | `100` | WETH side fee (basis points) |

### Sniper Protection
| Variable | Default | Description |
|----------|---------|-------------|
| `SNIPER_STARTING_FEE` | `666777` | Initial fee (Unibps, 1M=100%) |
| `SNIPER_ENDING_FEE` | `41673` | Final fee after decay |
| `SNIPER_SECONDS_TO_DECAY` | `15` | Decay duration |

### Context (For Indexing)
| Variable | Description |
|----------|-------------|
| `CONTEXT_PLATFORM` | `farcaster`, `twitter`, or `clanker` |
| `CONTEXT_MESSAGE_ID` | **Specific post URL** (not profile!) |

> ⚠️ **Important**: `CONTEXT_MESSAGE_ID` must be a specific tweet/cast URL for proper indexing.

---

## 🖥️ VPS Setup

```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
cd clank-and-claw && node deploy.js
```

---

## 📜 License
MIT
