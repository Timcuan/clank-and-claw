# 🚀 Release Notes - Clank & Claw v1.0.0

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
