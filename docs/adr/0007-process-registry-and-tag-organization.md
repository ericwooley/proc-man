# ADR 0007: Process registry and tag organization

- Status: Accepted
- Date: 2026-08-06
- Supersedes: ADR 0004

## Context

Git worktrees motivated Proc Man, but they are not the resource that users
need to operate. Users need labeled processes, actions, ports, runs, and logs.

A worktree-first model makes source directories control navigation, API
resources, selectors, and group actions. This hides processes that do not
belong to worktrees and makes one use case the product structure.

## Decision

- Make the process definition the only primary managed resource.
- Require a human label.
- Add free-form normalized tags for filtering and grouping.
- Use opaque process IDs for actions because labels can repeat.
- Use kind `service` or `task` on the same process resource.
- Keep manifest paths and working directories as provenance and launch data.
- Keep manifests as idempotent bulk registration sources.
- Do not expose repository or worktree resources in the dashboard, API, or CLI.
- Let worktree hooks apply and remove normal process manifests.
- Keep retained runs discoverable after process deregistration.

## Tag behavior

- V1 permits normalized free-form tags.
- Clients suggest existing tags.
- Repeated tag filters use AND semantics.
- Group-by-tag can show one process in several groups.
- Each repeated row uses the same stable process ID.

## Consequences

- The dashboard starts with one process inventory.
- Worktree-created and standalone processes use the same controls.
- Users can organize processes by project, agent, purpose, environment, or any
  other tag without a fixed hierarchy.
- Manifest reconciliation no longer creates a parent worktree record.
- Source removal requires explicit deregistration automation.

## Alternatives

Keeping worktrees as optional parent resources still creates two navigation and
selector models. Constrained tags prevent ad hoc agent and project labels.
Folders derived from source paths repeat the worktree problem with another
name.
