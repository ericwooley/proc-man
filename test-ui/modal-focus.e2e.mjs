import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectCdp } from "./cdp-client.mjs";

const chromeBinary = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const prototypeUrl = new URL("../prototype/index.html", import.meta.url).href;
const logoShowcaseUrl = new URL(
  "../prototype/logo-showcase.html",
  import.meta.url,
).href;

function cssColorToRgb(value) {
  const numbers = value.match(/\d*\.?\d+/g)?.map(Number) ?? [];
  if (value.startsWith("color(srgb") && numbers.length >= 3) {
    return numbers.slice(0, 3).map(channel => channel * 255);
  }
  if (value.startsWith("rgb") && numbers.length >= 3) {
    return numbers.slice(0, 3);
  }
  throw new Error(`Unsupported computed color: ${value}`);
}

function relativeLuminance(color) {
  return cssColorToRgb(color)
    .map(channel => channel / 255)
    .map(channel =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    )
    .reduce(
      (luminance, channel, index) =>
        luminance + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  async function activeFocusIndicator() {
    return evaluate(`(() => {
      const style = getComputedStyle(document.activeElement);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
        offset: style.outlineOffset,
        color: style.outlineColor
      };
    })()`);
  }

  async function registerAndOpenWorktree(path) {
    const branch = path.split("/").filter(Boolean).at(-1);
    await evaluate(`document.getElementById("registerOpen").click()`);
    await waitFor(
      `document.activeElement.id === "worktreePath"`,
      `registration should open for ${branch}`,
    );
    await evaluate(`(() => {
      document.getElementById("worktreePath").value = ${JSON.stringify(path)};
      document.getElementById("registerForm").requestSubmit();
    })()`);
    await waitFor(
      `[...document.querySelectorAll(".wt-tile .branch")]
        .some(element => element.textContent === ${JSON.stringify(branch)})`,
      `${branch} should register`,
    );
    await evaluate(`(() => {
      const branch = [...document.querySelectorAll(".wt-tile .branch")]
        .find(element => element.textContent === ${JSON.stringify(branch)});
      branch.closest(".wt-tile").querySelector("[data-open]").click();
    })()`);
    await waitFor(
      `document.activeElement.id === "drawerClose"`,
      `${branch} should open`,
    );
    await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
    return branch;
  }

  async function deregisterOpenWorktree() {
    await evaluate(`document.getElementById("deregisterWorktree").click()`);
    await waitFor(
      `document.activeElement.id === "deregisterCancel"`,
      "deregistration confirmation should open",
    );
    await evaluate(`document.getElementById("deregisterConfirm").click()`);
  }

  async function assertRetainedRunState(branch, expectedState) {
    await evaluate(`(() => {
      document.querySelector('[data-view-target="logs"]').click();
      const input = document.getElementById("globalRunSearch");
      input.value = ${JSON.stringify(branch)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await waitFor(
      `document.querySelectorAll(".run-row").length === 1 &&
       document.getElementById("globalLogTitle").textContent.includes(${JSON.stringify(branch)})`,
      `${branch} retained run should be discoverable`,
    );
    assert.equal(
      await evaluate(`document.getElementById("globalLogState").textContent`),
      expectedState,
      `${branch} should retain its ${expectedState} run`,
    );
    await evaluate(`(() => {
      const input = document.getElementById("globalRunSearch");
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('[data-view-target="worktrees"]').click();
    })()`);
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
  await evaluate(`document.documentElement.dataset.theme = "light"`);
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
  assert.deepEqual(
    await evaluate(`(() => {
      const badgeState = worktreeId => {
        const badge = document.querySelector(
          '[data-worktree="' + worktreeId + '"] .tile-foot .pill'
        );
        return ["running", "mixed", "stopped"].find(state =>
          badge.classList.contains(state)
        );
      };
      return {
        fullyRunning: badgeState("wt1"),
        partiallyRunning: badgeState("wt3"),
        stopped: badgeState("wt2")
      };
    })()`),
    {
      fullyRunning: "running",
      partiallyRunning: "mixed",
      stopped: "stopped",
    },
    "worktree badges should distinguish fully running, partial, and stopped states",
  );
  await evaluate(`document.querySelector('[data-state="empty"]').click()`);
  await waitFor(
    `Boolean(document.querySelector(".snippet button"))`,
    "empty state should expose its registration snippet",
  );
  await press("Tab", "Tab");
  const darkSurfaceFocusSamples = await evaluate(`(() => {
    const sample = (control, surface) => {
      control.focus();
      return {
        focus: getComputedStyle(control).outlineColor,
        surface: getComputedStyle(surface).backgroundColor
      };
    };
    return [
      sample(
        document.querySelector('.proto-bar [data-state="populated"]'),
        document.querySelector(".proto-bar")
      ),
      sample(
        document.querySelector(".snippet button"),
        document.querySelector(".snippet")
      )
    ];
  })()`);
  assert.equal(
    darkSurfaceFocusSamples.every(
      sample => contrastRatio(sample.focus, sample.surface) >= 3,
    ),
    true,
    "dark-surface controls should use a focus indicator with at least 3:1 contrast",
  );
  await evaluate(`document.querySelector('[data-state="populated"]').click()`);
  await waitFor(
    `document.querySelectorAll(".wt-tile").length === 6`,
    "populated state should return after focus contrast checks",
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
  assert.deepEqual(
    await evaluate(`(() => {
      const input = document.getElementById("jump");
      const listbox = document.getElementById("jumpResults");
      const active = document.getElementById(input.getAttribute("aria-activedescendant"));
      return {
        role: input.getAttribute("role"),
        expanded: input.getAttribute("aria-expanded"),
        controls: input.getAttribute("aria-controls"),
        listboxRole: listbox.getAttribute("role"),
        activeRole: active?.getAttribute("role"),
        activeSelected: active?.getAttribute("aria-selected")
      };
    })()`),
    {
      role: "combobox",
      expanded: "true",
      controls: "jumpResults",
      listboxRole: "listbox",
      activeRole: "option",
      activeSelected: "true",
    },
    "jump search should expose its active result through combobox semantics",
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
  assert.deepEqual(
    await evaluate(`({
      expanded: document.getElementById("jump").getAttribute("aria-expanded"),
      active: document.getElementById("jump").hasAttribute("aria-activedescendant")
    })`),
    { expanded: "false", active: false },
    "closing jump results should clear expanded and active-descendant state",
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
  const prototypeStatePoint = await evaluate(`(() => {
    const button = document.querySelector('.proto-bar [data-state="empty"]');
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: prototypeStatePoint.x,
    y: prototypeStatePoint.y,
    button: "left",
    clickCount: 1,
  });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: prototypeStatePoint.x,
    y: prototypeStatePoint.y,
    button: "left",
    clickCount: 1,
  });
  assert.deepEqual(
    await evaluate(`({
      prototypeBarInert: document.querySelector(".proto-bar").inert,
      prototypeBarPointerEvents: getComputedStyle(
        document.querySelector(".proto-bar")
      ).pointerEvents,
      drawerOpen: document.getElementById("drawer").classList.contains("open"),
      populatedState: document.querySelector(
        '.proto-bar [data-state="populated"]'
      ).classList.contains("on")
    })`),
    {
      prototypeBarInert: true,
      prototypeBarPointerEvents: "none",
      drawerOpen: true,
      populatedState: true,
    },
    "prototype state controls should not escape an open modal surface",
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
  await press("ArrowLeft", "ArrowLeft");
  assert.equal(
    await evaluate(`document.activeElement.dataset.tab`),
    "logs",
    "Left Arrow should wrap to the previous drawer tab",
  );
  await press("Home", "Home");

  await evaluate(`(() => {
    const drawer = document.getElementById("drawer");
    const focusable = [...drawer.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )].filter(element =>
      element.tabIndex >= 0 && element.getClientRects().length > 0
    );
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
  await evaluate(`document.querySelector('[data-tab="endpoints"]').focus()`);
  await press("Tab", "Tab");
  assert.equal(
    await evaluate(`document.activeElement.id`),
    "drawerClose",
    "Tab from the active roving tab should wrap within a control-free drawer panel",
  );
  await press("Tab", "Tab", 8);
  assert.equal(
    await evaluate(`document.activeElement.dataset.tab`),
    "endpoints",
    "Shift+Tab from the close button should reverse-wrap to the active drawer tab",
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
    `document.querySelector('[data-proc="web"] [data-proc-action="start"]').focus()`,
  );
  const processActionFocusIndicator = await activeFocusIndicator();
  const adjacentFocusSurfaces = await evaluate(`({
    card: getComputedStyle(document.querySelector(".proc-item")).backgroundColor,
    drawer: getComputedStyle(document.getElementById("drawer")).backgroundColor,
    shell: getComputedStyle(document.getElementById("appFrame")).backgroundColor
  })`);
  const opaqueFocusSurfaces = Object.values(adjacentFocusSurfaces)
    .filter(color => color !== "rgba(0, 0, 0, 0)");
  assert.equal(
    opaqueFocusSurfaces.every(
      surface => contrastRatio(processActionFocusIndicator.color, surface) >= 3,
    ),
    true,
    "the light-theme focus indicator should have at least 3:1 contrast against adjacent surfaces",
  );
  assert.deepEqual(
    {
      width: processActionFocusIndicator.width,
      style: processActionFocusIndicator.style,
      offset: processActionFocusIndicator.offset,
    },
    { width: "3px", style: "solid", offset: "2px" },
    "the process action should use the authored high-contrast focus indicator",
  );
  await activateFocusedButton();
  assert.deepEqual(
    {
      process: await evaluate(`document.activeElement.dataset.proc`),
      indicator: await activeFocusIndicator(),
    },
    {
      process: "web",
      indicator: processActionFocusIndicator,
    },
    "Start should keep the authored focus indicator on its process fallback",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running"`,
    "the registered process should create a run before deregistration",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`({
      focus: document.activeElement.dataset.proc,
      announcement: document.getElementById("actionStatus").textContent
    })`),
    { focus: "web", announcement: "Process web is running." },
    "Start completion should preserve process focus and announce the settled state",
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

  const startRaceBranch = await registerAndOpenWorktree(
    "/tmp/agent/start-deregister-race",
  );
  await evaluate(
    `document.getElementById("actionStatus").textContent = "No stale process completion"`,
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="start"]').click()`,
  );
  await deregisterOpenWorktree();
  const startDeregistrationOutcome = await evaluate(`({
    announcement: document.getElementById("actionStatus").textContent,
    toast: document.getElementById("toastText").textContent
  })`);
  await new Promise(resolve => setTimeout(resolve, 1_250));
  assert.deepEqual(
    await evaluate(`({
      announcement: document.getElementById("actionStatus").textContent,
      toast: document.getElementById("toastText").textContent,
      registered: [...document.querySelectorAll(".wt-tile .branch")]
        .some(element => element.textContent === ${JSON.stringify(startRaceBranch)})
    })`),
    {
      ...startDeregistrationOutcome,
      registered: false,
    },
    "deregistration should invalidate an in-flight process Start",
  );
  await assertRetainedRunState(startRaceBranch, "interrupted");

  const restartRaceBranch = await registerAndOpenWorktree(
    "/tmp/agent/restart-deregister-race",
  );
  await evaluate(
    `document.getElementById("actionStatus").textContent = "No stale restart completion"`,
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').click()`,
  );
  await deregisterOpenWorktree();
  const restartDeregistrationOutcome = await evaluate(`({
    announcement: document.getElementById("actionStatus").textContent,
    toast: document.getElementById("toastText").textContent
  })`);
  await new Promise(resolve => setTimeout(resolve, 1_250));
  assert.deepEqual(
    await evaluate(`({
      announcement: document.getElementById("actionStatus").textContent,
      toast: document.getElementById("toastText").textContent,
      registered: [...document.querySelectorAll(".wt-tile .branch")]
        .some(element => element.textContent === ${JSON.stringify(restartRaceBranch)})
    })`),
    {
      ...restartDeregistrationOutcome,
      registered: false,
    },
    "deregistration should invalidate an in-flight process Restart",
  );
  await assertRetainedRunState(restartRaceBranch, "interrupted");

  const bulkRaceBranch = await registerAndOpenWorktree(
    "/tmp/agent/start-all-deregister-race",
  );
  await evaluate(
    `document.getElementById("actionStatus").textContent = "No stale aggregate completion"`,
  );
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="start-all"]').click()`,
  );
  await deregisterOpenWorktree();
  const bulkDeregistrationOutcome = await evaluate(`({
    announcement: document.getElementById("actionStatus").textContent,
    toast: document.getElementById("toastText").textContent
  })`);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.deepEqual(
    await evaluate(`({
      announcement: document.getElementById("actionStatus").textContent,
      toast: document.getElementById("toastText").textContent,
      registered: [...document.querySelectorAll(".wt-tile .branch")]
        .some(element => element.textContent === ${JSON.stringify(bulkRaceBranch)})
    })`),
    {
      ...bulkDeregistrationOutcome,
      registered: false,
    },
    "deregistration should invalidate in-flight process and Start-all callbacks",
  );
  await assertRetainedRunState(bulkRaceBranch, "interrupted");

  await evaluate(`document.querySelector('[data-open="wt2"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the stopped-process worktree should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      startAll: Boolean(document.querySelector('[data-bulk-proc-action="start-all"]')),
      stopAll: Boolean(document.querySelector('[data-bulk-proc-action="stop-all"]'))
    })`),
    { startAll: true, stopAll: true },
    "the process pane should expose worktree-wide lifecycle controls",
  );
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="start-all"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running" &&
     document.querySelector('[data-proc="api"] .pill').textContent.trim() === "running" &&
     document.querySelector('[data-proc="worker"] .pill').textContent.trim() === "failed" &&
     document.querySelector("[data-bulk-result]").textContent.includes("2 started, 1 failed")`,
    "Start All should settle every process independently",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const result = document.querySelector("[data-bulk-result]");
      return {
        partial: result.textContent.includes("2 started, 1 failed"),
        web: result.textContent.includes("web"),
        api: result.textContent.includes("api"),
        worker: result.textContent.includes("worker")
      };
    })()`),
    { partial: true, web: true, api: true, worker: true },
    "Start All should preserve per-process results when one launch fails",
  );
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="start-all"]').click()`,
  );
  await waitFor(
    `document.querySelector("[data-bulk-result]").textContent.includes("0 started, 1 failed")`,
    "Start All should preserve no-op outcomes for already active processes",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const result = document.querySelector("[data-bulk-result]").textContent;
      return {
        webAlreadyActive: result.includes("web — already active (running)"),
        apiAlreadyActive: result.includes("api — already active (running)"),
        workerFailed: result.includes("worker — launch failed")
      };
    })()`),
    { webAlreadyActive: true, apiAlreadyActive: true, workerFailed: true },
    "Start All should not label already-running processes as newly started",
  );
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="stop-all"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "stopped" &&
     document.querySelector('[data-proc="api"] .pill').textContent.trim() === "stopped" &&
     document.querySelector("[data-bulk-result]").textContent.includes("3 results")`,
    "Stop All should settle active processes concurrently",
    2_000,
  );
  assert.equal(
    await evaluate(
      `document.querySelector("[data-bulk-result]").textContent.includes("3 results")`,
    ),
    true,
    "Stop All should report an outcome for every process",
  );
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="start-all"]').click()`,
  );
  await new Promise(resolve => setTimeout(resolve, 50));
  await evaluate(
    `document.querySelector('[data-bulk-proc-action="stop-all"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "stopped" &&
     document.querySelector('[data-proc="api"] .pill').textContent.trim() === "stopped" &&
     document.querySelector('[data-proc="worker"] .pill').textContent.trim() === "stopped" &&
     document.querySelector("[data-bulk-result]").textContent.includes("Stop all complete")`,
    "a newer Stop All should supersede an in-flight Start All batch",
    2_000,
  );
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(
    await evaluate(`({
      summary: document.querySelector("[data-bulk-result] strong").textContent,
      toast: document.getElementById("toastText").textContent
    })`),
    { summary: "Stop all complete · 3 results", toast: "Stop all complete" },
    "an older Start All timer should not overwrite the newer Stop All result",
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').focus()`,
  );
  await activateFocusedButton();
  assert.deepEqual(
    await evaluate(`({
      state: document.querySelector('[data-proc="web"] .pill').textContent.trim(),
      focusAction: document.activeElement.dataset.procAction
    })`),
    { state: "starting", focusAction: "restart" },
    "Restart should preserve focus on the stable Restart action",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running"`,
    "a stopped process should finish restarting",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`({
      focusAction: document.activeElement.dataset.procAction,
      announcement: document.getElementById("actionStatus").textContent
    })`),
    {
      focusAction: "restart",
      announcement: "Process web restarted and is running.",
    },
    "Restart completion should retain focus and announce its outcome",
  );
  await evaluate(
    `document.querySelector('[data-proc="worker"] [data-proc-action="restart"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="worker"] .pill').textContent.trim() === "failed"`,
    "a failed process should retain its launch result after Restart",
    2_000,
  );
  assert.equal(
    await evaluate(`document.getElementById("actionStatus").textContent`),
    "Process worker failed to restart.",
    "Restart launch failure should be announced",
  );
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  const processRunCountBeforeStoppingRestart = await evaluate(
    `document.querySelectorAll(
      '[data-pane="logs"] [data-log-target^="process:web:"]'
    ).length`,
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="stop"]').click()`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').disabled`,
    ),
    false,
    "Restart should remain available while Stop is in progress",
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').click()`,
  );
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="restart"]').click()`,
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "running"`,
    "Restart from stopping should coalesce and create one replacement run",
    2_000,
  );
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  assert.equal(
    await evaluate(
      `document.querySelectorAll(
        '[data-pane="logs"] [data-log-target^="process:web:"]'
      ).length`,
    ),
    processRunCountBeforeStoppingRestart + 1,
    "repeated Restart requests while stopping should create one replacement run",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  await evaluate(
    `document.querySelector('[data-proc="web"] [data-proc-action="stop"]').focus()`,
  );
  const stopActionFocusIndicator = await activeFocusIndicator();
  await activateFocusedButton();
  assert.deepEqual(
    {
      process: await evaluate(`document.activeElement.dataset.proc`),
      indicator: await activeFocusIndicator(),
    },
    {
      process: "web",
      indicator: stopActionFocusIndicator,
    },
    "Stop should keep the authored focus indicator on its process fallback",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-worktree="wt2"] .tile-foot .pill').classList.contains("mixed")`,
    ),
    true,
    "a worktree should remain transitional while its final active process is stopping",
  );
  await waitFor(
    `document.querySelector('[data-proc="web"] .pill').textContent.trim() === "stopped"`,
    "the restarted web process should return to stopped for supersession coverage",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`({
      focus: document.activeElement.dataset.proc,
      announcement: document.getElementById("actionStatus").textContent
    })`),
    { focus: "web", announcement: "Process web stopped." },
    "Stop completion should preserve process focus and announce the settled state",
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
    `document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').focus()`,
  );
  await activateFocusedButton();
  assert.equal(
    await evaluate(`document.activeElement.dataset.cmdAction`),
    "run",
    "Run should preserve focus on the stable command action",
  );
  await waitFor(
    `document.querySelector('[data-cmd="test"] [data-command-run] .pill').textContent.trim() === "succeeded"`,
    "the focused command invocation should complete",
    2_000,
  );
  assert.deepEqual(
    await evaluate(`({
      focusAction: document.activeElement.dataset.cmdAction,
      announcement: document.getElementById("actionStatus").textContent
    })`),
    {
      focusAction: "run",
      announcement: "Command test completed with exit code 0.",
    },
    "Run completion should retain focus and announce its exit result",
  );
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
  const canceledRunId = await evaluate(`(() => {
    const cancel = document.querySelector(
      '[data-cmd="test"] [data-command-run] [data-cmd-action="cancel"]'
    );
    cancel.focus();
    return cancel.dataset.runId;
  })()`);
  const cancelActionFocusIndicator = await activeFocusIndicator();
  await activateFocusedButton();
  assert.deepEqual(
    await evaluate(`({
      canceled: document.querySelectorAll('[data-cmd="test"] [data-command-run] .pill.canceled').length,
      running: document.querySelectorAll('[data-cmd="test"] [data-command-run] .pill.running').length,
      focusRun: document.activeElement.dataset.commandRun,
      focusIndicator: (() => {
        const style = getComputedStyle(document.activeElement);
        return {
          width: style.outlineWidth,
          style: style.outlineStyle,
          offset: style.outlineOffset,
          color: style.outlineColor
        };
      })(),
      announcement: document.getElementById("actionStatus").textContent
    })`),
    {
      canceled: 1,
      running: 1,
      focusRun: canceledRunId,
      focusIndicator: cancelActionFocusIndicator,
      announcement: `Command test run ${canceledRunId} canceled.`,
    },
    "Cancel should retain its authored focus indicator and announce the outcome",
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
        pressed: selected.getAttribute("aria-pressed"),
        otherPressed: [...pane.querySelectorAll("[data-log-target]")]
          .filter(button => button !== selected)
          .some(button => button.getAttribute("aria-pressed") === "true"),
        focused: document.activeElement.dataset.logTarget
      };
    })()`),
    {
      stored: selectedCommandLog,
      selected: true,
      pressed: "true",
      otherPressed: false,
      focused: selectedCommandLog,
    },
    "command completion should preserve the selected and focused drawer log",
  );
  assert.deepEqual(
    await evaluate(`({
      commandOutput: document.getElementById("logConsole").textContent.includes("test suite passed"),
      unrelatedStopOutput: document.getElementById("logConsole").textContent.includes("received SIGTERM")
    })`),
    { commandOutput: true, unrelatedStopOutput: false },
    "a successful command should show command-specific output",
  );

  await evaluate(`document.getElementById("drawerClose").click()`);
  await evaluate(`document.querySelector('[data-view-target="logs"]').click()`);
  await evaluate(`(() => {
    const runId = ${JSON.stringify(selectedCommandLog.split(":").at(-1))};
    const row = [...document.querySelectorAll(".run-row")]
      .find(candidate => candidate.dataset.run.endsWith(":" + runId));
    row.click();
    window.__commandDownloadBlob = null;
    URL.createObjectURL = blob => {
      window.__commandDownloadBlob = blob;
      return "blob:command-log";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    document.getElementById("globalLogDownload").click();
  })()`);
  assert.deepEqual(
    await evaluate(`(async () => {
      const records = (await window.__commandDownloadBlob.text())
        .trim()
        .split("\\n")
        .map(JSON.parse);
      return {
        commandOutput: records.some(record => record.text.includes("test suite passed")),
        unrelatedStopOutput: records.some(record => record.text.includes("received SIGTERM"))
      };
    })()`),
    { commandOutput: true, unrelatedStopOutput: false },
    "a successful command download should contain that command's output",
  );
  await evaluate(`document.querySelector('[data-view-target="worktrees"]').click()`);
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
      pressed: [...document.querySelectorAll(".run-row")]
        .find(row => row.textContent.includes("#web-103"))
        ?.getAttribute("aria-pressed"),
      pressedCount: [...document.querySelectorAll(".run-row")]
        .filter(row => row.getAttribute("aria-pressed") === "true").length,
      visibleLines: [...document.querySelectorAll(
        "#globalLogConsole [data-log-entry]"
      )].filter(line => !line.hidden).length,
      matchingText: [...document.querySelectorAll(
        "#globalLogConsole [data-log-entry]"
      )].filter(line => !line.hidden).every(
        line => line.textContent.includes("received SIGTERM")
      )
    })`),
    {
      selected: true,
      pressed: "true",
      pressedCount: 1,
      visibleLines: 1,
      matchingText: true,
    },
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

  await evaluate(`document.querySelector('[data-view-target="worktrees"]').click()`);
  await evaluate(`document.querySelector('[data-open="wt4"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the missing-worktree fixture should open",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      worktreeMessage: document.querySelector('[data-pane="processes"]').textContent.includes("folder can’t be found") ||
        document.querySelector('[data-pane="processes"]').textContent.includes("folder can't be found"),
      processState: document.querySelector('[data-proc="web"] .pill').textContent.trim(),
      startAllDisabled: document.querySelector('[data-bulk-proc-action="start-all"]').disabled
    })`),
    { worktreeMessage: true, processState: "stale", startAllDisabled: true },
    "a missing worktree should project its process as stale and block new starts",
  );
  await evaluate(`document.querySelector('[data-tab="commands"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      worktreeMessage: document.querySelector('[data-pane="commands"]').textContent.includes("folder can’t be found") ||
        document.querySelector('[data-pane="commands"]').textContent.includes("folder can't be found"),
      runDisabled: document.querySelector('[data-cmd="test"] [data-cmd-action="run"]').disabled
    })`),
    { worktreeMessage: true, runDisabled: true },
    "a missing worktree should block new associated command runs",
  );
  await evaluate(`document.getElementById("drawerClose").click()`);

  await evaluate(`document.getElementById("registerOpen").click()`);
  await waitFor(
    `document.activeElement.id === "worktreePath"`,
    "missing-worktree recovery should open the registration dialog",
  );
  await evaluate(`(() => {
    document.getElementById("worktreePath").value =
      "~/code/storefront/.worktrees/upgrade-deps";
    document.getElementById("registerForm").requestSubmit();
  })()`);
  await evaluate(`document.querySelector('[data-open="wt4"]').click()`);
  await waitFor(
    `document.activeElement.id === "drawerClose"`,
    "the returned worktree should open after re-registration",
  );
  await evaluate(`document.querySelector('[data-tab="processes"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      missingBanner: Boolean(document.querySelector(".banner.warn")),
      processState: document.querySelector('[data-proc="web"] .pill').textContent.trim(),
      startDisabled: document.querySelector(
        '[data-proc="web"] [data-proc-action="start"]'
      ).disabled
    })`),
    {
      missingBanner: false,
      processState: "stopped",
      startDisabled: false,
    },
    "re-registering a returned worktree should restore an operable stopped process",
  );
  await evaluate(`document.querySelector('[data-tab="logs"]').click()`);
  assert.equal(
    await evaluate(
      `document.querySelector(
        '[data-pane="logs"] [data-log-target^="process:web:"]'
      ).dataset.logState`,
    ),
    "interrupted",
    "re-registering a returned worktree should retain its interrupted run",
  );
  await evaluate(`document.getElementById("drawerClose").click()`);

  await evaluate(`document.querySelector('[data-view-target="admin"]').click()`);
  await evaluate(`document.getElementById("accessPreview").click()`);
  assert.equal(
    await evaluate("document.getElementById('accessBanner').hidden"),
    false,
    "Administration should preview the non-loopback exposure warning",
  );

  await evaluate(`document.querySelector('[data-state="loading"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      busy: document.getElementById("wtGrid").getAttribute("aria-busy"),
      status: document.getElementById("worktreeLoadingStatus").textContent
    })`),
    { busy: "true", status: "Loading worktrees" },
    "the loading grid should expose busy state and an accessible status",
  );
  await evaluate(`document.querySelector('[data-state="populated"]').click()`);
  assert.deepEqual(
    await evaluate(`({
      busy: document.getElementById("wtGrid").getAttribute("aria-busy"),
      status: document.getElementById("worktreeLoadingStatus").textContent
    })`),
    { busy: "false", status: "" },
    "leaving loading state should clear the busy announcement",
  );

  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`(() => {
    document.querySelector('[data-view-target="logs"]').click();
    const input = document.getElementById("globalRunSearch");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelectorAll(".run-row").length > 10`,
    "the narrow log view should render its complete run inventory",
  );
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll(".run-row")];
    rows.at(-1).scrollIntoView({ block: "nearest" });
    rows.at(-1).focus();
  })()`);
  await activateFocusedButton();
  assert.deepEqual(
    await evaluate(`(() => {
      const list = document.getElementById("globalRunList");
      const detail = document.querySelector(".global-log");
      const entry = document.querySelector(
        "#globalLogConsole [data-log-entry]"
      );
      const entryRect = entry.getBoundingClientRect();
      return {
        listBounded: list.clientHeight < list.scrollHeight,
        selectedFocused:
          document.activeElement.classList.contains("run-row") &&
          document.activeElement.getAttribute("aria-pressed") === "true",
        detailVisible:
          detail.getBoundingClientRect().top >= 0 &&
          detail.getBoundingClientRect().top < window.innerHeight,
        completeEntryVisible:
          entryRect.top >= 0 &&
          entryRect.bottom <= window.innerHeight
      };
    })()`),
    {
      listBounded: true,
      selectedFocused: true,
      detailVisible: true,
      completeEntryVisible: true,
    },
    "selecting a run on a narrow screen should reveal its output beside a bounded inventory",
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

  await cdp.call("Page.navigate", { url: logoShowcaseUrl });
  await waitFor(
    `document.readyState === "complete"`,
    "the brand showcase should load",
  );
  const showcaseAccessibility = await cdp.call(
    "Accessibility.getFullAXTree",
  );
  assert.deepEqual(
    showcaseAccessibility.nodes
      .filter(node => node.role?.value === "link")
      .map(node => node.name?.value)
      .sort(),
    ["Download SVG", "Prototype"],
    "showcase links should expose clean names without icon-font glyphs",
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
