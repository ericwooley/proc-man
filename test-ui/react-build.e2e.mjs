import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { connectCdp } from "./cdp-client.mjs";

async function availablePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  await new Promise(accept => server.close(accept));
  return address.port;
}

async function debugPage(port) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        response => response.json(),
      );
      const page = pages.find(item => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      await new Promise(accept => setTimeout(accept, 50));
    }
  }
  throw new Error("Chrome debugging endpoint did not become ready");
}

const repository = resolve(new URL("..", import.meta.url).pathname);
const buildURL = pathToFileURL(join(repository, "internal", "web", "dist", "index.html")).href;
const profile = await mkdtemp(join(tmpdir(), "proc-man-react-chrome-"));
const debuggingPort = await availablePort();
const chrome = spawn(
  process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  [
    "--headless=new",
    "--allow-file-access-from-files",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-web-security",
    "--no-first-run",
    "--no-sandbox",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { detached: true, stdio: "ignore" },
);
let cdp;

const processFixture = {
  id: "proc_browser",
  selector: "proc_browser",
  label: "Browser task",
  tags: ["frontend", "browser"],
  kind: "task",
  state: "stopped",
  source: { kind: "imperative" },
  command: { shell: 'printf "browser run ready\\n"' },
  cwd: repository,
  env: { TEST_MODE: "browser" },
  ports: [{
    id: "endpoint_browser",
    name: "http",
    host: "127.0.0.1",
    port: 4318,
    protocol: "http",
    path: "/",
  }],
  created_at: "2026-08-06T17:00:00Z",
  updated_at: "2026-08-06T17:00:00Z",
};
const runFixture = {
  id: "run_browser",
  process_id: processFixture.id,
  process: processFixture,
  state: "exited",
  pid: 4100,
  started_at: "2026-08-06T17:00:00Z",
  ended_at: "2026-08-06T17:00:01Z",
  exit_code: 0,
  log_path: "/tmp/run_browser.ndjson",
};

try {
  const page = await debugPage(debuggingPort);
  cdp = await connectCdp(page.webSocketDebuggerUrl, {
    commandTimeoutMs: 15_000,
  });
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const process = ${JSON.stringify(processFixture)};
      const run = ${JSON.stringify(runFixture)};
      class TestEventSource {
        addEventListener() {}
        close() {}
      }
      window.EventSource = TestEventSource;
      window.fetch = async input => {
        const url = String(input);
        let value;
        let status = 200;
        if (url.startsWith("/api/v1/processes?")) {
          value = {
            processes: [process],
            page: { limit: 25, has_more: false, next_cursor: "" },
            facets: {
              tags: process.tags.map(value => ({ value, count: 1 })),
              directories: [{ value: process.cwd, count: 1 }]
            }
          };
        } else if (url === "/api/v1/processes/" + process.id) {
          value = { process, runs: [run] };
        } else if (url === "/api/v1/runs/" + run.id + "/logs") {
          value = {
            run,
            records: [{
              seq: 1,
              time: "2026-08-06T17:00:00.500Z",
              stream: "stdout",
              text: "browser run ready",
              partial: false
            }]
          };
        } else {
          status = 404;
          value = { error: { code: "not_found", message: "not found" } };
        }
        return new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" }
        });
      };
    })();`,
  });
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.call("Page.navigate", { url: buildURL });

  async function evaluate(expression) {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async function waitFor(expression, message) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 25));
    }
    throw new Error(message);
  }

  await waitFor(
    `document.querySelectorAll(".process-row").length === 1`,
    "The built React process inventory did not load",
  );
  assert.deepEqual(
    await evaluate(`({
      heading: document.querySelector("h1").textContent,
      brandParent: document.querySelector(".brand").parentElement.tagName,
      brandInNav: Boolean(document.querySelector(".rail .brand")),
      navCount: document.querySelectorAll(".rail-link").length,
      navActive: document.querySelector(".rail-link").classList.contains("active"),
      directory: document.querySelector(".row-directory").innerText,
      hasDirectoryFilter: Boolean(document.querySelector('select[aria-label="Filter by directory"]')),
      hasDirectoryGrouping: [...document.querySelectorAll('select[aria-label="Group processes"] option')]
        .some(option => option.value === "directory")
    })`),
    {
      heading: "Processes",
      brandParent: "HEADER",
      brandInNav: false,
      navCount: 1,
      navActive: true,
      directory: repository,
      hasDirectoryFilter: true,
      hasDirectoryGrouping: true,
    },
  );

  await evaluate(`(() => {
    const group = document.querySelector('select[aria-label="Group processes"]');
    group.value = "directory";
    group.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelector(".group-heading strong")?.textContent === ${JSON.stringify(repository)}`,
    "Directory grouping did not render",
  );

  if (process.env.PROC_MAN_INVENTORY_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      process.env.PROC_MAN_INVENTORY_SCREENSHOT,
      Buffer.from(screenshot.data, "base64"),
    );
  }

  await evaluate(`document.querySelector(".process-label").click()`);
  await waitFor(
    `location.hash.includes("/process/") &&
     document.querySelector(".log-body")?.innerText.includes("browser run ready")`,
    "The process detail route or logs did not load",
  );
  assert.equal(await evaluate(`document.querySelector("h1").textContent`), "Browser task");
  assert.equal(await evaluate(`document.querySelectorAll(".port-row").length`), 1);

  if (process.env.PROC_MAN_DETAIL_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      process.env.PROC_MAN_DETAIL_SCREENSHOT,
      Buffer.from(screenshot.data, "base64"),
    );
  }

  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),
    true,
  );

  if (process.env.PROC_MAN_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(process.env.PROC_MAN_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  await evaluate(`document.querySelector(".rail-link").click()`);
  await waitFor(`location.hash === "#/"`, "The Processes navigation did not return to the inventory");
  assert.equal(await evaluate(`document.querySelector("h1").textContent`), "Processes");

  console.log("Built React application browser checks passed.");
} finally {
  cdp?.close();
  if (chrome.pid) {
    try {
      process.kill(-chrome.pid, "SIGTERM");
    } catch {
      chrome.kill("SIGTERM");
    }
  }
  await new Promise(accept => {
    if (chrome.exitCode !== null) {
      accept();
      return;
    }
    chrome.once("exit", accept);
    setTimeout(accept, 1_000);
  });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
