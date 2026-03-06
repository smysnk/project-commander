#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTO_DIR="${ROOT_DIR}/proto"
OUT_DIR="${ROOT_DIR}/packages/agent-shared/gen"

export PATH="${PATH}:${HOME}/go/bin"

mkdir -p "${OUT_DIR}"

protoc \
  -I "${PROTO_DIR}" \
  --go_out="${OUT_DIR}" \
  --go_opt=paths=source_relative \
  --go-grpc_out="${OUT_DIR}" \
  --go-grpc_opt=paths=source_relative \
  "${PROTO_DIR}/projectcommander/master/v1/master_control.proto" \
  "${PROTO_DIR}/projectcommander/master/v1/master_events.proto" \
  "${PROTO_DIR}/projectcommander/slave/v1/slave_control.proto"
