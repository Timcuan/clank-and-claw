# VPS Install & Repair SOP

This is the safest operational flow for fresh installs and fast recovery on VPS.

## 1) Fresh Install (Step-by-Step)

1. Log in to the VPS with the operational user (recommended: non-root with sudo).
2. Run bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

3. Ensure shortcuts are available:

```bash
~/clawctl shortcuts
```

4. Configure Telegram:

```bash
~/clawctl telegram-setup
```

5. Configure IPFS backend (choose option `1` for local Kubo if self-hosted):

```bash
~/clawctl ipfs-setup
```

6. Run full validation:

```bash
~/clawctl doctor
```

7. Start the bot:

```bash
~/clawctl start
~/clawctl status
pm2 logs clanker-bot --lines 120
```

## 2) Standard Repair Flow (When Errors Happen)

1. Update to the latest code:

```bash
cd ~/clank-and-claw
git pull
```

2. Repair ownership (if setup was previously run with mixed root/sudo contexts):

```bash
sudo chown -R "$USER:$USER" ~/clank-and-claw
```

3. Rebuild shortcuts:

```bash
~/clawctl shortcuts
```

4. Check and repair Kubo:

```bash
~/clawctl kubo-status
~/clawctl kubo-install --force
~/clawctl kubo-status
```

5. Check Kubo API directly (without proxy):

```bash
curl --noproxy '*' -sS -X POST --data '' http://127.0.0.1:5001/api/v0/version
```

6. Run bot self-heal:

```bash
~/clawctl heal
~/clawctl doctor
~/clawctl status
```

## 3) Kubo API Unreachable (Quick Playbook)

If `systemd` is active but the checker says API is unreachable:

1. Check service/logs:

```bash
~/clawctl kubo-status
```

2. If logs show `Daemon is ready` / `RPC API server listening`, continue with a manual API test:

```bash
curl --noproxy '*' -sS -X POST --data '' http://127.0.0.1:5001/api/v0/version
```

3. If the manual API call succeeds, run doctor again:

```bash
~/clawctl doctor
```

4. If the manual API call fails, force-repair:

```bash
~/clawctl kubo-install --force
~/clawctl kubo-status
```

## 4) One-Paste Recovery Block

Use this block if the instance is unhealthy:

```bash
cd ~/clank-and-claw && \
git pull && \
sudo chown -R "$USER:$USER" ~/clank-and-claw && \
~/clawctl shortcuts && \
~/clawctl kubo-install --force && \
~/clawctl heal && \
~/clawctl doctor && \
~/clawctl status
```

## 5) Success Criteria

Recovery target:
- `~/clawctl doctor` has no critical errors.
- `~/clawctl kubo-status` shows service active and API reachable.
- `~/clawctl status` shows the bot online.
- `pm2 logs clanker-bot` shows no restart loop.
