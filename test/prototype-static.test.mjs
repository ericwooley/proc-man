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
  assert.match(html, /function runCommandAction\(c, action, runId\)/);
  assert.match(html, /function renderGlobalRuns\(/);
  assert.match(html, /function openRegisterModal\(\)/);
  assert.match(html, /function closeRegisterModal\(/);
  assert.match(html, /function setBackgroundInert\(value\)/);
  assert.match(html, /function trapFocus\(container, event\)/);
  assert.match(html, /function normalizeWorktreePath\(path\)/);
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
    const surface = cssToken(block, "surface");
    assert.ok(ink && muted && surface, `${theme} tokens should be present`);
    assert.ok(
      contrastRatio(ink, surface) >= 4.5,
      `${theme} primary copy should meet 4.5:1`,
    );
    assert.ok(
      contrastRatio(muted, surface) >= 4.5,
      `${theme} secondary copy should meet 4.5:1`,
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
  assert.match(readme, /global `WebSocket`/i);
  assert.match(readme, /CHROME_BIN/);
  assert.match(readme, /registration and deregistration/);
  assert.equal(packageData.engines?.node, ">=22");
});
