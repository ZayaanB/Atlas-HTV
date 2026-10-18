#!/usr/bin/env bash
# Atlas deploy (Person 4). Fast-forwards /opt/atlas to origin/main, rebuilds only what changed, restarts
# atlas-backend, waits for readiness, and rolls back to the previous commit if a build or the health check fails.
#
#   sudo bash /opt/atlas/infra/deploy.sh                     deploy the latest origin/main now
#   sudo bash /opt/atlas/infra/deploy.sh --force             rebuild contracts, backend and frontend even when up to date
#   sudo bash /opt/atlas/infra/deploy.sh --allow-migrations  deploy an update touching db/migrations (apply on Tiger first)
#   bash /opt/atlas/infra/deploy.sh --auto                   atlas-deploy.timer mode: silent when up to date, never waits,
#                                                            holds migration updates, skips a commit that already failed
#
# Never touches /etc/atlas, /var/lib/atlas (flight ledger), the database, or the installed systemd/Caddy files.
# All work happens inside main(): bash parses the whole file before `git merge` can rewrite it mid-run.
set -Eeuo pipefail

REPO=/opt/atlas
BRANCH=main
STATE_DIR=/var/lib/atlas-deploy
HEALTH_URL=http://127.0.0.1:3001/api/health
LIVE_URL=http://127.0.0.1:3001/api/health/live

AUTO=0 FORCE=0 ALLOW_MIGRATIONS=0
OLD='' NEW='' CHANGED=''
contracts=0 backend=0 frontend=0 restart=0 swapped=0 restarted=0

log() { printf '%s atlas-deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }
changed() { grep -qE "$1" <<<"$CHANGED"; }
http_ok() { curl -fsS -o /dev/null --max-time 5 "$1"; }

# Up to 60 s for the restarted backend to answer.
wait_healthy() {
  local _
  for _ in $(seq 1 30); do http_ok "$1" && return 0; sleep 2; done
  return 1
}

# Functions below run in `if` context, where bash ignores set -e, so every step checks its own status.
install_deps() {
  local pkg=$1
  if [[ ! -d $REPO/$pkg/node_modules ]] || changed "^$pkg/package(-lock)?\.json$"; then
    log "npm ci in $pkg"
    npm --prefix "$REPO/$pkg" ci --no-audit --no-fund || return 1
  fi
}

build_pkg() {
  install_deps "$1" || return 1
  log "building $1"
  npm --prefix "$REPO/$1" run build || return 1
}

# The frontend builds into dist.next and is swapped in afterwards, so Caddy never serves a half-written dist.
build_frontend() {
  grep -qs '^VITE_MAPBOX_ACCESS_TOKEN=pk\.' "$REPO/frontend/.env.production.local" ||
    log "WARNING: frontend/.env.production.local has no pk. Mapbox token; the globe will be unavailable"
  install_deps frontend || return 1
  log "building frontend"
  rm -rf "$REPO/frontend/dist.next"
  npm --prefix "$REPO/frontend" run build -- --outDir dist.next || return 1
}

build_all() {
  if (( contracts )); then build_pkg contracts || return 1; fi
  if (( backend )); then build_pkg backend || return 1; fi
  if (( frontend )); then build_frontend || return 1; fi
  return 0
}

swap_frontend() {
  cd "$REPO/frontend"
  rm -rf dist.prev
  if [[ -d dist ]]; then mv dist dist.prev; fi
  mv dist.next dist
  swapped=1
  cd "$REPO"
}

# Remembered so --auto does not retry the same commit every run; a manual deploy clears it.
skip_commit() { printf '%s\n' "$NEW" >"$STATE_DIR/skip-commit"; }

hold() {
  skip_commit
  die "$1; deploy ${NEW:0:7} by hand: sudo bash $REPO/infra/deploy.sh${2:+ $2}"
}

rollback() {
  log "ERROR: $1; rolling back to ${OLD:0:7}"
  cd "$REPO"
  git reset --quiet --hard "$OLD"
  rm -rf frontend/dist.next
  if (( swapped )) && [[ -d frontend/dist.prev ]]; then rm -rf frontend/dist && mv frontend/dist.prev frontend/dist; fi
  if (( contracts )); then build_pkg contracts || log "WARNING: contracts rebuild failed during rollback"; fi
  if (( backend )); then build_pkg backend || log "WARNING: backend rebuild failed during rollback"; fi
  # A build failure happens before the restart: the running process still has the old code loaded.
  if (( restarted )); then
    systemctl restart atlas-backend
    wait_healthy "$LIVE_URL" || log "WARNING: backend still not answering after rollback; see journalctl -u atlas-backend"
  fi
  skip_commit
  die "rolled back to ${OLD:0:7}; ${NEW:0:7} will not be auto-deployed again"
}

main() {
  local arg
  for arg in "$@"; do
    case $arg in
      --auto) AUTO=1 ;;
      --force) FORCE=1 ;;
      --allow-migrations) ALLOW_MIGRATIONS=1 ;;
      *) die "unknown option: $arg" ;;
    esac
  done
  [[ $EUID == 0 ]] || die "run as root (sudo)"
  install -d -m 0700 "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || { log "another deploy is already running"; exit 0; }
  cd "$REPO"
  export GIT_TERMINAL_PROMPT=0

  [[ -z $(git status --porcelain --untracked-files=no) ]] ||
    die "tracked files in $REPO have local edits; commit or discard them first"
  git fetch --quiet origin "$BRANCH"
  OLD=$(git rev-parse HEAD)
  NEW=$(git rev-parse "origin/$BRANCH")
  if [[ $OLD == "$NEW" ]] && (( ! FORCE )); then
    (( AUTO )) || log "already at ${NEW:0:7}"
    exit 0
  fi
  if (( AUTO )) && [[ $NEW == "$(cat "$STATE_DIR/skip-commit" 2>/dev/null)" ]]; then exit 0; fi
  git merge-base --is-ancestor "$OLD" "$NEW" ||
    die "origin/$BRANCH is not a fast-forward of ${OLD:0:7}; resolve by hand"

  CHANGED=$(git diff --name-only "$OLD" "$NEW")
  if changed '^db/migrations/'; then
    (( AUTO )) && hold "update changes db/migrations; apply them on Tiger first" --allow-migrations
    (( ALLOW_MIGRATIONS )) ||
      die "update changes db/migrations: apply them on Tiger first (npm --prefix backend run setup:tiger), then rerun with --allow-migrations"
  fi

  if (( AUTO )); then
    systemctl is-active --quiet atlas-ingest.service && { log "ingestion pass running; retrying next run"; exit 0; }
  else
    while systemctl is-active --quiet atlas-ingest.service; do
      log "waiting for the running ingestion pass to finish"
      sleep 15
    done
  fi

  # Judge the new release by readiness only if the old one was ready; otherwise a Tiger outage would force a rollback.
  local check_url=$LIVE_URL
  if http_ok "$HEALTH_URL"; then check_url=$HEALTH_URL; else log "WARNING: backend was not ready before deploy; checking liveness only"; fi

  if (( FORCE )); then contracts=1 backend=1 frontend=1 restart=1; fi
  if changed '^contracts/'; then contracts=1 backend=1 frontend=1; fi
  if changed '^backend/'; then backend=1; fi
  if changed '^frontend/'; then frontend=1; fi
  # The backend loads contracts/, db/handoff/ and scripts/ at runtime; Caddy serves frontend/ and assets/ directly.
  if (( backend )) || grep -qvE '^(frontend/|assets/|docs/)|\.md$' <<<"$CHANGED"; then restart=1; fi

  local infra
  infra=$(grep -E '^infra/(.+\.(service|timer)|Caddyfile)$' <<<"$CHANGED" || true)
  [[ -z $infra ]] || log "NOTE: installed copies are not updated by this script; review and install: $(tr '\n' ' ' <<<"$infra")"

  log "deploying ${OLD:0:7} -> ${NEW:0:7} (contracts=$contracts backend=$backend frontend=$frontend restart=$restart)"
  git merge --quiet --ff-only "$NEW"

  build_all || rollback "build failed"
  if (( frontend )); then swap_frontend; fi
  if (( restart )); then
    log "restarting atlas-backend"
    restarted=1
    systemctl restart atlas-backend
    wait_healthy "$check_url" || rollback "backend did not pass $check_url within 60 s"
  fi

  # frontend/dist.prev stays until the next frontend deploy for a manual restore.
  rm -f "$STATE_DIR/skip-commit"
  log "deployed ${NEW:0:7}"
}

main "$@"
exit 0
