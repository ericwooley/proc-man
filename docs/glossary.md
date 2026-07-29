# Domain glossary

This glossary defines the shared language used by the product specification,
API, CLI, and architecture decision records.

## Administration server

The long-running HTTP server on a permanently configured control-plane port. It
serves the administration API and React/Vite single-page application. The CLI
also uses this API.

## Worktree registration

The durable inventory of a Git worktree's process definitions, command
definitions, declared ports, runs, and logs.

## Process definition

The durable configuration for one named long-running command that Port Start can
start, stop, restart, supervise, and log.

## Command definition

The durable configuration for one named one-shot command that Port Start can
run, cancel, and log.

## Managed process

The process group launched and supervised by Port Start for a process definition
or command invocation.

## Declared port

A named host, explicit TCP port, protocol hint, and optional URL path associated
with a process definition. It is used for discovery and launch configuration.

## Launch command

The argv array or explicit shell string started for a process or command
definition. It runs through the user's login shell in the configured working
directory.

## Run

One process start or command invocation, including its snapshotted execution
configuration, process identity, timestamps, terminal result, and logs.

## Manifest-owned definition

A process or command whose desired configuration comes from
`.port-start.yaml`. Operational actions remain available, while configuration
changes flow through worktree registration.

## Imperative definition

A process or command created directly through the CLI or API and editable
through those interfaces.

## Process log

The tagged stdout/stderr record stream captured for one run and retained in
segmented files.

## Reconciliation

The idempotent operation that compares a worktree manifest with its stored
manifest-owned definitions and updates the registration to match.

## Stale worktree

A registered worktree whose root path is missing. Its active runs are stopped
while the 24-hour deletion grace period runs.
