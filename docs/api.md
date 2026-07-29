# Administration API

## Contract

The administration API is a supported automation interface. Its base path is
`/api/v1`, and its OpenAPI document is available from the server and through
`port-start api openapi`.

JSON uses RFC 3339 timestamps in UTC, string resource identifiers, and explicit
enum values. Additive response fields are permitted within V1; removing or
changing fields requires a new API version.

## Resources

### Worktrees

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/worktrees` | List worktrees with aggregate process and command state. |
| `GET /api/v1/worktrees/{id}` | Get worktree, Git metadata, definitions, and declared ports. |
| `POST /api/v1/worktrees/register` | Validate and reconcile a worktree manifest. |
| `DELETE /api/v1/worktrees/{id}` | Stop and deregister a worktree. |
| `POST /api/v1/worktrees/{id}/processes/start` | Start all processes concurrently. |
| `POST /api/v1/worktrees/{id}/processes/stop` | Stop all active processes concurrently. |

Registration accepts the canonical worktree candidate path, manifest YAML, and
`dry_run`. The response is a complete reconciliation plan or result with
processes, commands, declared ports, and links. For changed active processes, it
returns both active-run links and configured next-run values. Repeating the same
registration is idempotent.

### Processes

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/processes` | Filter and list process definitions. |
| `POST /api/v1/processes` | Create an imperative process definition. |
| `GET /api/v1/processes/{id}` | Get configured values, state, and active-run snapshot. |
| `PATCH /api/v1/processes/{id}` | Update an imperative process definition. |
| `DELETE /api/v1/processes/{id}` | Stop and deregister a process. |
| `POST /api/v1/processes/{id}/start` | Start or return its starting/running run. |
| `POST /api/v1/processes/{id}/stop` | Stop its active run. |
| `POST /api/v1/processes/{id}/restart` | Replace its active run. |

### Commands

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/commands` | Filter and list command definitions. |
| `POST /api/v1/commands` | Create an imperative command definition. |
| `GET /api/v1/commands/{id}` | Get effective config and recent runs. |
| `PATCH /api/v1/commands/{id}` | Update an imperative command definition. |
| `DELETE /api/v1/commands/{id}` | Cancel active invocations and deregister a command. |
| `POST /api/v1/commands/{id}/runs` | Start one invocation and return its run. |

Updating a manifest-owned process or command returns `409 manifest_owned` with
its manifest path, definition kind, and key.

An imperative update or worktree re-registration does not mutate an active
run. Process responses include `configured` and `active_run.configuration`.
When they differ, `configured` is the next-run value. Clients use active-run
ports for links until that run becomes terminal.

Process Start creates a run from `stopped` or `failed`, returns the existing run
from `starting` or `running`, returns `409 invalid_state` from `stopping`, and
returns `409 worktree_stale` from `stale`. Stop is idempotent and joins an
in-progress stop. Restart waits for an active run to terminate and creates
exactly one new run; concurrent Restart requests join that restart operation.
Restart returns `409 worktree_stale` from `stale`.

### Runs and logs

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/runs` | Filter and paginate runs across definitions and worktrees. |
| `POST /api/v1/run-search` | Search retained output across runs. |
| `GET /api/v1/runs/{id}` | Get one run and terminal information. |
| `POST /api/v1/runs/{id}/cancel` | Terminate an active command invocation. |
| `GET /api/v1/runs/{id}/logs` | Paginate or search retained records. |
| `GET /api/v1/runs/{id}/logs/events` | Follow logs using SSE and a sequence cursor. |
| `GET /api/v1/runs/{id}/logs/download` | Stream text or NDJSON with attachment headers. |

`GET /api/v1/runs` accepts `worktree`, `kind`, `name`, `state`, `since`,
`until`, `include_deregistered`, `cursor`, and `limit`. Its response contains
`runs` and `next_cursor`. Every run includes its definition snapshot and a
`worktree_snapshot` with the worktree ID, path, repository, branch, and
identity captured when the run started. Query-time `worktree_registered` and
`definition_present` booleans sit outside that immutable snapshot. This keeps
retained history discoverable after current definitions have been removed
without rewriting historical identity. `include_deregistered` defaults to
false; when true, it also returns runs for which either query-time boolean is
false.

`POST /api/v1/run-search` accepts a literal query or RE2 expression, case
sensitivity, stream, worktree, definition kind and name, run state, timestamp
range, `include_deregistered`, cursor, and limit. Its response contains
ordered `matches` and `next_cursor`; each match includes `run_id`,
`worktree_snapshot`, `worktree_registered`, `definition_present`, and the
canonical log-record fields `seq`, `time`, `stream`, `text`, and `partial`.
Invalid regular expressions return validation errors rather than an empty
result.

Single-run log queries accept the same text, stream, timestamp, cursor, and
limit semantics. Cross-run and single-run search scan the same retained
records, so the SPA, CLI, and API return consistent results.

### Events

`GET /api/v1/events` is an authenticated SSE stream for worktree, definition,
run, and log-state changes. Events carry monotonically increasing connection
cursors and resource versions. Reconnecting clients send `Last-Event-ID`.

Slow consumers receive a gap event and refetch current resource state. One
subscriber cannot block lifecycle processing.

### Authentication and settings

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/auth/status` | Report whether password authentication is enabled. |
| `POST /api/v1/auth/login` | Exchange a password for a session. |
| `POST /api/v1/auth/logout` | Revoke the current session. |
| `PUT /api/v1/auth/password` | Set or change the password. |
| `DELETE /api/v1/auth/password` | Disable password authentication. |
| `GET /api/v1/settings` | Read effective non-secret settings. |

The SPA session is an opaque, HttpOnly, SameSite=Strict cookie. Session token
hashes and expiry are stored in SQLite. SPA sessions expire after 24 hours. CLI
login sessions expire after five minutes and exist only for the invoking
command. Password changes revoke all sessions. State-changing
cookie-authenticated requests require an exact same-origin `Origin` header or a
CSRF token.

The password is hashed with Argon2id and never returned. When password
authentication is disabled, loopback clients proceed without a session.

## Errors

Non-2xx responses use:

```json
{
  "error": {
    "code": "manifest_owned",
    "message": "process configuration is owned by .port-start.yaml",
    "details": {
      "manifest": "/workspace/.port-start.yaml",
      "kind": "process",
      "name": "web"
    }
  }
}
```

Required stable error codes include:

- `invalid_request`;
- `validation_failed`;
- `not_found`;
- `ambiguous_selector`;
- `manifest_owned`;
- `invalid_state`;
- `worktree_stale`;
- `authentication_required`;
- `authentication_failed`;
- `retention_gap`;
- `internal_error`.

Errors include a request ID in the response header and structured server log.
Secrets, full environments, and passwords are excluded.

## Health

- `GET /healthz` reports that the daemon process is alive.
- `GET /readyz` succeeds after SQLite migrations, run recovery, and registration
  loading have completed.

Health responses contain no sensitive configuration and do not require
authentication.
