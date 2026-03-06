#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

WATCH_ROOT="${WATCH_ROOT:-.}"
INTERVAL_SECONDS="${WATCH_INTERVAL_SECONDS:-1}"

COLOR_CYAN='\033[1;36m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[1;31m'
COLOR_GREEN='\033[1;32m'
COLOR_RESET='\033[0m'

child_pid=""

watch_file_list() {
  find "${WATCH_ROOT}" -type f \
    \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' -o -name '*.proto' -o -name '.env' -o -name '.env.*' -o -name 'Makefile' \) \
    -not -path '*/.git/*' \
    -not -path '*/bin/*' \
    -not -path '*/build/*' \
    -not -path '*/dist/*' \
    -not -path '*/node_modules/*' \
    -print0
}

hash_watch_state() {
  local os_name
  os_name="$(uname -s)"

  if [[ "${os_name}" == "Darwin" ]]; then
    watch_file_list \
      | while IFS= read -r -d '' file_path; do
          stat -f '%m %z %N' "${file_path}"
        done \
      | LC_ALL=C sort \
      | shasum -a 1 \
      | awk '{print $1}'
  else
    watch_file_list \
      | while IFS= read -r -d '' file_path; do
          stat -c '%Y %s %n' "${file_path}"
        done \
      | LC_ALL=C sort \
      | sha1sum \
      | awk '{print $1}'
  fi
}

kill_process_tree() {
  local pid="$1"
  local signal_name="$2"

  if [[ -z "${pid}" ]]; then
    return
  fi

  local children
  children="$(pgrep -P "${pid}" 2>/dev/null || true)"
  if [[ -n "${children}" ]]; then
    while IFS= read -r child; do
      [[ -z "${child}" ]] && continue
      kill_process_tree "${child}" "${signal_name}"
    done <<< "${children}"
  fi

  kill "-${signal_name}" "${pid}" 2>/dev/null || true
}

stop_child() {
  if [[ -z "${child_pid}" ]]; then
    return
  fi

  if kill -0 "${child_pid}" 2>/dev/null; then
    kill_process_tree "${child_pid}" "TERM"
    sleep 0.2
    if kill -0 "${child_pid}" 2>/dev/null; then
      kill_process_tree "${child_pid}" "KILL"
    fi
    wait "${child_pid}" 2>/dev/null || true
  fi

  child_pid=""
}

start_child() {
  printf "${COLOR_CYAN}[go-watch] starting:${COLOR_RESET} %s\n" "$*"
  "$@" &
  child_pid="$!"
  printf "${COLOR_GREEN}[go-watch] pid:${COLOR_RESET} %s\n" "${child_pid}"
}

shutdown() {
  stop_child
  printf "${COLOR_YELLOW}[go-watch] stopped${COLOR_RESET}\n"
  exit 0
}

trap shutdown INT TERM

current_hash="$(hash_watch_state || true)"
start_child "$@"

while true; do
  sleep "${INTERVAL_SECONDS}"

  if [[ -n "${child_pid}" ]] && ! kill -0 "${child_pid}" 2>/dev/null; then
    if wait "${child_pid}"; then
      exit_code=0
    else
      exit_code=$?
    fi

    printf "${COLOR_RED}[go-watch] process exited:${COLOR_RESET} %s\n" "${exit_code}"
    printf "${COLOR_YELLOW}[go-watch] waiting for file changes to restart...${COLOR_RESET}\n"
    child_pid=""
  fi

  next_hash="$(hash_watch_state || true)"
  if [[ "${next_hash}" != "${current_hash}" ]]; then
    current_hash="${next_hash}"

    if [[ -n "${child_pid}" ]]; then
      printf "${COLOR_YELLOW}[go-watch] file change detected; restarting...${COLOR_RESET}\n"
      stop_child
    else
      printf "${COLOR_YELLOW}[go-watch] file change detected; starting...${COLOR_RESET}\n"
    fi

    start_child "$@"
  fi
done
