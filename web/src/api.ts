import type { LogRecord, Process, Run } from "./types";

export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({
      error: { code: "request_failed", message: response.statusText },
    }));
    throw new RequestError(
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? response.statusText,
      response.status,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export type ProcessQuery = {
  query?: string;
  tags?: string[];
  kind?: string;
  state?: string;
};

export async function listProcesses(
  input: ProcessQuery = {},
): Promise<Process[]> {
  const query = new URLSearchParams();
  if (input.query) query.set("query", input.query);
  if (input.kind) query.set("kind", input.kind);
  if (input.state) query.set("state", input.state);
  input.tags?.forEach((tag) => query.append("tag", tag));
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await request<{ processes: Process[] }>(
    `/api/v1/processes${suffix}`,
  );
  return response.processes ?? [];
}

export async function getProcess(
  id: string,
): Promise<{ process: Process; runs: Run[] }> {
  return request(`/api/v1/processes/${encodeURIComponent(id)}`);
}

export type ProcessInput = Pick<
  Process,
  "label" | "kind" | "tags" | "cwd" | "command" | "env" | "ports"
>;

export async function createProcess(
  input: ProcessInput,
): Promise<Process> {
  const response = await request<{ process: Process }>("/api/v1/processes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.process;
}

export async function deleteProcess(id: string): Promise<void> {
  await request(`/api/v1/processes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function processAction(
  process: Process,
  action: "start" | "stop" | "restart" | "run",
): Promise<Run> {
  const endpoint =
    action === "run"
      ? `/api/v1/processes/${process.id}/runs`
      : `/api/v1/processes/${process.id}/${action}`;
  const response = await request<{ run: Run }>(endpoint, {
    method: "POST",
    body: "{}",
  });
  return response.run;
}

export async function cancelRun(id: string): Promise<Run> {
  const response = await request<{ run: Run }>(
    `/api/v1/runs/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return response.run;
}

export async function getRunLogs(
  id: string,
  input: { query?: string; stream?: string; since?: number } = {},
): Promise<{ run: Run; records: LogRecord[] }> {
  const query = new URLSearchParams();
  if (input.query) query.set("query", input.query);
  if (input.stream) query.set("stream", input.stream);
  if (input.since) query.set("since", String(input.since));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/v1/runs/${encodeURIComponent(id)}/logs${suffix}`);
}

export function logDownloadURL(id: string): string {
  return `/api/v1/runs/${encodeURIComponent(id)}/logs/download`;
}

export function subscribeToEvents(
  onChange: () => void,
): () => void {
  const events = new EventSource("/api/v1/events");
  const handler = () => onChange();
  for (const name of [
    "process.created",
    "process.updated",
    "process.deleted",
    "run.started",
    "run.finished",
  ]) {
    events.addEventListener(name, handler);
  }
  return () => events.close();
}
