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
- Download release archives for macOS, Linux, and Windows.
- Install macOS and Linux releases through a Homebrew tap.

Git worktrees can register normal process manifests.
proc-man does not create a worktree resource or worktree page.

## Requirements

- Go 1.26 or newer.
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

Append proc-man usage instructions to a repository agent file:

```sh
proc-man --agent-instructions >> AGENTS.md
```

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

## Install with Homebrew

The Homebrew Formula supports macOS and Linux.
[Homebrew requires explicit trust](https://docs.brew.sh/Tap-Trust) for non-official taps.
These commands work after a release publishes the Formula to `ericwooley/homebrew-apps`.

Install proc-man with its fully qualified Formula name:

```sh
brew install ericwooley/apps/proc-man
```

This command adds `ericwooley/apps` and trusts only the proc-man Formula.
It installs the proc-man executable.
Start the service with the default daemon setup command on macOS and Linux:

```sh
proc-man daemon install --now
```

You can also add the tap before installation:

```sh
brew tap ericwooley/apps
brew install ericwooley/apps/proc-man
```

Upgrade an installed release:

```sh
brew update
brew upgrade ericwooley/apps/proc-man
```

Remove proc-man and its tap:

```sh
proc-man daemon uninstall
brew uninstall proc-man
brew untap ericwooley/apps
```

Remove the user service before Homebrew removes the executable.

Replace an installed Cask with the Formula:

```sh
brew uninstall --cask proc-man
brew install ericwooley/apps/proc-man
```

Windows users can download a ZIP archive from the GitHub Release.

## Start the background daemon

Use this command as the default daemon setup after any proc-man installation:

```sh
proc-man daemon install --now
```

The command installs and starts a systemd user service on Linux.
The command installs and starts a per-user LaunchAgent on macOS.
Run this command after Homebrew installation and upgrades.

## Test

```sh
npm test
npm run test:smoke
npm run test:browser
```

## Release

Each qualifying push to `main` creates a version from its Conventional Commits.
The workflow creates the version tag and GitHub Release directly.
It then builds archives for macOS, Linux, and Windows.
It also updates the `ericwooley/homebrew-apps` Formula.

See [Releasing](docs/releasing.md) for the required tap repository and token.

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
- [Releasing](docs/releasing.md)
- [Architecture decisions](docs/adr/README.md)
- [Design QA](design-qa.md)

## License

proc-man is available under the [MIT License](LICENSE).
