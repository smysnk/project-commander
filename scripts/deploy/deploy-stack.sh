#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<USAGE
Usage:
  ./scripts/deploy/deploy-stack.sh --host user@remote-host [options]

Required:
  --host <user@host>                SSH target

Options:
  --target-dir <path>               Remote install root (default: /opt/project-commander)
  --service-prefix <prefix>         Service prefix (default: project-commander)
  --service-user <user>             systemd service user (default: SSH user or root)
  --service-group <group>           systemd service group (default: service user)
  --deploy-user <user>              Owner used for app install/build (default: SSH user)
  --deploy-group <group>            Owner group for app install/build (default: deploy user)
  --server-port <port>              GraphQL/server port (default: 4000)
  --web-port <port>                 Next.js web port (default: 3000)
  --master-socket-path <path>       Master UDS path (default: /var/run/project-commander/master.sock)
  --project-path <path>             Discovery PROJECT_PATH (default: <target-dir>/workspaces)
  --project-folder-pattern <regex>  Discovery PROJECT_FOLDER_PATTERN (default: .*)
  --scan-max-depth <int>            Discovery SCAN_MAX_DEPTH (default: 6)
  --db-storage <path>               SQLite DB path (default: <target-dir>/data/project-commander.sqlite)
  --goos <os>                       Build GOOS for pc-master (default: linux)
  --goarch <arch>                   Build GOARCH for pc-master (default: amd64)
  --remote-sudo <cmd|none>          Remote privilege command (default: sudo)
  -h, --help                        Show this help

Examples:
  ./scripts/deploy/deploy-stack.sh \
    --host ubuntu@10.0.0.24 \
    --service-user projectcmd \
    --service-group projectcmd \
    --deploy-user projectcmd \
    --deploy-group projectcmd \
    --project-path /srv/projects
USAGE
}

HOST=""
TARGET_DIR="/opt/project-commander"
SERVICE_PREFIX="project-commander"
SERVICE_USER=""
SERVICE_GROUP=""
DEPLOY_USER=""
DEPLOY_GROUP=""
SERVER_PORT="4000"
WEB_PORT="3000"
MASTER_SOCKET_PATH="/var/run/project-commander/master.sock"
PROJECT_PATH=""
PROJECT_FOLDER_PATTERN=".*"
SCAN_MAX_DEPTH="6"
DB_STORAGE=""
GOOS="linux"
GOARCH="amd64"
REMOTE_SUDO="sudo"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --target-dir)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --service-prefix)
      SERVICE_PREFIX="${2:-}"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="${2:-}"
      shift 2
      ;;
    --service-group)
      SERVICE_GROUP="${2:-}"
      shift 2
      ;;
    --deploy-user)
      DEPLOY_USER="${2:-}"
      shift 2
      ;;
    --deploy-group)
      DEPLOY_GROUP="${2:-}"
      shift 2
      ;;
    --server-port)
      SERVER_PORT="${2:-}"
      shift 2
      ;;
    --web-port)
      WEB_PORT="${2:-}"
      shift 2
      ;;
    --master-socket-path)
      MASTER_SOCKET_PATH="${2:-}"
      shift 2
      ;;
    --project-path)
      PROJECT_PATH="${2:-}"
      shift 2
      ;;
    --project-folder-pattern)
      PROJECT_FOLDER_PATTERN="${2:-}"
      shift 2
      ;;
    --scan-max-depth)
      SCAN_MAX_DEPTH="${2:-}"
      shift 2
      ;;
    --db-storage)
      DB_STORAGE="${2:-}"
      shift 2
      ;;
    --goos)
      GOOS="${2:-}"
      shift 2
      ;;
    --goarch)
      GOARCH="${2:-}"
      shift 2
      ;;
    --remote-sudo)
      REMOTE_SUDO="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fatal "Unknown argument: $1"
      ;;
  esac
done

if [[ -z "${HOST}" ]]; then
  usage
  fatal "--host is required"
fi

REMOTE_SUDO="$(normalize_sudo_prefix "${REMOTE_SUDO}")"

HOST_USER=""
if [[ "${HOST}" == *"@"* ]]; then
  HOST_USER="${HOST%@*}"
fi

if [[ -z "${DEPLOY_USER}" ]]; then
  DEPLOY_USER="${HOST_USER}"
fi
if [[ -z "${DEPLOY_GROUP}" ]]; then
  DEPLOY_GROUP="${DEPLOY_USER}"
fi
if [[ -z "${SERVICE_USER}" ]]; then
  if [[ -n "${DEPLOY_USER}" ]]; then
    SERVICE_USER="${DEPLOY_USER}"
  else
    SERVICE_USER="root"
  fi
fi
if [[ -z "${SERVICE_GROUP}" ]]; then
  SERVICE_GROUP="${SERVICE_USER}"
fi
if [[ -z "${PROJECT_PATH}" ]]; then
  PROJECT_PATH="${TARGET_DIR}/workspaces"
fi
if [[ -z "${DB_STORAGE}" ]]; then
  DB_STORAGE="${TARGET_DIR}/data/project-commander.sqlite"
fi

MASTER_SERVICE_NAME="${SERVICE_PREFIX}-master"
SERVER_SERVICE_NAME="${SERVICE_PREFIX}-server"
WEB_SERVICE_NAME="${SERVICE_PREFIX}-web"
APP_DIR="${TARGET_DIR}/app"
MASTER_LOG_DIR="${TARGET_DIR}/logs/master"
REMOTE_STAGING_DIR="/tmp/${SERVICE_PREFIX}-src"

require_cmd ssh
require_cmd scp
require_cmd rsync
require_cmd go
require_cmd mktemp

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

log "Building pc-master for ${GOOS}/${GOARCH}"
(
  cd "${ROOT_DIR}/packages/agent-master"
  GOOS="${GOOS}" GOARCH="${GOARCH}" CGO_ENABLED=0 go build -o "${TMP_DIR}/pc-master" ./cmd/pc-master
)

cat > "${TMP_DIR}/${MASTER_SERVICE_NAME}.service" <<MASTER_SERVICE
[Unit]
Description=Project Commander Master Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=${TARGET_DIR}/etc/master.env
ExecStart=${TARGET_DIR}/bin/pc-master --socket-path ${MASTER_SOCKET_PATH}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
MASTER_SERVICE

cat > "${TMP_DIR}/${SERVER_SERVICE_NAME}.service" <<SERVER_SERVICE
[Unit]
Description=Project Commander GraphQL Server
After=network-online.target ${MASTER_SERVICE_NAME}.service
Requires=${MASTER_SERVICE_NAME}.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${TARGET_DIR}/etc/server.env
ExecStart=/usr/bin/env bash -lc 'cd ${APP_DIR} && yarn workspace server start'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVER_SERVICE

cat > "${TMP_DIR}/${WEB_SERVICE_NAME}.service" <<WEB_SERVICE
[Unit]
Description=Project Commander Next.js Web App
After=network-online.target ${SERVER_SERVICE_NAME}.service
Requires=${SERVER_SERVICE_NAME}.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${TARGET_DIR}/etc/web.env
ExecStart=/usr/bin/env bash -lc 'cd ${APP_DIR} && yarn workspace web start'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
WEB_SERVICE

cat > "${TMP_DIR}/master.env" <<MASTER_ENV
PC_MASTER_SOCKET_PATH=${MASTER_SOCKET_PATH}
PC_MASTER_LOG_DIR=${MASTER_LOG_DIR}
MASTER_ENV

cat > "${TMP_DIR}/server.env" <<SERVER_ENV
PC_MASTER_SOCKET_PATH=${MASTER_SOCKET_PATH}
SERVER_PORT=${SERVER_PORT}
SERVER_URL=http://localhost:${SERVER_PORT}
RUN_MIGRATIONS_ON_STARTUP=true
PROJECT_PATH=${PROJECT_PATH}
PROJECT_FOLDER_PATTERN=${PROJECT_FOLDER_PATTERN}
SCAN_MAX_DEPTH=${SCAN_MAX_DEPTH}
DB_DIALECT=sqlite
DB_STORAGE=${DB_STORAGE}
SERVER_ENV

cat > "${TMP_DIR}/web.env" <<WEB_ENV
WEB_PORT=${WEB_PORT}
NEXT_PUBLIC_SERVER_PORT=${SERVER_PORT}
WEB_ENV

log "Syncing source to remote staging ${HOST}:${REMOTE_STAGING_DIR}"
rsync -az --delete \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='bin' \
  --exclude='test-results' \
  --exclude='runtime-logs' \
  --exclude='old' \
  "${ROOT_DIR}/" "${HOST}:${REMOTE_STAGING_DIR}/"

log "Uploading deployment artifacts to ${HOST}"
scp "${TMP_DIR}/pc-master" "${HOST}:/tmp/${MASTER_SERVICE_NAME}.bin"
scp "${TMP_DIR}/${MASTER_SERVICE_NAME}.service" "${HOST}:/tmp/${MASTER_SERVICE_NAME}.service"
scp "${TMP_DIR}/${SERVER_SERVICE_NAME}.service" "${HOST}:/tmp/${SERVER_SERVICE_NAME}.service"
scp "${TMP_DIR}/${WEB_SERVICE_NAME}.service" "${HOST}:/tmp/${WEB_SERVICE_NAME}.service"
scp "${TMP_DIR}/master.env" "${HOST}:/tmp/${MASTER_SERVICE_NAME}.env"
scp "${TMP_DIR}/server.env" "${HOST}:/tmp/${SERVER_SERVICE_NAME}.env"
scp "${TMP_DIR}/web.env" "${HOST}:/tmp/${WEB_SERVICE_NAME}.env"

log "Installing stack and starting services on ${HOST}"
ssh "${HOST}" \
  TARGET_DIR="${TARGET_DIR}" \
  APP_DIR="${APP_DIR}" \
  MASTER_SOCKET_PATH="${MASTER_SOCKET_PATH}" \
  MASTER_LOG_DIR="${MASTER_LOG_DIR}" \
  REMOTE_STAGING_DIR="${REMOTE_STAGING_DIR}" \
  MASTER_SERVICE_NAME="${MASTER_SERVICE_NAME}" \
  SERVER_SERVICE_NAME="${SERVER_SERVICE_NAME}" \
  WEB_SERVICE_NAME="${WEB_SERVICE_NAME}" \
  DEPLOY_USER="${DEPLOY_USER}" \
  DEPLOY_GROUP="${DEPLOY_GROUP}" \
  REMOTE_SUDO="${REMOTE_SUDO}" \
  WEB_PORT="${WEB_PORT}" \
  SERVER_PORT="${SERVER_PORT}" \
  'bash -se' <<'REMOTE'
set -euo pipefail

run_priv() {
  if [[ -n "${REMOTE_SUDO}" ]]; then
    "${REMOTE_SUDO}" "$@"
  else
    "$@"
  fi
}

run_priv mkdir -p "${TARGET_DIR}" "${TARGET_DIR}/bin" "${TARGET_DIR}/etc" "${TARGET_DIR}/data" "${MASTER_LOG_DIR}"
run_priv mkdir -p "$(dirname "${MASTER_SOCKET_PATH}")"
run_priv rm -rf "${APP_DIR}"
run_priv mkdir -p "${APP_DIR}"
run_priv cp -R "${REMOTE_STAGING_DIR}/." "${APP_DIR}/"

run_priv install -m 0755 "/tmp/${MASTER_SERVICE_NAME}.bin" "${TARGET_DIR}/bin/pc-master"
run_priv install -m 0644 "/tmp/${MASTER_SERVICE_NAME}.service" "/etc/systemd/system/${MASTER_SERVICE_NAME}.service"
run_priv install -m 0644 "/tmp/${SERVER_SERVICE_NAME}.service" "/etc/systemd/system/${SERVER_SERVICE_NAME}.service"
run_priv install -m 0644 "/tmp/${WEB_SERVICE_NAME}.service" "/etc/systemd/system/${WEB_SERVICE_NAME}.service"
run_priv install -m 0644 "/tmp/${MASTER_SERVICE_NAME}.env" "${TARGET_DIR}/etc/master.env"
run_priv install -m 0644 "/tmp/${SERVER_SERVICE_NAME}.env" "${TARGET_DIR}/etc/server.env"
run_priv install -m 0644 "/tmp/${WEB_SERVICE_NAME}.env" "${TARGET_DIR}/etc/web.env"

if [[ -n "${DEPLOY_USER}" && -n "${DEPLOY_GROUP}" ]]; then
  run_priv chown -R "${DEPLOY_USER}:${DEPLOY_GROUP}" "${APP_DIR}" "${TARGET_DIR}/data" "${MASTER_LOG_DIR}"
fi

if [[ -n "${DEPLOY_USER}" && -n "${REMOTE_SUDO}" ]]; then
  "${REMOTE_SUDO}" -u "${DEPLOY_USER}" bash -lc "cd '${APP_DIR}' && corepack enable >/dev/null 2>&1 || true; yarn install --immutable; yarn build:web"
elif [[ -n "${DEPLOY_USER}" ]]; then
  # No sudo available; assume the SSH user already matches DEPLOY_USER.
  bash -lc "cd '${APP_DIR}' && corepack enable >/dev/null 2>&1 || true; yarn install --immutable; yarn build:web"
elif [[ -n "${REMOTE_SUDO}" ]]; then
  "${REMOTE_SUDO}" bash -lc "cd '${APP_DIR}' && corepack enable >/dev/null 2>&1 || true; yarn install --immutable; yarn build:web"
else
  bash -lc "cd '${APP_DIR}' && corepack enable >/dev/null 2>&1 || true; yarn install --immutable; yarn build:web"
fi

run_priv systemctl daemon-reload
run_priv systemctl enable --now "${MASTER_SERVICE_NAME}.service"
run_priv systemctl enable --now "${SERVER_SERVICE_NAME}.service"
run_priv systemctl enable --now "${WEB_SERVICE_NAME}.service"
run_priv systemctl --no-pager --full status "${MASTER_SERVICE_NAME}.service" || true
run_priv systemctl --no-pager --full status "${SERVER_SERVICE_NAME}.service" || true
run_priv systemctl --no-pager --full status "${WEB_SERVICE_NAME}.service" || true

run_priv rm -rf "${REMOTE_STAGING_DIR}"
rm -f "/tmp/${MASTER_SERVICE_NAME}.bin" "/tmp/${MASTER_SERVICE_NAME}.service" "/tmp/${SERVER_SERVICE_NAME}.service" "/tmp/${WEB_SERVICE_NAME}.service"
rm -f "/tmp/${MASTER_SERVICE_NAME}.env" "/tmp/${SERVER_SERVICE_NAME}.env" "/tmp/${WEB_SERVICE_NAME}.env"
REMOTE

log "Stack deployment complete"
log "Web URL: http://${HOST#*@}:${WEB_PORT}"
log "Server URL: http://${HOST#*@}:${SERVER_PORT}/graphql"
