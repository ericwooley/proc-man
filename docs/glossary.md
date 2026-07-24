# Domain glossary

This glossary defines the shared language used by the product specification,
API, CLI, and architecture decision records.

## Administration server

The long-running HTTP server on a permanently reserved port. It serves the
administration API and the React/Vite single-page application. The CLI also uses
this API.

## Managed port

The advertised TCP port associated with one service. Port Start owns it
permanently in proxy mode and while idle in handoff mode.

## Service

The durable configuration and lifecycle for one launch command and one managed
port. A service is either manifest-owned or imperative.

## Launch command

The argv array or explicit shell string started for a service. It runs through
the user's login shell in the configured working directory.

## Managed process

The process group started for one run and supervised by the daemon.

## Trigger request

The connection or HTTP request that causes an idle service to launch.

## Port takeover

The transition in handoff mode where the daemon releases the advertised listener
and the managed process binds it.

## Proxy mode

The default service mode. The daemon permanently owns the advertised port,
launches the command on an assigned backend port, and forwards raw TCP.

## Handoff mode

The service mode for commands that must bind the advertised port. The daemon
releases the listener before launching the command and reclaims it after the
command stops.

## Backend port

The run-specific loopback port assigned to a proxy-mode command. It is not a
durable or user-facing address.

## Advertised port

The stable public-facing port shown in the CLI and dashboard. It may be exact or
automatically allocated.

## Armed

A service state in which Port Start owns the idle advertised listener and new
traffic may trigger launch.

## Startup interstitial

The self-contained HTML page served to eligible plain-HTTP browser navigations
while a service starts. It displays live logs and state and reloads into the
service at readiness.

## Readiness

Successful TCP connection establishment to the port the managed command was
instructed to bind.

## Run

One launch attempt for a service, including its snapshotted command, process
identity, timestamps, terminal result, and logs.

## Worktree registration

A Git worktree and its manifest-owned services as known to Port Start.

## Manifest-owned service

A service whose desired configuration comes from `.port-start.yaml`. Direct
configuration edits are rejected; operational lifecycle actions remain allowed.

## Imperative service

A service created directly through the CLI/API/SPA and editable through those
interfaces.

## Process log

The tagged stdout/stderr record stream captured for a run and retained in
segmented files.

## Reconciliation

The idempotent operation that compares a worktree manifest with stored
manifest-owned services and creates, updates, or deregisters them to match.

## Listener conflict

A state in which an enabled service's persisted advertised address cannot be
bound. Exact and persisted auto ports are not silently remapped.

## Stale worktree

A registered worktree whose root path is missing. Its services are stopped and
disarmed while the 24-hour deletion grace period runs.

## Capability token

A random, short-lived bearer secret embedded in a startup interstitial and
scoped only to that service's startup state, logs, Restart, and Cancel.
