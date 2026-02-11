# 🚀 Release Notes - Clank & Claw (Unreleased - Bot Modularization + Deploy Guardrails)

### 🧰 Deploy CLI Hardening
- **Strict Argument Parser**: `deploy.js` now fails fast on unknown flags, duplicate JSON files, and invalid argument combinations.
- **`--help` and Usage Docs**: Added explicit CLI usage output for safer ops handoff.
- **Spoof Guardrails**: `--spoof` now requires a valid `0x` EVM address and explicit value.
- **Private Key Validation**: PRIVATE_KEY is normalized and validated before spoof reward/account derivation.
- **File Load Safety**: Missing JSON config now fails immediately instead of silently falling through.

### 🧩 Telegram Bot Modularization
- **Lock Manager Extraction**: Added `lib/bot-lock.js` for single-instance lock lifecycle and stale-lock recovery.
- **Telegram API Client Extraction**: Added `lib/telegram-api-client.js` for origin failover, retry timing, and file URL construction.
- **Messenger Extraction**: Added `lib/telegram-messenger.js` to centralize send/edit/button/file behavior with markdown fallbacks.
- **Runtime Health Extraction**: Added `lib/runtime-health.js` for `/health` probing helpers and normalized health error formatting.
- **Session Draft Bridge Extraction**: Added `lib/bot-session.js` to isolate draft hydration/persistence behavior.
- **Panel UI Extraction**: Added `lib/bot-panel-ui.js` for action constants, readiness checks, and panel rendering.

### ✅ Readiness & Session Integrity
- **Ready-State Fix**: Panel readiness now requires valid `name`, `symbol`, and `fees` instead of always showing ready.
- **Required Prompt UX**: Bot now sends explicit required-field prompts before deployment when config is incomplete.
- **Session Normalization**: Draft restore now normalizes invalid/negative fee values and trims socials consistently.
- **Config Store Optimization**: Draft saves skip redundant disk writes when no actual data changes.
- **Draft Clear Optimization**: `clearDraft` is now a no-op when draft is already empty.

### 🧪 CI & Regression Coverage
- **CI Workflow Added**: New `.github/workflows/ci.yml` runs install + test on push/PR.
- **Test Script Standardization**: Added `npm run test:ci` and documented it in README.
- **New Module Tests**: Added focused tests for lock, panel UI, session bridge, runtime health, API client, messenger, and deploy CLI hardening.

---
*Date: February 11, 2026*

---

# 🚀 Release Notes - Clank & Claw (Unreleased - IPFS Backend Hardening)

### 📷 Image -> CID Reliability
- **No-API-Key IPFS Path**: Added local Kubo RPC upload support via `IPFS_KUBO_API` for self-hosted image-to-CID conversion.
- **Legacy Provider Guardrails**: Infura and NFT.Storage Classic uploads are now explicitly gated by `ENABLE_INFURA_IPFS_LEGACY` / `ENABLE_NFT_STORAGE_CLASSIC`.
- **Provider Status Accuracy**: Telegram `/health` and startup logs now show active providers correctly, including local Kubo.
- **Local-First Guidance**: Doctor now warns when upload backend is active without Kubo local, so local IPFS remains preferred.

### 🛠️ VPS Operations
- **`ipfs-setup` Wizard**: Added guided `vps-manager.sh ipfs-setup` flow (Kubo/Pinata/legacy/CID-only modes).
- **Doctor Upgrade**: `clawctl doctor` now verifies upload backend readiness, not just IPFS gateway reachability.
- **Setup Helpers Updated**: VPS setup now ships `~/ipfs-setup.sh` and includes Kubo optional connectivity checks.
- **Kubo Lifecycle Module**: Added `kubo-install`, `kubo-start`, `kubo-stop`, `kubo-restart`, and `kubo-status` commands in `vps-manager.sh`.
- **Auto Kubo Bootstrap**: `vps-setup.sh` now attempts best-effort Kubo install/repair so local IPFS path is ready by default.

### 💾 Config Persistence
- **Built-in Local Config DB**: Added `lib/config-store.js` with atomic file writes for per-chat draft + preset storage.
- **Preset Commands**: Added `/profiles`, `/save <name>`, `/load <name>`, and `/deletepreset <name>`.
- **Button Flow Integration**: `/a -> Settings -> Profiles` now supports save/load/delete preset actions.

### 🧪 Regression Safety
- Added hardening tests for IPFS provider-status behavior and invalid image input type handling.

---
*Date: February 11, 2026*

---

# 🚀 Release Notes - Clank & Claw v2.7.0 (Smart Logic + Documentation Refresh)

### 🧠 Smart Deployment Runtime
- **Auto-Heal First Policy**: Deployment no longer fails for common user input gaps (fees too high, missing description, incomplete socials, malformed rewards).
- **Context Continuity Upgrade**: If context is missing, runtime now uses `DEFAULT_CONTEXT_ID` or synthetic context fallback so deploy flow can continue.
- **Strict Mode Auto-Relax**: Incomplete strict-mode requirements now downgrade to standard mode instead of hard-failing.
- **Preflight Observability**: CLI preflight includes smart-fix count and sample fixes before deploy.

### 🗂️ Repository Cleanup & Docs
- **Documentation Overhaul**: README rewritten to be cleaner, production-focused, and easier to onboard.
- **New Visual Architecture Doc**: Added `docs/SYSTEM_ARCHITECTURE.md` with Mermaid component and sequence diagrams.
- **Config Baseline Sync**: `SMART_VALIDATION` and `DEFAULT_IMAGE_URL` are now documented and propagated in setup/templates.

---
*Date: February 10, 2026*

---

# 🚀 Release Notes - Clank & Claw v2.6.8 (Vanity & Metadata Hardening)

### 🎯 Deployment Reliability
- **Vanity Parsing Hardening**: Boolean parsing now handles quoted/env variants (`"true"`, `1`, `yes`, etc.) to prevent accidental vanity misconfiguration.
- **Preflight Summary**: CLI now prints preflight status (vanity, context source, social count, spoof split, metadata length) before deploy.
- **Context Guardrail**: Added `REQUIRE_CONTEXT=true` option to fail fast when context is missing.
- **Smart Logic Auto-Heal**: Validator now auto-normalizes missing/invalid fields (name, symbol, image, socials, rewards, context) so deploy flow keeps moving.

### 🧠 Smart Deployment Logic
- **No Hard Fail for Common Input Gaps**: High fees are capped to protocol-safe values, invalid socials are normalized/dropped, and broken rewards are auto-rebalanced.
- **Context Continuity**: When context is missing, system now auto-fills from `DEFAULT_CONTEXT_ID` or synthetic fallback to preserve indexing pipeline continuity.
- **Strict Mode Auto-Relax**: If strict requirements are incomplete, strict mode is downgraded to standard instead of aborting deployment.
- **Smart Fix Visibility**: Preflight now reports auto-fix count and sample fixes.

### 🧩 Metadata & Context Robustness
- **Social Normalization**: Social metadata now normalizes common URL formats (including bare domains and `@handle` for X).
- **Context Resolution Source Tracking**: Config now tracks whether context came from explicit input, socials, or `DEFAULT_CONTEXT_ID` fallback.
- **Session Metadata Fix**: Bot session configs now reliably populate `metadata.description`.

### 🔌 Multi-Mode Consistency
- **OpenClaw Mapping Extended**: Added `rpcFallbackUrls`, spoof block mapping, and legacy reward admin fields for env-mode parity.
- **Env Templates Updated**: Added `VANITY` and `REQUIRE_CONTEXT` to VPS template and setup output defaults.

---
*Date: February 10, 2026*

---

# 🚀 Release Notes - Clank & Claw v2.6.7 (Ops Healthcheck Patch)

### 🩺 Runtime Diagnostics
- **`/health` Command**: Added deep runtime check for all configured Telegram API origins and RPC endpoints.
- **Latency Visibility**: Health output now includes per-endpoint response time and latest RPC block number.
- **Operational Summary**: Health report shows wallet key readiness, IPFS provider status, active Telegram origin, preferred RPC, and active session count.
- **Spoof Toggle UX**: Added `/spoof off` to disable spoofing without resetting the whole session.

### 🧰 VPS Operations
- **VPS Env Template**: Added `.env.vps.example` with recommended multi-RPC and Telegram failover fields.
- **VPS Setup Template Fallback**: `vps-setup.sh` now prefers `.env.vps.example`, falls back to `.env.example`, and safely creates empty `.env` if neither exists.
- **Docs Sync**: Updated README and token guide with `/health` usage and template-driven VPS setup.
- **Config Hygiene**: Setup wizard no longer writes unused `DEFAULT_FEES`/`DEFAULT_PLATFORM`; switched to `DEFAULT_CONTEXT_ID` + active env keys.

---
*Date: February 10, 2026*

---

# 🚀 Release Notes - Clank & Claw v2.6.6 (Telegram Reliability Patch)

### 🌐 Telegram Gateway Hardening
- **Retry Classifier Isolation**: Moved Telegram API retry classification into `lib/telegram-network.js` for clear logic and testability.
- **Safer 4xx Handling**: Unknown 4xx responses from proxies/gateways are now treated as retryable (with origin rotation), while known Telegram-permanent errors are not retried.
- **Connection Stability**: Enabled keep-alive HTTPS agent for Telegram API calls to reduce connection churn on VPS NAT gateways.

### 🛡️ Message Delivery Hardening
- **Edit Fallback Safety**: `editMessage` now reliably falls back to plain edit and then `sendMessage` on non-markdown failures.
- **Message Not Modified Guard**: Explicitly handles Telegram `message is not modified` responses as non-fatal success.

### 📷 Media Input Robustness
- **No Double `getFile` Fetch**: Image documents now reuse pre-resolved Telegram file URL, preventing false failures from duplicate fetches.
- **Document Detection Upgrade**: Added file extension fallback detection for image documents with missing/incorrect MIME type.

### 🧪 Tests & Operations
- **New Regression Tests**: Added `test/telegram-network.test.js` covering retry/permanent error classification paths.
- **Graceful Shutdown**: Added `SIGINT`/`SIGTERM` handling to close keep-alive sockets cleanly during PM2 restarts.

---
*Date: February 10, 2026*

---

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
