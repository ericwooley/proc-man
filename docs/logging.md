# Logging and retention

## Goals

Logs make every managed process and registered-command invocation inspectable
during execution and after completion without turning SQLite into a
high-volume append log.

Port Start captures both stdout and stderr, tags their source, assigns a
run-local sequence number in receive order, and timestamps each record.
Cross-stream ordering reflects the order in which the daemon receives data; the
operating system cannot provide a stronger total-order guarantee for separate
pipes.

## Record format

Durable segments use newline-delimited JSON:

```json
{"seq":42,"time":"2026-07-24T22:15:03.123Z","stream":"stderr","text":"address already in use\n","partial":false}
```

Fields:

- `seq`: monotonically increasing within one run;
- `time`: daemon receive time in UTC;
- `stream`: `stdout` or `stderr`;
- `text`: UTF-8 text;
- `partial`: the record is a bounded fragment of a line that exceeded the
  reader's record size.

Invalid UTF-8 is replaced for the structured representation. The replacement is
reported in run metadata; byte-exact binary output is outside the V1 log
contract.

## Files and metadata

Each run owns a directory of numbered append-only NDJSON segments. A segment
targets 5 MiB and completes after the first whole record that crosses that
target. SQLite stores the run-to-segment relationship, first and last sequence,
byte count, and truncation flags.

Segments are written through a bounded, non-blocking fan-out:

1. stdout and stderr are always drained so the child can continue;
2. durable writes receive every record until retention limits require rotation;
3. live subscribers receive records through bounded buffers;
4. a slow subscriber gets a gap event and can resume from disk if the sequence
   is retained.

The default size policy retains the newest output. When a run exceeds 50 MiB,
the oldest completed segments are deleted and the run is marked truncated.
Downloads and searches state the retained sequence range.

## Search

Server-side search supports:

- literal text;
- Go RE2 regular expressions;
- case-sensitive or case-insensitive matching;
- stdout, stderr, or both;
- process, command, worktree, run, and timestamp filters;
- cursor-based pagination.

Search scans retained segments in sequence order. V1 does not maintain a
full-text index. The bounded default log size keeps scans predictable.

The CLI and administration API expose the same search contract. Use
`port-start run search` or `POST /api/v1/run-search` for output across runs,
including retained runs from deregistered worktrees. Use
`GET /api/v1/runs/{id}/logs` for one run. Both forms share stream, timestamp,
query, and cursor filters.

## Streaming

The SPA and CLI follow an SSE stream beginning after a supplied sequence.
Existing retained records are sent first, followed by live records and run-state
events.

On reconnect:

- the client supplies the last sequence;
- retained missing records are replayed;
- if retention has deleted the requested range, the server sends
  `retention_gap` with the earliest available sequence.

## Downloads

One run can be downloaded as:

- `text`: a combined timeline with timestamp and stream prefix;
- `ndjson`: the durable structured records.

Multi-run download is NDJSON with an added run identifier. The HTTP response
streams from disk and uses `Content-Disposition`; it is not assembled wholly in
memory.

## Retention policy

Global defaults are:

- maximum 50 MiB retained for one run;
- newest 20 runs retained per definition;
- no age limit.

Definitions may override any constraint or set unlimited retention. Constraints
are combined: data is eligible for removal when it violates any configured
maximum.

Retention runs:

- during segment rotation;
- after a run reaches a terminal state;
- after worktree registration or imperative definition update;
- periodically for age limits;
- during startup recovery.

Deregistered-definition history remains until its retention policy deletes it,
unless deregistration explicitly requests log purge. Automatic deletion of a
worktree after the 24-hour missing-path grace period purges that worktree's
logs.

## Daemon logs

Daemon operational logs are separate from managed-run logs. They are structured
and include request IDs, worktree/definition/run identifiers, lifecycle
transitions, and process exits.

They exclude passwords, session tokens, full inherited environments, and
manifest environment values marked or named like secrets.
