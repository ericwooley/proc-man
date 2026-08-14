import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Process, Run } from "./types";

const process: Process = {
  id: "proc_01",
  selector: "storefront-web",
  label: "Storefront web",
  tags: ["frontend", "project:storefront"],
  kind: "service",
  state: "running",
  source: { kind: "cli" },
  command: { shell: "npm run dev -- --port 4310" },
  cwd: "/code/storefront",
  env: { NODE_ENV: "development" },
  ports: [
    {
      id: "port_01",
      name: "http",
      host: "127.0.0.1",
      port: 4310,
      protocol: "http",
      path: "/",
    },
    {
      id: "port_02",
      name: "inspector",
      host: "127.0.0.1",
      port: 9310,
      protocol: "tcp",
    },
  ],
  created_at: "2026-08-06T17:00:00Z",
  updated_at: "2026-08-06T17:00:00Z",
};

const otherProcess: Process = {
  ...process,
  id: "proc_02",
  selector: "admin-worker",
  label: "Admin worker",
  tags: ["backend", "project:admin"],
  kind: "task",
  state: "stopped",
  cwd: "/code/admin",
  ports: [],
};

const run: Run = {
  id: "run_01",
  process_id: process.id,
  process,
  state: "running",
  pid: 4100,
  started_at: "2026-08-06T17:00:00Z",
  log_path: "/tmp/run_01.ndjson",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const parsed = new URL(url, "http://proc-man.test");
    if (parsed.pathname === "/api/v1/processes") {
      return json({
        processes: [process, otherProcess],
        page: { limit: 25, has_more: false, next_cursor: "" },
      });
    }
    if (url === `/api/v1/processes/${process.id}`) {
      return json({ process, runs: [run] });
    }
    if (url === `/api/v1/runs/${run.id}/logs`) {
      return json({
        run,
        records: [
          {
            seq: 1,
            time: "2026-08-06T17:00:01Z",
            stream: "stdout",
            text: "ready on port 4310",
            partial: false,
          },
        ],
      });
    }
    return json({ error: { code: "not_found", message: "not found" } }, 404);
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App navigation", () => {
  it("separates the brand from the active process navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const brand = screen.getByRole("link", { name: "proc-man home" });
    const processLink = within(navigation).getByRole("link", { name: "Processes" });

    expect(navigation).not.toContainElement(brand);
    expect(processLink).toHaveClass("active");
    expect(processLink).toHaveAttribute("href", "/");
    expect(await screen.findByText("Storefront web")).toBeVisible();
  });

  it("opens process details and returns through the process navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Storefront web" }));

    expect(await screen.findByRole("heading", { name: "Storefront web" })).toBeVisible();
    expect(await screen.findByText("ready on port 4310")).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Processes" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Processes" })).toBeVisible();
    });
  });

  it("loads a process detail route directly", async () => {
    render(
      <MemoryRouter initialEntries={[`/process/${process.id}`]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Storefront web" })).toBeVisible();
    expect(screen.getByText("npm run dev -- --port 4310")).toBeVisible();
    expect(await screen.findByText("ready on port 4310")).toBeVisible();
  });

  it("uses each declared port row as its labeled action target", async () => {
    render(
      <MemoryRouter initialEntries={[`/process/${process.id}`]}>
        <App />
      </MemoryRouter>,
    );

    const openRow = await screen.findByRole("link", {
      name: "Open http endpoint at 127.0.0.1:4310/",
    });
    expect(openRow).toHaveClass("port-row");
    expect(openRow).toHaveTextContent("http · 127.0.0.1:4310/");
    expect(within(openRow).getByText("Open")).toBeVisible();

    const copyRow = screen.getByRole("button", {
      name: "Copy inspector endpoint at 127.0.0.1:9310",
    });
    expect(copyRow).toHaveClass("port-row");
    expect(copyRow).toHaveTextContent("inspector · 127.0.0.1:9310");
    expect(within(copyRow).getByText("Copy")).toBeVisible();
  });

  it("filters and groups processes by their associated directory", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Storefront web")).toBeVisible();
    expect(screen.getByText("Admin worker")).toBeVisible();
    expect(screen.getByText("/code/storefront")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by directory" }), {
      target: { value: "/code/admin" },
    });
    expect(screen.queryByText("Storefront web")).not.toBeInTheDocument();
    expect(await screen.findByText("Admin worker")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by directory" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Group processes" }), {
      target: { value: "directory" },
    });
    expect(await screen.findByRole("button", { name: "/code/storefront, 1 process" })).toBeVisible();
    expect(screen.getByRole("button", { name: "/code/admin, 1 process" })).toBeVisible();
  });

  it("filters and groups processes by project and process type", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Storefront web")).toBeVisible();
    const projectFilter = screen.getByRole("combobox", { name: "Filter by project" });
    expect(within(projectFilter).getByRole("option", { name: "storefront (1)" })).toBeVisible();
    expect(within(projectFilter).getByRole("option", { name: "admin (1)" })).toBeVisible();

    fireEvent.change(projectFilter, { target: { value: "project:storefront" } });
    expect(screen.queryByText("Admin worker")).not.toBeInTheDocument();
    expect(await screen.findByText("Storefront web")).toBeVisible();
    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
      expect(requests.some((request) => request.includes("tag=project%3Astorefront"))).toBe(true);
    });

    fireEvent.change(projectFilter, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "One-shot" }));
    expect(screen.queryByText("Storefront web")).not.toBeInTheDocument();
    expect(await screen.findByText("Admin worker")).toBeVisible();
    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
      expect(requests.some((request) => request.includes("kind=task"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "All types" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Group processes" }), {
      target: { value: "project" },
    });
    expect(await screen.findByRole("button", { name: "storefront, 1 process" })).toBeVisible();
    expect(screen.getByRole("button", { name: "admin, 1 process" })).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Group processes" }), {
      target: { value: "kind" },
    });
    expect(await screen.findByRole("button", {
      name: "Long-running services, 1 process",
    })).toBeVisible();
    expect(screen.getByRole("button", { name: "One-shot tasks, 1 process" })).toBeVisible();
  });

  it("loads older process pages only after the user requests them", async () => {
    const processRequests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const parsed = new URL(url, "http://proc-man.test");
      if (parsed.pathname !== "/api/v1/processes") {
        return json({ error: { code: "not_found", message: "not found" } }, 404);
      }
      processRequests.push(url);
      if (parsed.searchParams.get("query") === "admin") {
        return json({
          processes: [otherProcess],
          page: { limit: 25, has_more: false, next_cursor: "" },
        });
      }
      if (parsed.searchParams.get("cursor") === "older-cursor") {
        return json({
          processes: [otherProcess],
          page: { limit: 25, has_more: false, next_cursor: "" },
        });
      }
      return json({
        processes: [process],
        page: { limit: 25, has_more: true, next_cursor: "older-cursor" },
        facets: {
          tags: [
            { value: "backend", count: 1 },
            { value: "frontend", count: 1 },
          ],
          directories: [
            { value: "/code/admin", count: 1 },
            { value: "/code/storefront", count: 1 },
          ],
        },
      });
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Storefront web")).toBeVisible();
    expect(processRequests[0]).toBe("/api/v1/processes?limit=25");
    expect(processRequests.some((request) => request.includes("cursor="))).toBe(false);
    expect(within(screen.getByRole("combobox", { name: "Filter by directory" }))
      .getByRole("option", { name: "/code/admin (1)" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Older processes" }));
    expect(await screen.findByText("Admin worker")).toBeVisible();
    expect(processRequests).toContain(
      "/api/v1/processes?limit=25&cursor=older-cursor",
    );

    fireEvent.click(screen.getByRole("button", { name: "Newer processes" }));
    expect(await screen.findByText("Storefront web")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Older processes" }));
    expect(await screen.findByText("Admin worker")).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Search label, tag, port, command, or path"), {
      target: { value: "admin" },
    });
    await waitFor(() => {
      expect(processRequests).toContain("/api/v1/processes?query=admin&limit=25");
    });
    expect(await screen.findByText("Admin worker")).toBeVisible();
  });

  it("keeps the application shell available when a process page render fails", async () => {
    let processRequests = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input), "http://proc-man.test");
      if (parsed.pathname !== "/api/v1/processes") {
        return json({ error: { code: "not_found", message: "not found" } }, 404);
      }
      processRequests += 1;
      return json({
        processes: processRequests === 1
          ? [{ ...process, tags: undefined }]
          : [process],
        page: { limit: 25, has_more: false, next_cursor: "" },
      });
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "This page could not load" })).toBeVisible();
    expect(screen.getByRole("link", { name: "proc-man home" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Storefront web")).toBeVisible();
  });
});
