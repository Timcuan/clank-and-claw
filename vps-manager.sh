#!/bin/bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/clank-and-claw}"
REPO_URL="${REPO_URL:-https://github.com/Timcuan/clank-and-claw.git}"
APP_NAME="${APP_NAME:-clanker-bot}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/clank-and-claw-backups}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
YES_MODE=0
FORCE_MODE=0

color_reset='\033[0m'
color_green='\033[32m'
color_yellow='\033[33m'
color_red='\033[31m'
color_cyan='\033[36m'

info() { echo -e "${color_cyan}ℹ${color_reset} $*"; }
ok() { echo -e "${color_green}✅${color_reset} $*"; }
warn() { echo -e "${color_yellow}⚠️${color_reset} $*"; }
err() { echo -e "${color_red}❌${color_reset} $*"; }

usage() {
    cat <<'EOF'
Clank & Claw VPS Manager

Usage:
  bash vps-manager.sh wizard
  bash vps-manager.sh install
  bash vps-manager.sh update [--force]
  bash vps-manager.sh doctor
  bash vps-manager.sh start
  bash vps-manager.sh telegram-setup
  bash vps-manager.sh stop
  bash vps-manager.sh restart
  bash vps-manager.sh status
  bash vps-manager.sh logs [lines]
  bash vps-manager.sh netcheck
  bash vps-manager.sh heal
  bash vps-manager.sh backup
  bash vps-manager.sh restore <backup.tar.gz>
  bash vps-manager.sh uninstall [--yes] [--force]
EOF
}

have_cmd() {
    command -v "$1" >/dev/null 2>&1
}

resolve_project_dir() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$script_dir/package.json" ]; then
        PROJECT_DIR="$script_dir"
    fi
}

require_project() {
    if [ ! -d "$PROJECT_DIR/.git" ]; then
        err "Project repo tidak ditemukan di $PROJECT_DIR"
        err "Jalankan: bash vps-manager.sh install"
        exit 1
    fi
}

pm2_exists() {
    have_cmd pm2
}

pm2_app_exists() {
    if ! pm2_exists; then
        return 1
    fi
    pm2 describe "$APP_NAME" >/dev/null 2>&1
}

telegram_token() {
    local env_file="$PROJECT_DIR/.env"
    if [ ! -f "$env_file" ]; then
        return 0
    fi
    grep -E '^TELEGRAM_BOT_TOKEN=' "$env_file" | tail -n1 | cut -d= -f2- | tr -d '\r'
}

is_valid_private_key() {
    local pk="$1"
    [[ "$pk" =~ ^(0x)?[a-fA-F0-9]{64}$ ]]
}

check_rpc_endpoint() {
    local rpc_url="$1"
    curl -fsS --max-time 10 \
        -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        "$rpc_url" >/dev/null 2>&1
}

ensure_env_file() {
    local env_file="$PROJECT_DIR/.env"
    if [ -f "$env_file" ]; then
        return 0
    fi

    if [ -f "$PROJECT_DIR/.env.vps.example" ]; then
        cp "$PROJECT_DIR/.env.vps.example" "$env_file"
        warn ".env belum ada, dibuat dari .env.vps.example"
        return 0
    fi
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$env_file"
        warn ".env belum ada, dibuat dari .env.example"
        return 0
    fi

    touch "$env_file"
    warn ".env kosong dibuat di $env_file"
}

read_env_value() {
    local key="$1"
    local env_file="$PROJECT_DIR/.env"
    if [ ! -f "$env_file" ]; then
        echo ""
        return 0
    fi
    grep -E "^${key}=" "$env_file" | tail -n1 | cut -d= -f2- | tr -d '\r'
}

upsert_env_value() {
    local key="$1"
    local value="$2"
    local env_file="$PROJECT_DIR/.env"
    local tmp
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" '
BEGIN { done=0 }
{
    if ($0 ~ "^" key "=") {
        print key "=" value
        done=1
    } else {
        print $0
    }
}
END {
    if (!done) print key "=" value
}
' "$env_file" > "$tmp"
    mv "$tmp" "$env_file"
}

is_placeholder_token() {
    local token="$1"
    local normalized
    normalized="$(echo "$token" | tr '[:lower:]' '[:upper:]')"
    [[ "$normalized" == *"REPLACE_ME"* || "$normalized" == *"YOUR_BOT_TOKEN"* || "$normalized" == *"<TOKEN"* ]]
}

TELEGRAM_CHECK_USERNAME=""
TELEGRAM_CHECK_DETAIL=""
check_telegram_token() {
    local token="$1"
    TELEGRAM_CHECK_USERNAME=""
    TELEGRAM_CHECK_DETAIL=""

    if [ -z "$token" ]; then
        TELEGRAM_CHECK_DETAIL="missing token"
        return 1
    fi

    local resp=""
    if ! resp="$(curl -sS --max-time 15 "https://api.telegram.org/bot${token}/getMe" 2>/dev/null)"; then
        TELEGRAM_CHECK_DETAIL="network request failed"
        return 10
    fi

    if echo "$resp" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
        TELEGRAM_CHECK_USERNAME="$(echo "$resp" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p' | head -n1)"
        return 0
    fi

    if echo "$resp" | grep -qi 'Unauthorized'; then
        TELEGRAM_CHECK_DETAIL="Unauthorized (invalid token)"
        return 2
    fi

    TELEGRAM_CHECK_DETAIL="$(echo "$resp" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p' | head -n1)"
    if [ -z "$TELEGRAM_CHECK_DETAIL" ]; then
        TELEGRAM_CHECK_DETAIL="unexpected Telegram API response"
    fi
    return 3
}

setup_telegram_env() {
    require_project
    cd "$PROJECT_DIR"
    ensure_env_file

    local current_token current_admins token admins api_bases
    current_token="$(read_env_value TELEGRAM_BOT_TOKEN)"
    current_admins="$(read_env_value TELEGRAM_ADMIN_IDS)"

    echo ""
    echo "===== TELEGRAM BOT SETUP ====="
    if [ -n "$current_token" ]; then
        echo "Current token: ${current_token:0:10}..."
    else
        echo "Current token: (empty)"
    fi
    echo "Current admins: ${current_admins:-"(empty)"}"
    echo ""

    while true; do
        read -r -p "Masukkan TELEGRAM_BOT_TOKEN (kosong = pakai nilai saat ini): " token
        if [ -z "$token" ]; then
            token="$current_token"
        fi
        if [ -z "$token" ]; then
            err "Token tidak boleh kosong."
            continue
        fi
        if is_placeholder_token "$token"; then
            err "Token masih placeholder (${token})."
            continue
        fi

        if check_telegram_token "$token"; then
            ok "Token valid. Bot username: @${TELEGRAM_CHECK_USERNAME:-unknown}"
            break
        fi

        local code=$?
        if [ "$code" -eq 2 ]; then
            err "Token tidak valid: $TELEGRAM_CHECK_DETAIL"
        elif [ "$code" -eq 10 ]; then
            warn "Gagal verifikasi token karena network: $TELEGRAM_CHECK_DETAIL"
            read -r -p "Simpan token ini tetap? (y/N): " keep_anyway
            if [[ "${keep_anyway:-}" =~ ^[Yy]$ ]]; then
                break
            fi
        else
            err "Token tidak lolos verifikasi: $TELEGRAM_CHECK_DETAIL"
        fi
    done

    read -r -p "Masukkan TELEGRAM_ADMIN_IDS (comma-separated, kosong = ${current_admins:-none}): " admins
    if [ -z "$admins" ]; then
        admins="$current_admins"
    fi

    api_bases="$(read_env_value TELEGRAM_API_BASES)"
    if [ -z "$api_bases" ]; then
        api_bases="https://api.telegram.org"
    fi

    upsert_env_value TELEGRAM_BOT_TOKEN "$token"
    upsert_env_value TELEGRAM_ADMIN_IDS "$admins"
    upsert_env_value TELEGRAM_API_BASES "$api_bases"
    ok "Telegram config tersimpan di $PROJECT_DIR/.env"

    read -r -p "Restart bot sekarang? (Y/n): " restart_now
    if [ -z "$restart_now" ] || [[ "$restart_now" =~ ^[Yy]$ ]]; then
        restart_bot
    fi
}

clear_telegram_webhook() {
    local token
    token="$(telegram_token || true)"
    if [ -z "${token:-}" ]; then
        warn "TELEGRAM_BOT_TOKEN tidak ada di .env, skip webhook cleanup"
        return 0
    fi
    if is_placeholder_token "$token"; then
        warn "TELEGRAM_BOT_TOKEN masih placeholder, skip webhook cleanup"
        return 0
    fi

    if curl -fsS --max-time 15 \
        -H 'content-type: application/json' \
        -d '{"drop_pending_updates":false}' \
        "https://api.telegram.org/bot${token}/deleteWebhook" >/dev/null; then
        ok "Webhook Telegram dibersihkan (polling mode)"
    else
        warn "Gagal clear webhook Telegram (akan retry saat bot start)"
    fi
}

cleanup_stale_locks() {
    local found=0
    local cleaned=0
    for lock in /tmp/clank-and-claw-*.lock; do
        [ -e "$lock" ] || continue
        found=1
        local pid=""
        if have_cmd jq; then
            pid="$(jq -r '.pid // empty' "$lock" 2>/dev/null || true)"
        fi
        if [ -z "$pid" ]; then
            pid="$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]\+' "$lock" | grep -o '[0-9]\+' | head -n1 || true)"
        fi
        if [ -z "$pid" ] || ! kill -0 "$pid" >/dev/null 2>&1; then
            rm -f "$lock"
            cleaned=$((cleaned + 1))
        fi
    done

    if [ "$found" -eq 1 ]; then
        ok "Lock cleanup selesai (removed: $cleaned)"
    fi
}

direct_bot_pids() {
    pgrep -f "node .*telegram-bot.js" 2>/dev/null || true
}

stop_direct_bot_processes() {
    local pids
    pids="$(direct_bot_pids)"
    if [ -n "$pids" ]; then
        warn "Menghentikan proses bot non-PM2"
        pkill -f "node .*telegram-bot.js" || true
        sleep 1
    fi
}

stop_non_pm2_bot_processes() {
    local pm2_pid="${1:-}"
    local pids pid stopped=0
    pids="$(direct_bot_pids)"
    if [ -z "$pids" ]; then
        return 0
    fi
    for pid in $pids; do
        if [ -n "$pm2_pid" ] && [ "$pid" = "$pm2_pid" ]; then
            continue
        fi
        if kill -0 "$pid" >/dev/null 2>&1; then
            warn "Menghentikan proses bot non-PM2 PID $pid"
            kill "$pid" >/dev/null 2>&1 || true
            stopped=1
        fi
    done
    if [ "$stopped" -eq 1 ]; then
        sleep 1
    fi
}

start_bot() {
    require_project
    cd "$PROJECT_DIR"
    ensure_env_file

    local token
    token="$(telegram_token || true)"
    if [ -z "${token:-}" ]; then
        err "TELEGRAM_BOT_TOKEN kosong. Jalankan: bash vps-manager.sh telegram-setup"
        exit 1
    fi
    if is_placeholder_token "$token"; then
        err "TELEGRAM_BOT_TOKEN masih placeholder: $token"
        err "Jalankan: bash vps-manager.sh telegram-setup"
        exit 1
    fi

    if ! check_telegram_token "$token"; then
        local code=$?
        if [ "$code" -eq 2 ]; then
            err "Token Telegram invalid: $TELEGRAM_CHECK_DETAIL"
            if pm2_exists && pm2_app_exists; then
                pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
                warn "PM2 app dihentikan untuk mencegah restart loop."
            fi
            err "Perbaiki token dulu: bash vps-manager.sh telegram-setup"
            exit 1
        fi
        if [ "$code" -eq 10 ]; then
            warn "Validasi token skipped (network issue: $TELEGRAM_CHECK_DETAIL). Lanjut start..."
        else
            err "Token Telegram tidak lolos verifikasi: $TELEGRAM_CHECK_DETAIL"
            exit 1
        fi
    else
        ok "Telegram token OK (@${TELEGRAM_CHECK_USERNAME:-unknown})"
    fi

    cleanup_stale_locks
    clear_telegram_webhook
    mkdir -p "$PROJECT_DIR/logs"

    if pm2_exists; then
        local pm2_pid=""
        if pm2_app_exists; then
            pm2_pid="$(pm2 pid "$APP_NAME" 2>/dev/null | tr -d '[:space:]' || true)"
            if [ "$pm2_pid" = "0" ]; then
                pm2_pid=""
            fi
        fi
        stop_non_pm2_bot_processes "$pm2_pid"

        if pm2_app_exists; then
            pm2 restart "$APP_NAME" --update-env
        else
            pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
        fi
        pm2 save >/dev/null 2>&1 || true
        ok "Bot berjalan via PM2"
        pm2 status "$APP_NAME" || true
        return 0
    fi

    warn "PM2 tidak terpasang, fallback ke nohup direct process"
    stop_non_pm2_bot_processes
    nohup node telegram-bot.js > "$PROJECT_DIR/logs/direct-bot.log" 2>&1 &
    ok "Bot started (fallback mode). Log: $PROJECT_DIR/logs/direct-bot.log"
}

stop_bot() {
    require_project
    if pm2_exists && pm2_app_exists; then
        pm2 stop "$APP_NAME" || true
        ok "PM2 app stopped: $APP_NAME"
    fi
    stop_direct_bot_processes
    cleanup_stale_locks
}

restart_bot() {
    stop_bot
    start_bot
}

show_status() {
    require_project
    cd "$PROJECT_DIR"

    echo ""
    echo "===== CLANK & CLAW STATUS ====="
    echo "Project: $PROJECT_DIR"
    if have_cmd git; then
        local branch rev
        branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')"
        rev="$(git rev-parse --short HEAD 2>/dev/null || echo '-')"
        echo "Git: $branch @ $rev"
    fi

    if pm2_exists; then
        echo ""
        echo "[PM2]"
        pm2 status "$APP_NAME" || true
    else
        echo ""
        echo "[PM2] not installed"
    fi

    echo ""
    echo "[Processes]"
    local pids
    pids="$(direct_bot_pids)"
    if [ -n "$pids" ]; then
        ps -fp $pids || true
    else
        echo "No direct telegram-bot.js process"
    fi

    echo ""
    echo "[Locks]"
    local lock_found=0
    for lock in /tmp/clank-and-claw-*.lock; do
        [ -e "$lock" ] || continue
        lock_found=1
        echo "$lock"
    done
    if [ "$lock_found" -eq 0 ]; then
        echo "No lock file found"
    fi
}

run_netcheck() {
    echo ""
    echo "===== NETWORK CHECK ====="
    if getent hosts api.telegram.org >/dev/null 2>&1; then ok "DNS telegram"; else err "DNS telegram"; fi
    if getent hosts mainnet.base.org >/dev/null 2>&1; then ok "DNS base rpc"; else err "DNS base rpc"; fi

    if curl -fsS --max-time 10 https://api.telegram.org >/dev/null 2>&1; then ok "Telegram API"; else err "Telegram API"; fi
    if curl -fsS --max-time 10 -H 'content-type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        https://mainnet.base.org >/dev/null 2>&1; then ok "Base RPC"; else err "Base RPC"; fi
    if curl -fsS --max-time 10 https://gateway.pinata.cloud/ipfs >/dev/null 2>&1; then ok "IPFS gateway"; else warn "IPFS gateway"; fi
}

do_doctor() {
    require_project
    cd "$PROJECT_DIR"
    ensure_env_file

    local failed=0
    local warned=0

    echo ""
    echo "===== CLANK & CLAW DOCTOR ====="
    echo "Project: $PROJECT_DIR"

    if have_cmd node; then ok "Node: $(node -v)"; else err "Node tidak terpasang"; failed=$((failed + 1)); fi
    if have_cmd npm; then ok "NPM: $(npm -v)"; else err "NPM tidak terpasang"; failed=$((failed + 1)); fi
    if pm2_exists; then ok "PM2 tersedia"; else warn "PM2 tidak terpasang (fallback mode)"; warned=$((warned + 1)); fi

    local token
    token="$(telegram_token || true)"
    if [ -z "${token:-}" ]; then
        err "TELEGRAM_BOT_TOKEN kosong"
        failed=$((failed + 1))
    elif is_placeholder_token "$token"; then
        err "TELEGRAM_BOT_TOKEN masih placeholder"
        failed=$((failed + 1))
    else
        if check_telegram_token "$token"; then
            ok "Telegram token valid (@${TELEGRAM_CHECK_USERNAME:-unknown})"
        else
            local code=$?
            if [ "$code" -eq 10 ]; then
                warn "Telegram token tidak bisa diverifikasi (network): $TELEGRAM_CHECK_DETAIL"
                warned=$((warned + 1))
            else
                err "Telegram token invalid: $TELEGRAM_CHECK_DETAIL"
                failed=$((failed + 1))
            fi
        fi
    fi

    local private_key
    private_key="$(read_env_value PRIVATE_KEY)"
    if [ -z "$private_key" ]; then
        err "PRIVATE_KEY kosong"
        failed=$((failed + 1))
    elif is_valid_private_key "$private_key"; then
        ok "PRIVATE_KEY format valid"
    else
        err "PRIVATE_KEY format invalid (harus 64 hex chars)"
        failed=$((failed + 1))
    fi

    local rpc_primary rpc_fallback_raw rpc_ok_count
    rpc_primary="$(read_env_value RPC_URL)"
    rpc_fallback_raw="$(read_env_value RPC_FALLBACK_URLS)"
    [ -n "$rpc_primary" ] || rpc_primary="https://mainnet.base.org"
    rpc_ok_count=0

    local seen_rpc=""
    for rpc in "$rpc_primary" $(echo "$rpc_fallback_raw" | tr ',' ' '); do
        rpc="$(echo "$rpc" | xargs)"
        [ -n "$rpc" ] || continue
        if echo "$seen_rpc" | grep -Fqx "$rpc"; then
            continue
        fi
        seen_rpc="${seen_rpc}"$'\n'"$rpc"

        if check_rpc_endpoint "$rpc"; then
            ok "RPC healthy: $rpc"
            rpc_ok_count=$((rpc_ok_count + 1))
        else
            warn "RPC failed: $rpc"
            warned=$((warned + 1))
        fi
    done
    if [ "$rpc_ok_count" -eq 0 ]; then
        err "Tidak ada RPC yang healthy"
        failed=$((failed + 1))
    fi

    local ipfs_gateways
    ipfs_gateways="$(read_env_value IPFS_GATEWAYS)"
    if [ -z "$ipfs_gateways" ]; then
        ipfs_gateways="https://gateway.pinata.cloud/ipfs"
    fi
    local ipfs_first
    ipfs_first="$(echo "$ipfs_gateways" | tr ',' '\n' | head -n1 | xargs)"
    if [ -n "$ipfs_first" ]; then
        if curl -fsS --max-time 10 "$ipfs_first" >/dev/null 2>&1; then
            ok "IPFS gateway reachable: $ipfs_first"
        else
            warn "IPFS gateway unreachable: $ipfs_first"
            warned=$((warned + 1))
        fi
    fi

    if pm2_exists && pm2_app_exists; then
        local pm2_pid
        pm2_pid="$(pm2 pid "$APP_NAME" 2>/dev/null | tr -d '[:space:]' || true)"
        if [ -n "$pm2_pid" ] && [ "$pm2_pid" != "0" ]; then
            ok "PM2 app online: $APP_NAME (PID $pm2_pid)"
        else
            warn "PM2 app terdaftar tapi tidak online: $APP_NAME"
            warned=$((warned + 1))
        fi
    else
        warn "PM2 app belum terdaftar: $APP_NAME"
        warned=$((warned + 1))
    fi

    echo ""
    if [ "$failed" -gt 0 ]; then
        err "Doctor selesai dengan $failed error kritis dan $warned warning."
        return 1
    fi
    ok "Doctor selesai. Tidak ada error kritis. Warning: $warned"
}

ensure_clean_or_forced() {
    require_project
    cd "$PROJECT_DIR"
    if ! git diff --quiet || ! git diff --cached --quiet; then
        if [ "$FORCE_MODE" -eq 1 ]; then
            warn "Worktree dirty, lanjut karena --force"
        else
            err "Worktree dirty. Commit/stash dulu, atau jalankan update dengan --force"
            exit 1
        fi
    fi
}

do_backup() {
    require_project
    cd "$PROJECT_DIR"
    mkdir -p "$BACKUP_DIR"
    local stamp archive
    stamp="$(date +%Y%m%d-%H%M%S)"
    archive="$BACKUP_DIR/clank-and-claw-$stamp.tar.gz"

    local items=()
    for item in .env token.json token.example.json ecosystem.config.cjs logs; do
        if [ -e "$PROJECT_DIR/$item" ]; then
            items+=("$item")
        fi
    done
    if [ "${#items[@]}" -eq 0 ]; then
        warn "Tidak ada file untuk dibackup"
        return 0
    fi

    tar -czf "$archive" -C "$PROJECT_DIR" "${items[@]}"
    ok "Backup tersimpan: $archive"
}

do_restore() {
    local archive="${1:-}"
    require_project
    if [ -z "$archive" ] || [ ! -f "$archive" ]; then
        err "File backup tidak ditemukan. Usage: bash vps-manager.sh restore <backup.tar.gz>"
        exit 1
    fi
    stop_bot
    tar -xzf "$archive" -C "$PROJECT_DIR"
    ok "Restore selesai dari: $archive"
    start_bot
}

do_update() {
    require_project
    ensure_clean_or_forced
    cd "$PROJECT_DIR"

    local before_branch before_rev
    before_branch="$(git rev-parse --abbrev-ref HEAD)"
    before_rev="$(git rev-parse --short HEAD)"
    info "Current: $before_branch @ $before_rev"

    do_backup || true

    git fetch origin
    local remote_ref="origin/$before_branch"
    if ! git show-ref --quiet "refs/remotes/$remote_ref"; then
        remote_ref="origin/$DEFAULT_BRANCH"
    fi

    if git pull --ff-only origin "${remote_ref#origin/}"; then
        ok "Git update success"
    else
        warn "Fast-forward pull gagal, mencoba rebase update..."
        git pull --rebase origin "${remote_ref#origin/}"
    fi

    npm install --omit=dev
    npm run test:hardening
    npm test

    cleanup_stale_locks
    restart_bot
    ok "Update + restart selesai."
}

do_install() {
    if [ ! -d "$PROJECT_DIR/.git" ]; then
        mkdir -p "$(dirname "$PROJECT_DIR")"
        if have_cmd git; then
            git clone "$REPO_URL" "$PROJECT_DIR"
        else
            err "git belum terpasang. Install git dulu."
            exit 1
        fi
    fi

    if [ -f "$PROJECT_DIR/vps-setup.sh" ]; then
        bash "$PROJECT_DIR/vps-setup.sh"
    else
        err "vps-setup.sh tidak ditemukan di $PROJECT_DIR"
        exit 1
    fi
}

do_heal() {
    require_project
    cleanup_stale_locks
    clear_telegram_webhook

    local pid_count
    pid_count="$(direct_bot_pids | wc -w | tr -d ' ')"
    if [ "${pid_count:-0}" -gt 1 ]; then
        warn "Terdeteksi bot process ganda ($pid_count), membersihkan..."
        stop_direct_bot_processes
    fi

    stop_bot || true
    start_bot
    ok "Self-heal selesai."
}

confirm_or_exit() {
    local prompt="$1"
    if [ "$YES_MODE" -eq 1 ]; then
        return 0
    fi
    echo "$prompt"
    read -r ans
    if [ "$ans" != "UNINSTALL" ]; then
        err "Konfirmasi gagal. Batal uninstall."
        exit 1
    fi
}

do_uninstall() {
    confirm_or_exit "Ketik UNINSTALL untuk lanjut hapus tool secara bersih:"
    do_backup || true

    stop_bot || true

    if pm2_exists; then
        pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
        pm2 save >/dev/null 2>&1 || true
    fi

    rm -f "$HOME/deploy-token.sh" \
        "$HOME/openclaw.sh" \
        "$HOME/claw-wizard.sh" \
        "$HOME/claw-update.sh" \
        "$HOME/claw-uninstall.sh" \
        "$HOME/claw-netcheck.sh" \
        "$HOME/run-bot.sh" \
        "$HOME/bot-setup.sh" \
        "$HOME/bot-start.sh" \
        "$HOME/bot-stop.sh" \
        "$HOME/bot-status.sh" \
        "$HOME/bot-enable-autostart.sh" \
        "$HOME/clawctl" || true

    rm -f /tmp/clank-and-claw-*.lock || true

    # Safety guard: never allow uninstall to remove unsafe paths.
    if [ -z "${PROJECT_DIR:-}" ] || [ "$PROJECT_DIR" = "/" ] || [ "$PROJECT_DIR" = "$HOME" ] || [ "$PROJECT_DIR" = "." ]; then
        err "PROJECT_DIR tidak aman untuk dihapus: '$PROJECT_DIR'"
        exit 1
    fi

    local resolved_project=""
    resolved_project="$(cd "$(dirname "$PROJECT_DIR")" 2>/dev/null && pwd)/$(basename "$PROJECT_DIR")"
    if [ "$resolved_project" = "/" ] || [ "$resolved_project" = "$HOME" ] || [ "$resolved_project" = "/root" ] || [ "$resolved_project" = "/home" ]; then
        err "Resolved PROJECT_DIR tidak aman: '$resolved_project'"
        exit 1
    fi
    if [ "$(basename "$resolved_project")" != "clank-and-claw" ] && [ "$FORCE_MODE" -ne 1 ]; then
        err "Refuse uninstall untuk path non-standar: '$resolved_project'"
        err "Gunakan --force jika memang sengaja."
        exit 1
    fi

    if [ -d "$resolved_project" ]; then
        rm -rf "$resolved_project"
    fi

    ok "Uninstall selesai bersih."
    info "Backup disimpan di: $BACKUP_DIR"
}

show_logs() {
    local lines="${1:-120}"
    if pm2_exists && pm2_app_exists; then
        pm2 logs "$APP_NAME" --lines "$lines"
        return 0
    fi

    local fallback_log="$PROJECT_DIR/logs/direct-bot.log"
    if [ -f "$fallback_log" ]; then
        tail -n "$lines" "$fallback_log"
        return 0
    fi
    warn "Log tidak ditemukan."
}

wizard() {
    while true; do
        echo ""
        echo "===== CLANK & CLAW WIZARD ====="
        echo "1) Install / Reinstall"
        echo "2) Update (git + npm + test + restart)"
        echo "3) Doctor (preflight full check)"
        echo "4) Telegram bot setup (.env + token validation)"
        echo "5) Start bot"
        echo "6) Stop bot"
        echo "7) Restart bot"
        echo "8) Status"
        echo "9) Logs"
        echo "10) Network check"
        echo "11) Self-heal"
        echo "12) Backup"
        echo "13) Uninstall clean"
        echo "0) Exit"
        echo -n "Pilih menu: "
        read -r menu

        case "$menu" in
            1) do_install ;;
            2) do_update ;;
            3) do_doctor ;;
            4) setup_telegram_env ;;
            5) start_bot ;;
            6) stop_bot ;;
            7) restart_bot ;;
            8) show_status ;;
            9) show_logs 120 ;;
            10) run_netcheck ;;
            11) do_heal ;;
            12) do_backup ;;
            13) do_uninstall ;;
            0) break ;;
            *) warn "Pilihan tidak valid" ;;
        esac
    done
}

main() {
    resolve_project_dir
    local command="${1:-wizard}"
    shift || true
    local args=()

    while [ $# -gt 0 ]; do
        case "$1" in
            --yes) YES_MODE=1 ;;
            --force) FORCE_MODE=1 ;;
            *) args+=("$1") ;;
        esac
        shift || true
    done

    case "$command" in
        wizard) wizard ;;
        install) do_install ;;
        update) do_update ;;
        doctor) do_doctor ;;
        telegram-setup) setup_telegram_env ;;
        start) start_bot ;;
        stop) stop_bot ;;
        restart) restart_bot ;;
        status) show_status ;;
        logs) show_logs "${args[0]:-120}" ;;
        netcheck) run_netcheck ;;
        heal) do_heal ;;
        backup) do_backup ;;
        restore) do_restore "${args[0]:-}" ;;
        uninstall) do_uninstall ;;
        help|-h|--help) usage ;;
        *)
            err "Command tidak dikenal: $command"
            usage
            exit 1
            ;;
    esac
}

main "$@"
