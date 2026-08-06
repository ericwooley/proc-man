# Administration API

## Contract

The API base path is `/api/v1`. The server and
`proc-man api openapi` expose the OpenAPI document.

JSON uses UTC RFC 3339 timestamps, string IDs, and explicit enums. V1 permits
additive fields. A breaking change requires another API version.

## Processes

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/processes` | Filter and list processes. |
| `POST /api/v1/processes` | Create an imperative process. |
| `GET /api/v1/processes/{id}` | Get configuration, state, runs, and ports. |
| `PATCH /api/v1/processes/{id}` | Update an imperative process. |
| `DELETE /api/v1/processes/{id}` | Stop runs and deregister the process. |
| `POST /api/v1/processes/{id}/start` | Start a service. |
| `POST /api/v1/processes/{id}/stop` | Stop a service. |
| `POST /api/v1/processes/{id}/restart` | Restart a service. |
| `POST /api/v1/processes/{id}/runs` | Run a task. |

Process responses contain:

- `id` and canonical `selector`.
- `label`, normalized `tags`, and `kind`.
- `source` provenance.
- Configured launch values.
- Declared ports.
- Service state or active task runs.
- recent runs and log links.

`GET /processes` accepts `query`, repeated `tag`, `kind`, `state`, `attention`,
`source`, `cursor`, and `limit`. Repeated tags use AND semantics. Query searches
labels, tags, ports, and launch metadata.

Labels do not select processes because they can repeat. Clients pass opaque
selectors without deriving them from labels or paths.

An update does not mutate an active run. Responses include `configured` and
`active_run.configuration` when they differ.

Starting a task or running a service returns `409 invalid_kind`. A missing
working directory returns `409 cwd_unavailable`.

## Manifest operations

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/registrations` | Validate and reconcile a process manifest. |
| `POST /api/v1/deregistrations` | Remove processes from one manifest source. |

Registration accepts a manifest path, YAML content, and `dry_run`. It returns
created, updated, removed, and unchanged processes with opaque selectors.
Repeating the same registration is idempotent.

Manifest-owned process updates return `409 manifest_owned` with the manifest
path and key.

## Runs and logs

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/runs` | Filter and paginate runs. |
| `POST /api/v1/run-search` | Search retained output. |
| `GET /api/v1/runs/{id}` | Get one run. |
| `POST /api/v1/runs/{id}/cancel` | Cancel an active task run. |
| `GET /api/v1/runs/{id}/logs` | Read retained records. |
| `GET /api/v1/runs/{id}/logs/events` | Follow logs with SSE. |
| `GET /api/v1/runs/{id}/logs/download` | Download text or NDJSON. |

Run filters include process ID, label, repeated tags, kind, state, time range,
definition presence, cursor, and limit. Each run includes a process snapshot
with its label, tags, kind, command, ports, and source metadata.

Search accepts literal text or RE2, case sensitivity, stream, repeated tags,
process, run state, and time range. Matches include `run_id`, process snapshot,
sequence, time, stream, text, and partial-line state.

## Events

`GET /api/v1/events` streams process, run, and log-state changes. Events use
connection cursors and resource versions. A slow consumer receives a gap event
and then refetches current state.

## Authentication and settings

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/auth/status` | Read password status. |
| `POST /api/v1/auth/login` | Create a session. |
| `POST /api/v1/auth/logout` | Revoke the session. |
| `PUT /api/v1/auth/password` | Set or change the password. |
| `DELETE /api/v1/auth/password` | Disable password authentication. |
| `GET /api/v1/settings` | Read non-secret settings. |

SPA sessions use opaque HttpOnly SameSite cookies. Password hashes use Argon2id.
Password changes revoke all sessions.

## Errors

```json
{
  "error": {
    "code": "cwd_unavailable",
    "message": "the process working directory is not available",
    "details": {
      "process_id": "proc_01...",
      "cwd": "/workspace/app"
    }
  }
}
```

Stable codes include:

- `invalid_request`.
- `validation_failed`.
- `not_found`.
- `ambiguous_selector`.
- `manifest_owned`.
- `invalid_kind`.
- `invalid_state`.
- `cwd_unavailable`.
- `authentication_required`.
- `authentication_failed`.
- `retention_gap`.
- `internal_error`.

## Health

- `GET /healthz` reports that the daemon is alive.
- `GET /readyz` succeeds after migration and run recovery.
