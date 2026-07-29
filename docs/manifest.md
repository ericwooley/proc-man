# Worktree manifest

## File discovery

The canonical manifest name is `.port-start.yaml`.

`port-start worktree register` searches from the current directory upward to the
Git worktree root and reads `<worktree-root>/.port-start.yaml`. `--file` may
select another file, but every relative path in that file still resolves from
the detected worktree root.

The manifest is declarative. A successful registration makes the worktree's
manifest-owned process and command definitions match the file. Imperatively
registered definitions are outside that reconciliation.

## Version 1

```yaml
version: 1

defaults:
  stop_timeout: 10s
  retention:
    max_bytes_per_run: 50MiB
    max_runs: 20

processes:
  - name: web
    cwd: .
    ports:
      - name: http
        host: 127.0.0.1
        port: 4310
        protocol: http
        path: /
      - name: inspector
        host: 127.0.0.1
        port: 9310
        protocol: tcp
    command:
      argv:
        - npm
        - run
        - dev
        - --
        - --host
        - 127.0.0.1
        - --port
        - "{port.http}"
    env:
      NODE_ENV: development

commands:
  - name: test
    cwd: .
    command:
      argv: ["npm", "test"]

  - name: migrate
    cwd: apps/api
    command:
      shell: exec ./scripts/migrate
    timeout: 5m
```

Unknown fields are errors. This protects checked-in configuration from silent
misspellings.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | Yes | Schema version. V1 accepts only integer `1`. |
| `defaults` | No | Shared stop-timeout and retention defaults. |
| `processes` | No | Long-running process definitions. Defaults to an empty list. |
| `commands` | No | One-shot command definitions. Defaults to an empty list. |

At least one process or command is required. Names must be unique within their
definition kind. A process and command may share a display name because selectors
always include their kind.

## Common definition fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Yes | — | Stable key matching `[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}`. |
| `cwd` | No | `.` | Worktree-relative execution directory, constrained to the worktree. |
| `command` | Yes | — | Exactly one of `argv` or `shell`. |
| `env` | No | `{}` | String-to-string environment overrides. |
| `stop_timeout` | No | `10s` | Duration between SIGTERM and SIGKILL. |
| `retention` | No | global/default | Log-retention constraints. |

Command definitions additionally accept `timeout`, an optional positive maximum
duration for one invocation. Process definitions additionally accept `ports`.

### Command representation

Argv form:

```yaml
command:
  argv: ["npm", "run", "dev"]
```

Shell form:

```yaml
command:
  shell: exec npm run dev
```

Argv is preferred because argument boundaries remain explicit. Both forms use
the configured user login shell environment. Shell form opts into expansion,
pipes, redirection, and compound-command semantics.

## Declared ports

A process may declare zero or more ports:

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Yes | — | Unique port key within the process. |
| `host` | No | `127.0.0.1` | Host shown in addresses and links. |
| `port` | Yes | — | Explicit integer from `1` through `65535`. |
| `protocol` | No | `tcp` | `tcp`, `http`, or `https`. |
| `path` | No | `/` | Link path for HTTP(S), beginning with `/`. |

`path` is invalid for `tcp`. Port Start stores these declarations for discovery,
links, launch configuration, and run snapshots. The launched process binds its
own sockets.

Two registered processes may declare the same host and port. Registration
returns a warning listing the overlapping definitions so worktree tooling can
surface likely configuration mistakes without treating metadata as a lock.

### Substitutions and environment

Named port placeholders are expanded in argv elements, shell strings, and
environment values:

| Placeholder | Meaning |
| --- | --- |
| `{port.<name>}` | Numeric value of the named declared port. |
| `{host.<name>}` | Host value of the named declared port. |
| `{worktree_root}` | Canonical worktree root. |
| `{definition_id}` | Stable process or command identifier. |
| `{run_id}` | Identifier of the new run. |

For a port named `http`, the daemon also sets:

- `PORT_START_PORT_HTTP`;
- `PORT_START_HOST_HTTP`;
- `PORT_START_URL_HTTP` when the protocol is HTTP or HTTPS.

Every launch also receives `PORT_START_WORKTREE_ROOT`,
`PORT_START_DEFINITION_ID`, and `PORT_START_RUN_ID`. Names are normalized to
uppercase ASCII with non-alphanumeric characters replaced by underscores.
Collisions after normalization are validation errors.

Application-specific variables remain explicit:

```yaml
env:
  PORT: "{port.http}"
```

Port Start's values win over conflicting manifest values for reserved
`PORT_START_*` names.

## Retention

Retention constraints may be combined:

```yaml
retention:
  max_bytes_per_run: 50MiB
  max_runs: 20
  max_age: 30d
```

Omitted constraints are unbounded. The explicit form below disables automatic
deletion for the definition:

```yaml
retention:
  unlimited: true
```

`unlimited: true` cannot be combined with another retention field.

## Reconciliation and ownership

Manifest ownership is recorded on every created definition.

- Re-registration updates matching definitions by worktree identity, kind, and
  name.
- When a matching definition has an active run, that run keeps its launch
  snapshot and the updated definition applies to its next run.
- Definitions removed from the manifest are stopped, if active, and
  deregistered.
- Existing run history remains subject to retention.
- Imperative definitions are unchanged.
- The SPA and direct update commands direct configuration changes for
  manifest-owned definitions to the manifest path.
- Process lifecycle, command execution, logs, and explicit worktree
  deregistration remain available as operational actions.

The CLI exposes the embedded schema through:

```sh
port-start schema manifest
port-start schema manifest --format json
```

`worktree register --dry-run` performs discovery, parsing, validation, overlap
analysis, and reconciliation planning without writing state.
