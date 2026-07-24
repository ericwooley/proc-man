# Port Start

Port Start is a local development service supervisor. It reserves advertised TCP
ports, starts a configured command when traffic arrives, and gives developers a
single dashboard and CLI for worktree-specific services and process logs.

This repository currently contains the product and architecture specification.
Application implementation is intentionally out of scope for this phase.

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
