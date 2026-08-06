# Logging and retention

## Goals

Every service run and task run has inspectable output during execution and
after completion.

Port Start captures stdout and stderr, assigns a run-local sequence, and adds a
receive timestamp. Separate pipes cannot provide a stronger total order.

## Record format

```json
{"seq":42,"time":"2026-07-24T22:15:03.123Z","stream":"stderr","text":"address already in use\n","partial":false}
```

Fields:

- `seq` increases within one run.
- `time` is the UTC daemon receive time.
- `stream` is `stdout` or `stderr`.
- `text` contains UTF-8 output.
- `partial` marks a bounded fragment of a large line.

## Files and metadata

Each run owns numbered append-only NDJSON segments. SQLite stores segment
sequence ranges, byte counts, and truncation state.

The writer:

1. Always drain child pipes.
2. Write retained records.
3. Send records to bounded subscriber buffers.
4. reports gaps to slow subscribers.

The default retains the newest 50 MiB for one run. Deleted segments update the
retained sequence range.

## Search

Search supports:

- Literal text or Go RE2.
- Case sensitivity.
- Stdout, stderr, or both.
- Process ID or label.
- Repeated tag filters.
- Process kind and run state.
- Time range.
- cursor pagination.

Repeated tags use AND semantics. Search includes retained runs from removed
processes when requested.

## Streaming

The SPA and CLI follow SSE from a sequence cursor. The server sends retained
records first and then live records.

On reconnect, the client supplies its last sequence. The server replays retained
records or reports `retention_gap`.

## Downloads

One run can download as:

- Combined text with time and stream prefixes.
- NDJSON with durable record fields.

The server streams files from disk and does not load a complete download into
memory.

## Retention

Defaults:

- 50 MiB for one run.
- 20 runs for one process.
- no age limit.

A process can override each limit or select unlimited retention. Retention runs
during rotation, terminal transitions, definition updates, periodic age scans,
and startup recovery.

Removed process history remains until retention deletes it. Explicit
deregistration can request log purge.

## Daemon logs

Daemon logs contain request IDs, process IDs, run IDs, lifecycle transitions,
and exits. They exclude passwords, tokens, full inherited environments, and
secret manifest values.
