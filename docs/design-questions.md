# Design decisions

| Question | Decision |
| --- | --- |
| What is the primary resource? | A registered process. |
| How do users organize processes? | Labels, tags, search, filters, and tag groups. |
| Where does the product brand appear? | In the application header. |
| What appears in the navigation rail? | One functional Processes route. |
| Does a worktree create a product resource? | No. A worktree can apply a normal process manifest. |
| How are ports represented? | As declared process metadata. |
| What controls process lifecycle? | Explicit application, CLI, or API actions. |
| Where do users read logs? | On the process detail page or through the CLI and API. |
| How does the UI open details? | React Router uses `/process/:processId`. |
| Where does the service run? | On a loopback address for local development. |
