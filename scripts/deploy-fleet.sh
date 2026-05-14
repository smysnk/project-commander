#!/usr/bin/env bash
set -euo pipefail

GITREPO_FILE="${GITREPO_FILE:-fleet/gitrepo.yml}"
FLEET_NAMESPACE="${FLEET_NAMESPACE:-fleet-local}"
APP_NAMESPACE="${APP_NAMESPACE:-project-commander}"
NAME="${NAME:-project-commander}"
WEB_DEPLOYMENT="${WEB_DEPLOYMENT:-project-commander-web}"
CONTROL_PLANE_DEPLOYMENT="${CONTROL_PLANE_DEPLOYMENT:-project-commander-control-plane}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"
RESTART_AFTER_SYNC="${RESTART_AFTER_SYNC:-0}"

usage() {
  cat <<USAGE
Usage:
  deploy-fleet.sh [options]

Options:
  --gitrepo-file <path>            Fleet GitRepo manifest (default: fleet/gitrepo.yml)
  --fleet-namespace <name>         Fleet namespace (default: fleet-local)
  --app-namespace <name>           App namespace (default: project-commander)
  --name <name>                    GitRepo name (default: project-commander)
  --restart                        Restart web/control-plane workloads after sync
  --wait-seconds <seconds>         Rollout timeout (default: 600)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gitrepo-file)
      GITREPO_FILE="${2:-}"
      shift 2
      ;;
    --fleet-namespace)
      FLEET_NAMESPACE="${2:-}"
      shift 2
      ;;
    --app-namespace)
      APP_NAMESPACE="${2:-}"
      shift 2
      ;;
    --name)
      NAME="${2:-}"
      shift 2
      ;;
    --restart)
      RESTART_AFTER_SYNC="1"
      shift
      ;;
    --wait-seconds)
      WAIT_SECONDS="${2:-600}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

kubectl apply --validate=false -f "$GITREPO_FILE"
kubectl -n "$FLEET_NAMESPACE" get gitrepo "$NAME" -o wide || true

echo "Waiting for Fleet to create deployments in namespace/${APP_NAMESPACE}"
deadline="$(( $(date +%s) + WAIT_SECONDS ))"
while true; do
  if kubectl -n "$APP_NAMESPACE" get deployment "$WEB_DEPLOYMENT" >/dev/null 2>&1 &&
    kubectl -n "$APP_NAMESPACE" get deployment "$CONTROL_PLANE_DEPLOYMENT" >/dev/null 2>&1; then
    break
  fi

  if [[ "$(date +%s)" -ge "$deadline" ]]; then
    echo "Timed out waiting for Fleet deployments" >&2
    exit 1
  fi

  sleep 5
done

if [[ "$RESTART_AFTER_SYNC" == "1" ]]; then
  kubectl -n "$APP_NAMESPACE" rollout restart deployment "$WEB_DEPLOYMENT"
  kubectl -n "$APP_NAMESPACE" rollout restart deployment "$CONTROL_PLANE_DEPLOYMENT"
fi

kubectl -n "$APP_NAMESPACE" rollout status deployment "$WEB_DEPLOYMENT" --timeout="${WAIT_SECONDS}s"
kubectl -n "$APP_NAMESPACE" rollout status deployment "$CONTROL_PLANE_DEPLOYMENT" --timeout="${WAIT_SECONDS}s"
kubectl -n "$APP_NAMESPACE" get deploy,svc,ingress,configmap,secret,pvc
