#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/.runtime"
SERVER_LOG="${LOG_DIR}/server.log"
TUNNEL_LOG="${LOG_DIR}/cloudflared.log"
SERVER_PID_FILE="${LOG_DIR}/server.pid"
TUNNEL_PID_FILE="${LOG_DIR}/cloudflared.pid"
PORT="${PORT:-8787}"
TARGET_URL="http://127.0.0.1:${PORT}"

cd "${ROOT_DIR}"

mkdir -p "${LOG_DIR}"

cleanup_pid_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      sleep 1
    fi
    rm -f "${pid_file}"
  fi
}

cleanup_pid_file "${TUNNEL_PID_FILE}"

if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Backend already running on ${TARGET_URL}"
else
  cleanup_pid_file "${SERVER_PID_FILE}"
  echo "Starting backend on ${TARGET_URL} ..."
  nohup node "${ROOT_DIR}/server.js" >"${SERVER_LOG}" 2>&1 &
  echo $! > "${SERVER_PID_FILE}"

  for _ in {1..20}; do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo
  echo "Backend failed to start. Check log:"
  echo "  ${SERVER_LOG}"
  exit 1
fi

: > "${TUNNEL_LOG}"
echo "Starting cloudflared tunnel ..."
nohup cloudflared tunnel --url "${TARGET_URL}" --no-autoupdate >"${TUNNEL_LOG}" 2>&1 &
echo $! > "${TUNNEL_PID_FILE}"

TUNNEL_URL=""
for _ in {1..30}; do
  if [[ -f "${TUNNEL_LOG}" ]]; then
    TUNNEL_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" | head -n 1 || true)"
    if [[ -n "${TUNNEL_URL}" ]]; then
      break
    fi
  fi
  sleep 1
done

if [[ -z "${TUNNEL_URL}" ]]; then
  echo
  echo "Tunnel started but URL was not detected yet. Check log:"
  echo "  ${TUNNEL_LOG}"
  exit 1
fi

printf "%s" "${TUNNEL_URL}" | pbcopy

echo
echo "Done."
echo "Backend health: ${TARGET_URL}/api/health"
echo "Remote API URL: ${TUNNEL_URL}"
echo "The URL has been copied to your clipboard."
echo
echo "Logs:"
echo "  Backend    ${SERVER_LOG}"
echo "  Tunnel     ${TUNNEL_LOG}"
echo
echo "If you want to stop them later, run:"
echo "  bash ${ROOT_DIR}/scripts/stop-remote-api.sh"
