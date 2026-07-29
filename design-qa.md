# Design QA

## Visual target

- Selected direction: Claude prototype B, “Jump to Endpoint”
- Source capture: `/tmp/port-start-design-review.FATDfH/jump-to-endpoint.png`
- Implemented capture: `/tmp/port-start-qa/implementation-desktop-cdp.png`
- Combined comparison: `/tmp/port-start-qa/comparison.png`
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
- Process start, stop, and restart
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
   drawer was recaptured at
   `/tmp/port-start-qa/implementation-commands-cdp.png` after the interaction
   model changed.
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

## Verification

- `npm test`: 25 tests passed
- `npm run test:browser`: worktree, process, command, log, and focus behavior passed
- External icons: local Phosphor icon font
- Product artwork: external `port-matrix.svg`; no inline or handcrafted SVG in
  the HTML surfaces
- Light and dark secondary-copy contrast: deterministic WCAG AA checks passed

final result: passed
