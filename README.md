# 🐾 Clank & Claw (Clanker SDK v4.1 Enhanced)

A professional-grade, modular framework for deploying automated liquidity tokens on the **Base** blockchain using the **Clanker SDK**. 

Optimized for **AI Agent** integration (OpenClaw) and **Degen** deployments (High Tax/Spoofing).

## 🚀 Features

- **🛡️ Strict Mode**: Guarantees Clankerworld "Checklist" verification and 100% indexing reliability.
- **🏴‍☠️ Degen Mode**: Bypass verification for high-profit viral tokens (Fees up to 30%).
- **🎭 Admin Spoofing**: Mask your primary wallet by redirecting rewards to a secondary address.
- **🤖 AI Ready**: Modular architecture (`clanker-core.js`) and OpenClaw tool schemas included.
- **🔫 Sniper Protection**: Built-in decaying fees to combat launch-day bots.
- **📱 Termux Support**: Deploy directly from your Android phone.

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
2. **Logic**: The agent can import `deployToken` from `clanker-core.js` for programmatic control.

---

## 📱 Mobile (Termux) Setup

Run the automated setup on your Android device:
```bash
curl -sL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/termux-setup.sh | bash
```

---

## 📜 License
MIT
