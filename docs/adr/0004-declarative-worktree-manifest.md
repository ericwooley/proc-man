# ADR 0004: Declarative worktree manifest

- Status: Accepted
- Date: 2026-07-24

## Context

Git worktrees need to advertise several commands and ports through scripts.
Imperative registration alone makes configuration hard to share, review, and
reapply consistently. The same repository may have many worktrees, so exact
ports commonly collide.

At the same time, Port Start must support ad hoc services that do not belong in
a repository manifest.

## Decision

- Define a checked-in, versioned `.port-start.yaml`.
- Identify a worktree by canonical Git common directory plus canonical worktree
  root, and identify its services by name.
- Make `worktree apply` validate and reconcile manifests idempotently.
- Allow exact ports or `auto`. Exact conflicts fail; auto ports are allocated,
  persisted, and retained across reapply/restart.
- Permit apply-time port overrides for worktree creation scripts without
  creating a hidden persistent override layer.
- Mark manifest-created services as manifest-owned. Reject direct configuration
  edits through CLI/API/SPA; direct users to the source file.
- Keep imperative registration as a separate editable ownership mode.
- If a worktree path disappears, stop and disarm it immediately. Delete its
  registrations and logs after 24 hours if it does not return.

## Consequences

- Configuration remains reviewable and reproducible in Git.
- The daemon needs a reconciliation engine and source-ownership metadata.
- Dashboard editing is intentionally limited for manifest services.
- Auto-assigned links remain stable instead of changing silently after restart.
- Temporary filesystem loss does not immediately destroy configuration.

## Alternatives considered

### Imperative CLI only

Simple to implement, but creation scripts become the undocumented source of
truth and drift is difficult to detect.

### Manifest only

Consistent, but prevents temporary or non-repository services.

### Persistent UI/CLI override layer

Flexible, but makes effective configuration difficult to explain and lets local
state invisibly diverge from the checked-in manifest.

### Silently remap exact port conflicts

Keeps apply successful but violates the meaning of an explicitly requested port
and breaks printed/bookmarked links.

