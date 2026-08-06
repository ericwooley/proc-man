# Domain glossary

## Administration server

The long-running HTTP server that provides the API and embedded SPA. The CLI
uses the same API.

## Process definition

The durable configuration for one labeled executable. Its kind is `service` or
`task`.

## Service

A long-running process definition that supports Start, Stop, and Restart.

## Task

A one-shot process definition that supports Run and Cancel.

## Label

The required human name shown for a process. Labels do not need to be unique.

## Tag

A normalized string attached to a process for filtering and grouping.

## Managed process

The operating-system process group launched and supervised for one run.

## Declared port

A named host, explicit TCP port, protocol hint, and optional URL path stored as
process metadata.

## Launch command

The argv array or shell string that starts a service run or task run.

## Run

One service start or task invocation with snapshotted configuration, timestamps,
terminal result, and logs.

## Process log

The retained stdout and stderr record stream for one run.

## Manifest

A versioned file that declares a set of process definitions.

## Manifest source

The canonical manifest path used for reconciliation and ownership. It is
provenance metadata, not a navigation or grouping resource.

## Manifest-owned process

A process whose desired configuration comes from a manifest.

## Imperative process

A process created directly through the CLI or API.

## Reconciliation

The idempotent operation that makes stored manifest-owned processes match a
manifest.
