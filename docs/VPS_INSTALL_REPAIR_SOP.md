# VPS Install & Repair SOP

Panduan ini adalah alur operasional paling aman untuk install baru dan recovery cepat di VPS.

## 1) Fresh Install (Step-by-Step)

1. Login ke VPS menggunakan user operasional (disarankan non-root dengan sudo).
2. Jalankan bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/Timcuan/clank-and-claw/main/vps-setup.sh | bash
```

3. Pastikan shortcut tersedia:

```bash
~/clawctl shortcuts
```

4. Setup Telegram:

```bash
~/clawctl telegram-setup
```

5. Setup backend IPFS (pilih opsi 1 untuk Kubo local jika self-hosted):

```bash
~/clawctl ipfs-setup
```

6. Validasi penuh:

```bash
~/clawctl doctor
```

7. Jalankan bot:

```bash
~/clawctl start
~/clawctl status
pm2 logs clanker-bot --lines 120
```

## 2) Standard Repair Flow (Saat Ada Error)

1. Update code terbaru:

```bash
cd ~/clank-and-claw
git pull
```

2. Perbaiki ownership (jika sebelumnya pernah setup pakai root/sudo campur):

```bash
sudo chown -R "$USER:$USER" ~/clank-and-claw
```

3. Rebuild shortcuts:

```bash
~/clawctl shortcuts
```

4. Cek dan repair Kubo:

```bash
~/clawctl kubo-status
~/clawctl kubo-install --force
~/clawctl kubo-status
```

5. Cek API Kubo langsung (tanpa proxy):

```bash
curl --noproxy '*' -sS -X POST --data '' http://127.0.0.1:5001/api/v0/version
```

6. Jalankan self-heal bot:

```bash
~/clawctl heal
~/clawctl doctor
~/clawctl status
```

## 3) Kubo API Unreachable (Playbook Cepat)

Jika `systemd active` tapi checker bilang API unreachable:

1. Pastikan service/log:

```bash
~/clawctl kubo-status
```

2. Jika log menunjukkan `Daemon is ready` / `RPC API server listening`, lanjut tes API manual:

```bash
curl --noproxy '*' -sS -X POST --data '' http://127.0.0.1:5001/api/v0/version
```

3. Jika API manual sukses, jalankan doctor ulang:

```bash
~/clawctl doctor
```

4. Jika API manual gagal, force-repair:

```bash
~/clawctl kubo-install --force
~/clawctl kubo-status
```

## 4) One-Paste Recovery Block

Gunakan blok ini kalau instance sedang tidak sehat:

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

Target akhir recovery:
- `~/clawctl doctor` tanpa error kritis.
- `~/clawctl kubo-status` menunjukkan service active dan API reachable.
- `~/clawctl status` menunjukkan bot online.
- `pm2 logs clanker-bot` tidak ada restart loop.
