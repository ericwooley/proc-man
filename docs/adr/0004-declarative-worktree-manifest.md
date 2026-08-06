# ADR 0004: Declarative worktree registration

- Status: Superseded by ADR 0007
- Date: 2026-07-29
- Superseded: 2026-08-06

## Original decision

The original design made a Git worktree the parent registration resource. A
worktree manifest owned process and command definitions.

## Reason for replacement

Worktrees are one automation source, not the product model. A parent worktree
resource forces navigation, selectors, API shapes, and lifecycle rules to use
source structure that many processes do not need.

ADR 0007 replaces this model with a flat process registry. Manifests remain
idempotent registration sources.
