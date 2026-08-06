# ADR 0003: Unified service and task execution

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Local development uses long-running services and one-shot tasks. Both need
labels, tags, execution, cancellation, history, and logs.

Separate top-level process and command resources make discovery and filtering
more complex.

## Decision

- Use one process definition resource.
- Give each process kind `service` or `task`.
- Let services use Start, Stop, and Restart.
- Let tasks use Run and Cancel.
- Permit one active service run.
- Permit independent overlapping task runs.
- Start every run through an explicit action.
- Never restart a service automatically.
- Run every child in its own process group.
- Send SIGTERM and then SIGKILL after the stop limit.
- Use the login shell.
- Preserve argv boundaries.

## Consequences

- One inventory contains all executable development operations.
- Labels and tags work the same for services and tasks.
- Every run uses the same log model.
- Kind-specific invalid actions return `invalid_kind`.

## Alternatives

Separate command resources split the inventory. CLI-only task execution loses
durable history. Automatic restart can create hidden crash loops.
