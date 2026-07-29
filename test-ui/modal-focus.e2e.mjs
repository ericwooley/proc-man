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
      modalHidden: document.getElementById("registerModal").getAttribute("aria-hidden"),
      deregisterModalHidden: document.getElementById("deregisterModal").getAttribute("aria-hidden"),
      exposedDecorativeIcons: document.querySelectorAll(".ph:not([aria-hidden='true'])").length,
      endpointTargetsLargeEnough: [...document.querySelectorAll(".endpoint-list .ep button")]
        .every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width >= 32 && rect.height >= 32;
        })
    })`),
    {
      title: "Port Start — Worktree process manager",
      cards: 6,
      drawerHidden: "true",
      drawerInert: true,
      modalHidden: "true",
      deregisterModalHidden: "true",
      exposedDecorativeIcons: 0,
      endpointTargetsLargeEnough: true,
    },
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
  await evaluate(`(() => {
    window.__openedPort = null;
    window.open = (url, target, features) => {
      window.__openedPort = { url, target, features };
      return null;
    };
  })()`);
  await press("Enter", "Enter");
  assert.deepEqual(
    await evaluate(`({
      opened: window.__openedPort,
      drawerHidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      toast: document.getElementById("toastText").textContent
    })`),
    {
      opened: {
        url: "http://127.0.0.1:4310/",
        target: "_blank",
        features: "noopener",
      },
      drawerHidden: "true",
      toast: "Opening http://127.0.0.1:4310/",
    },
    "Enter on an HTTP search result should open that endpoint directly",
  );

  await evaluate(`(() => {
    const input = document.getElementById("jump");
    input.value = "9310";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(
      `document.getElementById("jumpResults").textContent.includes("Copy →")`,
    ),
    true,
    "TCP search results should advertise a copy action",
  );
  await evaluate(`navigator.clipboard.writes.length = 0`);
  await evaluate(`document.querySelector("#jumpResults .jr-item").click()`);
  await waitFor(
    `navigator.clipboard.writes.length === 1`,
    "TCP search activation should reach the clipboard boundary",
  );
  assert.deepEqual(
    await evaluate(`({
      drawerHidden: document.getElementById("drawer").getAttribute("aria-hidden"),
      toast: document.getElementById("toastText").textContent,
      writes: navigator.clipboard.writes
    })`),
    {
      drawerHidden: "true",
      toast: "Copied to clipboard",
      writes: ["tcp://127.0.0.1:9310"],
    },
    "clicking a TCP search result should copy its address without opening the drawer",
  );
  await evaluate(`(() => {
    navigator.clipboard.writeText = value => {
      navigator.clipboard.writes.push(value);
      return Promise.reject(new Error("clipboard unavailable"));
    };
    const input = document.getElementById("jump");
    input.value = "9310";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#jumpResults .jr-item").click();
  })()`);
  await waitFor(
    `document.getElementById("toastText").textContent === "Couldn’t copy to clipboard"`,
    "clipboard failure should be reported instead of claiming success",
  );

  await evaluate(`document.querySelector('[data-open="wt1"]').click()`);
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
  assert.deepEqual(
    await evaluate(`(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      return {
        active: tabs.find(tab => tab.getAttribute("tabindex") === "0")?.dataset.tab,
        tabStops: tabs.filter(tab => tab.getAttribute("tabindex") === "0").length
      };
    })()`),
    { active: "endpoints", tabStops: 1 },
    "drawer tabs should expose one roving tab stop",
  );
  await evaluate(`document.querySelector('[data-tab="endpoints"]').focus()`);
  await press("ArrowRight", "ArrowRight");
  assert.deepEqual(
    await evaluate(`({
      focus: document.activeElement.dataset.tab,
      active: document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab
    })`),
    { focus: "processes", active: "processes" },
    "Right Arrow should move and activate the next drawer tab",
  );
  await press("End", "End");
  assert.equal(
    await evaluate(`document.activeElement.dataset.tab`),
    "logs",
    "End should move to the final drawer tab",
  );
  await press("Home", "Home");
  assert.equal(
    await evaluate(`document.activeElement.dataset.tab`),
    "endpoints",
    "Home should move to the first drawer tab",
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
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(
    await evaluate(`(() => {
      const drawer = document.getElementById("drawer");
      const frame = document.getElementById("appFrame");
      const drawerRect = drawer.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      return {
        visibility: getComputedStyle(drawer).visibility,
        notPainted:
          getComputedStyle(drawer).visibility === "hidden" ||
          drawerRect.left >= frameRect.right
      };
    })()`),
    { visibility: "hidden", notPainted: true },
    "the closed drawer should not remain painted over the desktop frame",
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
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      empty: document.querySelector('[data-pane="logs"]').textContent.includes(
        "Nothing has been run yet"
      ),
      targets: document.querySelectorAll(
        '[data-pane="logs"] [data-log-target]'
      ).length
    })`),
    { empty: true, targets: 0 },
    "a newly registered process should have no run history before its first start",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="start"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running"`,
    "the registered process should create a run before deregistration",
    2_000,
  );
  await evaluate(`document.getElementById("deregisterWorktree").click()`);
  await waitFor(
    `document.activeElement.id === "deregisterCancel"`,
    "deregistration confirmation should focus the safe action",
  );
  assert.deepEqual(
    await evaluate(`({
      confirmationOpen: document.getElementById("deregisterModal").getAttribute("aria-hidden"),
      stillRegistered: [...document.querySelectorAll(".wt-tile .branch")]
        .some(branch => branch.textContent === "saffron-puma"),
      branchNamed: document.getElementById("deregisterMessage").textContent.includes("saffron-puma"),
      activeCountNamed: document.getElementById("deregisterImpact").textContent.includes("1 active run"),
      retainedNamed: document.getElementById("deregisterImpact").textContent.includes("logs stay available"),
      focus: document.activeElement.id
    })`),
    {
      confirmationOpen: "false",
      stillRegistered: true,
      branchNamed: true,
      activeCountNamed: true,
      retainedNamed: true,
      focus: "deregisterCancel",
    },
    "deregistration should require an explicit consequence-aware confirmation",
  );
  await evaluate(`document.getElementById("deregisterConfirm").click()`);
  assert.equal(
    await evaluate("document.querySelectorAll('.wt-tile').length"),
    6,
    "deregistering should remove the worktree",
  );
  await evaluate(`document.querySelector('[data-view-target="logs"]').click()`);
  await evaluate(`(() => {
    const input = document.getElementById("globalRunSearch");
    input.value = "saffron-puma";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.deepEqual(
    await evaluate(`({
      retained:
        document.querySelectorAll(".run-row").length === 1 &&
        document.getElementById("globalLogTitle").textContent.includes("saffron-puma"),
      state: document.getElementById("globalLogState").textContent
    })`),
    { retained: true, state: "interrupted" },
    "deregistering should retain completed run history in Runs & logs",
  );
  await evaluate(`document.getElementById("globalRunSearch").value = ""`);
  await evaluate(`document.querySelector('[data-view-target="worktrees"]').click()`);

  await evaluate(`document.querySelector('[data-open="wt2"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the stopped-process worktree should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').click()`,
  );
  await evaluate(
    `document.querySelector('[data-proc="api"] [data-proc-action="restart"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      stoppedRestart: document.querySelector('[data-proc="web"] .pill').textContent.trim(),
      failedRestart: document.querySelector('[data-proc="api"] .pill').textContent.trim()
    })`),
    { stoppedRestart: "starting", failedRestart: "starting" },
    "restart from stopped or failed should create a new run without a stopping phase",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running" &&
     document.querySelector('[data-proc="api"] .pill').textContent.trim() === "running"`,
    "terminal-state restarts should finish their new runs",
    2_000,
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="stop"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "stopped"`,
    "the restarted web process should return to stopped for supersession coverage",
    2_000,
  );
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
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  assert.equal(
    await evaluate(`[
      ...document.querySelectorAll('[data-pane="logs"] [data-log-target]')
    ].find(button =>
      button.dataset.logTarget.startsWith("process:web:")
    )?.dataset.logState`),
    "interrupted",
    "a user-stopped process should retain an interrupted run result",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);

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
  const focusedRunId = await evaluate(`(() => {
    const row = [...document.querySelectorAll(".run-row")].find(candidate =>
      candidate.textContent.includes("fix/auth-race-condition") &&
      candidate.textContent.includes("process/web")
    );
    row.focus();
    return row.dataset.run;
  })()`);
  await waitFor(
    `[...document.querySelectorAll(".run-row")].find(candidate =>
      candidate.textContent.includes("fix/auth-race-condition") &&
      candidate.textContent.includes("process/web")
    )?.querySelector(".pill")?.textContent.trim() === "running"`,
    "global runs should refresh when an in-flight process finishes starting",
    2_000,
  );
  assert.equal(
    await evaluate("document.activeElement.dataset.run"),
    focusedRunId,
    "a live global-runs refresh should preserve the focused run row",
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
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  const selectedCommandLog = await evaluate(`(() => {
    const target = [...document.querySelectorAll(
      '[data-pane="logs"] [data-log-target]'
    )].find(button =>
      button.dataset.logTarget.startsWith("command:test:") &&
      button.dataset.logState === "running"
    );
    target.click();
    target.focus();
    return target.dataset.logTarget;
  })()`);
  await waitFor(
    `[...document.querySelectorAll('[data-pane="logs"] [data-log-target]')]
      .find(button => button.dataset.logTarget === ${JSON.stringify(selectedCommandLog)})
      ?.dataset.logState === "exited"`,
    "the selected command log should refresh when its run completes",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const pane = document.querySelector('[data-pane="logs"]');
      const selected = [...pane.querySelectorAll("[data-log-target]")]
        .find(button => button.dataset.logTarget === ${JSON.stringify(selectedCommandLog)});
      return {
        stored: pane.dataset.sel,
        selected: selected.classList.contains("on"),
        focused: document.activeElement.dataset.logTarget
      };
    })()`),
    {
      stored: selectedCommandLog,
      selected: true,
      focused: selectedCommandLog,
    },
    "command completion should preserve the selected and focused drawer log",
  );

  await evaluate(`document.getElementById("drawerClose").click()`);
  await evaluate(`document.querySelector('[data-open="wt1"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the pending-port worktree should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="api"] [data-proc-action="restart"]').click()`,
  );
  await evaluate(`document.getElementById("drawerClose").click()`);
  assert.deepEqual(
    await evaluate(`(() => {
      const tile = document.querySelector('[data-worktree="wt1"]');
      return {
        running: tile.querySelector(".tile-foot .pill").textContent.trim(),
        activePort: tile.textContent.includes("4311")
      };
    })()`),
    { running: "1/2 running", activePort: true },
    "the worktree card should reflect the stopping phase of a restart",
  );
  await waitFor(
    `(() => {
      const text = document.querySelector('[data-worktree="wt1"]').textContent;
      return text.includes("4321") && !text.includes("4311");
    })()`,
    "the worktree card should refresh when restart snapshots configured ports",
    1_100,
  );
  await waitFor(
    `document.querySelector('[data-worktree="wt1"] .tile-foot .pill').textContent.trim() === "2/2 running"`,
    "the worktree card should show restart completion",
    2_000,
  );
  await evaluate(`document.querySelector('[data-open="wt1"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the restarted worktree should reopen",
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
    input.value = "checkout-redesign";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll(".run-row")]
        .filter(row => row.textContent.includes("process/web")).length >= 2`,
    ),
    true,
    "global logs should expose current and historical process runs",
  );
  await evaluate(`(() => {
    const historical = [...document.querySelectorAll(".run-row")]
      .find(row =>
        row.textContent.includes("process/web") &&
        row.textContent.includes("#web-103")
      );
    historical.click();
    const input = document.querySelector("#globalLogConsole [data-log-search]");
    input.value = "received SIGTERM";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.deepEqual(
    await evaluate(`({
      selected: document.getElementById("globalLogTitle").textContent.includes("#web-103"),
      visibleLines: [...document.querySelectorAll(
        "#globalLogConsole [data-log-entry]"
      )].filter(line => !line.hidden).length,
      matchingText: [...document.querySelectorAll(
        "#globalLogConsole [data-log-entry]"
      )].filter(line => !line.hidden).every(
        line => line.textContent.includes("received SIGTERM")
      )
    })`),
    { selected: true, visibleLines: 1, matchingText: true },
    "historical process output should be searchable within the selected run",
  );
  await evaluate(`(() => {
    window.__downloadedLog = null;
    window.__downloadedBlob = null;
    URL.createObjectURL = blob => {
      window.__downloadedBlob = blob;
      return "blob:port-start-log";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function() {
      window.__downloadedLog = { download: this.download, href: this.href };
    };
    document.getElementById("globalLogDownload").click();
  })()`);
  assert.deepEqual(
    await evaluate(`(async () => {
      const text = await window.__downloadedBlob.text();
      const record = JSON.parse(text.trim().split("\\n")[0]);
      return {
        downloaded: Boolean(
          window.__downloadedLog?.download.endsWith(".ndjson") &&
          window.__downloadedLog?.href === "blob:port-start-log"
        ),
        nonempty: window.__downloadedBlob.size > 0,
        type: window.__downloadedBlob.type,
        fields: Object.keys(record).sort(),
        canonicalValues: Boolean(
          record.seq === 1 &&
          Number.isFinite(Date.parse(record.time)) &&
          ["stdout", "stderr"].includes(record.stream) &&
          typeof record.text === "string" &&
          record.partial === false
        )
      };
    })()`),
    {
      downloaded: true,
      nonempty: true,
      type: "application/x-ndjson",
      fields: ["partial", "seq", "stream", "text", "time"],
      canonicalValues: true,
    },
    "the selected historical run should download canonical nonempty NDJSON",
  );
  await evaluate(`(() => {
    const input = document.getElementById("globalRunSearch");
    input.value = "received SIGTERM";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.equal(
    await evaluate(`document.querySelectorAll(".run-row").length > 0`),
    true,
    "global Runs & logs search should find output content across runs",
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
  await evaluate(`(() => {
    const input = document.getElementById("globalRunSearch");
    input.value = "no-such-worktree-or-run";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  assert.deepEqual(
    await evaluate(`({
      rows: document.querySelectorAll(".run-row").length,
      title: document.getElementById("globalLogTitle").textContent,
      stateHidden: document.getElementById("globalLogState").hidden,
      emptyDetail: document.getElementById("globalLogConsole").textContent.includes("Change the filter")
    })`),
    {
      rows: 0,
      title: "No matching run",
      stateHidden: true,
      emptyDetail: true,
    },
    "a zero-match filter should clear stale run details",
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
