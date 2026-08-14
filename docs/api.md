# Administration API

## Contract

The API base path is `/api/v1`.
The service returns JSON and UTC RFC 3339 timestamps.

The API listens on a loopback address.
The application and CLI use this API.

## Processes

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/processes` | List and filter processes. |
| `POST /api/v1/processes` | Register an imperative process. |
| `GET /api/v1/processes/{id}` | Get one process and recent runs. |
| `PATCH /api/v1/processes/{id}` | Update an imperative process. |
| `DELETE /api/v1/processes/{id}` | Stop and deregister one process. |
| `POST /api/v1/processes/{id}/start` | Start a service. |
| `POST /api/v1/processes/{id}/stop` | Stop a service. |
| `POST /api/v1/processes/{id}/restart` | Restart a service. |
| `POST /api/v1/processes/{id}/runs` | Run a task. |
| `GET /api/v1/processes/{id}/runs` | List runs for one process. |

Process list filters are:

- `query`
- `directory`
- repeated `tag`
- `kind`
- `state`
- `limit`
- `cursor`

Repeated tags use AND behavior.
The directory filter matches the exact stored working directory.

Set `limit` from 1 through 100 to use cursor pagination.
The server orders paginated results by the most recent update, then by process ID.
The response adds a `page` object with `limit`, `has_more`, and `next_cursor`.
Paginated responses also include global tag and directory counts in `facets`.
Pass `next_cursor` as `cursor` to read the next older page.
The server applies process filters before the page limit.

Requests without `limit` or `cursor` keep the original unpaged v1 behavior.

## Runs

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/runs` | List runs. |
| `GET /api/v1/runs/{id}` | Get one run. |
| `POST /api/v1/runs/{id}/cancel` | Cancel an active task run. |

Run list filters are:

- `process_id`
- repeated `tag`
- `kind`
- `state`
- `limit`

Run responses include a process snapshot.
The snapshot remains after process deregistration.

## Logs

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/runs/{id}/logs` | Read retained records. |
| `GET /api/v1/runs/{id}/logs/events` | Stream new records. |
| `GET /api/v1/runs/{id}/logs/download` | Download text or NDJSON. |
| `POST /api/v1/run-search` | Search retained run output. |

The log route accepts:

- `query`
- `stream`
- `since`
- `limit`

The search request accepts text, stream, process ID, tags, and limit.
Search uses case-insensitive literal text.

Use `format=ndjson` on the download route for structured records.
The default download format is text.

## Tags and events

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/tags` | List tags and process counts. |
| `GET /api/v1/events` | Stream process and run changes. |
| `GET /api/v1/settings` | Read local server settings. |

## Manifest operations

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/registrations` | Validate and apply a manifest. |
| `POST /api/v1/deregistrations` | Remove one manifest source. |

Registration accepts `path`, `content`, and `dry_run`.
The response groups created, updated, removed, and unchanged processes.

Deregistration accepts `source`.
The source is the canonical manifest path.

## Service routes

- `GET /healthz`
- `GET /readyz`
- `GET /api/v1/openapi.json`

## Errors

```json
{
  "error": {
    "code": "cwd_unavailable",
    "message": "working directory is unavailable",
    "details": null
  }
}
```

Stable error codes include:

- `validation_failed`
- `not_found`
- `manifest_owned`
- `invalid_kind`
- `invalid_state`
- `cwd_unavailable`
- `internal_error`
