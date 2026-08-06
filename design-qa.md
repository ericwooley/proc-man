# Design QA

## Visual target

The selected direction uses a filtered process ledger. It keeps the process
inventory visible while users filter, group, execute, and inspect processes.

- [Selected process ledger](docs/assets/design-qa/process-ledger-reference.png)
- [Implemented desktop prototype](docs/assets/design-qa/process-ledger-desktop.png)
- [Side-by-side comparison](docs/assets/design-qa/process-ledger-comparison.png)
- [Implemented mobile prototype](docs/assets/design-qa/process-ledger-mobile.png)

The desktop reference and implementation use a 1440 by 1000 pixel viewport.
The mobile capture uses a 390 by 844 pixel viewport.

## Product structure

The prototype has one primary Processes screen. Each row shows a label, tags,
state, kind, declared ports, actions, and inline logs.

Search covers labels, tags, and declared ports. Repeated tag filters use AND
semantics. The grouping control creates one section per tag.

A process with several tags appears in each matching group. Every repeated row
uses the same process ID. Summary counts use unique process IDs.

## Interaction coverage

- Search by label, tag, and declared port.
- Filter by state, kind, and several tags.
- Group by tag and collapse one group.
- Start, stop, and restart a service.
- Run and cancel a task.
- Open or copy a declared endpoint.
- Expand, search, follow, and download logs.
- Open registration help.
- Confirm process deregistration.
- Use populated, loading, empty, and error states.
- Use the dashboard at desktop and mobile widths.
- Use dialogs with keyboard focus containment and Escape.
- Use light and dark themes.

## QA iterations

1. The first design pass compared three process-only layouts. The filtered
   ledger best matched the required discovery and grouping workflow.
2. The implementation replaced inline artwork with the local Phosphor icon
   font and the existing Port Matrix asset.
3. Runtime checks found repeated dynamic input IDs in grouped rows. Instance
   keys now keep DOM IDs unique while process IDs stay stable.
4. The mobile tag list first expanded the header and clipped controls. It now
   uses one horizontal list within the available width.
5. The final comparison confirmed the selected shell, typography, density,
   color, status treatment, row layout, and tag controls.

## Verification

- `npm test`: 30 tests passed.
- `npm run test:browser`: Process inventory browser checks passed.
- `npm run build`: Built the Port Start HTML prototype.
- Static contrast checks cover light and dark text, status labels, and focus.
- Browser checks cover filtering, grouping, actions, logs, dialogs, and mobile.
- HTML surfaces use local icons and external product artwork.

Final result: passed.
