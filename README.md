# Port Start

Port Start is a local development service supervisor. It reserves advertised TCP
ports, starts a configured command when traffic arrives, and gives developers a
single dashboard and CLI for worktree-specific services and process logs.

This repository currently contains the product and architecture specification.
Application implementation is intentionally out of scope for this phase.

## UI prototype

The canonical static prototype lives in [`prototype/`](prototype/). It includes
the full product flow, loading states, Administration, the selected Twin Listener
mark, and a light/dark theme. It opens in an honest first-run state with no
fabricated worktrees, services, metrics, logs, or system-health records. Generic
startup states remain available from **Preview startup**.

Run the prototype with the repository's simple Python HTTP server:

```sh
npm run serve
```

Then open <http://127.0.0.1:4174/>. The logo exploration is available at
<http://127.0.0.1:4174/logo-showcase.html>.

Use `npm test` for the generated-worker and deterministic UI checks. The browser
keyboard-flow check requires Node.js 22 or newer, its global `WebSocket`, and
Google Chrome:

```sh
npm run test:browser
```

The browser test uses `/usr/bin/google-chrome` by default. Set `CHROME_BIN` when
Chrome is installed elsewhere:

```sh
CHROME_BIN=/path/to/google-chrome npm run test:browser
```

## Documentation

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Domain model and lifecycle](docs/domain-model.md)
- [Domain glossary](docs/glossary.md)
- [Worktree manifest](docs/manifest.md)
- [CLI contract](docs/cli.md)
- [Administration API](docs/api.md)
- [Logging and retention](docs/logging.md)
- [Operations and installation](docs/operations.md)
- [Testing strategy](docs/testing.md)
- [Completed design interview](docs/design-questions.md)
- [Architecture decision records](docs/adr/README.md)
