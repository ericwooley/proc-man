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

function mixHexColors(foreground, background, foregroundWeight) {
  const foregroundChannels = foreground
    .replace("#", "")
    .match(/.{2}/g)
    .map(channel => Number.parseInt(channel, 16));
  const backgroundChannels = background
    .replace("#", "")
    .match(/.{2}/g)
    .map(channel => Number.parseInt(channel, 16));
  return `#${foregroundChannels
    .map((channel, index) =>
      Math.round(
        channel * foregroundWeight +
          backgroundChannels[index] * (1 - foregroundWeight),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function cssToken(block, name) {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
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

    const scripts = [
      ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
    ];
    for (const [index, script] of scripts.entries()) {
      assert.doesNotThrow(
        () =>
          new vm.Script(script[1], {
            filename: `${filename}:script-${index + 1}`,
          }),
        `${filename} inline script ${index + 1} should parse`,
      );
    }
  }
});

test("every local asset referenced by HTML and the icon stylesheet exists", async () => {
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
  for (const match of iconStylesheet.matchAll(/url\("(\.\/[^"#?]+)"\)/g)) {
    const bytes = await readFile(new URL(match[1], iconStylesheetUrl));
    assert.ok(bytes.byteLength > 0, `style.css: ${match[1]}`);
  }
});

test("dashboard presents the process-manager product model without legacy networking behavior", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const visibleCopy = html
    .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style>[\s\S]*?<\/style>/gi, "");

  assert.match(visibleCopy, /Register worktree/);
  assert.match(visibleCopy, /Processes/);
  assert.match(visibleCopy, /Commands/);
  assert.match(visibleCopy, /Endpoints/);
  assert.match(visibleCopy, /Runs &amp; logs/);
  assert.match(visibleCopy, /Deregister/);
  assert.match(visibleCopy, /port-start worktree register --json/);
  for (const action of ["Start", "Stop", "Restart", "Run", "Cancel"]) {
    assert.match(html, new RegExp(action));
  }

  for (const retiredConcept of [
    /\bwake(?:-on-port)?\b/i,
    /\bhandoff\b/i,
    /\bproxy\b/i,
    /\bforwarding\b/i,
    /\bmanaged ports?\b/i,
    /\bport allocation\b/i,
    /\bport ownership\b/i,
  ]) {
    assert.doesNotMatch(visibleCopy, retiredConcept);
  }
});

test("declared ports are explicit child-process metadata, including multiple and pending values", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(
    html,
    /name: 'web'[\s\S]*?name: 'http'[\s\S]*?port: 4310[\s\S]*?name: 'inspector'[\s\S]*?port: 9310/,
  );
  assert.match(
    html,
    /name: 'api'[\s\S]*?ports:[\s\S]*?port: 4321[\s\S]*?activePorts:[\s\S]*?port: 4311/,
  );
  assert.match(html, /No declared ports/);
  assert.match(html, /Next start/);
  assert.doesNotMatch(html, /\bport:\s*['"]?auto\b/i);
  assert.doesNotMatch(html, /\ballocatePort\b|\bclaimPort\b|\bportOwner\b/);
  assert.match(html, /function visiblePorts\(process\)/);
  assert.match(html, /function pendingPorts\(process\)/);
  assert.match(html, /process\.activePorts = process\.ports\.map/);
  assert.match(html, /delete process\.activePorts/);
});

test("core worktree, process, command, log, and registration interactions are wired", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  for (const view of ["worktrees", "logs", "admin"]) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`data-view-target="${view}"`));
  }
  for (const tab of ["endpoints", "processes", "commands", "logs"]) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
    assert.match(html, new RegExp(`data-pane="${tab}"`));
  }

  assert.match(html, /function runProcessAction\(p, action\)/);
  assert.match(html, /function runBulkProcessAction\(worktree, action\)/);
  assert.match(html, /function runCommandAction\(c, action, runId\)/);
  assert.match(html, /function renderGlobalRuns\(/);
  assert.match(html, /function openRegisterModal\(\)/);
  assert.match(html, /function closeRegisterModal\(/);
  assert.match(html, /function setBackgroundInert\(value\)/);
  assert.match(html, /function trapFocus\(container, event\)/);
  assert.match(html, /function normalizeWorktreePath\(path\)/);
  assert.match(
    html,
    /name: 'api'[\s\S]*?state: 'stopped'[\s\S]*?currentRunState: 'exited'[\s\S]*?currentRunCode: 1/,
  );
  assert.match(
    html,
    /name: 'worker'[\s\S]*?state: 'failed'[\s\S]*?Launch failed/,
  );
  assert.match(
    html,
    /run-test-98'[\s\S]*?state: 'exited'[\s\S]*?code: 1/,
  );
  assert.match(html, /existingRegistration/);
  assert.match(html, /WORKTREES\.splice\(index, 1\)/);
  assert.match(html, /INDEX = buildIndex\(\)/);
  assert.match(html, /Its active runs were stopped/);
  assert.match(html, /data-state="populated"/);
  assert.match(html, /data-state="loading"/);
  assert.match(html, /data-state="empty"/);
  assert.match(html, /data-command-run=/);
  assert.match(
    html,
    /<aside class="drawer"[^>]+aria-hidden="true"[^>]+inert/,
  );
  assert.match(html, /drawer\.inert = false/);
  assert.match(html, /drawer\.inert = true/);
  assert.match(html, /id="deregisterModal"/);
  assert.match(html, /id="deregisterConfirm"/);
  assert.match(html, /worktree's run logs stay available/i);
  assert.match(html, /ArrowRight/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /data-bulk-proc-action="start-all"/);
  assert.match(html, /data-bulk-proc-action="stop-all"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-activedescendant/);
  assert.match(html, /aria-busy/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<button[^>]*>Following<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*>Latest run<\/button>/);
  assert.doesNotMatch(html, /class="wt-tile"[^>]+role="button"/);
  assert.match(html, /<button class="view-btn" data-open=/);
});

test("registration starts with a blank worktree path and a manifest default", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const pathInput = html.match(/<input id="worktreePath"[^>]*>/)?.[0];
  const manifestInput = html.match(/<input id="manifestPath"[^>]*>/)?.[0];

  assert.ok(pathInput);
  assert.doesNotMatch(pathInput, /\bvalue=/);
  assert.match(pathInput, /\brequired\b/);
  assert.ok(manifestInput);
  assert.match(manifestInput, /value="\.port-start\.yaml"/);
  assert.match(html, /Register worktree/);
  assert.match(html, /Deregistered \$\{branch\}; its active runs were stopped/);
});

test("prototype uses the local icon family and external product mark instead of inline artwork", async () => {
  const [dashboard, brand, logoEntries] = await Promise.all([
    readFile(new URL("index.html", prototypeDirectory), "utf8"),
    readFile(new URL("logo-showcase.html", prototypeDirectory), "utf8"),
    readdir(new URL("assets/logos/", prototypeDirectory)),
  ]);

  assert.match(dashboard, /assets\/phosphor\/style\.css/);
  assert.match(dashboard, /assets\/logos\/port-matrix\.svg/);
  assert.match(brand, /Port Matrix is the product mark/);
  assert.doesNotMatch(dashboard, /<svg\b/i);
  assert.doesNotMatch(brand, /<svg\b/i);
  for (const icon of brand.matchAll(/<i\b[^>]*>/g)) {
    assert.match(
      icon[0],
      /aria-hidden="true"/,
      "brand-showcase icon glyphs should be decorative",
    );
  }
  assert.doesNotMatch(dashboard, /id="passwordPreview"/);
  assert.doesNotMatch(dashboard, /required non-loopback warning/i);
  assert.doesNotMatch(dashboard, /Password setup would open here/i);
  assert.deepEqual(logoEntries.sort(), ["port-matrix.svg"]);
});

test("light and dark body-copy tokens meet WCAG AA contrast", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const lightBlock = html.match(/:root\s*\{([\s\S]*?)\}/)?.[1];
  const darkBlock = html.match(
    /html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/,
  )?.[1];

  assert.ok(lightBlock);
  assert.ok(darkBlock);
  for (const [theme, block] of [
    ["light", lightBlock],
    ["dark", darkBlock],
  ]) {
    const ink = cssToken(block, "ink");
    const muted = cssToken(block, "muted");
    const focus = cssToken(block, "focus");
    const focusInverse = cssToken(block, "focus-inverse");
    const rail = cssToken(block, "rail");
    const shell = cssToken(block, "shell");
    const surface = cssToken(block, "surface");
    const surfaceSoft = cssToken(block, "surface-soft");
    const surfaceQuiet = cssToken(block, "surface-quiet");
    const good = cssToken(block, "good");
    const warning = cssToken(block, "warning");
    const danger = cssToken(block, "danger");
    const badgeGoodInk = cssToken(block, "badge-good-ink");
    const badgeGoodBackground = cssToken(block, "badge-good-bg");
    const badgeWarningInk = cssToken(block, "badge-warning-ink");
    const badgeWarningBackground = cssToken(block, "badge-warning-bg");
    const badgeDangerInk = cssToken(block, "badge-danger-ink");
    const badgeDangerBackground = cssToken(block, "badge-danger-bg");
    assert.ok(
      ink &&
        muted &&
        focus &&
        focusInverse &&
        rail &&
        shell &&
        surface &&
        surfaceSoft &&
        surfaceQuiet &&
        good &&
        warning &&
        danger &&
        badgeGoodInk &&
        badgeGoodBackground &&
        badgeWarningInk &&
        badgeWarningBackground &&
        badgeDangerInk &&
        badgeDangerBackground,
      `${theme} tokens should be present`,
    );
    assert.ok(
      contrastRatio(ink, surface) >= 4.5,
      `${theme} primary copy should meet 4.5:1`,
    );
    assert.ok(
      contrastRatio(muted, surface) >= 4.5,
      `${theme} secondary copy should meet 4.5:1`,
    );
    assert.ok(
      contrastRatio(focus, surface) >= 3 &&
        contrastRatio(focus, shell) >= 3,
      `${theme} focus indicator should meet 3:1 against adjacent surfaces`,
    );
    assert.ok(
      contrastRatio(focusInverse, rail) >= 3,
      `${theme} inverse focus indicator should meet 3:1 on dark surfaces`,
    );
    for (const [surfaceLabel, backdrop] of [
      ["surface", surface],
      ["surface-quiet", surfaceQuiet],
      ["surface-soft", surfaceSoft],
    ]) {
      for (const [stateLabel, stateInk, stateBackground] of [
        ["running or succeeded", badgeGoodInk, badgeGoodBackground],
        ["mixed or transitional", badgeWarningInk, badgeWarningBackground],
        ["stale or failed", badgeDangerInk, badgeDangerBackground],
      ]) {
        const effectiveBackground = mixHexColors(
          stateBackground,
          backdrop,
          1,
        );
        assert.ok(
          contrastRatio(stateInk, effectiveBackground) >= 4.5,
          `${theme} ${stateLabel} text should meet 4.5:1 on ${surfaceLabel}`,
        );
      }
    }
    assert.ok(
      contrastRatio(muted, surfaceSoft) >= 4.5,
      `${theme} stopped or canceled text should meet 4.5:1`,
    );
  }
  for (const state of ["good", "warning", "danger"]) {
    assert.equal(
      [...html.matchAll(new RegExp(`background:\\s*var\\(--badge-${state}-bg\\)`, "g"))]
        .length,
      2,
      `${state} state pills should use an opaque background token`,
    );
  }
});

test("browser prerequisites and override are documented", async () => {
  const [readme, packageJson] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.match(readme, /Node\.js 22/i);
  assert.match(readme, /jq 1\.6 or newer/i);
  assert.match(readme, /global `WebSocket`/i);
  assert.match(readme, /CHROME_BIN/);
  assert.match(readme, /registration and deregistration/);
  assert.equal(packageData.engines?.node, ">=22");
});

test("CLI contract gives agents a worktree-scoped discovery path", async () => {
  const cli = await readFile(
    new URL("../docs/cli.md", import.meta.url),
    "utf8",
  );

  assert.match(cli, /port-start process list --worktree/);
  assert.match(cli, /port-start command list --worktree/);
  assert.match(cli, /port-start run list --worktree/);
  assert.match(cli, /port-start run search/);
  assert.match(cli, /include-deregistered/);
  assert.match(cli, /next_cursor/);
  assert.match(cli, /active_invocation_count/);
  assert.match(cli, /next_start/);
  assert.match(cli, /\.data\.worktree\.selector/);
  assert.match(cli, /sort_by\(\.selector\).*?\.\[0\]\.selector/s);
  assert.match(cli, /\.data\.processes\[\]\.endpoints\[\]/);
  assert.match(cli, /port-start process start --worktree "\$worktree_selector"/);
  assert.doesNotMatch(cli, /\$\(basename "\$PWD"\)\/web/);
  for (const followUp of [
    "port-start process status",
    "port-start open",
    "port-start command run",
    "port-start process logs",
  ]) {
    assert.match(cli, new RegExp(followUp.replaceAll(" ", "\\s+")));
  }
});

test("API contract supports retained run discovery and cross-run log search", async () => {
  const api = await readFile(
    new URL("../docs/api.md", import.meta.url),
    "utf8",
  );

  assert.match(api, /GET \/api\/v1\/runs/);
  assert.match(api, /POST \/api\/v1\/run-search/);
  assert.match(api, /include_deregistered/);
  assert.match(api, /worktree_snapshot/);
  assert.match(api, /worktree_registered/);
  assert.match(api, /definition_present/);
  assert.match(api, /\brun_id\b/);
  for (const field of ["seq", "time", "stream", "text", "partial"]) {
    assert.match(api, new RegExp(`\\b${field}\\b`));
  }
  assert.match(api, /next_cursor/);
});

test("missing-worktree command and download contracts are consistent", async () => {
  const [domain, api, cli, logging, prototype] = await Promise.all([
    readFile(new URL("../docs/domain-model.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/api.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/cli.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/logging.md", import.meta.url), "utf8"),
    readFile(new URL("index.html", prototypeDirectory), "utf8"),
  ]);

  assert.match(domain, /Command actions[\s\S]*?worktree_stale/);
  assert.match(api, /command run[\s\S]*?worktree_stale/i);
  assert.match(cli, /command run[\s\S]*?worktree_stale/i);
  assert.match(
    prototype,
    /status: 'missing'[\s\S]*?state: 'stale'/,
  );
  assert.doesNotMatch(prototype, /status: 'stale'/);
  assert.doesNotMatch(logging, /Multi-run download/i);
  assert.match(logging, /one selected run/i);
});

test("cross-worktree machine inventories retain worktree attribution", async () => {
  const [cli, api] = await Promise.all([
    readFile(new URL("../docs/cli.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/api.md", import.meta.url), "utf8"),
  ]);

  assert.match(
    cli,
    /each process[\s\S]*?`worktree`[\s\S]*?stable ID[\s\S]*?canonical path/i,
  );
  assert.match(
    cli,
    /each command[\s\S]*?`worktree`[\s\S]*?stable ID[\s\S]*?canonical path/i,
  );
  assert.match(
    api,
    /process and command list responses[\s\S]*?`worktree`[\s\S]*?stable ID[\s\S]*?canonical path/i,
  );
});

test("design QA evidence is durable inside the repository", async () => {
  const designQa = await readFile(
    new URL("../design-qa.md", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(designQa, /\/tmp\//);
  assert.match(designQa, /`npm test`: 31 tests passed/);
  for (const asset of [
    "jump-to-endpoint.png",
    "implementation-desktop.png",
    "implementation-processes.png",
    "comparison.png",
    "implementation-commands.png",
  ]) {
    const bytes = await readFile(
      new URL(`../docs/assets/design-qa/${asset}`, import.meta.url),
    );
    assert.ok(bytes.byteLength > 10_000, asset);
  }
});
