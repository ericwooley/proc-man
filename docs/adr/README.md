# Architecture decision records

ADRs record why stable architectural choices were made. Normative behavior is
specified in the linked design documents.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-local-application-shape.md) | Accepted | One local daemon and shared control plane for process management |
| [0002](0002-declared-ports-as-metadata.md) | Accepted | Explicit named ports as process metadata |
| [0003](0003-process-lifecycle-and-command-execution.md) | Accepted | Explicit process lifecycle plus one-shot command execution |
| [0004](0004-declarative-worktree-manifest.md) | Accepted | Idempotent worktree registration and deregistration |
| [0005](0005-sqlite-metadata-and-segmented-log-files.md) | Accepted | SQLite metadata with segmented run logs |
| [0006](0006-versioned-local-control-plane.md) | Accepted | One versioned API for CLI and SPA with optional password |
