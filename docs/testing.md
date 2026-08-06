# Testing

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
2. Registers a task and service.
3. Runs the task.
4. Starts the service immediately after the task.
5. Reads the task logs.
6. Checks the application and detail routes.
7. Stops the service.

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
