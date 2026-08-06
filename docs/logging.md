# Logs

## Capture

proc-man captures stdout and stderr for every run.

The supervisor assigns one sequence number and receive time to each record.
Separate child pipes can report records in either arrival order.

## Record format

```json
{"seq":1,"time":"2026-08-06T17:00:00.500Z","stream":"stdout","text":"ready","partial":false}
```

Fields:

- `seq` increases within one run.
- `time` is the UTC receive time.
- `stream` is `stdout` or `stderr`.
- `text` contains one output line.
- `partial` marks output without a final newline.

## Storage

Each run owns one append-only NDJSON file.

```text
DATA_DIR/
└── logs/
    └── RUN_ID/
        └── 000001.ndjson
```

The file uses user-only permissions.
SQLite stores the run record and log path.

Logs remain after process deregistration.
Current V1 storage does not remove old logs automatically.

## Read and filter

The application loads all retained records for the selected run.
It filters records by stdout, stderr, and text.

The API also filters records by stream, text, sequence, and limit.

```sh
proc-man process logs PROCESS_ID
proc-man process logs PROCESS_ID --stream stderr
proc-man process logs PROCESS_ID --query failed
proc-man run logs RUN_ID
```

## Live output

The service publishes new records through Server-Sent Events.

The application refreshes active-run logs while Follow is active.
The run log event route supports direct consumers.

## Download

Download text:

```sh
proc-man run logs RUN_ID --output run.log
```

Download NDJSON:

```sh
proc-man run logs RUN_ID --format ndjson --output run.ndjson
```

The application exposes the same download action on the process detail page.
