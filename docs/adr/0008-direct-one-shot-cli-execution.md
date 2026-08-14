# ADR 0008: Direct one-shot CLI execution

- Status: Accepted
- Date: 2026-08-14
- Amends: ADR 0003

## Context

The registered process model fits long-running services.
Coding agents also run transient tests, checks, and scripts.
Registration adds labels, tags, and lifecycle data that these commands do not need.
The caller needs the invoking directory, live output, the child result, and an audit trail.

## Decision

- Add `proc-man run -- COMMAND [ARG...]` for one-shot commands.
- Require the `--` boundary to protect run history subcommands and child flags.
- Execute the argv command in the directory that invoked proc-man.
- Send the caller environment without retaining it in the audit snapshot.
- Stream retained stdout and stderr records to the CLI.
- Do not forward stdin.
- Wait for completion and return the child exit code.
- Call the local service without registering a process.
- Create one retained run and log file for each command.
- Store the directory, exact argv command, timestamps, output, and exit code.
- Cancel the direct run when the CLI receives an interrupt.
- Keep `run list`, `run status`, and `run logs` for retained runs.
- Keep existing managed task data and APIs for compatibility.
- Guide new one-shot work to the direct command.

## Consequences

- Coding agents receive output while the child runs.
- One-shot commands require the local service.
- Each command produces an audit run without process registration.
- Users can filter direct audit runs by the invoking directory.
- Registered services keep lifecycle controls, ports, tags, and retained logs.
- Exact command arguments remain in history and must not contain secrets.

## Alternatives

Local execution cannot create the required service-owned audit record.
Task registration adds process data and cleanup that one-shot commands do not need.
Running the child through a shell would lose exact argv boundaries.
