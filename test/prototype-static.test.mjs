import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const prototypeDirectory = new URL("../prototype/", import.meta.url);
const htmlFiles = ["index.html", "logo-showcase.html"];

function relativeLuminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return (
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  );
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function mixSrgb(first, second, firstWeight) {
  const channelValues = hex =>
    hex
      .replace("#", "")
      .match(/.{2}/g)
      .map(channel => Number.parseInt(channel, 16));
  const firstChannels = channelValues(first);
  const secondChannels = channelValues(second);
  return `#${firstChannels
    .map((channel, index) =>
      Math.round(
        channel * firstWeight + secondChannels[index] * (1 - firstWeight),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function cssToken(block, name) {
  return block.match(
    new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|\\d+%)`, "i"),
  )?.[1];
}

test("served prototype directory contains only runtime surfaces and assets", async () => {
  const entries = (await readdir(prototypeDirectory)).sort();

  assert.deepEqual(entries, ["assets", ...htmlFiles].sort());
});

test("prototype HTML has unique IDs and syntactically valid inline scripts", async () => {
  for (const filename of htmlFiles) {
    const html = await readFile(new URL(filename, prototypeDirectory), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

    assert.equal(new Set(ids).size, ids.length, `${filename} has duplicate IDs`);

    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    for (const [index, script] of scripts.entries()) {
      assert.doesNotThrow(
        () => new vm.Script(script[1], { filename: `${filename}:script-${index + 1}` }),
        `${filename} inline script ${index + 1} should parse`,
      );
    }
  }
});

test("every local asset referenced by the HTML and icon stylesheet exists", async () => {
  for (const filename of htmlFiles) {
    const sourceUrl = new URL(filename, prototypeDirectory);
    const html = await readFile(sourceUrl, "utf8");
    const references = [
      ...html.matchAll(/(?:href|src)="(\.\/assets\/[^"#?]+)"/g),
      ...html.matchAll(/url\("(\.\/assets\/[^"#?]+)"\)/g),
    ].map(match => match[1]);

    for (const reference of new Set(references)) {
      const bytes = await readFile(new URL(reference, sourceUrl));
      assert.ok(bytes.byteLength > 0, `${filename}: ${reference}`);
    }
  }

  const iconStylesheetUrl = new URL(
    "assets/phosphor/style.css",
    prototypeDirectory,
  );
  const iconStylesheet = await readFile(iconStylesheetUrl, "utf8");
  const fontReferences = [
    ...iconStylesheet.matchAll(/url\("(\.\/[^"#?]+)"\)/g),
  ].map(match => match[1]);

  for (const reference of fontReferences) {
    const bytes = await readFile(new URL(reference, iconStylesheetUrl));
    assert.ok(bytes.byteLength > 0, `style.css: ${reference}`);
  }
});

test("prototype starts empty and contains no fabricated operational records", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const fabricatedTokens = [
    "northstar",
    "atlas-api",
    "postgres",
    "storybook",
    "oauth-mock",
    "run_01J3K91Q",
    "PID 48614",
    "PID 12844",
    "localhost:4310",
    "localhost:4311",
    ":5439",
    ":4522",
    ":6006",
    ":4400",
    ":4401",
    ":6381",
  ];

  assert.match(html, /data-managed-count="0"/);
  assert.match(html, /data-running-count="0"/);
  assert.equal(
    (html.match(/class="tab-count">0<\/span>/g) ?? []).length,
    2,
    "worktree and service tabs should both start at zero",
  );
  assert.equal(
    (html.match(/\bdata-service-row\b/g) ?? []).length,
    0,
    "the static prototype should not ship service records",
  );
  assert.equal(
    (html.match(/\bdata-service-count=/g) ?? []).length,
    0,
    "the static prototype should not ship worktree records",
  );
  assert.match(html, /No worktrees (?:registered|applied)/i);
  assert.match(html, /No services registered/i);
  assert.match(html, /Nothing has run yet/i);
  assert.match(html, /data-live-status="unavailable"/);
  assert.match(html, /Interface preview[^<]*not a real launch/i);
  assert.doesNotMatch(html, /const startupLines\s*=/);

  for (const token of fabricatedTokens) {
    assert.doesNotMatch(
      html,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      `prototype should not contain fabricated token: ${token}`,
    );
  }
});

test("Administration presents effective configuration without unsafe inline toggles", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const start = html.indexOf('<section class="view" data-view="admin">');
  const end = html.indexOf("</section>", start);
  const administration = html.slice(start, end);

  assert.ok(start >= 0 && end > start, "Administration view should exist");
  assert.match(administration, /Effective configuration/);
  assert.doesNotMatch(
    administration,
    /Non-loopback warning[\s\S]*?data-toggle/,
    "the required exposure warning cannot be user-disableable",
  );
  assert.doesNotMatch(
    administration,
    /<select\b/,
    "settings returned by the read-only API cannot look directly editable",
  );
});

test("non-loopback access has a persistent, non-dismissible warning", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const start = html.indexOf('id="accessBanner"');
  const end = html.indexOf("</div>", start);
  const banner = html.slice(start, end);

  assert.ok(start >= 0 && end > start, "access warning banner should exist");
  assert.match(banner, /role="alert"/);
  assert.match(banner, /reachable from other devices/i);
  assert.match(banner, /data-flow-open="auth"/);
  assert.match(banner, /data-flow-state="setup"/);
  assert.doesNotMatch(
    banner,
    /data-(?:flow-)?close/,
    "the exposure warning must not be dismissible",
  );
});

test("manifest preview starts blank and never invents reconciliation results", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const yamlField = html.match(
    /<textarea[^>]+id="manifestYaml"[^>]*>([\s\S]*?)<\/textarea>/,
  );
  const dryRunStart = html.indexOf('data-flow-state-view="dry-run"');
  const dryRunEnd = html.indexOf("</section>", dryRunStart);
  const dryRun = html.slice(dryRunStart, dryRunEnd);

  assert.ok(yamlField, "manifest preview should include a YAML field");
  assert.equal(yamlField[1], "", "manifest YAML should not be prefilled");
  assert.match(yamlField[0], /\srequired(?:\s|>)/);
  assert.match(yamlField[0], /placeholder="[^"]+"/);
  assert.match(
    html,
    /id="manifestSource"[^>]+placeholder="[^"]+"[^>]+required/,
  );
  assert.match(dryRun, /Manifest results appear here/i);
  assert.match(dryRun, /No reconciliation results/i);
  assert.doesNotMatch(dryRun, /data-result-status=/);
  assert.doesNotMatch(html, /data-flow-panel="service-detail"/);
  assert.doesNotMatch(html, /data-flow-panel="aggregate"/);
});

test("Runs and logs keeps documented filters disabled until real history exists", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const start = html.indexOf('<section class="view" data-view="logs">');
  const end = html.indexOf(
    '<section class="view" data-view="admin">',
    start,
  );
  const logs = html.slice(start, end);

  assert.ok(start >= 0 && end > start, "Runs and logs view should exist");
  for (const control of [
    "logSearchQuery",
    "logRegex",
    "logIgnoreCase",
    "logStream",
    "logRun",
    "logSince",
  ]) {
    assert.match(logs, new RegExp(`id="${control}"`), `${control} should exist`);
  }
  assert.match(logs, /Nothing has run yet/i);
  assert.match(logs, /No run history/i);
  assert.match(logs, /id="logRun" disabled><option>No runs available/);
  assert.doesNotMatch(logs, /retention gap/i);
  assert.doesNotMatch(logs, /class="log-line"/);
});

test("locked authentication states cannot dismiss the control-plane gate", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const authStart = html.indexOf('data-flow-panel="auth"');
  const authEnd = html.indexOf('data-flow-panel="manifest"', authStart);
  const auth = html.slice(authStart, authEnd);

  for (const state of ["signin", "error", "expired"]) {
    const stateStart = auth.indexOf(`data-flow-state-view="${state}"`);
    const nextState = auth.indexOf('data-flow-state-view="', stateStart + 30);
    const stateMarkup = auth.slice(
      stateStart,
      nextState === -1 ? auth.length : nextState,
    );
    assert.doesNotMatch(
      stateMarkup,
      /data-flow-close/,
      `${state} must not offer a real dismiss action`,
    );
  }

  assert.match(auth, /data-auth-preview-exit/);
  assert.match(html, /data-auth-locked/);
});

test("managed-port mode is a labelled group with a visible keyboard focus style", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(
    html,
    /<fieldset[^>]+mode-fieldset[\s\S]*?<legend>Managed port mode<\/legend>/,
  );
  assert.match(html, /\.mode-card:has\(input:focus-visible\)/);
});

test("muted copy meets normal-text contrast in light and dark surfaces", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const rootTokens = html.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const darkTokens =
    html.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  const cases = [
    ["light soft", cssToken(rootTokens, "muted"), cssToken(rootTokens, "surface-soft")],
    ["light surface", cssToken(rootTokens, "muted"), cssToken(rootTokens, "surface")],
    ["dark soft", cssToken(darkTokens, "muted"), cssToken(darkTokens, "surface-soft")],
    ["dark surface", cssToken(darkTokens, "muted"), cssToken(darkTokens, "surface")],
  ];

  for (const [label, foreground, background] of cases) {
    assert.ok(foreground && background, `${label} tokens should exist`);
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${label} muted contrast should be at least 4.5:1`,
    );
  }
});

test("critical badges and terminal timestamps meet normal-text contrast", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const rootTokens = html.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const darkTokens =
    html.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const value = (theme, name) =>
    cssToken(theme === "light" ? rootTokens : darkTokens, name) ??
    cssToken(rootTokens, name);

  for (const theme of ["light", "dark"]) {
    const surface = value(theme, "surface");
    const cases = [
      [
        "good",
        value(theme, "badge-good-ink"),
        mixSrgb(value(theme, "good"), surface, 0.14),
      ],
      [
        "danger",
        value(theme, "badge-danger-ink"),
        mixSrgb(value(theme, "danger"), surface, 0.14),
      ],
      [
        "warning",
        value(theme, "badge-warning-ink"),
        mixSrgb(value(theme, "warning"), surface, 0.14),
      ],
      [
        "manifest",
        value(theme, "manifest-ink"),
        mixSrgb("#8572db", surface, 0.15),
      ],
      [
        "starting",
        value(theme, "ink"),
        mixSrgb(
          value(theme, "acid"),
          surface,
          Number.parseInt(value(theme, "badge-starting-mix"), 10) / 100,
        ),
      ],
      [
        "imperative",
        value(theme, "badge-imperative-ink"),
        mixSrgb(value(theme, "acid"), surface, 0.5),
      ],
    ];

    for (const [label, foreground, background] of cases) {
      assert.ok(foreground && background, `${theme} ${label} colors should exist`);
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${theme} ${label} contrast should be at least 4.5:1; received ${ratio.toFixed(3)}:1`,
      );
    }
  }

  assert.ok(
    contrastRatio(cssToken(rootTokens, "log-time"), "#111416") >= 4.5,
    "terminal timestamps should meet 4.5:1 against the fixed terminal surface",
  );
  assert.match(html, /\.badge\.running[\s\S]*?color:\s*var\(--badge-good-ink\)/);
  assert.match(html, /\.badge\.conflict[\s\S]*?color:\s*var\(--badge-danger-ink\)/);
  assert.match(html, /\.badge\.stale[\s\S]*?color:\s*var\(--badge-warning-ink\)/);
  assert.match(html, /\.badge\.manifest[\s\S]*?color:\s*var\(--manifest-ink\)/);
  assert.match(html, /\.log-time\s*\{\s*color:\s*var\(--log-time\)/);
});

test("dashboard inventory, worktrees, and service table tell one coherent zero-state story", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const managedCard = html.match(
    /<article[^>]+data-managed-count="0"[^>]*>([\s\S]*?)<\/article>/,
  )?.[1];
  const runningCard = html.match(
    /<article[^>]+data-running-count="0"[^>]*>([\s\S]*?)<\/article>/,
  )?.[1];

  assert.ok(managedCard, "managed-port count card should exist");
  assert.ok(runningCard, "running-service count card should exist");
  assert.doesNotMatch(managedCard, /\bcapacity\b|\/\s*12|67%/i);
  assert.match(managedCard, />0\s*<small>assigned<\/small>/);
  assert.match(managedCard, /Across 0 worktrees/);
  assert.match(runningCard, />0\s*<small>services<\/small>/);
  assert.match(runningCard, /Nothing starting/);
  assert.equal((html.match(/class="segment filled"/g) ?? []).length, 0);
  assert.equal((html.match(/data-service-count=/g) ?? []).length, 0);
  assert.equal((html.match(/\bdata-service-row\b/g) ?? []).length, 0);
  assert.match(html, /<div class="card service-table" role="table"/);
  assert.equal(
    (html.match(/role="columnheader"/g) ?? []).length,
    6,
    "the service table should expose six column headers",
  );
  assert.equal(
    (html.match(/role="cell"/g) ?? []).length,
    1,
    "the empty service table should expose one explanatory cell",
  );
  assert.equal(
    (html.match(/class="card quick-card" disabled/g) ?? []).length,
    2,
    "aggregate actions should be disabled when no services exist",
  );
});

test("administration distinguishes documented defaults from unavailable live state", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(html, /data-live-status="unavailable"/);
  assert.match(html, /Documented defaults/);
  assert.match(html, /60 seconds/);
  assert.match(html, /50 MiB/);
  assert.match(html, /data-action="preview-access-warning"/);
  assert.doesNotMatch(html, /\b(?:healthy|exposed)\b/i);
  assert.doesNotMatch(html, /\bPID\b|\buptime\b/i);
});

test("authentication setup validates confirmation and modal names remain exposed", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(html, /id="flowModal"[^>]+aria-label="Port Start"/);
  assert.doesNotMatch(html, /id="flowModal"[^>]+aria-labelledby="flowTitle"/);
  assert.match(html, /id="passwordMismatch"[^>]+role="alert"[^>]+hidden/);
  assert.match(
    html,
    /\(setup \|\| change\) && password\.value\s*!==\s*confirmation\.value/,
  );
  assert.match(html, /confirmation\.setAttribute\("aria-invalid",\s*"true"\)/);
  assert.doesNotMatch(html, /minlength="12"|At least 12 characters/);
  assert.match(html, /function updateBackgroundInert\(\)/);
  assert.match(html, /id="adminPasswordStatus"/);
  assert.match(html, /id="adminPasswordAction"/);
  assert.match(html, /A password is required for dashboard and API access\./);
  assert.match(html, /data-flow-state-view="change"/);
  assert.match(html, /Update the password required for this dashboard and its API\./);
  assert.match(html, /Administration password changed/);
  assert.doesNotMatch(
    html,
    /Require a password whenever the Administration dashboard is opened/,
  );
  assert.doesNotMatch(html, /would open from the embedded admin server/);
});

test("browser prerequisites and override are documented", async () => {
  const [readme, packageJson] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.match(readme, /Node\.js 22/i);
  assert.match(readme, /global `WebSocket`/i);
  assert.match(readme, /CHROME_BIN/);
  assert.equal(packageData.engines?.node, ">=22");
});

test("contract-critical flows expose auth, blank manifest review, and generic startup states", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const panelNames = new Set(
    [...html.matchAll(/data-flow-panel="([^"]+)"/g)].map(match => match[1]),
  );
  const openTargets = new Set(
    [...html.matchAll(/data-flow-open="([^"]+)"/g)].map(match => match[1]),
  );

  for (const target of openTargets) {
    assert.ok(panelNames.has(target), `flow trigger "${target}" needs a panel`);
  }

  const flowStates = new Set(
    [...html.matchAll(/data-flow-state-view="([^"]+)"/g)].map(match => match[1]),
  );
  for (const state of [
    "setup",
    "change",
    "signin",
    "error",
    "expired",
    "input",
    "dry-run",
  ]) {
    assert.ok(flowStates.has(state), `missing flow state: ${state}`);
  }

  assert.match(html, /Port override/);
  assert.match(html, /Manifest results appear here\./);
  assert.doesNotMatch(html, /data-result-status=/);

  for (const state of ["ready", "failed", "backoff"]) {
    assert.match(
      html,
      new RegExp(`data-startup-state="${state}"`),
      `missing startup preview: ${state}`,
    );
  }
  assert.match(html, /Starting the service\./);
  assert.match(html, /The service is ready\./);
  assert.match(html, /The service didn't start\./);
  assert.match(html, /Waiting before trying again\./);
  assert.match(html, /Startup canceled\./);
});
