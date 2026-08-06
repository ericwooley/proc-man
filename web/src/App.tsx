import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsOut,
  CaretDown,
  CaretRight,
  CheckCircle,
  Copy,
  DownloadSimple,
  FileText,
  Folder,
  Gear,
  MagnifyingGlass,
  Moon,
  Play,
  PlugsConnected,
  Plus,
  RocketLaunch,
  Stop,
  Sun,
  Tag,
  Terminal,
  TerminalWindow,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  FormEvent,
  MouseEvent,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  cancelRun,
  createProcess,
  deleteProcess,
  getProcess,
  getRunLogs,
  listProcesses,
  logDownloadURL,
  processAction,
  RequestError,
  subscribeToEvents,
} from "./api";
import type { ProcessInput } from "./api";
import type {
  LogRecord,
  Port,
  Process,
  Run,
} from "./types";

type Theme = "light" | "dark";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("proc-man-theme");
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("proc-man-theme", theme);
  }, [theme]);

  return (
    <AppShell
      theme={theme}
      toggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
    >
      <Routes>
        <Route path="/" element={<InventoryPage />} />
        <Route path="/process/:processId" element={<ProcessDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function AppShell({
  theme,
  toggleTheme,
  children,
}: PropsWithChildren<{ theme: Theme; toggleTheme: () => void }>) {
  return (
    <div className="app-shell">
      <header className="brand-header">
        <Link className="brand" to="/" aria-label="proc-man home">
          <img src="/assets/proc-man.svg" alt="" />
          <span>proc-man</span>
        </Link>
        <span className="local-badge">local</span>
        <button
          className="icon-button theme-button"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "light" ? "Use dark mode" : "Use light mode"}
        >
          {theme === "light" ? <Moon /> : <Sun />}
        </button>
      </header>
      <nav className="rail" aria-label="Primary navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}
          aria-label="Processes"
          title="Processes"
        >
          <Terminal />
          <span>Processes</span>
        </NavLink>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}

function InventoryPage() {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "service" | "task">("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [groupByTag, setGroupByTag] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Process | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listProcesses();
      setProcesses(result);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeToEvents(() => void load());
  }, [load]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const process of processes) {
      for (const tag of process.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [processes]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return processes.filter((process) => {
      if (kind !== "all" && process.kind !== kind) return false;
      if (!selectedTags.every((tag) => process.tags.includes(tag))) return false;
      if (!needle) return true;
      const searchable = [
        process.id,
        process.label,
        process.cwd,
        process.command.shell ?? "",
        ...(process.command.argv ?? []),
        ...process.tags,
        ...process.ports.flatMap((port) => [
          port.name,
          port.host,
          String(port.port),
          port.protocol,
        ]),
      ];
      return searchable.some((value) => value.toLowerCase().includes(needle));
    });
  }, [kind, processes, query, selectedTags]);

  const groups = useMemo(() => {
    if (!groupByTag) return [];
    const allTags = new Set(filtered.flatMap((process) => process.tags.length ? process.tags : ["untagged"]));
    return [...allTags].sort().map((tag) => ({
      tag,
      processes: filtered.filter((process) =>
        tag === "untagged" ? process.tags.length === 0 : process.tags.includes(tag),
      ),
    }));
  }, [filtered, groupByTag]);

  async function act(process: Process, action: "start" | "stop" | "restart" | "run") {
    try {
      await processAction(process, action);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteProcess(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="inventory-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LOCAL PROCESS MANAGER</div>
          <h1>Processes</h1>
          <p>Run development commands and find their ports and logs.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setRegisterOpen(true)}>
          <Plus weight="bold" />
          Register process
        </button>
      </div>

      <div className="inventory-tools">
        <label className="search-field">
          <MagnifyingGlass />
          <span className="sr-only">Search processes</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search label, tag, port, command, or path"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X />
            </button>
          )}
        </label>
        <div className="segmented" aria-label="Process kind">
          {(["all", "service", "task"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? "selected" : ""}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {value === "all" ? "All" : `${value}s`}
            </button>
          ))}
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            checked={groupByTag}
            onChange={(event) => setGroupByTag(event.target.checked)}
          />
          <span aria-hidden="true" />
          Group by tag
        </label>
      </div>

      {tags.length > 0 && (
        <div className="tag-filter-row" aria-label="Filter by tags">
          <span className="tag-filter-label"><Tag /> Tags</span>
          {tags.map(([tag, count]) => {
            const selected = selectedTags.includes(tag);
            return (
              <button
                className={`tag-chip ${selected ? "selected" : ""}`}
                type="button"
                key={tag}
                aria-pressed={selected}
                onClick={() =>
                  setSelectedTags((current) =>
                    current.includes(tag)
                      ? current.filter((value) => value !== tag)
                      : [...current, tag],
                  )
                }
              >
                {tag}<span>{count}</span>
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button className="clear-tags" type="button" onClick={() => setSelectedTags([])}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="inventory-summary">
        <span><strong>{filtered.length}</strong> matching processes</span>
        <span>{processes.filter((process) => process.state === "running").length} running</span>
        <span>{processes.filter((process) => process.state === "failed").length} need attention</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {loading ? (
        <ProcessSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasProcesses={processes.length > 0} onRegister={() => setRegisterOpen(true)} />
      ) : groupByTag ? (
        <div className="process-groups">
          {groups.map((group) => {
            const collapsed = collapsedGroups.includes(group.tag);
            return (
              <section className="process-group" key={group.tag}>
                <button
                  type="button"
                  className="group-heading"
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setCollapsedGroups((current) =>
                      current.includes(group.tag)
                        ? current.filter((tag) => tag !== group.tag)
                        : [...current, group.tag],
                    )
                  }
                >
                  {collapsed ? <CaretRight /> : <CaretDown />}
                  <Tag />
                  <strong>{group.tag}</strong>
                  <span>{group.processes.length}</span>
                </button>
                {!collapsed && (
                  <ProcessTable
                    processes={group.processes}
                    navigate={navigate}
                    act={act}
                    requestDelete={setDeleteTarget}
                  />
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ProcessTable
          processes={filtered}
          navigate={navigate}
          act={act}
          requestDelete={setDeleteTarget}
        />
      )}

      {registerOpen && (
        <RegisterDialog
          onClose={() => setRegisterOpen(false)}
          onCreated={async () => {
            setRegisterOpen(false);
            await load();
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Deregister ${deleteTarget.label}?`}
          message="The process definition will be removed. Retained run logs stay available."
          confirmLabel="Deregister"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

function ProcessTable({
  processes,
  navigate,
  act,
  requestDelete,
}: {
  processes: Process[];
  navigate: ReturnType<typeof useNavigate>;
  act: (process: Process, action: "start" | "stop" | "restart" | "run") => void;
  requestDelete: (process: Process) => void;
}) {
  return (
    <div className="process-table" role="table" aria-label="Processes">
      <div className="process-table-header" role="row">
        <span>Process</span><span>State</span><span>Declared ports</span><span>Kind</span><span>Actions</span>
      </div>
      {processes.map((process) => (
        <article
          className="process-row"
          key={process.id}
          role="row"
          tabIndex={0}
          onClick={() => navigate(`/process/${process.id}`)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              navigate(`/process/${process.id}`);
            }
          }}
        >
          <div className="process-identity" role="cell">
            <span className="process-icon">
              {process.kind === "service" ? <Terminal /> : <FileText />}
            </span>
            <div>
              <button
                className="process-label"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/process/${process.id}`);
                }}
              >
                {process.label}
              </button>
              <div className="row-tags">
                {(process.tags.length ? process.tags : ["untagged"]).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
          <div role="cell"><StatusPill state={process.state} /></div>
          <div className="row-ports" role="cell">
            {process.ports.length ? process.ports.map((port) => (
              <span key={port.id}>{port.name} · {port.host}:{port.port}</span>
            )) : <span className="muted">None</span>}
          </div>
          <span className="kind-cell" role="cell">{process.kind}</span>
          <ProcessActions
            process={process}
            compact
            onAction={act}
            onDelete={requestDelete}
          />
        </article>
      ))}
    </div>
  );
}

function ProcessActions({
  process,
  compact = false,
  onAction,
  onDelete,
}: {
  process: Process;
  compact?: boolean;
  onAction: (process: Process, action: "start" | "stop" | "restart" | "run") => void;
  onDelete?: (process: Process) => void;
}) {
  function click(action: "start" | "stop" | "restart" | "run") {
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onAction(process, action);
    };
  }
  const active = process.state === "running" || process.state === "starting";
  return (
    <div className={`row-actions ${compact ? "compact" : ""}`} role="cell">
      {process.kind === "service" ? (
        <>
          <button
            type="button"
            className="icon-button"
            onClick={click("restart")}
            disabled={process.state === "stopping"}
            aria-label={`Restart ${process.label}`}
          >
            <ArrowsClockwise />
          </button>
          <button type="button" className="button" onClick={click("stop")} disabled={!active}>
            Stop
          </button>
          <button type="button" className="button strong" onClick={click("start")} disabled={active || process.state === "stopping"}>
            Start
          </button>
        </>
      ) : (
        <button type="button" className="button strong" onClick={click("run")}>
          <Play weight="fill" /> Run
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="icon-button danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(process);
          }}
          aria-label={`Deregister ${process.label}`}
        >
          <Trash />
        </button>
      )}
    </div>
  );
}

function ProcessDetailPage() {
  const { processId = "" } = useParams();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const [process, setProcess] = useState<Process | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunID, setSelectedRunID] = useState("");
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [query, setQuery] = useState("");
  const [stdout, setStdout] = useState(true);
  const [stderr, setStderr] = useState(true);
  const [follow, setFollow] = useState(true);
  const [focusLogs, setFocusLogs] = useState(false);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const logBody = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await getProcess(processId);
      setProcess(result.process);
      setRuns(result.runs ?? []);
      setSelectedRunID((current) =>
        result.runs.some((run) => run.id === current)
          ? current
          : result.runs[0]?.id ?? "",
      );
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [processId]);

  const selectedRun = runs.find((run) => run.id === selectedRunID);
  const live = selectedRun ? ["starting", "running", "stopping"].includes(selectedRun.state) : false;

  const loadLogs = useCallback(async () => {
    if (!selectedRunID) {
      setRecords([]);
      return;
    }
    try {
      const result = await getRunLogs(selectedRunID);
      setRecords(result.records ?? []);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [selectedRunID]);

  useEffect(() => {
    void load();
    return subscribeToEvents(() => void load());
  }, [load]);

  useEffect(() => {
    if (process) heading.current?.focus();
  }, [process]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!follow || !live) return;
    const timer = window.setInterval(() => {
      void loadLogs();
      void load();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [follow, live, load, loadLogs]);

  useEffect(() => {
    if (follow && live && logBody.current) {
      logBody.current.scrollTop = logBody.current.scrollHeight;
    }
  }, [follow, live, records]);

  const visibleRecords = records.filter((record) => {
    if (record.stream === "stdout" && !stdout) return false;
    if (record.stream === "stderr" && !stderr) return false;
    return record.text.toLowerCase().includes(query.toLowerCase());
  });

  async function act(target: Process, action: "start" | "stop" | "restart" | "run") {
    try {
      const run = await processAction(target, action);
      setSelectedRunID(run.id);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (loading) return <ProcessSkeleton />;
  if (!process) {
    return (
      <div className="not-found">
        <h1>Process not found</h1>
        <p>{error || "This process is no longer registered."}</p>
        <button className="button strong" type="button" onClick={() => navigate("/")}>Back to Processes</button>
      </div>
    );
  }

  const command = process.command.shell || process.command.argv?.join(" ") || "";
  return (
    <section className={`detail-page ${focusLogs ? "logs-focused" : ""}`}>
      <div className="detail-topbar">
        <button className="back-button" type="button" onClick={() => navigate("/")}>
          <ArrowLeft /> Back to Processes
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-heading detail-context">
          <span className="detail-icon">
            {process.kind === "service" ? <Terminal /> : <FileText />}
          </span>
          <div>
            <h1 ref={heading} tabIndex={-1}>{process.label}</h1>
            <div className="detail-subtitle">
              <code>{process.id}</code><span>·</span><span>{process.kind}</span><span>·</span>
              <StatusPill state={process.state} />
            </div>
            <div className="detail-tags">
              {(process.tags.length ? process.tags : ["untagged"]).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </div>
          <ProcessActions process={process} onAction={act} />
        </div>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        <div className="detail-cards detail-context">
          <InfoCard title="Declared ports" icon={<PlugsConnected />}>
            {process.ports.length ? process.ports.map((port) => (
              <PortRow port={port} key={port.id} />
            )) : <span className="muted">No declared ports</span>}
          </InfoCard>
          <InfoCard title="Launch command" icon={<TerminalWindow />}>
            <code className="launch-command">{command}</code>
            <div className="directory"><Folder /> {process.cwd}</div>
          </InfoCard>
          <InfoCard title="Environment" icon={<Gear />}>
            <span className="muted">{Object.keys(process.env).length} variables set</span>
            <div className="environment-list">
              {Object.entries(process.env).slice(0, showEnvironment ? undefined : 3).map(([key, value]) => (
                <code key={key}>{showEnvironment ? `${key}=${value}` : key}</code>
              ))}
            </div>
            {Object.keys(process.env).length > 0 && (
              <button className="text-button" type="button" onClick={() => setShowEnvironment((value) => !value)}>
                {showEnvironment ? "Hide values" : "Show all values"}
              </button>
            )}
          </InfoCard>
        </div>

        <div className="run-tabs detail-context" aria-label="Run history">
          {runs.length ? runs.map((run) => (
            <button
              type="button"
              key={run.id}
              className={run.id === selectedRunID ? "selected" : ""}
              aria-pressed={run.id === selectedRunID}
              onClick={() => {
                setSelectedRunID(run.id);
                setQuery("");
                setFollow(["starting", "running", "stopping"].includes(run.state));
              }}
            >
              <StatusPill state={run.state} />
              <span>{run.id === runs[0]?.id ? "Latest run" : formatDate(run.started_at)}</span>
              {run.exit_code !== undefined && <span>exit {run.exit_code}</span>}
            </button>
          )) : <span className="muted">Run this process to create logs.</span>}
        </div>

        <div className="log-heading">
          <h2><FileText /> Logs</h2>
          <button className="button" type="button" aria-pressed={focusLogs} onClick={() => setFocusLogs((value) => !value)}>
            <ArrowsOut /> {focusLogs ? "Show details" : "Focus logs"}
          </button>
        </div>
        <section className="log-panel">
          <div className="log-toolbar">
            <label><input type="checkbox" checked={stdout} onChange={(event) => setStdout(event.target.checked)} />stdout</label>
            <label><input type="checkbox" checked={stderr} onChange={(event) => setStderr(event.target.checked)} />stderr</label>
            <label className="log-search">
              <span className="sr-only">Search this run</span>
              <MagnifyingGlass />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this run's logs" />
            </label>
            <button className={`button ${follow && live ? "following" : ""}`} type="button" disabled={!live} aria-pressed={follow && live} onClick={() => setFollow((value) => !value)}>
              <RocketLaunch /> {follow && live ? "Following" : "Follow"}
            </button>
            {selectedRun && (
              <a className="button" href={logDownloadURL(selectedRun.id)} download>
                <DownloadSimple /> Download
              </a>
            )}
          </div>
          <div className="log-count">
            {selectedRun ? `${visibleRecords.length} of ${records.length} records · ${formatDate(selectedRun.started_at)}` : "No run selected"}
          </div>
          <div className="log-body" ref={logBody}>
            {visibleRecords.length ? visibleRecords.map((record) => (
              <div className={`log-line ${record.stream}`} key={record.seq}>
                <time>{formatTime(record.time)}</time>
                <span>{record.text}</span>
              </div>
            )) : <div className="log-empty">No log records match these filters.</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

function PortRow({ port }: { port: Port }) {
  const address = `${port.protocol}://${port.host}:${port.port}${port.path ?? ""}`;
  return (
    <div className="port-row">
      <code>{port.name} · {port.host}:{port.port}{port.path ?? ""}</code>
      {port.protocol === "tcp" ? (
        <button className="icon-button" type="button" aria-label={`Copy ${port.name} endpoint`} onClick={() => void navigator.clipboard.writeText(address)}>
          <Copy />
        </button>
      ) : (
        <a className="icon-button" href={address} target="_blank" rel="noreferrer" aria-label={`Open ${port.name} endpoint`}>
          <ArrowSquareOut />
        </a>
      )}
    </div>
  );
}

function RegisterDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"service" | "task">("service");
  const [tags, setTags] = useState("");
  const [cwd, setCWD] = useState("");
  const [command, setCommand] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => closeButton.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const ports: Port[] = [];
    if (port.trim()) {
      try {
        const parsed = new URL(port);
        if (!parsed.port || !["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("invalid endpoint");
        }
        ports.push({
          id: "",
          name: "http",
          host: parsed.hostname,
          port: Number(parsed.port),
          protocol: parsed.protocol.replace(":", "") as Port["protocol"],
          path: parsed.pathname,
        });
      } catch {
        setError("Use a complete endpoint URL, such as http://127.0.0.1:4310/.");
        setSaving(false);
        return;
      }
    }
    const input: ProcessInput = {
      label,
      kind,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      cwd,
      command: { shell: command },
      env: {},
      ports,
    };
    try {
      await createProcess(input);
      onCreated();
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="register-title">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">PROCESS DEFINITION</span>
            <h2 id="register-title">Register a process</h2>
          </div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close registration">
            <X />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>Label<input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Storefront web" /></label>
          <div className="form-grid">
            <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as "service" | "task")}><option value="service">Service</option><option value="task">Task</option></select></label>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="frontend, project:storefront" /></label>
          </div>
          <label>Working directory<input required value={cwd} onChange={(event) => setCWD(event.target.value)} placeholder="/home/me/code/storefront" /></label>
          <label>Shell command<textarea required value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npm run dev -- --port 4310" /></label>
          <label>HTTP endpoint <span className="optional">(optional)</span><input value={port} onChange={(event) => setPort(event.target.value)} placeholder="http://127.0.0.1:4310/" /></label>
          {error && <div className="form-error">{error}</div>}
          <div className="dialog-actions">
            <button className="button" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary" type="submit" disabled={saving}>
              <Plus weight="bold" /> {saving ? "Registering" : "Register process"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-layer">
      <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onCancel}>Cancel</button>
          <button className="button danger-button" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function InfoCard({ title, icon, children }: PropsWithChildren<{ title: string; icon: ReactNode }>) {
  return (
    <section className="info-card">
      <h2>{icon}{title}</h2>
      {children}
    </section>
  );
}

function StatusPill({ state }: { state: string }) {
  const normalized = state === "exited" ? "succeeded" : state;
  return <span className={`status-pill ${normalized}`}><i />{normalized}</span>;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button className="button" type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}

function ProcessSkeleton() {
  return <div className="skeleton" aria-label="Loading processes">{Array.from({ length: 5 }, (_, index) => <div key={index} />)}</div>;
}

function EmptyState({ hasProcesses, onRegister }: { hasProcesses: boolean; onRegister: () => void }) {
  return (
    <div className="empty-state">
      <span><CheckCircle /></span>
      <h2>{hasProcesses ? "No processes match" : "Register your first process"}</h2>
      <p>{hasProcesses ? "Change the active filters or search." : "Add a local command, label, tags, and declared ports."}</p>
      {!hasProcesses && <button className="button primary" type="button" onClick={onRegister}><Plus /> Register process</button>}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "The local proc-man service is unavailable.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(new Date(value));
}
