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

audit_script='printf "smoke %s\n" "$PROC_MAN_SMOKE_ENV"'
one_shot_output=$(
  cd "$repo_dir"
  PROC_MAN_SMOKE_ENV=caller-value \
    "$repo_dir/bin/proc-man" --admin-url "$admin_url" \
    run -- /bin/sh -c "$audit_script"
)
if [ "$one_shot_output" != "smoke caller-value" ]; then
  exit 1
fi

direct_runs_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json \
    run list --directory "$repo_dir"
)
direct_run_id=$(
  printf '%s' "$direct_runs_json" | jq -er \
    --arg directory "$repo_dir" \
    --arg script "$audit_script" '
      .data.runs as $runs
      | if (
          ($runs | length) == 1
          and $runs[0].process_id == null
          and $runs[0].process.source.kind == "direct"
          and $runs[0].process.cwd == $directory
          and ($runs[0].process.env | length) == 0
          and $runs[0].process.command.argv == ["/bin/sh", "-c", $script]
          and $runs[0].state == "exited"
          and $runs[0].exit_code == 0
        ) then $runs[0].id else error("invalid direct audit run") end
    '
)

direct_logs_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json \
    run logs "$direct_run_id"
)
printf '%s' "$direct_logs_json" | jq -e \
  '.data.records | any(.stream == "stdout" and .text == "smoke caller-value")' \
  >/dev/null

processes_json=$(
  "$repo_dir/bin/proc-man" --admin-url "$admin_url" --json process list
)
printf '%s' "$processes_json" | jq -e '.data.processes | length == 0' >/dev/null

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

"$repo_dir/bin/proc-man" --admin-url "$admin_url" \
  process start "$service_id" >/dev/null

curl -fsS "$admin_url/" | grep -q '<div id="root"></div>'
curl -fsS "$admin_url/process/$service_id" | grep -q '<div id="root"></div>'
"$repo_dir/bin/proc-man" --admin-url "$admin_url" \
  process stop "$service_id" >/dev/null

printf 'proc-man smoke test passed\n'
