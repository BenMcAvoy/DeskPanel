#!/bin/sh
set -eu

python /app/control_agent/main.py &
agent_pid=$!

python /app/control_frontend/serve_dist.py &
frontend_pid=$!

cleanup() {
  kill "$agent_pid" "$frontend_pid" 2>/dev/null || true
  wait "$agent_pid" 2>/dev/null || true
  wait "$frontend_pid" 2>/dev/null || true
}

trap cleanup INT TERM

exit_code=0
while :; do
  if ! kill -0 "$agent_pid" 2>/dev/null; then
    wait "$agent_pid" || exit_code=$?
    break
  fi

  if ! kill -0 "$frontend_pid" 2>/dev/null; then
    wait "$frontend_pid" || exit_code=$?
    break
  fi

  sleep 1
done

cleanup
exit "$exit_code"