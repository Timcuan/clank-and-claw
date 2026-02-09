# 🚀 Release Notes - Clank & Claw v2.6.5 (Network Hardening)

### 🌐 VPS & Network Reliability
- **Multi-RPC Failover**: Added `RPC_FALLBACK_URLS` support with active endpoint health probing before deployment.
- **Receipt Recovery Across RPCs**: If primary RPC times out after tx submission, the system now attempts receipt recovery via fallback RPC providers.
- **Telegram Gateway Failover**: Added `TELEGRAM_API_BASES` rotation support to survive temporary API gateway/DNS routing issues.
- **Telegram File Endpoint Override**: Added `TELEGRAM_FILE_BASE` for custom file download base when running behind alternative gateways.
- **IPFS Gateway Redundancy**: Added `IPFS_GATEWAYS` support and multi-gateway output URLs for stronger metadata reachability.

### 🛡️ Runtime Hardening
- **Stricter Input Validation**: Hardened address/symbol/image/reward validation in `validator.js`.
- **Spoof Command Validation**: `/spoof` now validates strict EVM address format.
- **Message Safety Guards**: Added Telegram message truncation and non-throwing fallback behavior.
- **IPFS Download Safeguards**: Added content-type filtering, size prechecks, streaming size limits, and filename sanitization.

### 🧰 Operations & Tooling
- **VPS Diagnostics Script**: `vps-setup.sh` now creates `~/claw-netcheck.sh` for DNS, RPC, Telegram, and gateway health checks.
- **Safer VPS Git Update Path**: Removed destructive update fallback in setup script, replaced with safe fetch/rebase flow.
- **PM2 Resilience Tuning**: Increased restart resilience for transient network outages.
- **Hardening Test Suite**: Added `npm run test:hardening` and coverage for validation/IPFS defensive behaviors.

---
*Date: February 9, 2026*

---

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
