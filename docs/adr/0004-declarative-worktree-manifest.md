# ADR 0004: Declarative worktree registration

- Status: Accepted
- Date: 2026-07-29

## Context

Agent-created Git worktrees need a repeatable way to advertise their processes,
commands, declared ports, and execution directories. Creation and removal hooks
must be able to register and deregister a worktree without an interactive
session.

Imperative registration alone makes configuration difficult to share, review,
and reapply. A manifest-only product would make ad hoc and standalone tools
awkward.

## Decision

- Define a checked-in, versioned `.port-start.yaml`.
- Identify a worktree by canonical Git common directory plus canonical worktree
  root.
- Identify definitions within a worktree by kind (`process` or `command`) and
  name.
- Make `worktree register` validate and reconcile the manifest idempotently.
- Make `worktree deregister` stop active runs and remove current definitions.
- Allow every process to contain zero or more explicit named port declarations.
- Mark manifest-created definitions as manifest-owned. Route their
  configuration changes through the manifest and re-registration.
- Keep imperative process and command registration as a separate editable
  ownership mode.
- If a worktree path disappears, stop its runs immediately and delete its
  registration and logs after 24 hours if it does not return.

## Consequences

- Worktree configuration remains reviewable and reproducible in Git.
- Creation hooks can call registration repeatedly and consume stable JSON.
- Removal hooks have one command that closes the worktree's managed lifecycle.
- The daemon needs a reconciliation engine and source-ownership metadata.
- Dashboard editing is intentionally limited for manifest-owned definitions.
- Temporary filesystem loss does not immediately destroy configuration.

## Alternatives considered

### Imperative CLI only

Creation scripts become the undocumented source of truth and drift is difficult
to detect.

### Manifest only

This prevents temporary, generated, and non-repository definitions.

### Persistent UI or CLI override layer

A hidden override layer makes effective worktree configuration difficult to
explain and lets local state silently diverge from the checked-in manifest.

### Registration starts every process

Separating registration from execution lets a new worktree appear immediately
without consuming resources and keeps each launch intentional.
