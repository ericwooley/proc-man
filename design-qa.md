# Design QA

## Visual targets

The process inventory uses the selected filtered ledger direction.

- [Process ledger reference](docs/assets/design-qa/process-ledger-reference.png)
- [Process ledger implementation](docs/assets/design-qa/process-ledger-desktop.png)
- [Process ledger comparison](docs/assets/design-qa/process-ledger-comparison.png)
- [Process ledger mobile implementation](docs/assets/design-qa/process-ledger-mobile.png)

The process detail page uses the selected profile console direction.

- [Process detail reference](docs/assets/design-qa/process-detail-reference.png)
- [Process detail implementation](docs/assets/design-qa/process-detail-desktop.png)
- [Process detail comparison](docs/assets/design-qa/process-detail-comparison.png)
- [Process detail mobile reference](docs/assets/design-qa/process-detail-mobile-reference.png)
- [Process detail mobile implementation](docs/assets/design-qa/process-detail-mobile.png)
- [Process detail mobile comparison](docs/assets/design-qa/process-detail-mobile-comparison.png)

The desktop comparisons use a 1440 by 1000 pixel viewport for each side.
The mobile comparison uses a 390 by 844 pixel viewport for each side.

## Process detail state

The comparison opens Storefront web in the light theme.
It selects the current run with 52 log lines and three retained runs.
The page shows process identity, tags, ports, command, directory, environment, run history, and full logs.

## Fidelity review

The implementation uses the existing Manrope typeface, shell, color tokens, status pills, and Phosphor icons.
The implementation matches the target card structure, log console, action order, border radius, and control density.
The desktop comparison preserves both full-size captures, so labels and log controls remain readable.
The mobile comparison checks the same populated state without horizontal page overflow.

The reference shows the first records while its Follow control is active.
The implementation shows the newest records so that the Follow control reports its actual state.
The target clips some port actions and run tabs at the mobile width.
The implementation keeps these controls inside the viewport as an intentional responsive improvement.
The implementation uses slightly more vertical space for the mobile environment card.
This low-impact density difference does not hide content or block actions.

## Interaction coverage

- Open a process from its label or row.
- Open a process directly from its hash route.
- Return to the same inventory filters.
- Start, stop, and restart a service.
- Run and cancel a task.
- Open or copy a declared endpoint.
- Expand environment values.
- Select a retained run.
- Filter logs by stdout or stderr.
- Search all logs in the selected run.
- Toggle log following.
- Download the selected run logs.
- Focus and restore the full log panel.
- Use the detail page at desktop and mobile widths.

## QA iterations

1. The first detail capture showed the inventory header below the detail page.
2. A hidden-state rule now removes that header from the detail route.
3. The second capture aligned the status, card grid, run tabs, and log controls.
4. The mobile pass changed the overview grid to one column and contained every control.
5. The final comparison found no blocking visual or interaction defect.

## Verification

- `npm test`: 30 tests passed.
- `npm run test:browser`: Process inventory browser checks passed.
- `npm run build`: Built the Proc Man HTML prototype.
- Static checks cover the detail structure, actions, routes, and QA assets.
- Browser checks cover the list-to-detail journey, full logs, run history, filters, actions, and mobile layout.

Final result: passed.
