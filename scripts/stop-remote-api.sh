#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/.runtime"
SERVER_PID_FILE="${LOG_DIR}/server.pid"
TUNNEL_PID_FILE="${LOG_DIR}/cloudflared.pid"

stop_from_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [[ ! -f "${pid_file}" ]]; then
    echo "${label}: not running"
    return
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    echo "${label}: stopped (${pid})"
  else
    echo "${label}: stale pid file cleaned"
  fi

  rm -f "${pid_file}"
}

stop_from_pid_file "Tunnel" "${TUNNEL_PID_FILE}"
stop_from_pid_file "Backend" "${SERVER_PID_FILE}"
