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

  async function activateFocusedButton() {
    await cdp.call("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdp.call("Input.dispatchKeyEvent", {
      type: "char",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdp.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
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
      drawerInert: document.getElementById("drawer").inert,
      modalHidden: document.getElementById("registerModal").getAttribute("aria-hidden")
    })`),
    {
      title: "Port Start — Worktree process manager",
      cards: 6,
      drawerHidden: "true",
      drawerInert: true,
      modalHidden: "true",
    },
  );

  await evaluate(`(() => {
    const endpointCopy = document.querySelector(".wt-tile [data-copy]");
    endpointCopy.focus();
  })()`);
  await activateFocusedButton();
  assert.deepEqual(
    await evaluate(`({
      drawerHidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      toast: document.getElementById("toastText").textContent
    })`),
    { drawerHidden: "true", toast: "Copied to clipboard" },
    "keyboard activation of an endpoint should not open the worktree drawer",
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
      inert: document.getElementById("drawer").inert,
      topInert: document.querySelector(".top").inert,
      focus: document.activeElement.id
    })`),
    { hidden: "true", inert: true, topInert: false, focus: "jump" },
    "Escape should close the drawer, restore interactivity, and return focus",
  );
  assert.equal(
    await evaluate(`(() => {
      document.getElementById("drawerClose").focus();
      return document.activeElement.id;
    })()`),
    "jump",
    "closed drawer controls should remain outside the focus sequence",
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
    const opener = document.getElementById("registerOpen");
    opener.focus();
    opener.click();
  })()`);
  await waitFor(
    `document.activeElement.id === "worktreePath"`,
    "re-registration should open the registration dialog",
  );
  await evaluate(`(() => {
    document.getElementById("worktreePath").value = "/tmp/agent/saffron-puma/";
    document.getElementById("registerForm").requestSubmit();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      cards: document.querySelectorAll(".wt-tile").length,
      matches: [...document.querySelectorAll(".wt-tile .branch")]
        .filter(branch => branch.textContent === "saffron-puma").length
    })`),
    { cards: 7, matches: 1 },
    "re-registering a normalized worktree path should reconcile one registration",
  );

  await evaluate(`(() => {
    const opener = document.getElementById("registerOpen");
    opener.focus();
    opener.click();
  })()`);
  await waitFor(
    `document.activeElement.id === "worktreePath"`,
    "manifest reconciliation should open the registration dialog",
  );
  await evaluate(`(() => {
    document.getElementById("worktreePath").value = "/tmp/agent/saffron-puma";
    document.getElementById("manifestPath").value = "config/alternate.yaml";
    document.getElementById("registerForm").requestSubmit();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      cards: document.querySelectorAll(".wt-tile").length,
      matches: [...document.querySelectorAll(".wt-tile .branch")]
        .filter(branch => branch.textContent === "saffron-puma").length
    })`),
    { cards: 7, matches: 1 },
    "re-registering a worktree with a new manifest should update one registration",
  );

  await evaluate(`(() => {
    const opener = document.querySelector(".wt-tile [data-open]");
    opener.focus();
    opener.click();
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
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="stop"]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-proc="web"] .pill').textContent.trim()`,
    ),
    "stopping",
    "a newer stop should supersede an in-flight start",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "stopped"`,
    "the superseding stop should transition the process to stopped",
    2_000,
  );
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(
    await evaluate(
      `document.querySelector('[data-proc="web"] .pill').textContent.trim()`,
    ),
    "stopped",
    "an older start timer should not overwrite the newer stop result",
  );

  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="start"]').click()`,
  );
  await evaluate(`document.querySelector('[data-view-target="logs"]').click()`);
  assert.equal(
    await evaluate(`(() => {
      const row = [...document.querySelectorAll(".run-row")].find(candidate =>
        candidate.textContent.includes("fix/auth-race-condition") &&
        candidate.textContent.includes("process/web")
      );
      return row?.querySelector(".pill")?.textContent.trim();
    })()`),
    "starting",
    "global runs should show an in-flight process on view entry",
  );
  await waitFor(
    `[...document.querySelectorAll(".run-row")].find(candidate =>
      candidate.textContent.includes("fix/auth-race-condition") &&
      candidate.textContent.includes("process/web")
    )?.querySelector(".pill")?.textContent.trim() === "running"`,
    "global runs should refresh when an in-flight process finishes starting",
    2_000,
  );

  await evaluate(`document.querySelector('[data-view-target="worktrees"]').click()`);
  await evaluate(`document.querySelector('[data-open="wt2"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the command worktree should reopen after checking global runs",
  );
  await evaluate(`document.querySelector('[data-tab="commands"]').click()`);
  await evaluate(
    `document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').click()`,
  );
  await evaluate(
    `document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      running: document.querySelectorAll('[data-cmd="test"] [data-command-run] .pill.running').length,
      runDisabled: document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').disabled
    })`),
    { running: 2, runDisabled: false },
    "one-shot command invocations should overlap independently",
  );
  await evaluate(
    `document.querySelector('[data-cmd="test"] [data-command-run] [data-cmd-action="cancel"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      canceled: document.querySelectorAll('[data-cmd="test"] [data-command-run] .pill.canceled').length,
      running: document.querySelectorAll('[data-cmd="test"] [data-command-run] .pill.running').length
    })`),
    { canceled: 1, running: 1 },
    "cancel should target one active command invocation",
  );

  await evaluate(`document.getElementById("drawerClose").click()`);
  await evaluate(`document.querySelector('[data-open="wt1"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the pending-port worktree should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="api"] [data-proc-action="stop"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="api"] .pill').textContent.trim() === "stopped"`,
    "stop should move the API to its configured definition",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const text = document.querySelector('[data-proc="api"]').textContent;
      return {
        configured: text.includes("4321"),
        oldActive: text.includes("4311"),
        pending: text.includes("Next start")
      };
    })()`),
    { configured: true, oldActive: false, pending: false },
    "a stopped process should expose only its configured ports",
  );
  await evaluate(
    `document.querySelector('[data-proc="api"] [data-proc-action="start"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const text = document.querySelector('[data-proc="api"]').textContent;
      return {
        state: document.querySelector('[data-proc="api"] .pill').textContent.trim(),
        configured: text.includes("4321"),
        pending: text.includes("Next start")
      };
    })()`),
    { state: "starting", configured: true, pending: false },
    "a new run should snapshot the configured ports as its active ports",
  );
  await waitFor(
    `document.querySelector('[data-proc="api"] .pill').textContent.trim() === "running"`,
    "the API should finish starting with its configured port snapshot",
    2_000,
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
