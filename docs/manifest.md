# Process manifest

## Discovery

The canonical filename is `.port-start.yaml`.

`port-start register` searches from the current directory upward and reads the
nearest manifest. `--file` selects another file. Relative working directories
resolve from the manifest directory.

The manifest is declarative. Registration makes the stored manifest-owned
processes match the file. Imperative processes remain unchanged.

## Version 1

```yaml
version: 1

defaults:
  tags: [project:storefront]
  stop_timeout: 10s
  retention:
    max_bytes_per_run: 50MiB
    max_runs: 20

processes:
  - key: web
    label: Storefront web
    kind: service
    tags: [role:web, frontend]
    cwd: .
    ports:
      - name: http
        host: 127.0.0.1
        port: 4310
        protocol: http
        path: /
    command:
      argv: [npm, run, dev, --, --port, "{port.http}"]

  - key: test
    label: Storefront test suite
    kind: task
    tags: [test]
    cwd: .
    command:
      argv: [npm, test]
    timeout: 10m
```

Unknown fields are errors.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | Yes | Schema version. V1 accepts integer `1`. |
| `defaults` | No | Shared tags, limits, and retention. |
| `processes` | Yes | One or more process definitions. |

## Process fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `key` | Yes | None | Stable manifest key. |
| `label` | Yes | None | Human label from 1 through 120 characters. |
| `kind` | Yes | None | `service` or `task`. |
| `tags` | No | `[]` | Free-form normalized tags. |
| `cwd` | No | `.` | Directory relative to the manifest. |
| `command` | Yes | None | Exactly one of `argv` or `shell`. |
| `env` | No | `{}` | Environment overrides. |
| `ports` | No | `[]` | Declared port metadata. |
| `stop_timeout` | No | `10s` | TERM to KILL limit. |
| `timeout` | No | Unlimited | Task run limit. |
| `retention` | No | Defaults | Log-retention limits. |

Keys must be unique in one manifest. Labels can repeat. Default tags and
process tags form one normalized set.

## Tags

A tag:

- Trim whitespace and convert the tag to lowercase.
- Require 1 through 63 characters.
- Start with a letter or number.
- Use letters, numbers, a period, an underscore, a hyphen, or a colon.
- Keep the tag unique within one process after normalization.

V1 accepts free-form tags. Clients suggest existing tags but do not constrain
new values.

## Command representation

Argv is preferred:

```yaml
command:
  argv: [npm, run, dev]
```

Shell form is explicit:

```yaml
command:
  shell: exec ./scripts/migrate
```

Both forms use the configured login shell. Shell form permits shell expansion,
pipes, redirection, and compound commands.

## Declared ports

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Yes | None | Unique key within the process. |
| `host` | No | `127.0.0.1` | Displayed host. |
| `port` | Yes | None | Integer from 1 through 65535. |
| `protocol` | No | `tcp` | `tcp`, `http`, or `https`. |
| `path` | No | `/` | HTTP path beginning with `/`. |

The child binds its own sockets. Registration can warn about overlapping
declarations, but it does not reject or reserve them.

Named ports provide placeholders and environment variables:

| Value | Meaning |
| --- | --- |
| `{port.http}` | Numeric port value. |
| `{host.http}` | Declared host value. |
| `{manifest_dir}` | Canonical manifest directory. |
| `{definition_id}` | Stable process ID. |
| `{run_id}` | New run ID. |
| `PORT_START_PORT_HTTP` | Normalized port variable. |
| `PORT_START_URL_HTTP` | HTTP or HTTPS URL. |

## Reconciliation

`port-start register`:

1. Validate the file.
2. Calculate the required process set.
3. Create or update entries by manifest path and key.
4. Stop and remove deleted manifest entries.
5. Preserve active-run snapshots.
6. Leave imperative processes unchanged.

`port-start register --dry-run` returns the same change plan without writes.
`port-start deregister --source` removes processes from one manifest source.

The CLI exposes the schema:

```sh
port-start schema manifest
port-start schema manifest --format json
```
