# proc-man

proc-man is a local process manager for development commands.

Each process has a label, tags, a command, a working directory, declared ports, runs, and logs.

The Go service supervises processes and serves the React application.
The CLI and application use the same local API.
The React application provides the process inventory and process detail routes.

## Features

- Register services and one-shot tasks.
- Filter and group processes with tags or working directories.
- Start, stop, and restart services.
- Run and cancel tasks.
- Record declared ports as process metadata.
- Read current and retained run logs.
- Apply and remove process manifests.
- Install the Go binary as a user service.

Git worktrees can register normal process manifests.
proc-man does not create a worktree resource or worktree page.

## Requirements

- Go 1.24 or newer.
- Node.js 22 or newer.
- npm.
- `jq` 1.6 or newer for the shell smoke test.
- Google Chrome for the browser check.

The browser check uses Node.js global `WebSocket`.
Set `CHROME_BIN` when Google Chrome uses another path.

## Build

```sh
npm install --prefix web
npm run build
```

The build creates `bin/proc-man`.
The Go binary embeds the React production files.

## Development setup

Enable the repository Git hooks after each new clone:

```sh
npm run hooks:install
```

The `commit-msg` hook requires Conventional Commit headers.
For example, use `feat(cli): add directory filtering`.

## Run locally

```sh
./bin/proc-man serve
```

Open <http://127.0.0.1:13337/>.

The service accepts loopback hosts only.
proc-man targets local development and has no deployment workflow.

## Register a process

These commands register processes directly.
They do not require a manifest file.

Register a service:

```sh
./bin/proc-man process register \
  --label "Storefront web" \
  --kind service \
  --tag frontend \
  --tag project:storefront \
  --port http=http://127.0.0.1:4310/ \
  --cwd "$PWD" \
  -- npm run dev -- --port 4310
```

Register a task:

```sh
./bin/proc-man process register \
  --label "Storefront tests" \
  --kind task \
  --tag test \
  --cwd "$PWD" \
  -- npm test
```

Use the returned process ID for later commands.

```sh
./bin/proc-man process list
./bin/proc-man process list --directory .
./bin/proc-man process start PROCESS_ID
./bin/proc-man process logs PROCESS_ID
./bin/proc-man process stop PROCESS_ID
./bin/proc-man process deregister PROCESS_ID
```

## Install the user service

Place `bin/proc-man` in a stable executable path.

```sh
./bin/proc-man daemon install --now
```

Linux uses a systemd user service.
macOS uses a per-user LaunchAgent.

## Test

```sh
npm test
npm run test:smoke
npm run test:browser
```

## Documentation

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Manifest](docs/manifest.md)
- [CLI](docs/cli.md)
- [API](docs/api.md)
- [Logs](docs/logging.md)
- [Operations](docs/operations.md)
- [Testing](docs/testing.md)
- [Architecture decisions](docs/adr/README.md)
- [Design QA](design-qa.md)
