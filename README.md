# Proc Man

Proc Man is a local process manager for development commands. Each registered
process has a human label, tags, a launch definition, runs, and retained logs.
A process can also declare the ports that its child expects to use.

The dashboard and CLI provide one inventory for these tasks:

- Find processes by label, tag, state, or declared port.
- Group processes by tag.
- Start, stop, and restart long-running services.
- Run and cancel one-shot tasks.
- Open declared HTTP endpoints.
- Inspect current and historical logs.
- Register and deregister processes from scripts or manifests.

Git worktrees are an important automation use case, but they are not a product
entity. A worktree creation hook can apply its process manifest. Its removal
hook can deregister the processes from that manifest source.

This repository contains the product and architecture specification plus a
static UI prototype. Application implementation is outside this phase.

## UI prototype

The static prototype lives in [`prototype/`](prototype/). It demonstrates the
process inventory, tag filters, tag grouping, lifecycle actions, declared-port
links, process details, run history, full logs, and populated, loading, empty,
and error states.

Run the prototype:

```sh
npm run serve
```

Then open <http://127.0.0.1:4174/>.

Use these checks:

```sh
npm test
npm run test:browser
```

The tests require Node.js 22 or newer and jq 1.6 or newer. The browser test
requires Node's global `WebSocket` and Google Chrome. Set `CHROME_BIN` when
Chrome is installed outside `/usr/bin/google-chrome`.

## Documentation

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [Domain model and lifecycle](docs/domain-model.md)
- [Domain glossary](docs/glossary.md)
- [Process manifest](docs/manifest.md)
- [CLI contract](docs/cli.md)
- [Administration API](docs/api.md)
- [Logging and retention](docs/logging.md)
- [Operations and installation](docs/operations.md)
- [Testing strategy](docs/testing.md)
- [Design interview](docs/design-questions.md)
- [Architecture decision records](docs/adr/README.md)
