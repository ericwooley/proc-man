# Process manifest

## Discovery

The canonical filename is `.proc-man.yaml`.

`proc-man register` searches from the current directory toward the filesystem root.
`--file` selects a different file.

Relative working directories resolve from the manifest directory.

## Version 1

```yaml
version: 1

processes:
  - key: web
    label: Storefront web
    kind: service
    tags: [frontend, project:storefront]
    cwd: .
    env:
      NODE_ENV: development
    ports:
      - name: http
        host: 127.0.0.1
        port: 4310
        protocol: http
        path: /
    command:
      argv: [npm, run, dev, --, --port, "4310"]

  - key: test
    label: Storefront tests
    kind: task
    tags: [test, project:storefront]
    cwd: .
    command:
      argv: [npm, test]
```

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | Yes | Schema version. Version 1 accepts integer `1`. |
| `processes` | Yes | One or more process definitions. |

## Process fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `key` | Yes | None | Stable key within the manifest. |
| `label` | Yes | None | Human process label. |
| `kind` | Yes | None | `service` or `task`. |
| `tags` | No | `[]` | Normalized process tags. |
| `cwd` | No | Manifest directory | Working directory. |
| `command` | Yes | None | One argv array or shell string. |
| `env` | No | `{}` | Environment overrides. |
| `ports` | No | `[]` | Declared port metadata. |

Keys must be unique within one manifest.
Labels can repeat.

## Commands

Argv form:

```yaml
command:
  argv: [npm, run, dev]
```

Shell form:

```yaml
command:
  shell: exec ./scripts/migrate
```

Use shell form when the command needs expansion, pipes, or redirection.

## Declared ports

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Yes | None | Unique name within the process. |
| `host` | No | `127.0.0.1` | Display host. |
| `port` | Yes | None | Integer from 1 through 65535. |
| `protocol` | No | `tcp` | `tcp`, `http`, or `https`. |
| `path` | No | Empty | Optional HTTP path. |

The process command binds its own listener.
proc-man records and displays the declaration.

Commands and environment values can use `{port.<name>}`.
The supervisor also adds `PROC_MAN_PORT_<NAME>` and `PROC_MAN_HOST_<NAME>`.

## Reconciliation

Registration follows this sequence:

1. Parse and validate the manifest.
2. Match current processes by source path and key.
3. Create missing entries.
4. Update changed entries.
5. Stop and remove deleted entries.
6. Keep imperative processes unchanged.

`proc-man register --dry-run` returns the planned changes.

`proc-man deregister --source` stops and removes all processes from one source.
Existing run snapshots and logs remain.
