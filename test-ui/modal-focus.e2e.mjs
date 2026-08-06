import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectCdp } from "./cdp-client.mjs";

const chromeBinary = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const prototypeUrl = new URL("../prototype/index.html", import.meta.url).href;

async function getAvailablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function findDebugPage(port) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const endpoint = `http://127.0.0.1:${port}`;
      const pages = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(500),
      }).then(response => response.json());
      const page = pages.find(
        candidate =>
          candidate.type === "page" &&
          !candidate.url.startsWith("chrome-extension://"),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error("Chrome debugging endpoint did not become ready");
}

const userDataDirectory = await mkdtemp(join(tmpdir(), "port-start-chrome-"));
const debuggingPort = await getAvailablePort();
const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-sandbox",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ],
  { detached: true, stdio: "ignore" },
);
let cdp;

try {
  const page = await findDebugPage(debuggingPort);
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Accessibility.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.call("Page.navigate", { url: prototypeUrl });

  async function evaluate(expression) {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  async function waitFor(expression, message, timeout = 3_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(message);
  }

  async function press(key, code = key, modifiers = 0) {
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      modifiers,
    });
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers,
    });
  }

  await waitFor(
    `document.readyState === "complete" &&
     document.querySelectorAll(".process-entry").length === 12`,
    "The process inventory did not load.",
  );

  assert.deepEqual(
    await evaluate(`({
      title: document.title,
      heading: document.querySelector("h1").textContent,
      rows: document.querySelectorAll(".process-entry").length,
      uniqueRows: new Set(
        [...document.querySelectorAll(".process-entry")]
          .map(element => element.dataset.processId)
      ).size,
      worktreeCopy: document.body.innerText.toLowerCase().includes("worktree"),
      exposedIcons: document.querySelectorAll(".ph:not([aria-hidden='true'])").length
    })`),
    {
      title: "Port Start - Process manager",
      heading: "Processes",
      rows: 12,
      uniqueRows: 12,
      worktreeCopy: false,
      exposedIcons: 0,
    },
  );

  await evaluate(`(() => {
    const input = document.getElementById("processSearch");
    input.value = "4310";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 1`,
    "Port search did not reduce the process list.",
  );
  assert.equal(
    await evaluate(`document.querySelector(".process-label").textContent`),
    "Storefront web",
  );
  await evaluate(
    `document.querySelector('[data-open-process="proc_storefront_web"]').click()`,
  );
  await waitFor(
    `!document.getElementById("processDetail").hidden`,
    "The process detail page did not open.",
  );
  assert.deepEqual(
    await evaluate(`({
      hash: location.hash,
      title: document.querySelector(".detail-title").textContent,
      processId: document.querySelector("[data-detail-process-id]").textContent,
      command: document.querySelector("[data-detail-command]").textContent,
      directory: document.querySelector("[data-detail-directory]").textContent,
      ports: document.querySelectorAll("[data-detail-port]").length,
      runs: document.querySelectorAll("[data-detail-run]").length,
      logLines: document.querySelectorAll(".detail-log-line").length
    })`),
    {
      hash: "#process/proc_storefront_web",
      title: "Storefront web",
      processId: "proc_storefront_web",
      command: "npm run dev -- --port 4310",
      directory: "~/code/storefront",
      ports: 2,
      runs: 3,
      logLines: 52,
    },
  );
  await evaluate(
    `document.querySelector("[data-detail-environment-toggle]").click()`,
  );
  assert.match(
    await evaluate(
      `document.querySelector("[data-detail-environment]").textContent`,
    ),
    /NODE_ENV=development/,
  );
  await evaluate(`document.getElementById("detailFocusLogs").click()`);
  assert.equal(
    await evaluate(
      `document.querySelector(".detail-scroll").classList.contains("logs-focused")`,
    ),
    true,
  );
  await evaluate(`document.getElementById("detailFocusLogs").click()`);
  await evaluate(`document.getElementById("detailStdout").click()`);
  assert.equal(
    await evaluate(`document.querySelectorAll(".detail-log-line").length`),
    3,
    "The stderr-only detail filter should show three records.",
  );
  await evaluate(`document.getElementById("detailStdout").click()`);
  await evaluate(
    `document.querySelector('[data-detail-run="run_storefront_web_previous"]').click()`,
  );
  await waitFor(
    `document.querySelector(".detail-log-body").textContent.includes(
      "Previous Storefront web run stopped cleanly"
    )`,
    "The retained run logs did not appear on the detail page.",
  );
  await evaluate(
    `document.querySelector('[data-detail-run="run_storefront_web_current"]').click()`,
  );
  await evaluate(`(() => {
    const input = document.getElementById("detailLogSearch");
    input.value = "upstream timeout";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(`document.querySelectorAll(".detail-log-line").length`),
    3,
    "The detail log search should show three matching records.",
  );
  await evaluate(`document.getElementById("detailDownload").click()`);
  assert.equal(
    await evaluate(`document.getElementById("toast").textContent`),
    "Prepared Current run logs for Storefront web.",
  );
  await evaluate(`document.getElementById("detailBack").click()`);
  await waitFor(
    `document.getElementById("processDetail").hidden`,
    "The detail back action did not restore the process inventory.",
  );
  assert.deepEqual(
    await evaluate(`({
      hash: location.hash,
      search: document.getElementById("processSearch").value,
      rows: document.querySelectorAll(".process-entry").length
    })`),
    {
      hash: "",
      search: "4310",
      rows: 1,
    },
    "Returning from details should preserve the inventory filters.",
  );
  await evaluate(
    `document.querySelector('button[title="Processes"]').click()`,
  );
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 12`,
    "The Processes rail button did not restore the full process list.",
  );
  assert.deepEqual(
    await evaluate(`({
      search: document.getElementById("processSearch").value,
      toast: document.getElementById("toast").textContent,
      active: document.querySelector('button[title="Processes"]').classList.contains("active")
    })`),
    {
      search: "",
      toast: "Showing all processes.",
      active: true,
    },
  );

  await evaluate(`(() => {
    const input = document.getElementById("processSearch");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-filter-tag="project:platform"]').click();
    document.querySelector('[data-filter-tag="api"]').click();
  })()`);
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 2`,
    "AND tag filters did not return two platform APIs.",
  );
  assert.deepEqual(
    await evaluate(`[...document.querySelectorAll(".process-label")]
      .map(element => element.textContent).sort()`),
    ["Platform API", "Vector search API"],
  );

  await evaluate(`document.getElementById("clearTags").click()`);
  await evaluate(`document.getElementById("groupSwitch").click()`);
  await waitFor(
    `document.querySelectorAll(".tag-group").length > 8`,
    "Tag grouping did not render.",
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll(
        '.process-entry[data-process-id="proc_vector_search"]'
      )];
      return {
        instances: rows.length,
        ids: [...new Set(rows.map(row => row.dataset.processId))],
        duplicateDomIds:
          [...document.querySelectorAll("[id]")]
            .map(element => element.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index)
      };
    })()`),
    {
      instances: 3,
      ids: ["proc_vector_search"],
      duplicateDomIds: [],
    },
    "Grouped rows must share one process ID without duplicate DOM IDs.",
  );

  await evaluate(`document.querySelector('[data-toggle-group="api"]').click()`);
  assert.equal(
    await evaluate(
      `document.querySelector('[data-tag-group="api"]').classList.contains("collapsed")`,
    ),
    true,
  );

  await evaluate(`document.getElementById("groupSwitch").click()`);
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 12`,
    "The flat process list did not return.",
  );

  await evaluate(
    `document.querySelector('[data-toggle-logs="proc_storefront_web"]').click()`,
  );
  await waitFor(
    `!document.querySelector(
      '[data-process-id="proc_storefront_web"] .log-panel'
    ).hidden`,
    "Inline logs did not open.",
  );
  assert.match(
    await evaluate(
      `document.querySelector(
        '[data-process-id="proc_storefront_web"] .log-panel'
      ).textContent`,
    ),
    /Storefront web compiled client bundle/,
  );
  assert.ok(
    await evaluate(
      `document.querySelectorAll(
        '[data-process-id="proc_storefront_web"] [data-run-select] option'
      ).length`,
    ) >= 2,
    "Storefront web should expose retained runs.",
  );
  await evaluate(`(() => {
    const select = document.querySelector(
      '[data-process-id="proc_storefront_web"] [data-run-select]'
    );
    select.value = "run_storefront_web_previous";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelector(
      '[data-process-id="proc_storefront_web"] .log-panel'
    ).textContent.includes("Previous Storefront web run stopped cleanly")`,
    "The retained run logs did not appear.",
  );
  await evaluate(
    `document.querySelector('[data-toggle-logs="proc_platform_api"]').click()`,
  );
  await waitFor(
    `!document.querySelector(
      '[data-process-id="proc_platform_api"] .log-panel'
    ).hidden`,
    "Platform API logs did not open.",
  );
  const platformLogs = await evaluate(
    `document.querySelector(
      '[data-process-id="proc_platform_api"] .log-panel'
    ).textContent`,
  );
  assert.match(platformLogs, /Platform API listening on/);
  assert.doesNotMatch(platformLogs, /Storefront web compiled client bundle/);

  await evaluate(`(() => {
    const select = document.querySelector(
      '[data-process-id="proc_storefront_web"] [data-run-select]'
    );
    select.value = "run_storefront_web_current";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await evaluate(`(() => {
    const input = document.querySelector(
      '[data-process-id="proc_storefront_web"] [data-log-search]'
    );
    input.value = "compiled client bundle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(
      `document.querySelectorAll(
        '[data-process-id="proc_storefront_web"] .log-line'
      ).length`,
    ),
    1,
    "Log search should show one matching line.",
  );

  await evaluate(
    `document.querySelector(
      '[data-service-action="stop"][data-process-id="proc_storefront_web"]'
    ).click()`,
  );
  await waitFor(
    `document.querySelector(
      '[data-process-id="proc_storefront_web"] .pill'
    ).textContent === "stopped"`,
    "The service did not stop.",
  );
  await evaluate(
    `document.querySelector(
      '[data-service-action="start"][data-process-id="proc_storefront_web"]'
    ).click()`,
  );
  await waitFor(
    `document.querySelector(
      '[data-process-id="proc_storefront_web"] .pill'
    ).textContent === "running"`,
    "The service did not start.",
  );

  await evaluate(
    `document.querySelector(
      '[data-task-action="cancel"][data-process-id="proc_ml_training"]'
    ).click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector(
        '[data-process-id="proc_ml_training"] .pill'
      ).textContent`,
    ),
    "canceled",
  );
  await evaluate(
    `document.querySelector(
      '[data-task-action="run"][data-process-id="proc_ml_training"]'
    ).click()`,
  );
  await waitFor(
    `document.querySelector(
      '[data-process-id="proc_ml_training"] .pill'
    ).textContent === "succeeded"`,
    "The task did not complete.",
  );

  await evaluate(`Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writes: [],
      writeText(value) {
        this.writes.push(value);
        return Promise.resolve();
      }
    }
  })`);
  await evaluate(
    `document.querySelector('[data-copy-port="tcp://127.0.0.1:9310"]').click()`,
  );
  await waitFor(
    `navigator.clipboard.writes.length === 1`,
    "The TCP endpoint did not reach the clipboard.",
  );
  assert.deepEqual(
    await evaluate(`navigator.clipboard.writes`),
    ["tcp://127.0.0.1:9310"],
  );
  await evaluate(
    `document.querySelector('[data-open-port="http://127.0.0.1:4310/"]').click()`,
  );
  assert.equal(
    await evaluate(`document.getElementById("toast").textContent`),
    "Open http://127.0.0.1:4310/",
  );

  await evaluate(`document.getElementById("openRegister").click()`);
  await waitFor(
    `document.getElementById("registerDialog").classList.contains("open")`,
    "The registration dialog did not open.",
  );
  assert.deepEqual(
    await evaluate(`({
      focus: document.activeElement.getAttribute("aria-label"),
      appInert: document.getElementById("application").inert,
      railInert: document.querySelector(".rail").inert,
      prototypeInert: document.querySelector(".proto-bar").inert
    })`),
    {
      focus: "Close registration help",
      appInert: true,
      railInert: true,
      prototypeInert: true,
    },
  );
  await evaluate(`document.getElementById("copyRegister").focus()`);
  await press("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement.getAttribute("aria-label")`),
    "Close registration help",
    "Dialog focus should wrap to its first control.",
  );
  await press("Escape", "Escape");
  assert.equal(
    await evaluate(`document.activeElement.id`),
    "openRegister",
    "Escape should close the dialog and restore focus.",
  );

  await evaluate(
    `document.querySelector('[data-deregister="proc_local_proxy"]').click()`,
  );
  await waitFor(
    `document.getElementById("deregisterDialog").classList.contains("open")`,
    "The deregistration dialog did not open.",
  );
  await evaluate(`document.getElementById("confirmDeregister").click()`);
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 11`,
    "Deregistration did not remove one process.",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-process-id="proc_local_proxy"]') === null`,
    ),
    true,
  );
  assert.equal(
    await evaluate(`document.getElementById("toast").textContent`),
    "Local fixture generator was deregistered. 1 retained run remains available.",
  );

  for (const screen of ["loading", "empty", "error"]) {
    await evaluate(
      `document.querySelector('[data-state="${screen}"]').click()`,
    );
    assert.equal(
      await evaluate(`document.querySelector('[data-state="${screen}"]').classList.contains("on")`),
      true,
    );
  }
  await evaluate(`document.getElementById("retryLoad").click()`);
  await waitFor(
    `document.querySelectorAll(".process-entry").length === 11`,
    "Retry did not restore the process inventory.",
  );

  await evaluate(`document.getElementById("themeToggle").click()`);
  assert.deepEqual(
    await evaluate(`({
      theme: document.documentElement.dataset.theme,
      label: document.getElementById("themeToggle").getAttribute("aria-label")
    })`),
    { theme: "dark", label: "Use light mode" },
  );

  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.deepEqual(
    await evaluate(`({
      rail: getComputedStyle(document.querySelector(".rail")).display,
      frameWidth: Math.round(document.querySelector(".frame").getBoundingClientRect().width),
      viewportWidth: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      topActionsVisible:
        document.querySelector(".top-actions").getBoundingClientRect().right <= innerWidth,
      tagScroll:
        document.getElementById("tagRow").scrollWidth >
        document.getElementById("tagRow").clientWidth,
      tagOverflow: getComputedStyle(document.getElementById("tagRow")).overflowX
    })`),
    {
      rail: "none",
      frameWidth: 390,
      viewportWidth: 390,
      overflow: false,
      topActionsVisible: true,
      tagScroll: true,
      tagOverflow: "auto",
    },
  );
  await evaluate(
    `document.querySelector('[data-open-process="proc_storefront_web"]').click()`,
  );
  await waitFor(
    `!document.getElementById("processDetail").hidden`,
    "The mobile process detail page did not open.",
  );
  assert.deepEqual(
    await evaluate(`({
      overflow: document.documentElement.scrollWidth > innerWidth,
      detailOverflow:
        document.querySelector(".detail-scroll").scrollWidth >
        document.querySelector(".detail-scroll").clientWidth,
      overviewColumns:
        getComputedStyle(document.querySelector(".detail-overview")).gridTemplateColumns
          .split(" ").length,
      backVisible:
        document.getElementById("detailBack").getBoundingClientRect().right <= innerWidth,
      logVisible:
        document.querySelector(".detail-log-panel").getBoundingClientRect().width <= innerWidth
    })`),
    {
      overflow: false,
      detailOverflow: false,
      overviewColumns: 1,
      backVisible: true,
      logVisible: true,
    },
  );

  console.log("Process inventory browser checks passed.");
} finally {
  if (cdp) {
    try {
      cdp.close();
    } catch {
      // The browser can close the connection first.
    }
  }
  if (chrome.pid) {
    try {
      process.kill(-chrome.pid, "SIGTERM");
    } catch {
      chrome.kill("SIGTERM");
    }
  }
  await new Promise(resolve => {
    if (chrome.exitCode !== null) {
      resolve();
      return;
    }
    chrome.once("exit", resolve);
    setTimeout(resolve, 1_000);
  });
  await rm(userDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
