# 🐾 Token Config Cheatsheet

## Quick Start (token.json)

```json
{
  "name": "My Token",
  "symbol": "TOKEN",
  "image": "bafkreiabcd1234",
  "fees": {
    "mode": "static",
    "static": {
      "clankerFeeBps": 300,
      "pairedFeeBps": 300
    },
    "dynamic": {
      "baseFeePercent": 1,
      "maxFeePercent": 10,
      "adjustmentPeriod": 3600,
      "resetPeriod": 86400
    }
  },
  "context": {
    "platform": "twitter",
    "url": "https://x.com/user/status/123456789"
  }
}
```

## 🤖 Bot Interaction & Commands

The Telegram bot is AI-powered and understands natural language.

### Smart Fallback
If you get stuck or the bot doesn't understand, it will:
- **Suggest valid inputs** based on your current step
- **Detect typos** (e.g. "PEME" instead of "PEPE")
- **Show partial progress** (what's missing)

### Commands
- `/start` - Check system status (IPFS, Wallet)
- `/deploy` - Start the deployment wizard
- `/go SYMBOL "Name" 6%` - Quick deploy in one line
- `/spoof 0x...` - Enable spoofing for the active session
- `/spoof off` - Disable spoofing for the active session
- `/health` - Deep health check for Telegram and RPC endpoints
- `/cancel` - Reset critical session data

### Smart Input
 Paste *any* text containing links and the bot will sort them:
 > "Here is my token launch tweet https://x.com/status/123 and website https://mysite.com"
 
 Result:
 - ✅ Context linked to Tweet
 - ✅ Website added to socials

## Fee Modes (token.json)

Use one explicit `fees.mode` in `token.json`:

### Static mode (custom bps)

```json
{
  "fees": {
    "mode": "static",
    "static": {
      "clankerFeeBps": 300,
      "pairedFeeBps": 300
    }
  }
}
```

### Dynamic mode (traffic-based, default 1%-10%)

```json
{
  "fees": {
    "mode": "dynamic",
    "dynamic": {
      "baseFeePercent": 1,
      "maxFeePercent": 10,
      "adjustmentPeriod": 3600,
      "resetPeriod": 86400
    }
  }
}
```

### 📢 Default Standards (v2.6.2+)
If no fees are provided, the system defaults to:
- **Static Fees:** 6% Total (3% Clanker + 3% Paired)
- **Dynamic Fees:** 1% Base - 10% Max

For `token.json` flow:
- Static fees are fully custom (no hard cap enforced by validator).
- Dynamic fees are configurable via `fees.dynamic` parameters.

## Legacy Fee Inputs (Still Supported)

| Format | Example | Result |
|--------|---------|--------|
| Percentage | `"6%"` | 3% + 3% |
| Split | `"3% 3%"` | 3% + 3% |
| BPS Total | `"600"` | 3% + 3% |
| BPS Split | `"300 300"` | 3% + 3% |
| Natural | `"with 6 percent fees"` | 3% + 3% |

## Context Platforms

Context platform is now auto-detected from the URL you provide.

Examples:
- `https://x.com/user/status/123456789` -> `twitter`
- `https://warpcast.com/user/0x123abc` -> `farcaster`
- `https://github.com/org/repo` -> `github`
- `https://t.me/channel` -> `telegram`
- Any other HTTPS link -> `website`

`context.messageId` is auto-fetched from `context.url`.

## Spoofing Mode

```json
{
  "spoof": {
    "enabled": true,
    "ourWallet": "0xYourRealWallet",
    "targetAddress": "0xAddressThatAppearsAsDeployer"
  }
}
```

**Result:**
- Interface shows `targetAddress` as deployer
- 99.9% fees → `ourWallet`
- 0.1% fees → `targetAddress`

## Anti-Bot Protection

```json
{
  "antiBot": {
    "enabled": true,
    "startingFee": 6667.77,
    "endingFee": 416.73,
    "decaySeconds": 15
  }
}
```

**Effect:** Massive fees at launch that decay to normal after 15 seconds.

## Auto Dev Buy

```json
{
  "advanced": {
    "devBuy": 0.01
  }
}
```

**Effect:** Automatically buys 0.01 ETH of your token on deployment.

## Dynamic Fee Parameters (Advanced)

```json
{
  "fees": {
    "mode": "dynamic",
    "dynamic": {
      "baseFeePercent": 1,
      "maxFeePercent": 10,
      "adjustmentPeriod": 3600,
      "resetPeriod": 86400,
      "resetTickFilter": 100,
      "feeControlNumerator": 100000,
      "decayFilterBps": 9500
    }
  }
}
```

**Effect:** Fees adjust based on trading activity.

## Pool Configuration

```json
{
  "pool": {
    "pairedToken": "WETH",
    "type": "Standard",
    "startingTick": -230400
  }
}
```

| Type | Description |
|------|-------------|
| `Standard` | Default, balanced liquidity |
| `Narrow` | Concentrated liquidity |
| `Wide` | Spread out liquidity |

## Complete Example

```json
{
  "name": "Moon Token",
  "symbol": "MOON",
  "image": "bafkreixyz123",
  "fees": {
    "mode": "static",
    "static": {
      "clankerFeeBps": 300,
      "pairedFeeBps": 300
    }
  },
  
  "context": {
    "platform": "twitter",
    "url": "https://x.com/moontoken/status/123456"
  },
  
  "description": "To the moon! 🚀",
  
  "socials": {
    "x": "https://x.com/moontoken",
    "website": "https://moontoken.com",
    "telegram": "https://t.me/moontoken"
  },
  
  "spoof": {
    "enabled": false
  },
  
  "advanced": {
    "devBuy": 0.01,
    "vanity": true,
    "strictMode": false
  }
}
```

## Validation

Run `npm run test` to validate your config without deploying.

Recommended env guardrail:
- `SMART_VALIDATION=true` to auto-heal missing/invalid fields (recommended for bot/agent workflows).
- `REQUIRE_CONTEXT=true` + `DEFAULT_CONTEXT_ID=<id>` for consistent indexing fallback.

For `token.json` manual editing flow:
- `advanced.smartValidation` defaults to `false` (strict, no auto-correct).
- Set `advanced.smartValidation: true` only if you want auto-heal behavior.

## Common Mistakes

❌ **Don't:**
```json
{
  "fees": {
    "mode": "static"
  },  // Missing static fee parameters
  "context": {
    "url": "https://example.com"  // Works, but tweet/cast gives best indexing quality
  }
}
```

✅ **Do:**
```json
{
  "fees": {
    "mode": "dynamic",
    "dynamic": {
      "baseFeePercent": 1,
      "maxFeePercent": 10
    }
  },
  "context": {
    "url": "https://x.com/user/status/123456789"
  }
}
```
