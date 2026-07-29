# Design QA

## Visual target

- Selected direction: Claude prototype B, “Jump to Endpoint”
  ([capture](docs/assets/design-qa/jump-to-endpoint.png))
- Implemented dashboard
  ([capture](docs/assets/design-qa/implementation-desktop.png))
- Aggregate-process state
  ([capture](docs/assets/design-qa/implementation-processes.png))
- Command drawer
  ([capture](docs/assets/design-qa/implementation-commands.png))
- Combined comparison
  ([capture](docs/assets/design-qa/comparison.png))
- Comparison viewport: 1440 × 1000 CSS pixels

The implemented dashboard preserves the selected target’s framed desktop shell,
search-first hierarchy, three-column worktree grid, compact status treatment,
neutral card surfaces, Manrope typography, acid accent, endpoint density, and
quiet lower canvas. The added primary navigation and registration action extend
the target to cover the documented Runs & Logs and Administration surfaces
without changing its visual hierarchy.

## State and interaction coverage

- Populated dashboard at 1440 × 1000
- Worktree detail drawer with Processes selected at 1440 × 1000
- Worktree detail drawer with independent command runs at 1440 × 1000
- Dark theme at 1440 × 1000
- Responsive dashboard at 390 × 844 using Chrome device metrics
- Loading and empty prototype states
- Search by worktree, process, command, and declared port
- Registration and deregistration
- Process start, stop, restart, Start all, and Stop all
- One-shot command run and cancellation
- Per-worktree and global logs
- Keyboard focus traps, Escape handling, focus return, and reduced motion

## QA iterations

1. The first implementation pass matched the target’s desktop composition but
   retained obsolete logo concepts and incomplete process-manager interactions.
   The prototype was updated to use the Port Matrix asset, the retired logo
   assets were removed, and registration, deregistration, global logs,
   Administration, process actions, and command actions were completed.
2. The first mobile capture used Chrome’s minimum layout viewport and revealed
   clipped controls and worktree cards. A device-metrics capture reproduced the
   true 390-pixel layout. Grid items and header regions received explicit
   minimum-width handling, the mobile registration control became a square icon
   button, and drawer controls were allowed to wrap.
3. Accessibility inspection found icon-only controls without stable accessible
   names and incomplete tab relationships. Port actions and process restart now
   have labels, registration retains a text alternative at mobile sizes, and
   drawer tabs reference their tab panels.
4. The final side-by-side comparison confirmed matching typography, spacing,
   color, radii, borders, elevation, grid density, and card hierarchy. The
   intentional additions remain visually subordinate to search and worktree
   discovery.
5. Checkpoint review identified contract gaps in idempotent registration,
   overlapping command invocations, active-versus-configured port snapshots,
   endpoint keyboard behavior, and the closed drawer’s focus state. Each gap
   received a browser regression assertion before implementation. The command
   drawer was recaptured after the interaction model changed and retained with
   the other repository-owned QA evidence.
6. Checkpoint re-review extended registration coverage to manifest changes and
   exercised rapid process actions. Worktree identity now remains tied to the
   normalized path while re-registration updates its current manifest, and a
   newer process action supersedes pending state-transition timers.
7. Runs & logs was exercised while a process was still starting. Lifecycle and
   command updates now refresh that view in place, so status and output do not
   remain stuck at an earlier in-flight state.
8. Live Runs & logs refreshes now restore the focused run by stable ID, and a
   filter with no matches clears the previous detail before showing a direct
   empty-state prompt.
9. Restart was verified from drawer initiation through the dashboard card’s
   stopping, starting, and running states, including promotion of the configured
   port snapshot while the drawer is closed.
10. Per-worktree log selection and keyboard focus now survive command
    completion by stable target key. Deferred updates are scoped to the
    worktree that launched them, so an older timer cannot rerender another
    worktree’s open drawer.
11. Search-result activation now opens HTTP(S) endpoints and copies TCP
    addresses for both pointer and keyboard paths. Restart from stopped or
    failed goes directly to starting a new run, while active restarts retain
    their stopping phase.
12. Clipboard behavior is verified at its boundary with the exact TCP address.
    Copy success appears only after the write resolves, and rejected or
    unavailable clipboard access receives a visible failure message.
13. Deregistration now removes active definitions while retaining completed run
    history in Runs & logs. Current and earlier process runs are independently
    selectable, and the selected run’s output supports in-place text filtering.
14. A newly registered process now shows “Nothing has been run yet” until its
    first real start creates a run ID. Its first run is retained without a
    fabricated pre-start history entry.
15. Process definition state and run outcome are presented independently:
    stopping a definition records an `interrupted` run, while a normal command
    completion records `exited`. Global search indexes retained output as well
    as metadata, and a selected run downloads the canonical NDJSON record
    schema.
16. Final UX review caught a closed drawer that remained painted over desktop
    content. The closed state is now hidden after its transition and verified
    at 1440 × 1000. Deregistration names the worktree, active-run impact, and
    retained-log behavior before confirmation. Drawer tabs use roving focus and
    arrow/Home/End navigation, decorative icons are excluded from accessible
    names, and dashboard endpoint actions use 32-pixel targets. The drawer
    focus trap filters the roving set by actual tab order, including forward
    and reverse wrapping when the selected panel has no controls.
17. Product re-review separated launch failure from a child’s nonzero exit:
    the definition returns to `stopped`, its run remains `exited` with code 1,
    and a separate worker fixture demonstrates a true launch failure.
    Completed and downloaded command logs now use test-, migration-, failure-,
    and cancellation-specific output rather than process shutdown samples.
18. Final group review added worktree-wide Start all and Stop all controls with
    per-process partial-failure results, including a repeatable worker launch
    failure. Restart remains available while termination is in progress and
    repeated requests coalesce into one replacement run. Jump search now exposes
    its active option through combobox/listbox semantics; loading announces a
    busy worktree region; and log-follow state is status text instead of a silent
    action. The missing-worktree fixture now mirrors the canonical
    `missing`/`stale` projection used by the documentation. Aggregate batches
    retain dispatch-time no-op results and use a batch version so an older
    Start-all completion cannot overwrite a newer Stop-all result.
19. Action-triggered drawer updates now restore keyboard focus by stable
    process, command, and run identity. Start, Stop, Restart, Run, and Cancel
    announce their settled outcomes through a persistent live region.
    Machine-readable process and command inventories retain worktree identity
    on every record, the obsolete social card is no longer packaged, and all
    visual comparison evidence is retained in the repository.
20. Dashboard badges now distinguish fully running, transitional or partially
    active, and stopped worktrees instead of giving every registered worktree a
    success treatment. A worktree remains transitional while its final active
    process is stopping. Programmatic process, command, and invocation focus
    fallbacks use the same three-pixel high-contrast indicator as interactive
    controls. Browser assertions cover the badge states and the computed focus
    indicator after Start, Stop, and Cancel; the dashboard and drawer captures
    were refreshed at 1440 × 1000.
21. The light-theme focus indicator now uses the dark interface ink on light
    surfaces and the acid inverse token on the prototype bar, command snippet,
    and log search. Browser-computed and deterministic checks require 3:1
    contrast across both surface groups; dark mode retains the acid indicator.
    Deregistration invalidates pending process transitions and aggregate batches
    before retaining interrupted run history, so delayed Start, Restart, and
    Start-all callbacks cannot publish stale completion state after a worktree
    is removed.
22. Per-worktree and global run selectors now expose their selected state to
    assistive technology with `aria-pressed`. The semantic state moves with the
    visible output and remains exclusive when another run is selected.
23. Re-registering a worktree whose path has returned now clears its missing
    state and restores stale process definitions to `stopped`, with Start
    available again. Its interrupted run remains discoverable in the worktree
    log history.
24. On narrow screens, the run inventory now has its own bounded scroll region.
    The selected row remains focused in that region while the corresponding
    output stays visible directly below it.

## Verification

- `npm test`: 30 tests passed
- `npm run test:browser`: worktree, process, command, log, and focus behavior passed
- External icons: local Phosphor icon font
- Product artwork: external `port-matrix.svg`; no inline or handcrafted SVG in
  the HTML surfaces
- Light and dark secondary-copy contrast: deterministic WCAG AA checks passed

final result: passed
