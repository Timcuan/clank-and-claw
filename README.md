# 🐾 Clank & Claw (Clanker SDK v4.1 Enhanced)

A professional-grade, modular framework for deploying automated liquidity tokens on the **Base** blockchain using the **Clanker SDK**. 

Optimized for **AI Agent** integration (OpenClaw) and **Degen** deployments (High Tax/Spoofing).

## 🚀 Features

- **🛡️ Strict Mode**: Guarantees Clankerworld "Checklist" verification and 100% indexing reliability.
- **🏴‍☠️ Degen Mode**: Bypass verification for high-profit viral tokens (Fees up to 30%).
- **🎭 Admin Spoofing**: Mask your primary wallet by redirecting rewards to a secondary address.
- **🤖 AI Ready**: Modular architecture (`clanker-core.js`) and OpenClaw tool schemas included.
- **🔫 Sniper Protection**: Built-in decaying fees to combat launch-day bots.
- **🖥️ VPS Ready**: One-command setup for Debian/Ubuntu servers.

---

## 🛠️ Installation

1. **Clone the Repo**:
   ```bash
   git clone https://github.com/Timcuan/clank-and-claw.git
   cd clank-and-claw
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env` and fill in your details.
   ```bash
   cp .env.example .env
   ```

---

## 📖 Usage

### ⚙️ Basic Deployment
Simply run the wrapper script:
```bash
node deploy.js
```

### 🔬 Dry Run (Validation)
Test your configuration without spending gas:
```bash
DRY_RUN=true node deploy.js
```

### 🏴‍☠️ Degen Deployment (High Tax)
To launch with high fees (e.g., 10%) and a spoofed recipient:
```bash
HIGH_TAX=true FEE_CLANKER_BPS=500 FEE_PAIRED_BPS=500 ADMIN_SPOOF=0xYourHiddenWallet node deploy.js
```

---

## 🤖 AI Agent Integration (OpenClaw)

This project is built for **OpenClaw**. 

1. **Schema**: Use `openclaw-tool.json` as the tool definition for your agent.
2. **Handler (Recommended)**: Use `openclaw-handler.js` to accept rich JSON input and run the deployment logic.
3. **Logic (Direct)**: The agent can import `deployToken` from `clanker-core.js` for programmatic control.

### OpenClaw Handler Usage
Send a JSON payload via stdin (or `--file` / `OPENCLAW_INPUT`).

Minimal example:
```bash
echo '{\"TOKEN_NAME\":\"ClawBot AI\",\"TOKEN_SYMBOL\":\"CLAW\",\"TOKEN_IMAGE\":\"ipfs://...\",\"METADATA_DESCRIPTION\":\"...\",\"CONTEXT_MESSAGE_ID\":\"https://warpcast.com/...\",\"DEV_BUY_ETH_AMOUNT\":0.01}' | node openclaw-handler.js
```

Complex example:
```bash
cat <<'JSON' | node openclaw-handler.js
{
  \"TOKEN_NAME\": \"ClawBot AI\",
  \"TOKEN_SYMBOL\": \"CLAW\",
  \"TOKEN_IMAGE\": \"ipfs://...\",\n  \"METADATA_DESCRIPTION\": \"Serious long-term project.\",
  \"STRICT_MODE\": true,
  \"DEV_BUY_ETH_AMOUNT\": 0.02,
  \"SOCIALS\": { \"x\": \"https://x.com/yourproject\", \"website\": \"https://example.com\" },
  \"CONTEXT\": { \"platform\": \"farcaster\", \"messageId\": \"https://warpcast.com/...\" },
  \"FEES\": { \"type\": \"dynamic\", \"baseFee\": 100, \"maxFee\": 500 },
  \"SNIPER_FEES\": { \"startingFee\": 666777, \"endingFee\": 41673, \"secondsToDecay\": 15 },
  \"POOL\": {
    \"type\": \"Standard\",
    \"startingTick\": -230400,
    \"pairedToken\": \"WETH\",
    \"positions\": [
      { \"tickLower\": -230400, \"tickUpper\": -120000, \"positionBps\": 3000 },
      { \"tickLower\": -120000, \"tickUpper\": 887200, \"positionBps\": 7000 }
    ]
  }
}
JSON
```

---

## 🖥️ VPS Setup (Recommended)

Run the automated setup on your VPS (Debian/Ubuntu):
```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

After setup:
```bash
cd clank-and-claw
node deploy.js
```

OpenClaw JSON input:
```bash
cd clank-and-claw
node openclaw-handler.js
```

Remote from Termux (SSH into VPS):
```bash
ssh user@your-vps-ip
```

### VPS Hardening + tmux
The `vps-setup.sh` script also:
- Installs `tmux` so you can keep deployments running after disconnect.
- Enables `ufw` with `OpenSSH` allowed.
- Switches SSH to key-only auth **only if** `~/.ssh/authorized_keys` exists and is non-empty.

Suggested usage:
```bash
tmux new -s clank
```

---

## 📜 License
MIT
