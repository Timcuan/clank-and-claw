# 🚀 Release Notes - Clank & Claw v2.6.4

## 🌟 Key Highlights
This initial release transforms the basic Clanker SDK into a robust, AI-ready deployment engine with a focus on **indexing reliability** and **degen flexibility**.

### ✨ New Features
- **Modular Core Architecture**: Separated logic (`clanker-core.js`) from CLI (`deploy.js`) for library-level imports.
- **OpenClaw Support**: Native JSON schema Tool definition added for seamless AI agent integration.
- **Degen Mode**: 
    - Introduced `HIGH_TAX` flag to bypass the 5% verification cap (allowing up to 30%).
    - Introduced `ADMIN_SPOOF` to redirect rewards and mask the deployer's primary wallet.
- **Indexing Fixes**: Mandatory Farcaster context and minimum seed-buy ($0.001 ETH) enforced in `STRICT_MODE`.
- **Vanity Address Support**: Easy toggle for the `.B07` Clanker suffix.
- **Sniper Fee Decay**: SDK v4.1 parity for bot protection.
- **Mobile Support**: Added `termux-setup.sh` for easy Android deployments.

### 🔧 Bug Fixes & Robustness
- **Zero Liquidity Resolution**: Fixed a bug where tick ranges were too wide, diluting liquidity.
- **Position Validation**: Implemented automatic tick rounding to protocol-compliant `tickSpacing` multiples.
- **IPFS Conversion**: Automatic normalization of `Qm...` and `baf...` CIDs to Pinata gateways.

### 📝 Documentation
- Created a comprehensive `README.md`.
- Consolidated all features into a detailed `walkthrough.md`.

---
*Date: February 8, 2026*

---

# 🚀 Release Notes - Clank & Claw v2.6.4 (Agency Grade)

### 🛡️ Concurrency & Safety
- **Session-Locked Architecture**: Isolated per-user memory handling to prevent data cross-pollution in multi-user Telegram environments.
- **process.env Sanitization**: Eliminated global environment manipulation during runtime; deployments now use safe, isolated config objects.
- **Double-Deploy Protection**: Implemented `isDeploying` locks to prevent accidental double-spending and duplicate transactions.

### 🧠 Smart Features & Hardening
- **Smart Context Indexing**: Automated extraction of Tweet IDs and Cast Hashes from raw URLs. If no context is provided, it auto-scans social links or uses a system fallback to ensure Clankerworld indexing.
- **Network Hardening**: Increased RPC retry counts (5x) and added exponential backoff for extreme reliability on Base Mainnet.
- **Graceful Error Recovery**: Added global `uncaughtException` and `unhandledRejection` handlers to keep the bot alive 24/7.

### ⚡ Performance & UX
- **Turbo Confirmation**: Optimized blockchain polling (1s interval) and fast-fail timeouts (20s) for snappier deployment feedback.
- **Dashboard UI**: Comprehensive deployment summary showing token details, socials count, spoofing status, and verification indicators.
- **Standardized Fees**: Updated default fees to 5% (Static) and 1%-10% (Dynamic) to align with platform best practices.

### 🧹 Maintenance
- **PM2 Ready**: Added `ecosystem.config.cjs` for professional process management and auto-restart capability.
- **Repo Cleanup**: Removed legacy test files and updated `token.example.json`.

---
*Date: February 10, 2026*

