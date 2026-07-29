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

      const createdPage = await fetch(`${endpoint}/json/new?about:blank`, {
        method: "PUT",
        signal: AbortSignal.timeout(500),
      }).then(response => response.json());
      if (createdPage.webSocketDebuggerUrl) return createdPage;
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
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
    `document.readyState === "complete" && document.querySelectorAll(".wt-tile").length === 6`,
    "prototype should load its populated worktree state",
  );
  assert.deepEqual(
    await evaluate(`({
      title: document.title,
      cards: document.querySelectorAll(".wt-tile").length,
      drawerHidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      modalHidden: document.getElementById("registerModal").getAttribute("aria-hidden")
    })`),
    {
      title: "Port Start — Worktree process manager",
      cards: 6,
      drawerHidden: "true",
      modalHidden: "true",
    },
  );

  await press("/", "Slash");
  assert.equal(
    await evaluate("document.activeElement.id"),
    "jump",
    "the slash shortcut should focus global worktree search",
  );
  await evaluate(`(() => {
    const input = document.getElementById("jump");
    input.value = "4310";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(
      `document.getElementById("jumpResults").textContent.includes("feature/checkout-redesign")`,
    ),
    true,
    "declared ports should be searchable",
  );
  await press("Enter", "Enter");
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "opening a worktree should focus its detail drawer",
  );
  assert.deepEqual(
    await evaluate(`({
      hidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      open: document.getElementById("drawer").classList.contains("open"),
      topInert: document.querySelector(".top").inert,
      title: document.getElementById("drTitle").textContent
    })`),
    {
      hidden: "false",
      open: true,
      topInert: true,
      title: "feature/checkout-redesign",
    },
  );

  await evaluate(`(() => {
    const drawer = document.getElementById("drawer");
    const focusable = [...drawer.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )].filter(element => element.getClientRects().length > 0);
    focusable.at(-1).focus();
  })()`);
  await press("Tab", "Tab");
  assert.equal(
    await evaluate("document.activeElement.id"),
    "drawerClose",
    "drawer focus should wrap from the final control to the close button",
  );
  await press("Escape", "Escape");
  assert.deepEqual(
    await evaluate(`({
      hidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      topInert: document.querySelector(".top").inert,
      focus: document.activeElement.id
    })`),
    { hidden: "true", topInert: false, focus: "jump" },
    "Escape should close the drawer, restore interactivity, and return focus",
  );

  await evaluate(`(() => {
    const opener = document.getElementById("registerOpen");
    opener.focus();
    opener.click();
  })()`);
  await waitFor(
    `document.activeElement.id === "worktreePath"`,
    "registration should focus its blank worktree path",
  );
  assert.deepEqual(
    await evaluate(`({
      hidden: document.getElementById("registerModal").getAttribute("aria-hidden"),
      path: document.getElementById("worktreePath").value,
      manifest: document.getElementById("manifestPath").value,
      topInert: document.querySelector(".top").inert
    })`),
    {
      hidden: "false",
      path: "",
      manifest: ".port-start.yaml",
      topInert: true,
    },
  );
  await evaluate(`(() => {
    const modal = document.getElementById("registerModal");
    const focusable = [...modal.querySelectorAll(
      "button:not([disabled]), input:not([disabled])"
    )].filter(element => element.getClientRects().length > 0);
    focusable.at(-1).focus();
  })()`);
  await press("Tab", "Tab");
  assert.equal(
    await evaluate("document.activeElement.id"),
    "registerClose",
    "registration focus should wrap to its close button",
  );

  await evaluate(`(() => {
    document.getElementById("worktreePath").value = "/tmp/agent/saffron-puma";
    document.getElementById("registerForm").requestSubmit();
  })()`);
  await waitFor(
    `document.querySelectorAll(".wt-tile").length === 7`,
    "registering a worktree should add it to the dashboard",
  );
  assert.equal(
    await evaluate(
      `document.querySelector(".wt-tile .branch").textContent === "saffron-puma"`,
    ),
    true,
  );

  await evaluate(`(() => {
    const tile = document.querySelector(".wt-tile");
    tile.focus();
    tile.click();
  })()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the registered worktree should open",
  );
  await evaluate(`document.getElementById("deregisterWorktree").click()`);
  assert.equal(
    await evaluate("document.querySelectorAll('.wt-tile').length"),
    6,
    "deregistering should remove the worktree",
  );

  await evaluate(`document.querySelector('[data-open="wt2"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the stopped-process worktree should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="start"]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-proc="web"] .pill').textContent.trim()`,
    ),
    "starting",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running"`,
    "start should transition the process to running",
    2_000,
  );

  await evaluate(`document.querySelector('[data-tab="commands"]').click()`);
  await evaluate(
    `document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-cmd="test"] .pill').textContent.trim()`,
    ),
    "running",
  );
  await evaluate(
    `document.querySelector('[data-cmd="test"] [data-cmd-action="cancel"]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-cmd="test"] .pill').textContent.trim()`,
    ),
    "canceled",
  );

  await evaluate(`document.getElementById("drawerClose").click()`);
  await evaluate(`document.querySelector('[data-view-target="logs"]').click()`);
  assert.equal(
    await evaluate(
      `!document.querySelector('[data-view="logs"]').hidden && document.querySelectorAll(".run-row").length > 0`,
    ),
    true,
    "the global runs view should list process and command output",
  );
  await evaluate(`(() => {
    const input = document.getElementById("globalRunSearch");
    input.value = "vector-search";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(
      `document.querySelectorAll(".run-row").length === 2 && document.getElementById("globalLogTitle").textContent.includes("vector-search")`,
    ),
    true,
    "global logs should filter by worktree",
  );

  await evaluate(`document.querySelector('[data-view-target="admin"]').click()`);
  await evaluate(`document.getElementById("accessPreview").click()`);
  assert.equal(
    await evaluate("document.getElementById('accessBanner').hidden"),
    false,
    "Administration should preview the non-loopback exposure warning",
  );

  await evaluate(`document.querySelector('[data-state="empty"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      view: !document.querySelector('[data-view="worktrees"]').hidden,
      count: document.getElementById("worktreeCount").textContent,
      empty: document.getElementById("emptyState").textContent.includes("Nothing registered yet"),
      visibleCards: [...document.querySelectorAll(".wt-tile")].filter(card => card.getClientRects().length).length
    })`),
    { view: true, count: "0", empty: true, visibleCards: 0 },
    "the empty-state switch should tell one coherent zero-registration story",
  );

  console.log("Worktree, process, command, log, and focus behavior passed.");
} finally {
  cdp?.close();
  if (chrome.exitCode === null) {
    try {
      process.kill(-chrome.pid, "SIGKILL");
    } catch {
      chrome.kill("SIGKILL");
    }
  }
  await rm(userDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

process.exit(0);
