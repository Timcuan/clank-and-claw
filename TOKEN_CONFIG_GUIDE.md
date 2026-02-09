# 🐾 Token Config Cheatsheet

## Quick Start (token.json)

```json
{
  "name": "My Token",
  "symbol": "TOKEN",
  "image": "bafkreiabcd1234",
  "fees": "10%",
  "context": {
    "platform": "twitter",
    "url": "https://x.com/user/status/123456789"
  }
}
```

## All Fee Formats

| Format | Example | Result |
|--------|---------|--------|
| Percentage | `"10%"` | 5% + 5% |
| Split | `"5% 5%"` | 5% + 5% |
| BPS Total | `"1000"` | 5% + 5% |
| BPS Split | `"500 500"` | 5% + 5% |
| Natural | `"with 10 percent fees"` | 5% + 5% |

## Context Platforms

| Platform | URL Format |
|----------|------------|
| Twitter | `https://x.com/user/status/123456789` |
| Farcaster | `https://warpcast.com/user/0x123abc` |

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

## Dynamic Fees (Advanced)

```json
{
  "dynamicFees": {
    "enabled": true,
    "baseFee": 0.5,
    "maxFee": 5,
    "adjustmentPeriod": 3600,
    "resetPeriod": 86400
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
  "fees": "10%",
  
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

## Common Mistakes

❌ **Don't:**
```json
{
  "fees": "10",  // Missing %
  "context": {
    "url": "https://x.com/user"  // Not a tweet link
  }
}
```

✅ **Do:**
```json
{
  "fees": "10%",
  "context": {
    "url": "https://x.com/user/status/123456789"
  }
}
```
