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
| `GET /api/v1/worktrees` | List worktrees with aggregate service state. |
| `GET /api/v1/worktrees/{id}` | Get worktree, Git metadata, and services. |
| `POST /api/v1/worktrees/apply` | Validate and reconcile a manifest. |
| `DELETE /api/v1/worktrees/{id}` | Stop and remove a worktree registration. |
| `POST /api/v1/worktrees/{id}/start` | Start all enabled services concurrently. |
| `POST /api/v1/worktrees/{id}/stop` | Stop all running services concurrently. |

Apply accepts the canonical worktree candidate path, manifest YAML, optional
service-port overrides, and `dry_run`. The response is a complete reconciliation
plan/result with assigned ports and links. Repeating the same apply is
idempotent.

### Services

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/services` | Filter and list services. |
| `POST /api/v1/services` | Create an imperative service. |
| `GET /api/v1/services/{id}` | Get effective config, state, and latest run. |
| `PATCH /api/v1/services/{id}` | Update an imperative service. |
| `DELETE /api/v1/services/{id}` | Deregister a service. |
| `POST /api/v1/services/{id}/start` | Start or join an existing launch. |
| `POST /api/v1/services/{id}/stop` | Stop and return to armed idle. |
| `POST /api/v1/services/{id}/restart` | Restart immediately. |
| `POST /api/v1/services/{id}/cancel` | Cancel startup and return to idle. |
| `POST /api/v1/services/{id}/enable` | Arm the service listener. |
| `POST /api/v1/services/{id}/disable` | Stop and disarm the service. |

Updating a manifest-owned service returns `409 manifest_owned` with its manifest
path and service key.

### Runs and logs

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/services/{id}/runs` | Paginate run history. |
| `GET /api/v1/runs/{id}` | Get one run and terminal information. |
| `GET /api/v1/runs/{id}/logs` | Paginate or search retained records. |
| `GET /api/v1/runs/{id}/logs/events` | Follow logs using SSE and a sequence cursor. |
| `GET /api/v1/runs/{id}/logs/download` | Stream text or NDJSON with attachment headers. |

Log queries accept stream, literal query, RE2 expression, case sensitivity,
timestamp range, sequence cursor, and limit. Invalid regular expressions return
validation errors rather than an empty result.

### Events

`GET /api/v1/events` is an authenticated SSE stream for worktree, service, run,
and listener-state changes. Events carry monotonically increasing connection
cursors and resource versions. Reconnecting clients send `Last-Event-ID`.

Slow consumers receive a gap event and must refetch current resource state. The
daemon does not allow one subscriber to block lifecycle processing.

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
hashes and expiry are stored in SQLite. SPA sessions expire after 24 hours.
CLI login sessions expire after five minutes and exist only for the invoking
command. Password changes revoke all sessions. State-changing
cookie-authenticated requests require an exact same-origin `Origin` header or a
CSRF token.

The password is hashed with Argon2id and never returned. When password
authentication is disabled, loopback clients proceed without a session.

### Startup-page capability

The HTTP startup interstitial uses a separate bearer capability:

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/startup/state` | Read the scoped service/current run state. |
| `GET /api/v1/startup/events` | Stream scoped state and log events. |
| `POST /api/v1/startup/restart` | Restart the scoped service. |
| `POST /api/v1/startup/cancel` | Cancel the scoped launch. |

These endpoints accept only the short-lived capability token, ignore admin
cookies, expose no other services, and return an exact allow-origin value for
the page that received the capability. Capabilities expire ten minutes after
issuance or 60 seconds after terminal startup state, whichever is earlier.

## Errors

Non-2xx responses use:

```json
{
  "error": {
    "code": "manifest_owned",
    "message": "service configuration is owned by .port-start.yaml",
    "details": {
      "manifest": "/workspace/.port-start.yaml",
      "service": "web"
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
- `port_conflict`;
- `invalid_state`;
- `startup_backoff`;
- `authentication_required`;
- `authentication_failed`;
- `retention_gap`;
- `internal_error`.

Errors include a request ID in the response header and structured server log.
Secrets, full environments, and passwords are excluded.

## Health

- `GET /healthz` reports that the process is alive.
- `GET /readyz` succeeds only after SQLite migrations, recovery, and listener
  reconciliation have completed.

Health responses contain no sensitive configuration and do not require
authentication.
