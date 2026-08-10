# Design QA

## Current implementation

The React application uses the original process-ledger prototype as its visual base.

Current captures:

- [Process inventory](docs/assets/design-qa/react-processes-desktop.png)
- [Process detail](docs/assets/design-qa/react-process-detail-desktop.png)
- [Mobile process detail](docs/assets/design-qa/react-process-detail-mobile.png)

The desktop captures use a 1440 by 1000 pixel viewport.
The mobile capture uses a 390 by 844 pixel viewport.

## Navigation decision

The product logo sits in the header with the `proc-man` wordmark.

The dark rail contains one Processes navigation item.
That item routes to `/` and shows an active state on the inventory.

The logo and navigation use different containers and different roles.
The logo does not appear as a selected navigation item.

## Process inventory

The inventory shows:

- Search.
- Kind filters.
- Directory filters.
- Tag filters.
- Directory grouping.
- Tag grouping.
- Associated directories on each process row.
- Process state.
- Declared ports.
- Service and task actions.
- Process registration.
- Process deregistration.

## Process detail

The detail route is `/process/:processId`.

The page shows:

- Identity, kind, state, and tags.
- Declared ports.
- Launch command and working directory.
- Environment values.
- Run history.
- Full retained logs.
- Stream and text filters.
- Follow, download, and log focus controls.

## Responsive check

The mobile layout moves Processes navigation to a fixed bottom bar.
Cards use one column.
Controls remain inside the page width.

## Verification

- Four React tests passed.
- The production frontend build passed.
- The production browser check passed.
- The browser check found no horizontal page overflow.
- The shell smoke test verified embedded application routes.

Final result: passed.
