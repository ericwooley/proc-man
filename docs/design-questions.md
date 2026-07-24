# Design interview record

The initial design interview is complete. Normative behavior lives in the linked
specifications and rationale in the ADRs. This file preserves the decisions that
closed the original questions.

| Question | Decision |
| --- | --- |
| Who owns a managed port? | Support permanent proxying and literal handoff; proxy is the default. |
| Can a proxy command bind another port? | Yes. Expose it through `{port}` and `PORT`. |
| Which protocols are supported? | Arbitrary TCP with `http`/`https` hints for links and startup behavior. |
| What happens to the first browser request? | Eligible plain-HTTP navigation gets a log-streaming startup interstitial and reloads at readiness. |
| What happens to API/TCP/TLS traffic? | Proxy queues and forwards it; handoff returns retryable HTTP or closes the connection. |
| When is a process ready? | Its instructed bind port accepts TCP connections. |
| When does a process stop? | Explicit stop/disable, process exit, daemon shutdown, missing worktree, or handoff port free for three seconds. |
| Does an exited process restart automatically? | No. The service re-arms for traffic or explicit start. |
| What does Stop mean? | Terminate and return to armed idle; Disable disarms. |
| What platforms are required? | Linux and macOS. |
| How do worktrees advertise services? | Idempotent `.port-start.yaml` apply plus separate imperative registrations. |
| How are collisions handled? | Exact conflicts fail; `auto` allocates and persists an available port. |
| Can manifest services be edited in the UI? | No. Edit the manifest and reapply. |
| What happens to missing worktrees? | Stop/disarm immediately; delete after 24 hours if still missing. |
| How are commands represented? | Argv by default, explicit shell string as opt-in, both using the login shell environment. |
| Where are logs stored? | Tagged segmented files with metadata in SQLite. |
| What is the default retention? | 50 MiB per run and 20 runs, with configurable size/count/age/unlimited policies. |
| How is the daemon started? | systemd user service or macOS LaunchAgent, with foreground `serve` available. |
| How is administration exposed? | Versioned API and embedded SPA at `127.0.0.1:13337` by default. |
| Is authentication required? | Optional password; non-loopback unauthenticated binding is allowed with a strong warning. |
| Is scripting limited to the CLI? | No. CLI JSON and the documented `/api/v1` are supported contracts. |
| Can one command own several ports? | No. One service is one command and one port. |
| Can worktree services have dependencies? | No in V1; Start All runs them concurrently. |

No blocking design questions remain for the V1 implementation described by
these documents.
