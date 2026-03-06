#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() {
  printf '[deploy] %s\n' "$*"
}

fatal() {
  printf '[deploy][error] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fatal "Missing required command: ${command_name}"
  fi
}

normalize_sudo_prefix() {
  local raw_value="${1:-sudo}"
  if [[ "${raw_value}" == "none" ]]; then
    echo ""
    return
  fi
  echo "${raw_value}"
}
