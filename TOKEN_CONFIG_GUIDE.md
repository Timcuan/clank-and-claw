# Token Config Guide (`token.json`)

This guide is optimized for **fast manual editing** with **predictable deploy behavior**.

## 1. Editing Principles

- `token.json` runs in strict manual mode: no auto-correction for core token fields.
- Parser is human-friendly for syntax mistakes:
  - supports `//` and `/* ... */` comments
  - supports trailing commas
  - handles smart quotes (`“ ”`)
- Validation still fails fast for invalid required values (`name`, `symbol`, `image`, fee format).
- For `twitter`/`farcaster` context, set `context.id` to the real social account id to avoid clanker.world provenance mismatch.

Use this before deploy:

```bash
npm run token:check
```

## 2. Fast Human-Edit Format (Recommended)

Use this flat format for speed:

```json
{
  "name": "My Token",
  "symbol": "TOKEN",
  "image": "https://example.com/image.png",
  "description": "Short description",
  "fee": "6%",
  "contextUrl": "https://x.com/user/status/123456789",
  "contextUserId": "123456789012345678",
  "x": "https://x.com/mytoken",
  "website": "https://mytoken.com",
  "telegram": "https://t.me/mytoken"
}
```

Flat aliases supported:
- `fee` -> same as `fees`
- `contextUrl`, `contextMessageId`, `contextId`, `contextPlatform`
- `contextUserId`, `contextProfileId`
- top-level socials: `x`, `twitter`, `website`, `telegram`, `discord`, `farcaster`, etc.

## 3. Canonical Format (Also Supported)

```json
{
  "name": "Moon Token",
  "symbol": "MOON",
  "image": "bafkreixyz123",
  "description": "To the moon",
  "fees": {
    "mode": "dynamic",
    "dynamic": {
      "baseFeePercent": 1,
      "maxFeePercent": 10,
      "adjustmentPeriod": 3600,
      "resetPeriod": 86400
    }
  },
  "context": {
    "url": "https://x.com/user/status/123456789"
  },
  "socials": {
    "x": "https://x.com/moontoken",
    "telegram": "https://t.me/moontoken"
  }
}
```

## 4. Fee Input Options

Accepted:
- `"fee": "6%"`
- `"fee": "600bps"`
- `"fees": "3% 3%"`
- `"fees": { "mode": "static", "static": { "clankerFeeBps": 300, "pairedFeeBps": 300 } }`
- `"fees": { "mode": "dynamic", "dynamic": { ... } }`

## 5. Strictness Notes

- For `token.json`, `advanced.smartValidation` is ignored by design.
- Missing or invalid required token values produce explicit errors.
- This protects manual edits from hidden auto-fixes that could change deploy intent.

## 6. Common Human-Edit Mistakes

- Broken JSON: use `npm run token:check` to get line/column parse errors.
- Invalid image: must be HTTP(S) URL or IPFS CID.
- Bad fee text: use `6%`, `600bps`, or explicit static/dynamic structure.
- Missing context when `REQUIRE_CONTEXT=true`: set `contextUrl` or `context.messageId`.

## 7. Pre-Deploy Checklist

1. Edit `token.json`.
2. Run `npm run token:check`.
3. If pass, run deploy (`npm run deploy`).
