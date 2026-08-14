# Testing

## Commit messages

Run `npm run hooks:install` after cloning the repository.
This command sets `core.hooksPath` to `.githooks` for the local checkout.

The `commit-msg` hook accepts Conventional Commit headers and Git merge or revert messages.

## Test structure

The repository uses three test levels:

1. Pure domain tests.
2. Go integration tests.
3. Focused browser and service checks.

## Go tests

```sh
go test ./...
```

Go tests cover:

- Process validation and tag normalization.
- SQLite process and run storage.
- Per-connection SQLite lock settings.
- Manifest parsing and reconciliation.
- Command execution and output capture.
- API routes and error mapping.
- systemd and LaunchAgent file generation.

## React tests

```sh
npm run test:web
```

React tests cover:

- Header brand separation.
- Active Processes navigation.
- Inventory loading.
- List-to-detail navigation.
- Direct process detail routes.
- Run log display.

## Production build

```sh
npm run build
```

The build type-checks React, creates production files, embeds them, and builds the Go binary.

## Service smoke test

```sh
npm run test:smoke
```

The smoke test:

1. Starts the built service with temporary data.
2. Runs a direct one-shot command through the service.
3. Checks its directory, exact argv command, result, and retained output.
4. Confirms that the direct run created no process definition.
5. Registers a long-running service.
6. Starts the registered service.
7. Checks the application and detail routes.
8. Stops the registered service.

This check requires `curl` and `jq`.

## Browser check

```sh
npm run test:browser
```

The browser check loads the production React build with test API data.
It uses a temporary Chrome profile.

The check verifies:

- The brand sits in the header.
- The navigation contains one Processes route.
- The Processes route has an active state.
- A process opens its detail route.
- Full logs load.
- Declared ports load.
- Mobile layout has no page overflow.
- The Processes route returns to inventory.

The shell smoke test verifies the embedded HTTP delivery separately.

## macOS ARM64 checks

The macOS 26 ARM64 workflow builds and installs a test Homebrew Formula.
It checks CLI startup, LaunchAgent loading, and the service HTTP endpoint.

The release workflow also installs the published Formula on macOS 26 ARM64.
It checks the published version before the release workflow passes.

## Prototype checks

The original static prototype remains as a design reference.

```sh
npm run test:prototype
npm run test:prototype:browser
```

## Full local validation

```sh
npm test
npm run test:smoke
npm run test:browser
git diff --check
```
