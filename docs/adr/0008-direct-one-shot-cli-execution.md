# ADR 0008: Direct one-shot CLI execution

- Status: Accepted
- Date: 2026-08-14
- Amends: ADR 0003

## Context

The registered process model fits long-running services and retained task history.
Coding agents also run transient tests, checks, and scripts.
Registration adds labels, tags, and later log reads that these commands do not need.
The caller needs the invoking directory, live output, and the child result.

## Decision

- Add `proc-man run -- COMMAND [ARG...]` for one-shot commands.
- Require the `--` boundary to protect run history subcommands and child flags.
- Execute the argv command in the directory that invoked proc-man.
- Attach stdin, stdout, and stderr directly to the CLI process.
- Wait for completion and return the child exit code.
- Do not call the local service or register a process.
- Do not create retained run state or log files.
- Keep `run list`, `run status`, and `run logs` for retained runs.
- Keep existing managed task data and APIs for compatibility.
- Guide new one-shot work to the direct command.

## Consequences

- Coding agents receive output while the child runs.
- One-shot commands need no daemon setup or cleanup.
- The invoking directory is the only proc-man execution context.
- Direct output has no proc-man history after the command ends.
- Registered services keep lifecycle controls, ports, tags, and retained logs.

## Alternatives

A transient daemon run could retain output, but it needs registration and stream lifecycle contracts.
Running the child through a shell would lose exact argv boundaries.
