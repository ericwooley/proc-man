# Design interview record

The revised design interview is complete. Normative behavior lives in the linked
specifications and rationale in the ADRs. This file preserves the decisions that
shape the process-management product.

| Question | Decision |
| --- | --- |
| What problem does Port Start solve? | It makes agent-created worktrees, their executable processes and commands, their declared ports, and their logs discoverable and operable. |
| What is the primary managed resource? | A named long-running process definition. |
| Are one-shot tasks supported? | Yes. Worktrees may also register named commands such as test, migrate, and seed. |
| How does a process start? | Only through an explicit CLI, API, or dashboard action. |
| What determines process state? | The supervised process group lifecycle. |
| Who owns a declared port? | The launched application owns its socket; Port Start stores the configured endpoint as metadata. |
| Can one process declare several ports? | Yes. A process may declare zero or more uniquely named ports. |
| Are ports allocated automatically? | No. Every declaration contains an explicit port number. |
| What are declared ports used for? | Inventory, copyable addresses, browser links, launch placeholders, environment variables, and run history. |
| What happens when declarations overlap? | Registration succeeds with a deterministic warning naming the overlapping definitions. |
| How are worktrees registered? | Idempotent `.port-start.yaml` registration plus separate imperative definitions. |
| How are worktrees deregistered? | An explicit removal-hook command stops active runs and removes current definitions. |
| What happens to missing worktrees? | Stop active runs immediately; delete the registration and logs after 24 hours if still missing. |
| How are commands represented? | Argv by default, explicit shell string as opt-in, both using the login shell environment. |
| Can a process have several active runs? | No. Start coalesces with its single active run. |
| Can command invocations overlap? | Yes. Each one-shot invocation is an independent run. |
| Does an exited process restart automatically? | No. Every new run follows an explicit action. |
| Where are logs stored? | Tagged segmented files with metadata in SQLite. |
| What is the default retention? | 50 MiB per run and 20 runs per definition, with configurable size, count, age, and unlimited policies. |
| How is the daemon started? | systemd user service or macOS LaunchAgent, with foreground `serve` available. |
| How is administration exposed? | Versioned API and embedded SPA at `127.0.0.1:13337` by default. |
| Is authentication required? | Optional password; non-loopback unauthenticated binding produces a strong warning. |
| Is scripting limited to the CLI? | No. CLI JSON and the documented `/api/v1` are supported contracts. |
| Can worktree processes have dependencies? | No in V1; Start All runs them concurrently. |

No blocking design questions remain for the V1 described by these documents.
