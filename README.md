# Port Start

Port Start is a local process manager for development worktrees. A worktree
registers its long-running processes, useful one-shot commands, and the ports
those processes expect to use. Port Start then provides one dashboard and CLI
for starting and stopping processes, running commands, opening declared
endpoints, and reading current or historical logs.

The primary use case is agent-created Git worktrees. Registration gives people
and automation a durable answer to three questions:

- Which commands belong to this worktree?
- Which development processes are running?
- Which ports and logs belong to each process?

This repository currently contains the product and architecture specification
plus a static UI prototype. Application implementation is intentionally out of
scope for this phase.

## UI prototype

The static prototype lives in [`prototype/`](prototype/). It is being revised to
match the process, command, declared-port, and log-management specification in
this documentation; until that revision lands, the Markdown specifications are
the current product contract.

Run the prototype with the repository's simple Python HTTP server:

```sh
npm run serve
```

Then open <http://127.0.0.1:4174/>. The logo exploration is available at
<http://127.0.0.1:4174/logo-showcase.html>.

Use `npm test` for deterministic UI checks. The browser keyboard-flow check
requires Node.js 22 or newer, its global `WebSocket`, and Google Chrome:

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
