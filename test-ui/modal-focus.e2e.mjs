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

  let pageReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await cdp.call("Runtime.evaluate", {
      expression: `location.href === ${JSON.stringify(prototypeUrl)} && document.readyState === "complete"`,
      returnByValue: true,
    });
    if (ready.result.value) {
      pageReady = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const pageState = await cdp.call("Runtime.evaluate", {
    expression: "({ href: location.href, readyState: document.readyState, title: document.title })",
    returnByValue: true,
  });
  assert.equal(
    pageReady,
    true,
    `prototype page should finish loading: ${JSON.stringify(pageState.result.value)}`,
  );

  async function evaluate(expression) {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  await evaluate(`(() => {
    const opener = document.querySelector("[data-modal-open]");
    opener.focus();
    opener.click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(
    await evaluate("document.activeElement.id"),
    "serviceName",
    "opening the dialog should focus its first field",
  );
  assert.deepEqual(
    await evaluate(`({
      name: document.getElementById("serviceName").value,
      port: document.getElementById("servicePort").value,
      directory: document.getElementById("workingDirectory").value,
      command: document.getElementById("command").value
    })`),
    { name: "", port: "", directory: "", command: "" },
    "registration should not begin with fabricated service details",
  );
  assert.equal(
    await evaluate("document.querySelector('.app-frame').inert"),
    true,
    "opening a modal should make the dashboard background inert",
  );

  await evaluate("document.getElementById('servicePort').focus()");
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  assert.deepEqual(
    await evaluate(`(() => {
      const input = document.activeElement;
      const card = input.closest(".mode-card");
      const style = getComputedStyle(card);
      return {
        type: input.type,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth
      };
    })()`),
    { type: "radio", outlineStyle: "solid", outlineWidth: "3px" },
    "the transparent mode radio should expose focus on its visible card",
  );

  await evaluate(`(() => {
    const focusable = [...document.querySelectorAll(
      "#serviceModal a[href], #serviceModal button:not([disabled]), #serviceModal input:not([disabled]), #serviceModal select:not([disabled]), #serviceModal textarea:not([disabled]), #serviceModal [tabindex]:not([tabindex='-1'])"
    )].filter(element => !element.hidden);
    focusable.at(-1).focus();
  })()`);
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });

  assert.equal(
    await evaluate("document.activeElement.getAttribute('aria-label')"),
    "Close",
    "Tab from the last control should wrap to the dialog's first control",
  );

  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    modifiers: 8,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    modifiers: 8,
  });

  assert.equal(
    await evaluate("document.activeElement.textContent.trim()"),
    "Review service",
    "Shift+Tab from the first control should wrap to the last control",
  );

  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });

  assert.equal(
    await evaluate("document.activeElement.hasAttribute('data-modal-open')"),
    true,
    "closing the dialog should restore focus to its opener",
  );
  assert.equal(
    await evaluate("document.getElementById('serviceModal').getAttribute('aria-hidden')"),
    "true",
    "closing the dialog should remove it from the accessibility tree",
  );
  assert.equal(
    await evaluate("document.querySelector('.app-frame').inert"),
    false,
    "closing the modal should restore dashboard interactivity",
  );

  await evaluate(`(() => {
    const opener = [...document.querySelectorAll("[data-action='open-startup']")]
      .find(element => element.getClientRects().length > 0);
    opener.focus();
    opener.click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));

  const startupState = await evaluate(`(() => ({
    activeId: document.activeElement.id,
    activeTag: document.activeElement.tagName,
    activeLabel: document.activeElement.getAttribute("aria-label"),
    appInert: document.querySelector(".app-frame").inert,
    ariaHidden: document.getElementById("startup").getAttribute("aria-hidden"),
    open: document.getElementById("startup").classList.contains("open"),
    closeDisabled: document.getElementById("closeStartup").disabled,
    closeRects: document.getElementById("closeStartup").getClientRects().length,
    closeTabIndex: document.getElementById("closeStartup").tabIndex
  }))()`);
  assert.equal(
    startupState.activeId,
    "closeStartup",
    `opening the startup view should move focus into it: ${JSON.stringify(startupState)}`,
  );
  assert.equal(
    startupState.appInert,
    true,
    "the dashboard should be inert while the startup dialog is open",
  );

  await evaluate(`(() => {
    const focusable = [...document.querySelectorAll(
      "#startup a[href], #startup button:not([disabled]), #startup input:not([disabled]), #startup select:not([disabled]), #startup textarea:not([disabled]), #startup [tabindex]:not([tabindex='-1'])"
    )].filter(element => element.getClientRects().length > 0);
    focusable.at(-1).focus();
  })()`);
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await evaluate("document.activeElement.id"),
    "closeStartup",
    "Tab from the last startup control should wrap to the close button",
  );

  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });

  assert.equal(
    await evaluate("document.activeElement.hasAttribute('data-action')"),
    true,
    "closing the startup view should restore focus to its opener",
  );
  assert.equal(
    await evaluate("document.querySelector('.app-frame').inert"),
    false,
    "closing startup should restore dashboard interactivity",
  );

  await evaluate(`(() => {
    const opener = [...document.querySelectorAll("[data-action='open-startup']")]
      .find(element => element.getClientRects().length > 0);
    opener.click();
    document.querySelector('[data-startup-state="backoff"]').click();
    document.querySelector('[data-startup-state="ready"]').click();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      status: document.getElementById("startupStatus").textContent.trim(),
      timerLabel: document.getElementById("startupTimerLabel").textContent.trim(),
      warn: document.getElementById("startupDot").classList.contains("warn"),
      track: document.getElementById("startupTrack").style.height,
      title: document.getElementById("startupTitle").textContent.trim(),
      output: document.getElementById("startupLogs").textContent.trim(),
      logLines: document.querySelectorAll("#startupLogs .log-line").length
    })`),
    {
      status: "ready",
      timerLabel: "elapsed",
      warn: false,
      track: "100%",
      title: "The service is ready.",
      output: "No process output yetOutput will appear here when the managed command writes to the terminal.",
      logLines: 0,
    },
    "ready preview should stay generic and replace every visual left by backoff",
  );
  await evaluate(
    `document.querySelector('[data-startup-state="failed"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      status: document.getElementById("startupStatus").textContent.trim(),
      timerLabel: document.getElementById("startupTimerLabel").textContent.trim(),
      warn: document.getElementById("startupDot").classList.contains("warn"),
      track: document.getElementById("startupTrack").style.height,
      title: document.getElementById("startupTitle").textContent.trim()
    })`),
    {
      status: "failed",
      timerLabel: "elapsed",
      warn: true,
      track: "58%",
      title: "The service didn't start.",
    },
    "failure preview should not retain the ready progress or identity",
  );
  await evaluate(`(() => {
    document.querySelector('[data-startup-state="backoff"]').click();
    document.getElementById("restartStartup").click();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      status: document.getElementById("startupStatus").textContent.trim(),
      timer: document.getElementById("startupTimer").textContent.trim(),
      timerLabel: document.getElementById("startupTimerLabel").textContent.trim(),
      warn: document.getElementById("startupDot").classList.contains("warn"),
      track: document.getElementById("startupTrack").style.height
    })`),
    {
      status: "connecting",
      timer: "0.0s",
      timerLabel: "elapsed",
      warn: false,
      track: "12%",
    },
    "restart should synchronously reset every preview value",
  );
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });

  await evaluate(`(() => {
    const opener = [...document.querySelectorAll("[data-action='open-startup']")]
      .find(element => element.getClientRects().length > 0);
    opener.click();
    document.querySelector('[data-startup-state="ready"]').click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(
    await evaluate(`({
      open: document.getElementById("startup").classList.contains("open"),
      status: document.getElementById("startupStatus").textContent.trim()
    })`),
    { open: true, status: "ready" },
    "the generic ready preview should stay open for inspection",
  );
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });

  await evaluate(`(() => {
    document.querySelector('.tab[data-view-target="admin"]').click();
    document.getElementById("adminPasswordAction").click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(
    await evaluate(`({
      flow: document.getElementById("flowModal").dataset.flow,
      state: document.getElementById("flowModal").dataset.flowState,
      focus: document.activeElement.id,
      label: document.getElementById("flowModal").getAttribute("aria-label"),
      appInert: document.querySelector(".app-frame").inert
    })`),
    {
      flow: "auth",
      state: "setup",
      focus: "newPassword",
      label: "Set a password",
      appInert: true,
    },
    "password setup should open as a focused authentication flow",
  );

  await evaluate(`(() => {
    document.getElementById("newPassword").value = "alpha";
    document.getElementById("confirmPassword").value = "beta";
    document.querySelector('[data-auth-form="setup"]').requestSubmit();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      open: document.getElementById("flowModal").classList.contains("open"),
      state: document.getElementById("flowModal").dataset.flowState,
      focus: document.activeElement.id,
      invalid: document.getElementById("confirmPassword").getAttribute("aria-invalid"),
      alert: document.getElementById("passwordMismatch").textContent.trim(),
      alertHidden: document.getElementById("passwordMismatch").hidden
    })`),
    {
      open: true,
      state: "setup",
      focus: "confirmPassword",
      invalid: "true",
      alert: "Passwords do not match. Try again.",
      alertHidden: false,
    },
    "password setup should reject a mismatched confirmation inline",
  );

  await evaluate(
    `document.querySelector('[data-flow-panel="auth"] [data-flow-transition="signin"]').click()`,
  );
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(
    await evaluate(`({
      newPassword: document.getElementById("newPassword").value,
      confirmPassword: document.getElementById("confirmPassword").value
    })`),
    { newPassword: "", confirmPassword: "" },
    "leaving password setup should clear credentials from the hidden state",
  );
  await evaluate(
    `document.querySelector('[data-flow-state-view="signin"] [data-flow-transition="error"]').click()`,
  );
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(
    await evaluate(`({
      state: document.getElementById("flowModal").dataset.flowState,
      invalid: document.activeElement.getAttribute("aria-invalid"),
      alert: document.querySelector('[data-flow-state-view="error"] [role="alert"]').textContent.trim()
    })`),
    {
      state: "error",
      invalid: "true",
      alert: "That password didn’t match. Try again.",
    },
    "the invalid-password state should announce the error and focus the field",
  );
  await cdp.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  assert.deepEqual(
    await evaluate(`({
      open: document.getElementById("flowModal").classList.contains("open"),
      state: document.getElementById("flowModal").dataset.flowState,
      closeHidden: document.getElementById("flowClose").hidden,
      accessWarningHidden: document.getElementById("accessBanner").hidden
    })`),
    {
      open: true,
      state: "error",
      closeHidden: true,
      accessWarningHidden: true,
    },
    "Escape must not dismiss a locked authentication gate",
  );
  await evaluate(
    `document.querySelector('[data-flow-state-view="error"] [data-auth-preview-exit]').click()`,
  );
  assert.equal(
    await evaluate("document.activeElement.hasAttribute('data-flow-open')"),
    true,
    "the explicit prototype-only exit should restore the preview opener",
  );
  assert.equal(
    await evaluate("document.querySelector('.app-frame').inert"),
    false,
    "leaving the authentication preview should restore dashboard interactivity",
  );

  await evaluate(`(() => {
    document.getElementById("adminPasswordAction").click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  await evaluate(`(() => {
    document.getElementById("newPassword").value = "matching password";
    document.getElementById("confirmPassword").value = "matching password";
    document.querySelector('[data-auth-form="setup"]').requestSubmit();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      flowOpen: document.getElementById("flowModal").classList.contains("open"),
      warningHidden: document.getElementById("accessBanner").hidden,
      status: document.getElementById("adminPasswordStatus").textContent.trim(),
      action: document.getElementById("adminPasswordAction").textContent.trim(),
      focus: document.activeElement.id,
      focusVisible: document.activeElement.getClientRects().length > 0,
      newPassword: document.getElementById("newPassword").value,
      confirmPassword: document.getElementById("confirmPassword").value
    })`),
    {
      flowOpen: false,
      warningHidden: true,
      status: "A password is required for dashboard and API access.",
      action: "Change password",
      focus: "adminPasswordAction",
      focusVisible: true,
      newPassword: "",
      confirmPassword: "",
    },
    "successful setup should update Administration, clear credentials, and restore visible focus",
  );

  await evaluate("document.getElementById('adminPasswordAction').click()");
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(
    await evaluate(`({
      state: document.getElementById("flowModal").dataset.flowState,
      label: document.getElementById("flowModal").getAttribute("aria-label"),
      title: document.querySelector('[data-flow-state-view="change"] .auth-title').textContent.trim(),
      lead: document.querySelector('[data-flow-state-view="change"] .flow-lead').textContent.trim(),
      submit: document.querySelector('[data-auth-form="change"] button[type="submit"]').textContent.trim()
    })`),
    {
      state: "change",
      label: "Change password",
      title: "Change password",
      lead: "Update the password required for this dashboard and its API.",
      submit: "Change password",
    },
    "the secured Administration action should open a dedicated change-password state",
  );
  await evaluate(`(() => {
    document.getElementById("changePassword").value = "new matching password";
    document.getElementById("changeConfirmPassword").value = "new matching password";
    document.querySelector('[data-auth-form="change"]').requestSubmit();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      open: document.getElementById("flowModal").classList.contains("open"),
      toast: document.getElementById("toastText").textContent.trim(),
      focus: document.activeElement.id,
      focusVisible: document.activeElement.getClientRects().length > 0,
      password: document.getElementById("changePassword").value,
      confirmation: document.getElementById("changeConfirmPassword").value
    })`),
    {
      open: false,
      toast: "Administration password changed",
      focus: "adminPasswordAction",
      focusVisible: true,
      password: "",
      confirmation: "",
    },
    "change-password submission should restore its opener and clear credentials",
  );
  await evaluate("document.getElementById('adminPasswordAction').click()");
  await new Promise(resolve => setTimeout(resolve, 50));
  await evaluate(`(() => {
    document.getElementById("changePassword").value = "cancel me";
    document.getElementById("changeConfirmPassword").value = "cancel me";
    document.querySelector('[data-auth-form="change"] [data-flow-close]').click();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      open: document.getElementById("flowModal").classList.contains("open"),
      focus: document.activeElement.id,
      password: document.getElementById("changePassword").value,
      confirmation: document.getElementById("changeConfirmPassword").value
    })`),
    {
      open: false,
      focus: "adminPasswordAction",
      password: "",
      confirmation: "",
    },
    "canceling password change should clear credentials and restore its opener",
  );

  await evaluate(
    `document.querySelector('.tab[data-view-target="services"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      rows: document.querySelectorAll("[data-service-row]").length,
      empty: document.querySelector('[data-view="services"] .empty-panel h3').textContent.trim(),
      worktreeCount: document.querySelector('.tab[data-view-target="worktrees"] .tab-count').textContent.trim(),
      serviceCount: document.querySelector('.tab[data-view-target="services"] .tab-count').textContent.trim(),
      startDisabled: document.querySelector(".quick-card h3").closest("button").disabled,
      stopDisabled: [...document.querySelectorAll(".quick-card")].find(button => button.querySelector("h3")?.textContent.trim() === "Stop all").disabled
    })`),
    {
      rows: 0,
      empty: "No services registered",
      worktreeCount: "0",
      serviceCount: "0",
      startDisabled: true,
      stopDisabled: true,
    },
    "default views should expose a coherent zero state",
  );

  await evaluate(
    `document.querySelector('.tab[data-view-target="logs"]').click()`,
  );
  assert.deepEqual(
    await evaluate(`({
      title: document.querySelector('[data-view="logs"] .terminal-empty strong').textContent.trim(),
      runOptions: document.getElementById("logRun").options.length,
      runDisabled: document.getElementById("logRun").disabled,
      logLines: document.querySelectorAll('[data-view="logs"] .log-line').length
    })`),
    {
      title: "Nothing has run yet",
      runOptions: 1,
      runDisabled: true,
      logLines: 0,
    },
    "run history should be empty and unavailable until a real service runs",
  );

  await evaluate(`(() => {
    document.querySelector('.tab[data-view-target="overview"]').click();
    document.querySelector('[data-flow-open="manifest"]').click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(
    await evaluate("document.activeElement.id"),
    "manifestSource",
    "manifest Apply should focus its source",
  );
  assert.deepEqual(
    await evaluate(`({
      source: document.getElementById("manifestSource").value,
      yaml: document.getElementById("manifestYaml").value,
      override: document.getElementById("overrideService").value
    })`),
    { source: "", yaml: "", override: "" },
    "manifest review should not begin with fabricated input",
  );
  await evaluate(
    `document.querySelector('[data-flow-panel="manifest"] [data-flow-transition="dry-run"]').click()`,
  );
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(
    await evaluate(
      `document.querySelector('[data-flow-state-view="dry-run"] .flow-summary').textContent.includes("Manifest results appear here.")`,
    ),
    true,
    "dry-run preview should explain its empty results without inventing changes",
  );
  await evaluate(
    `document.querySelector('[data-flow-state-view="dry-run"] [data-flow-close]').click()`,
  );

  await evaluate(`(() => {
    document.querySelector('.tab[data-view-target="admin"]').click();
    document.querySelector('[data-action="preview-access-warning"]').click();
  })()`);
  assert.deepEqual(
    await evaluate(`({
      hidden: document.getElementById("accessBanner").hidden,
      role: document.getElementById("accessBanner").getAttribute("role"),
      focusState: document.activeElement.dataset.flowState,
      dismissers: document.querySelectorAll("#accessBanner [data-flow-close], #accessBanner [data-close]").length
    })`),
    {
      hidden: false,
      role: "alert",
      focusState: "setup",
      dismissers: 0,
    },
    "the Administration preview should expose the persistent access warning",
  );

  console.log("Overlay, zero-state, and authentication behavior passed.");
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
