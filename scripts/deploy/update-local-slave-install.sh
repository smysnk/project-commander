#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

COLOR_CYAN='\033[1;36m'
COLOR_BLUE='\033[1;34m'
COLOR_GREEN='\033[1;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[1;31m'
COLOR_RESET='\033[0m'

BINARY_PATH="${REPO_ROOT}/bin/pc-slave"

usage() {
  cat <<USAGE
Usage:
  ./scripts/deploy/update-local-slave-install.sh [--binary <path>]

Options:
  --binary <path>   Path to replacement pc-slave binary (default: ./bin/pc-slave)
  -h, --help        Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf "${COLOR_RED}[deploy:local-update] unknown argument: %s${COLOR_RESET}\n" "$1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "${BINARY_PATH}" ]]; then
  printf "${COLOR_RED}[deploy:local-update] binary not found: %s${COLOR_RESET}\n" "${BINARY_PATH}" >&2
  exit 1
fi

if [[ ! -x "${BINARY_PATH}" ]]; then
  printf "${COLOR_YELLOW}[deploy:local-update] warning: binary is not executable yet, install will still proceed${COLOR_RESET}\n"
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO_PREFIX=()
else
  SUDO_PREFIX=(sudo)
fi

run_priv() {
  if "$@"; then
    return 0
  fi
  local status=$?
  if [[ "${#SUDO_PREFIX[@]}" -gt 0 ]]; then
    "${SUDO_PREFIX[@]}" "$@"
    return 0
  fi
  return "${status}"
}

declare -a INSTALLS=()

has_install_entry() {
  local candidate="$1"
  local existing=""
  for existing in "${INSTALLS[@]-}"; do
    if [[ "${existing}" == "${candidate}" ]]; then
      return 0
    fi
  done
  return 1
}

add_install() {
  local mode="$1"
  local id="$2"
  local exec_path="$3"
  local manifest="$4"
  local key="${mode}|${id}|${exec_path}|${manifest}"
  if has_install_entry "${key}"; then
    return
  fi
  INSTALLS+=("${key}")
}

discover_systemd_installs() {
  local dir=""
  local unit_file=""
  local unit_name=""
  local exec_path=""
  for dir in /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
    [[ -d "${dir}" ]] || continue
    for unit_file in "${dir}"/*.service; do
      [[ -f "${unit_file}" ]] || continue
      exec_path="$(grep -Eo '/[^[:space:]]+/bin/pc-slave' "${unit_file}" | head -n 1 || true)"
      [[ -n "${exec_path}" ]] || continue
      [[ "$(basename "${exec_path}")" == "pc-slave" ]] || continue
      unit_name="$(basename "${unit_file}" .service)"
      add_install "systemd" "${unit_name}" "${exec_path}" "${unit_file}"
    done
  done
}

discover_launchd_installs() {
  local plist=""
  local program_path=""
  local label=""
  local plist_buddy="/usr/libexec/PlistBuddy"

  [[ -d /Library/LaunchDaemons ]] || return
  for plist in /Library/LaunchDaemons/*.plist; do
    [[ -f "${plist}" ]] || continue

    program_path=""
    label=""
    if [[ -x "${plist_buddy}" ]]; then
      program_path="$("${plist_buddy}" -c "Print :ProgramArguments:0" "${plist}" 2>/dev/null || true)"
      label="$("${plist_buddy}" -c "Print :Label" "${plist}" 2>/dev/null || true)"
    fi
    if [[ -z "${program_path}" ]]; then
      program_path="$(grep -Eo '/[^<[:space:]]+/bin/pc-slave' "${plist}" | head -n 1 || true)"
    fi
    [[ -n "${program_path}" ]] || continue
    [[ "$(basename "${program_path}")" == "pc-slave" ]] || continue

    if [[ -z "${label}" ]]; then
      label="$(basename "${plist}" .plist)"
    fi
    add_install "launchd" "${label}" "${program_path}" "${plist}"
  done
}

restart_systemd_service() {
  local unit_name="$1"
  local active="0"
  local enabled="0"

  run_priv systemctl daemon-reload || true
  if run_priv systemctl is-active --quiet "${unit_name}.service"; then
    active="1"
  fi
  if run_priv systemctl is-enabled --quiet "${unit_name}.service"; then
    enabled="1"
  fi

  if [[ "${active}" == "1" ]]; then
    printf "${COLOR_BLUE}[deploy:local-update] restarting systemd unit %s.service${COLOR_RESET}\n" "${unit_name}"
    run_priv systemctl restart "${unit_name}.service"
    return
  fi
  if [[ "${enabled}" == "1" ]]; then
    printf "${COLOR_BLUE}[deploy:local-update] starting enabled systemd unit %s.service${COLOR_RESET}\n" "${unit_name}"
    run_priv systemctl start "${unit_name}.service"
    return
  fi
  printf "${COLOR_YELLOW}[deploy:local-update] systemd unit %s.service is installed but not active; binary updated only${COLOR_RESET}\n" "${unit_name}"
}

restart_launchd_service() {
  local label="$1"
  local plist_path="$2"

  printf "${COLOR_BLUE}[deploy:local-update] reloading launchd label %s${COLOR_RESET}\n" "${label}"
  run_priv launchctl bootout system "${plist_path}" >/dev/null 2>&1 || true
  run_priv launchctl bootstrap system "${plist_path}"
  run_priv launchctl enable "system/${label}" >/dev/null 2>&1 || true
  run_priv launchctl kickstart -k "system/${label}" >/dev/null 2>&1 || true
}

discover_systemd_installs
discover_launchd_installs

if [[ "${#INSTALLS[@]}" -eq 0 ]]; then
  printf "${COLOR_CYAN}[deploy:local-update] no local installed pc-slave service found; skipping install sync${COLOR_RESET}\n"
  exit 0
fi

printf "${COLOR_CYAN}[deploy:local-update] updating %d local pc-slave install(s) with %s${COLOR_RESET}\n" "${#INSTALLS[@]}" "${BINARY_PATH}"

for entry in "${INSTALLS[@]-}"; do
  IFS='|' read -r mode id exec_path manifest <<< "${entry}"
  target_dir="$(dirname "${exec_path}")"
  printf "${COLOR_BLUE}[deploy:local-update] %s %s -> %s${COLOR_RESET}\n" "${mode}" "${id}" "${exec_path}"
  run_priv mkdir -p "${target_dir}"
  run_priv install -m 0755 "${BINARY_PATH}" "${exec_path}"
  if [[ "${mode}" == "systemd" ]]; then
    restart_systemd_service "${id}"
  else
    restart_launchd_service "${id}" "${manifest}"
  fi
done

printf "${COLOR_GREEN}[deploy:local-update] complete${COLOR_RESET}\n"
