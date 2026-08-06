#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
service_pid=

cleanup() {
  if [ -n "$service_pid" ]; then
    kill "$service_pid" 2>/dev/null || true
    wait "$service_pid" 2>/dev/null || true
  fi
  rm -rf -- "$test_dir"
}
trap cleanup EXIT INT TERM

port=13398
admin_url="http://127.0.0.1:$port"

"$repo_dir/bin/proc-man" serve \
  --port "$port" \
  --data-dir "$test_dir/data" \
  >"$test_dir/service.log" 2>&1 &
service_pid=$!

attempt=0
until curl -fsS "$admin_url/readyz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    cat "$test_dir/service.log"
    exit 1
  fi
  sleep 0.05
done

task_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json \
    process register \
    --label "Smoke task" \
    --kind task \
    --tag smoke \
    --cwd "$repo_dir" \
    --shell 'printf "smoke ready\n"'
)
task_id=$(printf '%s' "$task_json" | jq -r '.data.process.id')

service_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json \
    process register \
    --label "Smoke service" \
    --kind service \
    --tag smoke \
    --port http=http://127.0.0.1:4319/ \
    --cwd "$repo_dir" \
    --shell 'while true; do sleep 1; done'
)
service_id=$(printf '%s' "$service_json" | jq -r '.data.process.id')

run_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json \
    process run "$task_id"
)
run_id=$(printf '%s' "$run_json" | jq -r '.data.run.id')

"$repo_dir/bin/proc-man" --admin-url "$admin_url" \
  process start "$service_id" >/dev/null

attempt=0
while :; do
  state=$(
    curl -fsS "$admin_url/api/v1/runs/$run_id" |
      jq -r '.run.state'
  )
  case "$state" in
    exited|failed|canceled|interrupted) break ;;
  esac
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    exit 1
  fi
  sleep 0.05
done

"$repo_dir/bin/proc-man" --admin-url "$admin_url" \
  process logs "$task_id" --run "$run_id" |
  grep -q "smoke ready"
curl -fsS "$admin_url/" | grep -q '<div id="root"></div>'
curl -fsS "$admin_url/process/$task_id" | grep -q '<div id="root"></div>'
"$repo_dir/bin/proc-man" --admin-url "$admin_url" \
  process stop "$service_id" >/dev/null

printf 'proc-man smoke test passed\n'
