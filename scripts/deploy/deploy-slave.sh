#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<USAGE
Usage:
  ./scripts/deploy/deploy-slave.sh --host user@remote-host [options]

Required:
  --host <user@host>            SSH target (or local host label in --local mode)

Options:
  --local                       Execute install locally (no SSH/SCP)
  --ssh-port <port>             SSH port for remote copy/install
  --target-dir <path>           Remote install path (default: /opt/project-commander/slave)
  --service-name <name>         Service name (systemd unit / launchd label suffix, default: pc-slave)
  --service-user <user>         Service runtime user (default: logged-in user)
  --service-group <group>       Service runtime group (default: logged-in user's primary group)
  --slave-id <id>               Agent id (default: derived from host)
  --master-endpoint <value>     PC_MASTER_ENDPOINT value (default: empty)
  --master-socket-path <path>   Unix socket path for local slave->master connectivity
  --default-project-path <path> Default project directory shared by slave agents (default: env PC_SLAVE_DEFAULT_PROJECT_PATH)
  --shared-key <value>          PC_SLAVE_SHARED_KEY value (default: env PC_SLAVE_SHARED_KEY)
  --heartbeat-interval <dur>    PC_HEARTBEAT_INTERVAL value (default: 2s)
  --verify-timeout <seconds>    Seconds to wait for slave->master registration (default: 45)
  --verify-retries <count>      Registration verification attempts (default: 3)
  --verify-retry-delay <secs>   Delay between verification attempts (default: 8)
  --goos <os>                   Build GOOS (default: auto-detected from target host)
  --goarch <arch>               Build GOARCH (default: auto-detected from target host)
  --remote-sudo <cmd|none>      Remote privilege command (default: sudo)
  -h, --help                    Show this help

Examples:
  ./scripts/deploy/deploy-slave.sh \
    --host ubuntu@10.0.0.42 \
    --service-user projectcmd \
    --service-group projectcmd \
    --slave-id edge-west-1 \
    --master-endpoint 10.0.0.5:8443
USAGE
}

HOST=""
LOCAL_MODE="0"
SSH_PORT=""
TARGET_DIR="/opt/project-commander/slave"
SERVICE_NAME="pc-slave"
SERVICE_USER=""
SERVICE_GROUP=""
SERVICE_USER_EXPLICIT="0"
SERVICE_GROUP_EXPLICIT="0"
SLAVE_ID=""
MASTER_ENDPOINT=""
MASTER_SOCKET_PATH=""
DEFAULT_PROJECT_PATH="${PC_SLAVE_DEFAULT_PROJECT_PATH:-}"
SHARED_KEY="${PC_SLAVE_SHARED_KEY:-}"
HEARTBEAT_INTERVAL="2s"
VERIFY_TIMEOUT_SECONDS="45"
VERIFY_RETRIES="3"
VERIFY_RETRY_DELAY_SECONDS="8"
GOOS=""
GOARCH=""
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
    --local)
      LOCAL_MODE="1"
      shift 1
      ;;
    --ssh-port)
      SSH_PORT="${2:-}"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="${2:-}"
      SERVICE_USER_EXPLICIT="1"
      shift 2
      ;;
    --service-group)
      SERVICE_GROUP="${2:-}"
      SERVICE_GROUP_EXPLICIT="1"
      shift 2
      ;;
    --slave-id)
      SLAVE_ID="${2:-}"
      shift 2
      ;;
    --master-endpoint)
      MASTER_ENDPOINT="${2:-}"
      shift 2
      ;;
    --master-socket-path)
      MASTER_SOCKET_PATH="${2:-}"
      shift 2
      ;;
    --default-project-path)
      DEFAULT_PROJECT_PATH="${2:-}"
      shift 2
      ;;
    --shared-key)
      SHARED_KEY="${2:-}"
      shift 2
      ;;
    --heartbeat-interval)
      HEARTBEAT_INTERVAL="${2:-}"
      shift 2
      ;;
    --verify-timeout)
      VERIFY_TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    --verify-retries)
      VERIFY_RETRIES="${2:-}"
      shift 2
      ;;
    --verify-retry-delay)
      VERIFY_RETRY_DELAY_SECONDS="${2:-}"
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
if ! [[ "${LOCAL_MODE}" =~ ^[01]$ ]]; then
  fatal "--local must be passed as a flag without a value"
fi
if [[ -n "${SSH_PORT}" ]]; then
  if ! [[ "${SSH_PORT}" =~ ^[0-9]+$ ]] || [[ "${SSH_PORT}" -le 0 ]] || [[ "${SSH_PORT}" -gt 65535 ]]; then
    fatal "--ssh-port must be an integer between 1 and 65535"
  fi
fi
if [[ -z "${MASTER_ENDPOINT}" && -z "${MASTER_SOCKET_PATH}" ]]; then
  fatal "either --master-endpoint or --master-socket-path is required"
fi
if [[ -z "${SHARED_KEY}" ]]; then
  fatal "--shared-key is required (or set PC_SLAVE_SHARED_KEY)"
fi

resolve_default_service_identity() {
  if [[ "${LOCAL_MODE}" == "1" ]]; then
    if [[ -z "${SERVICE_USER}" ]]; then
      SERVICE_USER="$(id -un 2>/dev/null || true)"
    fi
    if [[ -z "${SERVICE_GROUP}" ]]; then
      if [[ -n "${SERVICE_USER}" ]]; then
        SERVICE_GROUP="$(id -gn "${SERVICE_USER}" 2>/dev/null || true)"
      fi
      if [[ -z "${SERVICE_GROUP}" ]]; then
        SERVICE_GROUP="$(id -gn 2>/dev/null || true)"
      fi
    fi
    return
  fi

  local host_user=""
  if [[ "${HOST}" == *"@"* ]]; then
    host_user="${HOST%%@*}"
  fi
  if [[ -z "${SERVICE_USER}" ]]; then
    SERVICE_USER="${host_user}"
  fi
  if [[ -z "${SERVICE_GROUP}" ]]; then
    SERVICE_GROUP="${SERVICE_USER}"
  fi
}

resolve_default_service_identity

if [[ -z "${SERVICE_USER}" ]]; then
  fatal "unable to determine --service-user (set it explicitly or use --host user@host)"
fi
if [[ -z "${SERVICE_GROUP}" ]]; then
  fatal "unable to determine --service-group (set it explicitly)"
fi
if [[ "${SERVICE_USER}" == "root" ]]; then
  fatal "--service-user must be non-root"
fi
if [[ "${SERVICE_GROUP}" == "root" ]]; then
  fatal "--service-group must be non-root"
fi
if ! [[ "${VERIFY_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] || [[ "${VERIFY_TIMEOUT_SECONDS}" -le 0 ]]; then
  fatal "--verify-timeout must be a positive integer number of seconds"
fi
if ! [[ "${VERIFY_RETRIES}" =~ ^[0-9]+$ ]] || [[ "${VERIFY_RETRIES}" -le 0 ]]; then
  fatal "--verify-retries must be a positive integer"
fi
if ! [[ "${VERIFY_RETRY_DELAY_SECONDS}" =~ ^[0-9]+$ ]] || [[ "${VERIFY_RETRY_DELAY_SECONDS}" -le 0 ]]; then
  fatal "--verify-retry-delay must be a positive integer number of seconds"
fi

REMOTE_SUDO="$(normalize_sudo_prefix "${REMOTE_SUDO}")"

if [[ -z "${SLAVE_ID}" ]]; then
  SLAVE_ID="$(printf '%s' "${HOST}" | tr '@:.' '-' | tr -cd '[:alnum:]-')"
fi
SLAVE_STDOUT_LOG="${TARGET_DIR}/logs/${SERVICE_NAME}.stdout.log"
SLAVE_STDERR_LOG="${TARGET_DIR}/logs/${SERVICE_NAME}.stderr.log"

if [[ -n "${MASTER_SOCKET_PATH}" ]]; then
  if [[ "${MASTER_SOCKET_PATH}" == unix://* || "${MASTER_SOCKET_PATH}" == unix:* ]]; then
    MASTER_ENDPOINT="${MASTER_SOCKET_PATH}"
  else
    MASTER_ENDPOINT="unix://${MASTER_SOCKET_PATH}"
  fi
fi

if [[ -n "${GOOS}" ]]; then
  GOOS="$(printf '%s' "${GOOS}" | tr '[:upper:]' '[:lower:]')"
fi
if [[ -n "${GOARCH}" ]]; then
  GOARCH="$(printf '%s' "${GOARCH}" | tr '[:upper:]' '[:lower:]')"
fi

require_cmd go
require_cmd mktemp
if [[ "${LOCAL_MODE}" != "1" ]]; then
  require_cmd ssh
  require_cmd scp
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

TARGET_UNAME_S=""
TARGET_UNAME_M=""

normalize_target_goos() {
  local raw_value
  raw_value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "${raw_value}" in
    linux*|linux)
      echo "linux"
      ;;
    darwin*|macos*)
      echo "darwin"
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_target_goarch() {
  local raw_value
  raw_value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "${raw_value}" in
    x86_64|amd64)
      echo "amd64"
      ;;
    arm64|aarch64)
      echo "arm64"
      ;;
    *)
      return 1
      ;;
  esac
}

detect_target_platform() {
  local uname_s=""
  local uname_m=""
  if [[ "${LOCAL_MODE}" == "1" ]]; then
    uname_s="$(uname -s 2>/dev/null || true)"
    uname_m="$(uname -m 2>/dev/null || true)"
  else
    local remote_platform=""
    if [[ -n "${SSH_PORT}" ]]; then
      remote_platform="$(ssh -p "${SSH_PORT}" "${HOST}" "uname -s 2>/dev/null || true; uname -m 2>/dev/null || true" || true)"
    else
      remote_platform="$(ssh "${HOST}" "uname -s 2>/dev/null || true; uname -m 2>/dev/null || true" || true)"
    fi
    uname_s="$(printf '%s\n' "${remote_platform}" | sed -n '1p')"
    uname_m="$(printf '%s\n' "${remote_platform}" | sed -n '2p')"
  fi

  TARGET_UNAME_S="$(printf '%s' "${uname_s}" | tr '[:upper:]' '[:lower:]')"
  TARGET_UNAME_M="$(printf '%s' "${uname_m}" | tr '[:upper:]' '[:lower:]')"
}

detect_target_platform

if [[ -z "${GOOS}" ]]; then
  GOOS="$(normalize_target_goos "${TARGET_UNAME_S}")" \
    || fatal "Unable to auto-detect GOOS for target host '${HOST}' (uname -s='${TARGET_UNAME_S:-unknown}'). Pass --goos explicitly."
else
  GOOS="$(normalize_target_goos "${GOOS}")" \
    || fatal "Unsupported --goos '${GOOS}'. Supported values: linux, darwin."
fi

if [[ -z "${GOARCH}" ]]; then
  GOARCH="$(normalize_target_goarch "${TARGET_UNAME_M}")" \
    || fatal "Unable to auto-detect GOARCH for target host '${HOST}' (uname -m='${TARGET_UNAME_M:-unknown}'). Pass --goarch explicitly."
else
  GOARCH="$(normalize_target_goarch "${GOARCH}")" \
    || fatal "Unsupported --goarch '${GOARCH}'. Supported values: amd64, arm64."
fi

SUDO_PASSWORD_B64=""
if [[ -n "${PC_DEPLOY_SUDO_PASSWORD:-}" ]]; then
  require_cmd base64
  SUDO_PASSWORD_B64="$(printf '%s' "${PC_DEPLOY_SUDO_PASSWORD}" | base64 | tr -d '\r\n')"
fi

log "Target host platform: ${TARGET_UNAME_S:-unknown}/${TARGET_UNAME_M:-unknown} (build ${GOOS}/${GOARCH})"
log "Building pc-slave for ${GOOS}/${GOARCH}"
(
  cd "${ROOT_DIR}/packages/agent-slave"
  GOOS="${GOOS}" GOARCH="${GOARCH}" CGO_ENABLED=0 go build -o "${TMP_DIR}/pc-slave" ./cmd/pc-slave
)

LAUNCHD_LABEL="com.projectcommander.${SERVICE_NAME}"

cat > "${TMP_DIR}/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Project Commander Slave Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${TARGET_DIR}
Environment=PC_SLAVE_ID=${SLAVE_ID}
Environment=PC_MASTER_ENDPOINT=${MASTER_ENDPOINT}
Environment=PC_SLAVE_DEFAULT_PROJECT_PATH=${DEFAULT_PROJECT_PATH}
Environment=PC_SLAVE_SHARED_KEY=${SHARED_KEY}
Environment=PC_HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL}
Environment=HOME=${TARGET_DIR}
ExecStart=${TARGET_DIR}/bin/pc-slave
StandardOutput=append:${SLAVE_STDOUT_LOG}
StandardError=append:${SLAVE_STDERR_LOG}
KillMode=control-group
TimeoutStopSec=10
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

cat > "${TMP_DIR}/${SERVICE_NAME}.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>UserName</key>
    <string>${SERVICE_USER}</string>
    <key>GroupName</key>
    <string>${SERVICE_GROUP}</string>
    <key>WorkingDirectory</key>
    <string>${TARGET_DIR}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${TARGET_DIR}/bin/pc-slave</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PC_SLAVE_ID</key>
      <string>${SLAVE_ID}</string>
      <key>PC_MASTER_ENDPOINT</key>
      <string>${MASTER_ENDPOINT}</string>
      <key>PC_SLAVE_DEFAULT_PROJECT_PATH</key>
      <string>${DEFAULT_PROJECT_PATH}</string>
      <key>PC_SLAVE_SHARED_KEY</key>
      <string>${SHARED_KEY}</string>
      <key>PC_HEARTBEAT_INTERVAL</key>
      <string>${HEARTBEAT_INTERVAL}</string>
      <key>HOME</key>
      <string>${TARGET_DIR}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SLAVE_STDOUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${SLAVE_STDERR_LOG}</string>
  </dict>
</plist>
PLIST

log "Uploading slave artifacts to ${HOST}"
if [[ "${LOCAL_MODE}" == "1" ]]; then
  cp "${TMP_DIR}/pc-slave" "/tmp/${SERVICE_NAME}.bin"
  cp "${TMP_DIR}/${SERVICE_NAME}.service" "/tmp/${SERVICE_NAME}.service"
  cp "${TMP_DIR}/${SERVICE_NAME}.plist" "/tmp/${SERVICE_NAME}.plist"
else
  SCP_COMMAND=(scp)
  if [[ -n "${SSH_PORT}" ]]; then
    SCP_COMMAND+=("-P" "${SSH_PORT}")
  fi
  "${SCP_COMMAND[@]}" "${TMP_DIR}/pc-slave" "${HOST}:/tmp/${SERVICE_NAME}.bin"
  "${SCP_COMMAND[@]}" "${TMP_DIR}/${SERVICE_NAME}.service" "${HOST}:/tmp/${SERVICE_NAME}.service"
  "${SCP_COMMAND[@]}" "${TMP_DIR}/${SERVICE_NAME}.plist" "${HOST}:/tmp/${SERVICE_NAME}.plist"
fi

INSTALL_RUNNER=()
if [[ "${LOCAL_MODE}" == "1" ]]; then
  log "Installing local service ${SERVICE_NAME}"
  INSTALL_RUNNER=(
    env
    "TARGET_DIR=${TARGET_DIR}"
    "SERVICE_NAME=${SERVICE_NAME}"
    "SERVICE_USER=${SERVICE_USER}"
    "SERVICE_GROUP=${SERVICE_GROUP}"
    "SERVICE_USER_EXPLICIT=${SERVICE_USER_EXPLICIT}"
    "SERVICE_GROUP_EXPLICIT=${SERVICE_GROUP_EXPLICIT}"
    "SLAVE_ID=${SLAVE_ID}"
    "DEFAULT_PROJECT_PATH=${DEFAULT_PROJECT_PATH}"
    "SHARED_KEY=${SHARED_KEY}"
    "HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL}"
    "SLAVE_STDOUT_LOG=${SLAVE_STDOUT_LOG}"
    "SLAVE_STDERR_LOG=${SLAVE_STDERR_LOG}"
    "REMOTE_SUDO=${REMOTE_SUDO}"
    "MASTER_ENDPOINT=${MASTER_ENDPOINT}"
    "MASTER_SOCKET_PATH=${MASTER_SOCKET_PATH}"
    "LAUNCHD_LABEL=${LAUNCHD_LABEL}"
    "SUDO_PASSWORD_B64=${SUDO_PASSWORD_B64}"
    "VERIFY_TIMEOUT_SECONDS=${VERIFY_TIMEOUT_SECONDS}"
    "VERIFY_RETRIES=${VERIFY_RETRIES}"
    "VERIFY_RETRY_DELAY_SECONDS=${VERIFY_RETRY_DELAY_SECONDS}"
    bash
    -se
  )
else
  log "Installing remote service ${SERVICE_NAME}"
  INSTALL_RUNNER=(ssh)
  if [[ -n "${SSH_PORT}" ]]; then
    INSTALL_RUNNER+=("-p" "${SSH_PORT}")
  fi
  INSTALL_RUNNER+=(
    "${HOST}"
    "TARGET_DIR=${TARGET_DIR}"
    "SERVICE_NAME=${SERVICE_NAME}"
    "SERVICE_USER=${SERVICE_USER}"
    "SERVICE_GROUP=${SERVICE_GROUP}"
    "SERVICE_USER_EXPLICIT=${SERVICE_USER_EXPLICIT}"
    "SERVICE_GROUP_EXPLICIT=${SERVICE_GROUP_EXPLICIT}"
    "SLAVE_ID=${SLAVE_ID}"
    "DEFAULT_PROJECT_PATH=${DEFAULT_PROJECT_PATH}"
    "SHARED_KEY=${SHARED_KEY}"
    "HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL}"
    "SLAVE_STDOUT_LOG=${SLAVE_STDOUT_LOG}"
    "SLAVE_STDERR_LOG=${SLAVE_STDERR_LOG}"
    "REMOTE_SUDO=${REMOTE_SUDO}"
    "MASTER_ENDPOINT=${MASTER_ENDPOINT}"
    "MASTER_SOCKET_PATH=${MASTER_SOCKET_PATH}"
    "LAUNCHD_LABEL=${LAUNCHD_LABEL}"
    "SUDO_PASSWORD_B64=${SUDO_PASSWORD_B64}"
    "VERIFY_TIMEOUT_SECONDS=${VERIFY_TIMEOUT_SECONDS}"
    "VERIFY_RETRIES=${VERIFY_RETRIES}"
    "VERIFY_RETRY_DELAY_SECONDS=${VERIFY_RETRY_DELAY_SECONDS}"
    "bash -se"
  )
fi
"${INSTALL_RUNNER[@]}" <<'REMOTE'
set -euo pipefail

DEPLOY_SUDO_REQUIRED_MARKER="__PC_DEPLOY_SUDO_PASSWORD_REQUIRED__"
platform_name="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
if [[ "${platform_name}" == darwin* ]]; then
  service_supervisor="launchd"
else
  service_supervisor="systemd"
fi

launchd_plist_path="/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist"
start_epoch="$(date +%s)"
remote_host_label="$(hostname -s 2>/dev/null || hostname || true)"
remote_host_label="${remote_host_label:-remote-host}"

stream_stdout_pid=""
stream_stderr_pid=""
sudo_password=""

decode_base64() {
  local raw_input="$1"
  local decoded=""
  if [[ -z "${raw_input}" ]]; then
    echo ""
    return 0
  fi
  if decoded="$(printf '%s' "${raw_input}" | base64 --decode 2>/dev/null)"; then
    printf '%s' "${decoded}"
    return 0
  fi
  if decoded="$(printf '%s' "${raw_input}" | base64 -d 2>/dev/null)"; then
    printf '%s' "${decoded}"
    return 0
  fi
  if decoded="$(printf '%s' "${raw_input}" | base64 -D 2>/dev/null)"; then
    printf '%s' "${decoded}"
    return 0
  fi
  return 1
}

if [[ -n "${SUDO_PASSWORD_B64:-}" ]]; then
  if ! sudo_password="$(decode_base64 "${SUDO_PASSWORD_B64}")"; then
    echo "[deploy][warn] unable to decode provided sudo password payload; proceeding without password."
    sudo_password=""
  fi
fi

run_priv() {
  if [[ -n "${REMOTE_SUDO}" ]]; then
    if [[ "${REMOTE_SUDO}" == "sudo" ]]; then
      if [[ -n "${sudo_password}" ]]; then
        printf '%s\n' "${sudo_password}" | sudo -S -p '' "$@"
      else
        sudo -n "$@"
      fi
    else
      "${REMOTE_SUDO}" "$@"
    fi
  else
    "$@"
  fi
}

ensure_privilege_access() {
  if [[ -z "${REMOTE_SUDO}" ]]; then
    return
  fi
  if run_priv true >/dev/null 2>&1; then
    return
  fi
  if [[ -z "${sudo_password}" ]]; then
    echo "[deploy][auth] sudo password is required to continue installation."
    echo "${DEPLOY_SUDO_REQUIRED_MARKER}"
    exit 92
  fi
  if ! run_priv true >/dev/null 2>&1; then
    echo "[deploy][error] provided sudo password was rejected." >&2
    exit 1
  fi
}

command_exists_priv() {
  local command_name="$1"
  run_priv sh -c "command -v ${command_name} >/dev/null 2>&1"
}

stop_streams() {
  if [[ -n "${stream_stdout_pid}" ]]; then
    kill "${stream_stdout_pid}" >/dev/null 2>&1 || true
    wait "${stream_stdout_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${stream_stderr_pid}" ]]; then
    kill "${stream_stderr_pid}" >/dev/null 2>&1 || true
    wait "${stream_stderr_pid}" >/dev/null 2>&1 || true
  fi
}

trap stop_streams EXIT

ensure_service_identity() {
  if [[ "${SERVICE_USER}" == "root" || "${SERVICE_GROUP}" == "root" ]]; then
    echo "[deploy][error] service user/group must be non-root (user='${SERVICE_USER}' group='${SERVICE_GROUP}')" >&2
    exit 1
  fi

  if [[ "${service_supervisor}" == "launchd" ]]; then
    if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
      local fallback_user
      fallback_user="$(id -un)"
      echo "[deploy][warn] service user '${SERVICE_USER}' does not exist on macOS; using '${fallback_user}'."
      SERVICE_USER="${fallback_user}"
    fi
    if ! dscl . -read "/Groups/${SERVICE_GROUP}" >/dev/null 2>&1; then
      local fallback_group
      fallback_group="$(id -gn "${SERVICE_USER}" 2>/dev/null || id -gn)"
      echo "[deploy][warn] service group '${SERVICE_GROUP}' does not exist on macOS; using '${fallback_group}'."
      SERVICE_GROUP="${fallback_group}"
    fi
    return
  fi

  if run_priv id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    if [[ "${SERVICE_GROUP_EXPLICIT:-0}" != "1" ]]; then
      local existing_user_group
      existing_user_group="$(run_priv id -gn "${SERVICE_USER}" 2>/dev/null || true)"
      if [[ -n "${existing_user_group}" ]]; then
        SERVICE_GROUP="${existing_user_group}"
      fi
    fi
  fi

  if ! run_priv getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
    if command_exists_priv groupadd; then
      run_priv groupadd --system "${SERVICE_GROUP}"
    elif command_exists_priv addgroup; then
      run_priv addgroup --system "${SERVICE_GROUP}" >/dev/null 2>&1 || run_priv addgroup "${SERVICE_GROUP}"
    else
      echo "[deploy][error] unable to create group '${SERVICE_GROUP}': missing groupadd/addgroup" >&2
      exit 1
    fi
  fi

  if ! run_priv id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    if command_exists_priv useradd; then
      run_priv useradd --system --gid "${SERVICE_GROUP}" --home-dir "${TARGET_DIR}" --shell /usr/sbin/nologin --create-home "${SERVICE_USER}" \
        || run_priv useradd --gid "${SERVICE_GROUP}" --home-dir "${TARGET_DIR}" --shell /usr/sbin/nologin --create-home "${SERVICE_USER}"
    elif command_exists_priv adduser; then
      run_priv adduser --system --home "${TARGET_DIR}" --ingroup "${SERVICE_GROUP}" --shell /usr/sbin/nologin "${SERVICE_USER}" >/dev/null 2>&1 \
        || run_priv adduser --disabled-password --gecos "" --home "${TARGET_DIR}" --ingroup "${SERVICE_GROUP}" --shell /usr/sbin/nologin "${SERVICE_USER}"
    else
      echo "[deploy][error] unable to create user '${SERVICE_USER}': missing useradd/adduser" >&2
      exit 1
    fi
  fi
}

refresh_systemd_unit_identity() {
  if [[ "${service_supervisor}" != "systemd" ]]; then
    return
  fi
  local unit_path="/tmp/${SERVICE_NAME}.service"
  if [[ ! -f "${unit_path}" ]]; then
    return
  fi
  run_priv sed -i \
    -e "s|^User=.*$|User=${SERVICE_USER}|" \
    -e "s|^Group=.*$|Group=${SERVICE_GROUP}|" \
    "${unit_path}"
  echo "[deploy][debug] systemd unit refreshed with user='${SERVICE_USER}' group='${SERVICE_GROUP}'."
}

ensure_privilege_access
ensure_service_identity
refresh_systemd_unit_identity
run_priv mkdir -p "${TARGET_DIR}/bin" "${TARGET_DIR}/logs"
run_priv chown "${SERVICE_USER}:${SERVICE_GROUP}" "${TARGET_DIR}" "${TARGET_DIR}/logs" || true
run_priv touch "${SLAVE_STDOUT_LOG}" "${SLAVE_STDERR_LOG}"
run_priv chown "${SERVICE_USER}:${SERVICE_GROUP}" "${SLAVE_STDOUT_LOG}" "${SLAVE_STDERR_LOG}"
run_priv chmod 0644 "${SLAVE_STDOUT_LOG}" "${SLAVE_STDERR_LOG}"
run_priv truncate -s 0 "${SLAVE_STDOUT_LOG}" "${SLAVE_STDERR_LOG}" || true
echo "[deploy][debug] Cleared previous slave logs before verification."

if [[ "${service_supervisor}" == "launchd" ]]; then
  cat > "/tmp/${SERVICE_NAME}.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>UserName</key>
    <string>${SERVICE_USER}</string>
    <key>GroupName</key>
    <string>${SERVICE_GROUP}</string>
    <key>WorkingDirectory</key>
    <string>${TARGET_DIR}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${TARGET_DIR}/bin/pc-slave</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PC_SLAVE_ID</key>
      <string>${SLAVE_ID}</string>
      <key>PC_MASTER_ENDPOINT</key>
      <string>${MASTER_ENDPOINT}</string>
      <key>PC_SLAVE_DEFAULT_PROJECT_PATH</key>
      <string>${DEFAULT_PROJECT_PATH}</string>
      <key>PC_SLAVE_SHARED_KEY</key>
      <string>${SHARED_KEY}</string>
      <key>PC_HEARTBEAT_INTERVAL</key>
      <string>${HEARTBEAT_INTERVAL}</string>
      <key>HOME</key>
      <string>${TARGET_DIR}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SLAVE_STDOUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${SLAVE_STDERR_LOG}</string>
  </dict>
</plist>
PLIST
  echo "[deploy][debug] launchd plist refreshed with user='${SERVICE_USER}' group='${SERVICE_GROUP}'."
fi

stop_existing_slave_processes() {
  local known_service=0
  local main_pid=""

  if [[ "${service_supervisor}" == "systemd" ]]; then
    if run_priv systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1; then
      known_service=1
      main_pid="$(run_priv systemctl show -p MainPID --value "${SERVICE_NAME}.service" 2>/dev/null || true)"
      echo "[deploy] Existing ${SERVICE_NAME}.service detected; stopping before reinstall."
      run_priv systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || run_priv systemctl stop "${SERVICE_NAME}.service" || true
      run_priv systemctl reset-failed "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    fi
  else
    if run_priv launchctl print "system/${LAUNCHD_LABEL}" >/dev/null 2>&1; then
      known_service=1
      echo "[deploy] Existing launchd service ${LAUNCHD_LABEL} detected; stopping before reinstall."
      run_priv launchctl bootout system "${launchd_plist_path}" >/dev/null 2>&1 \
        || run_priv launchctl bootout "system/${LAUNCHD_LABEL}" >/dev/null 2>&1 \
        || true
    fi
  fi

  if [[ "${main_pid}" =~ ^[0-9]+$ ]] && [[ "${main_pid}" -gt 0 ]]; then
    if run_priv kill -0 "${main_pid}" >/dev/null 2>&1; then
      echo "[deploy][warn] Killing stale ${SERVICE_NAME} main pid ${main_pid}."
      run_priv kill -TERM "${main_pid}" || true
      sleep 1
      run_priv kill -KILL "${main_pid}" >/dev/null 2>&1 || true
    fi
  fi

  if command_exists_priv pgrep; then
    local stale_pids
    stale_pids="$(run_priv pgrep -f "${TARGET_DIR}/bin/pc-slave" || true)"
    if [[ -n "${stale_pids}" ]]; then
      echo "[deploy][warn] Found stale pc-slave processes; terminating: $(echo "${stale_pids}" | tr '\n' ' ')"
      while IFS= read -r pid; do
        [[ -z "${pid}" ]] && continue
        run_priv kill -TERM "${pid}" >/dev/null 2>&1 || true
      done <<< "${stale_pids}"
      sleep 1
      stale_pids="$(run_priv pgrep -f "${TARGET_DIR}/bin/pc-slave" || true)"
      if [[ -n "${stale_pids}" ]]; then
        echo "[deploy][warn] Force killing remaining stale pc-slave processes: $(echo "${stale_pids}" | tr '\n' ' ')"
        while IFS= read -r pid; do
          [[ -z "${pid}" ]] && continue
          run_priv kill -KILL "${pid}" >/dev/null 2>&1 || true
        done <<< "${stale_pids}"
      fi
    elif [[ "${known_service}" -eq 0 ]]; then
      echo "[deploy][debug] No existing ${SERVICE_NAME} service or stray pc-slave process detected."
    fi
  elif command_exists_priv ps; then
    local stale_pids
    stale_pids="$(
      run_priv ps -eo pid=,args= \
        | awk -v target="${TARGET_DIR}/bin/pc-slave" 'index($0, target) > 0 {print $1}' \
        || true
    )"
    if [[ -n "${stale_pids}" ]]; then
      echo "[deploy][warn] pgrep unavailable; found stale pc-slave processes via ps/awk: $(echo "${stale_pids}" | tr '\n' ' ')"
      while IFS= read -r pid; do
        [[ -z "${pid}" ]] && continue
        run_priv kill -TERM "${pid}" >/dev/null 2>&1 || true
      done <<< "${stale_pids}"
      sleep 1
      stale_pids="$(
        run_priv ps -eo pid=,args= \
          | awk -v target="${TARGET_DIR}/bin/pc-slave" 'index($0, target) > 0 {print $1}' \
          || true
      )"
      if [[ -n "${stale_pids}" ]]; then
        echo "[deploy][warn] Force killing remaining stale pc-slave processes: $(echo "${stale_pids}" | tr '\n' ' ')"
        while IFS= read -r pid; do
          [[ -z "${pid}" ]] && continue
          run_priv kill -KILL "${pid}" >/dev/null 2>&1 || true
        done <<< "${stale_pids}"
      fi
    fi
  else
    echo "[deploy][warn] Neither pgrep nor ps is available on remote host; skipping stray process scan."
  fi
}

stop_existing_slave_processes

run_priv install -m 0755 "/tmp/${SERVICE_NAME}.bin" "${TARGET_DIR}/bin/pc-slave"
if [[ "${service_supervisor}" == "systemd" ]]; then
  run_priv install -m 0644 "/tmp/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
else
  run_priv install -m 0644 "/tmp/${SERVICE_NAME}.plist" "${launchd_plist_path}"
  run_priv chown root:wheel "${launchd_plist_path}" >/dev/null 2>&1 || true
fi

tail -n 0 -F "${SLAVE_STDOUT_LOG}" | sed -u "s/^/[${remote_host_label}][stdout] /" &
stream_stdout_pid="$!"
tail -n 0 -F "${SLAVE_STDERR_LOG}" | sed -u "s/^/[${remote_host_label}][stderr] /" >&2 &
stream_stderr_pid="$!"

if [[ "${service_supervisor}" == "systemd" ]]; then
  run_priv systemctl daemon-reload
  run_priv systemctl enable --now "${SERVICE_NAME}.service"
  if run_priv systemctl is-enabled "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    echo "[deploy] ${SERVICE_NAME}.service is enabled at boot and remains resident independently of SSH login sessions."
  fi
else
  run_priv launchctl bootout system "${launchd_plist_path}" >/dev/null 2>&1 || true
  run_priv launchctl bootstrap system "${launchd_plist_path}"
  run_priv launchctl enable "system/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  run_priv launchctl kickstart -k "system/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  echo "[deploy] ${LAUNCHD_LABEL} is installed via launchd and remains resident independently of SSH login sessions."
fi

print_service_state() {
  if [[ "${service_supervisor}" == "systemd" ]]; then
    local active_state
    local sub_state
    local result_state
    local exec_status
    active_state="$(run_priv systemctl show -p ActiveState --value "${SERVICE_NAME}.service" || true)"
    sub_state="$(run_priv systemctl show -p SubState --value "${SERVICE_NAME}.service" || true)"
    result_state="$(run_priv systemctl show -p Result --value "${SERVICE_NAME}.service" || true)"
    exec_status="$(run_priv systemctl show -p ExecMainStatus --value "${SERVICE_NAME}.service" || true)"
    echo "[deploy][debug] state active='${active_state:-unknown}' sub='${sub_state:-unknown}' result='${result_state:-unknown}' exec_status='${exec_status:-unknown}'"
  else
    echo "[deploy][debug] launchd state for ${LAUNCHD_LABEL}"
    run_priv launchctl print "system/${LAUNCHD_LABEL}" 2>/dev/null | sed -n '1,80p' || true
  fi
}

check_master_connectivity() {
  if [[ -n "${MASTER_SOCKET_PATH}" ]]; then
    local socket_path="${MASTER_SOCKET_PATH}"
    if [[ "${socket_path}" == unix://* ]]; then
      socket_path="${socket_path#unix://}"
    elif [[ "${socket_path}" == unix:* ]]; then
      socket_path="${socket_path#unix:}"
    fi
    if [[ -S "${socket_path}" ]]; then
      echo "[deploy][debug] unix socket connectivity target exists: '${socket_path}'"
    else
      echo "[deploy][warn] unix socket connectivity target missing or not a socket: '${socket_path}'"
    fi
    return
  fi

  if [[ -z "${MASTER_ENDPOINT}" || "${MASTER_ENDPOINT}" != *:* ]]; then
    return
  fi
  local endpoint_host="${MASTER_ENDPOINT%:*}"
  local endpoint_port="${MASTER_ENDPOINT##*:}"
  if [[ -z "${endpoint_host}" || -z "${endpoint_port}" ]]; then
    return
  fi
  if bash -c "</dev/tcp/${endpoint_host}/${endpoint_port}" >/dev/null 2>&1; then
    echo "[deploy][debug] tcp connectivity to master endpoint '${MASTER_ENDPOINT}' succeeded"
  else
    echo "[deploy][warn] tcp connectivity to master endpoint '${MASTER_ENDPOINT}' failed"
  fi
}

print_failure_diagnostics() {
  echo "[deploy][debug] Collecting failure diagnostics for ${SERVICE_NAME}"
  print_service_state
  if [[ "${service_supervisor}" == "systemd" ]]; then
    run_priv systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
    run_priv systemctl cat "${SERVICE_NAME}.service" || true
    run_priv journalctl -u "${SERVICE_NAME}.service" --since "@${start_epoch}" --no-pager -n 300 || true
  else
    run_priv launchctl print "system/${LAUNCHD_LABEL}" || true
    if command_exists_priv log; then
      run_priv log show --last 5m --style compact --predicate "process == \"pc-slave\"" 2>/dev/null | tail -n 200 || true
    fi
  fi
  echo "[deploy][debug] Last stdout lines"
  tail -n 300 "${SLAVE_STDOUT_LOG}" || true
  echo "[deploy][debug] Last stderr lines" >&2
  tail -n 300 "${SLAVE_STDERR_LOG}" >&2 || true
  check_master_connectivity
}

verify_registration_attempt() {
  local attempt="$1"
  local deadline_epoch="$(( $(date +%s) + VERIFY_TIMEOUT_SECONDS ))"
  local next_debug_epoch="$(date +%s)"
  echo "[deploy] verification attempt ${attempt}/${VERIFY_RETRIES}: waiting up to ${VERIFY_TIMEOUT_SECONDS}s for slave registration"
  while [[ "$(date +%s)" -le "${deadline_epoch}" ]]; do
    if grep -Fq "slave registration acknowledged" "${SLAVE_STDOUT_LOG}"; then
      echo "[deploy] slave registration confirmed on attempt ${attempt}"
      return 0
    fi
    if grep -Fq "invalid slave shared key" "${SLAVE_STDOUT_LOG}" \
      || grep -Fq "invalid slave shared key" "${SLAVE_STDERR_LOG}"; then
      echo "[deploy][error] ${SERVICE_NAME} failed to authenticate with master (invalid shared key)." >&2
      return 10
    fi

    local now_epoch
    now_epoch="$(date +%s)"
    if [[ "${now_epoch}" -ge "${next_debug_epoch}" ]]; then
      print_service_state
      check_master_connectivity
      next_debug_epoch="$((now_epoch + 5))"
    fi
    sleep 1
  done
  return 1
}

attempt=1
verified=0
while [[ "${attempt}" -le "${VERIFY_RETRIES}" ]]; do
  if verify_registration_attempt "${attempt}"; then
    verified=1
    break
  fi
  verify_exit="$?"
  if [[ "${verify_exit}" -eq 10 ]]; then
    print_failure_diagnostics
    exit 1
  fi
  if [[ "${attempt}" -lt "${VERIFY_RETRIES}" ]]; then
    echo "[deploy][warn] Verification attempt ${attempt}/${VERIFY_RETRIES} timed out; restarting service and retrying in ${VERIFY_RETRY_DELAY_SECONDS}s."
    if [[ "${service_supervisor}" == "systemd" ]]; then
      run_priv systemctl reset-failed "${SERVICE_NAME}.service" || true
      run_priv systemctl restart "${SERVICE_NAME}.service" || true
    else
      run_priv launchctl kickstart -k "system/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
    fi
    sleep "${VERIFY_RETRY_DELAY_SECONDS}"
  fi
  attempt="$((attempt + 1))"
done

if [[ "${verified}" -ne 1 ]]; then
  echo "[deploy][error] Timed out waiting for ${SERVICE_NAME} to verify connectivity with master target '${MASTER_ENDPOINT:-<pc-slave-default>}' after ${VERIFY_RETRIES} attempt(s)." >&2
  print_failure_diagnostics
  exit 1
fi

if [[ "${service_supervisor}" == "systemd" ]]; then
  run_priv systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
else
  run_priv launchctl print "system/${LAUNCHD_LABEL}" || true
fi
stop_streams
trap - EXIT
rm -f "/tmp/${SERVICE_NAME}.bin" "/tmp/${SERVICE_NAME}.service" "/tmp/${SERVICE_NAME}.plist"
REMOTE

log "Slave deployment complete: ${SERVICE_NAME} on ${HOST}"
