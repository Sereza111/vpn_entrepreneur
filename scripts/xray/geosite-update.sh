#!/usr/bin/env bash
set -Eeuo pipefail

# Safe updater for Xray geosite.dat (runetfreedom release channel).
# - Verifies SHA256 before install
# - Uses atomic replace + backup
# - Prevents parallel runs (flock)
# - Does NOT restart by default (set XRAY_RESTART_CMD explicitly)

LOCK_FILE="${LOCK_FILE:-/var/lock/geosite-update.lock}"
WORK_DIR="${WORK_DIR:-/var/lib/geosite-updater}"
GEOSITE_PATH="${GEOSITE_PATH:-/usr/local/share/xray/geosite.dat}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/xray}"
LOG_PREFIX="${LOG_PREFIX:-[geosite-updater]}"

GEOSITE_URL="${GEOSITE_URL:-https://raw.githubusercontent.com/runetfreedom/russia-blocked-geosite/release/geosite.dat}"
SHA_URL="${SHA_URL:-https://raw.githubusercontent.com/runetfreedom/russia-blocked-geosite/release/geosite.dat.sha256sum}"

# Optional safety commands:
# - XRAY_TEST_CMD: validates config before restart (optional)
# - XRAY_RESTART_CMD: reload/restart service when file changed (optional, default empty)
XRAY_TEST_CMD="${XRAY_TEST_CMD:-}"
XRAY_RESTART_CMD="${XRAY_RESTART_CMD:-}"

# Set DRY_RUN=1 to verify download/checksum without replacing live file.
DRY_RUN="${DRY_RUN:-0}"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

require_cmd curl
require_cmd sha256sum
require_cmd install
require_cmd awk
require_cmd flock
require_cmd cmp
require_cmd date

mkdir -p "$WORK_DIR" "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || {
  log "another update is in progress, exiting"
  exit 0
}

tmp_dat="$WORK_DIR/geosite.dat.new"
tmp_sha="$WORK_DIR/geosite.dat.sha256sum"

log "downloading geosite.dat"
curl -fL --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 120 \
  -o "$tmp_dat" "$GEOSITE_URL"

log "downloading checksum"
curl -fL --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 60 \
  -o "$tmp_sha" "$SHA_URL"

expected_hash="$(awk '{print $1}' "$tmp_sha" | tr -d '\r\n')"
if [[ -z "$expected_hash" ]]; then
  log "failed to parse expected hash"
  exit 1
fi

actual_hash="$(sha256sum "$tmp_dat" | awk '{print $1}')"
if [[ "$actual_hash" != "$expected_hash" ]]; then
  log "checksum mismatch: expected=$expected_hash actual=$actual_hash"
  exit 1
fi

if [[ -f "$GEOSITE_PATH" ]] && cmp -s "$tmp_dat" "$GEOSITE_PATH"; then
  log "no changes detected"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run mode: verified new file, live file not replaced"
  exit 0
fi

timestamp="$(date +%F_%H-%M-%S)"
if [[ -f "$GEOSITE_PATH" ]]; then
  backup_path="$BACKUP_DIR/geosite.dat.$timestamp.bak"
  cp -f "$GEOSITE_PATH" "$backup_path"
  log "backup created: $backup_path"
fi

install -m 0644 "$tmp_dat" "$GEOSITE_PATH"
log "installed new geosite.dat to $GEOSITE_PATH"

if [[ -n "$XRAY_TEST_CMD" ]]; then
  log "running test command"
  if ! bash -lc "$XRAY_TEST_CMD"; then
    log "test command failed, rolling back"
    if [[ -f "$backup_path" ]]; then
      install -m 0644 "$backup_path" "$GEOSITE_PATH"
      log "rollback completed from backup"
    fi
    exit 1
  fi
fi

if [[ -n "$XRAY_RESTART_CMD" ]]; then
  log "running restart command"
  bash -lc "$XRAY_RESTART_CMD"
  log "restart command completed"
else
  log "XRAY_RESTART_CMD is empty, skip reload/restart"
fi

log "done"
