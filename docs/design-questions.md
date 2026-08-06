# Design interview record

| Question | Decision |
| --- | --- |
| What does Port Start manage? | Registered local processes. |
| What appears on the primary screen? | One process inventory. |
| What identifies a process for people? | A required label and tags. |
| Must labels be unique? | No. Actions use opaque process IDs. |
| How do users organize processes? | Search, tag filters, and tag grouping. |
| Are tags constrained? | No. V1 accepts normalized free-form tags and suggests existing values. |
| What process kinds exist? | Long-running services and one-shot tasks. |
| Do both kinds have logs? | Yes. Every run captures stdout and stderr. |
| Can task runs overlap? | Yes. Each invocation has its own run. |
| Can a service have several active runs? | No. A service has at most one active run. |
| Who owns a declared port? | The child process owns its socket. |
| Does Port Start allocate ports? | No. It stores explicit port metadata. |
| Are repositories or worktrees resources? | No. They are automation contexts and optional tags. |
| How does a worktree register? | Its hook applies a normal process manifest. |
| How does a worktree deregister? | Its removal hook deregisters the manifest source. |
| What happens when a working directory disappears? | The process stays visible and execution returns `cwd_unavailable`. |
| Where are logs stored? | Segmented files with metadata in SQLite. |
| How is administration exposed? | One versioned API, CLI, and embedded SPA. |

No blocking design questions remain for V1.
