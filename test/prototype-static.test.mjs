import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const prototypeDirectory = new URL("../prototype/", import.meta.url);
const htmlFiles = ["index.html", "logo-showcase.html"];

function visibleCopy(html) {
  return html
    .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, "");
}

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
  return block.match(
    new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i"),
  )?.[1];
}

test("served prototype contains only runtime surfaces and assets", async () => {
  const entries = (await readdir(prototypeDirectory)).sort();
  assert.deepEqual(entries, ["assets", ...htmlFiles].sort());
});

test("prototype HTML has unique IDs and valid inline scripts", async () => {
  for (const filename of htmlFiles) {
    const html = await readFile(new URL(filename, prototypeDirectory), "utf8");
    const staticHtml = html.replace(
      /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi,
      "",
    );
    const ids = [...staticHtml.matchAll(/\sid="([^"]+)"/g)].map(
      match => match[1],
    );
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

test("dashboard exposes one process inventory with labels, tags, ports, and logs", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const copy = visibleCopy(html);

  for (const term of [
    "Processes",
    "Filter by label, tag, or port",
    "Group by tag",
    "Register process",
    "Deregister",
  ]) {
    assert.match(copy, new RegExp(term));
  }
  for (const action of ["Start", "Stop", "Restart", "Run", "Cancel"]) {
    assert.match(html, new RegExp(action));
  }
  assert.match(html, /Search this run/);

  assert.doesNotMatch(copy, /\bworktrees?\b/i);
  assert.doesNotMatch(copy, /\bcommands section\b/i);
  assert.doesNotMatch(html, /\bWORKTREES\b|data-worktree|worktreePath/);
});

test("process fixtures use stable unique IDs, labels, tags, kinds, and declared ports", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");
  const fixtureBlock = html.match(
    /const PROCESSES = \[([\s\S]*?)\n  \]\n\n  const [A-Z_]+ =/,
  )?.[1];

  assert.ok(fixtureBlock);
  const ids = [...fixtureBlock.matchAll(/\bid: "(proc_[^"]+)"/g)].map(
    match => match[1],
  );
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal([...fixtureBlock.matchAll(/\blabel: "/g)].length, ids.length);
  assert.equal([...fixtureBlock.matchAll(/\btags: \[/g)].length, ids.length);
  assert.equal([...fixtureBlock.matchAll(/\bkind: "(?:service|task)"/g)].length, ids.length);
  assert.match(fixtureBlock, /port: 4310[\s\S]*?port: 9310/);
  assert.match(fixtureBlock, /tags: \[\]/);
  assert.doesNotMatch(fixtureBlock, /\bport:\s*["']?auto\b/i);
});

test("filtering and tag grouping preserve process identity", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(html, /state\.tags\.size[\s\S]*?every\(tag => processHasTag/);
  assert.match(html, /function matchesFilters\(process\)/);
  assert.match(html, /function uniqueTags\(\)/);
  assert.match(html, /function processHasTag\(process, tag\)/);
  assert.match(html, /data-tag-group=/);
  assert.match(html, /data-process-id="\$\{process\.id\}"/);
  assert.match(html, /processes\.map\(process =>[\s\S]*?processMarkup\(process/);
  assert.match(html, /state\.groupByTag/);
  assert.match(html, /untagged/);
});

test("process actions, logs, registration, and deregistration are wired", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(html, /id="processDetail"/);
  assert.match(html, /function openProcessDetail\(processId/);
  assert.match(html, /function detailMarkup\(process\)/);
  assert.match(html, /data-open-process=/);
  assert.match(html, /data-detail-run=/);
  assert.match(html, /id="detailLogSearch"/);
  assert.match(html, /id="detailStdout"/);
  assert.match(html, /id="detailStderr"/);
  assert.match(html, /id="detailFollow"/);
  assert.match(html, /id="detailDownload"/);
  assert.match(html, /function serviceAction\(process, action\)/);
  assert.match(html, /function taskAction\(process, action\)/);
  assert.match(html, /function logMarkup\(process, instanceKey\)/);
  assert.match(html, /state\.logQueries/);
  assert.match(html, /PROCESSES\.splice\(index, 1\)/);
  assert.match(html, /id="registerDialog"/);
  assert.match(html, /id="deregisterDialog"/);
  assert.match(html, /proc-man process register/);
  assert.match(html, /Retained run logs stay available/);
  assert.match(html, /Storefront web compiled client bundle/);
  assert.match(html, /Platform API listening on/);
  assert.match(html, /data-run-select/);
  assert.match(html, /The process exited with code 1\./);
  assert.doesNotMatch(html, /accepted connections/i);
  assert.match(html, /data-state="populated"/);
  assert.match(html, /data-state="loading"/);
  assert.match(html, /data-state="empty"/);
  assert.match(html, /data-state="error"/);
});

test("prototype uses local icons and excludes legacy network behavior", async () => {
  const [dashboard, brand, logoEntries] = await Promise.all([
    readFile(new URL("index.html", prototypeDirectory), "utf8"),
    readFile(new URL("logo-showcase.html", prototypeDirectory), "utf8"),
    readdir(new URL("assets/logos/", prototypeDirectory)),
  ]);
  const copy = visibleCopy(dashboard);

  assert.match(dashboard, /assets\/phosphor\/style\.css/);
  assert.match(dashboard, /assets\/logos\/port-matrix\.svg/);
  assert.match(brand, /Port Matrix is the product mark/);
  assert.doesNotMatch(dashboard, /<svg\b/i);
  assert.doesNotMatch(brand, /<svg\b/i);
  assert.deepEqual(logoEntries.sort(), ["port-matrix.svg"]);

  for (const retiredConcept of [
    /\bwake(?:-on-port)?\b/i,
    /\bhandoff\b/i,
    /\bforwarding\b/i,
    /\bmanaged ports?\b/i,
    /\bport allocation\b/i,
    /\bport ownership\b/i,
  ]) {
    assert.doesNotMatch(copy, retiredConcept);
  }
});

test("core controls expose keyboard and screen-reader state", async () => {
  const html = await readFile(new URL("index.html", prototypeDirectory), "utf8");

  assert.match(html, /role="switch" aria-checked="false"/);
  assert.match(html, /aria-expanded="\$\{isOpen\}"/);
  assert.match(html, /aria-expanded="\$\{!collapsed\}"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /function trapDialogFocus\(event\)/);
  assert.match(html, /document\.getElementById\("application"\)\.inert = true/);
  assert.match(html, /event\.key === "Escape"/);
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
    const surface = cssToken(block, "surface");
    const surfaceSoft = cssToken(block, "surface-soft");
    const shell = cssToken(block, "shell");
    const rail = cssToken(block, "rail");
    const goodInk = cssToken(block, "badge-good-ink");
    const goodBackground = cssToken(block, "badge-good-bg");
    const warningInk = cssToken(block, "badge-warning-ink");
    const warningBackground = cssToken(block, "badge-warning-bg");
    const dangerInk = cssToken(block, "badge-danger-ink");
    const dangerBackground = cssToken(block, "badge-danger-bg");

    for (const token of [
      ink,
      muted,
      focus,
      focusInverse,
      surface,
      surfaceSoft,
      shell,
      rail,
      goodInk,
      goodBackground,
      warningInk,
      warningBackground,
      dangerInk,
      dangerBackground,
    ]) {
      assert.ok(token, `${theme} token is present`);
    }
    assert.ok(contrastRatio(ink, surface) >= 4.5, `${theme} primary copy`);
    assert.ok(contrastRatio(muted, surface) >= 4.5, `${theme} secondary copy`);
    assert.ok(contrastRatio(muted, surfaceSoft) >= 4.5, `${theme} neutral state`);
    assert.ok(contrastRatio(focus, surface) >= 3, `${theme} surface focus`);
    assert.ok(contrastRatio(focus, shell) >= 3, `${theme} shell focus`);
    assert.ok(contrastRatio(focusInverse, rail) >= 3, `${theme} rail focus`);
    assert.ok(
      contrastRatio(goodInk, goodBackground) >= 4.5,
      `${theme} positive state`,
    );
    assert.ok(
      contrastRatio(warningInk, warningBackground) >= 4.5,
      `${theme} transition state`,
    );
    assert.ok(
      contrastRatio(dangerInk, dangerBackground) >= 4.5,
      `${theme} failure state`,
    );
  }
});

test("CLI contract starts from the process inventory and supports tag filters", async () => {
  const cli = await readFile(new URL("../docs/cli.md", import.meta.url), "utf8");

  assert.match(cli, /proc-man process list/);
  assert.match(cli, /--tag frontend --tag project:storefront/);
  assert.match(cli, /Repeated tag flags use AND behavior/);
  assert.match(cli, /proc-man process register/);
  assert.match(cli, /proc-man process deregister PROCESS_ID/);
  assert.match(cli, /proc-man process start/);
  assert.match(cli, /proc-man process run/);
  assert.match(cli, /proc-man process logs/);
  assert.match(cli, /proc-man register --dry-run --json/);
  assert.doesNotMatch(cli, /├── worktree|├── command/);
});

test("API and domain contracts retain process labels, tags, runs, and logs", async () => {
  const [api, domain, logging] = await Promise.all([
    readFile(new URL("../docs/api.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/domain-model.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/logging.md", import.meta.url), "utf8"),
  ]);

  assert.match(api, /GET \/api\/v1\/processes/);
  assert.match(api, /POST \/api\/v1\/processes/);
  assert.match(api, /GET \/api\/v1\/runs/);
  assert.match(api, /POST \/api\/v1\/run-search/);
  assert.match(api, /List and filter processes/);
  assert.doesNotMatch(api, /GET \/api\/v1\/worktrees/);
  assert.match(domain, /Tag grouping can show one process in several groups/);
  assert.match(domain, /Start and Run return `cwd_unavailable`/);
  assert.match(api, /`cwd_unavailable`/);
  assert.match(logging, /Logs remain after process deregistration/);
});

test("browser prerequisites and override are documented", async () => {
  const [readme, packageJson] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.match(readme, /Node\.js 22/i);
  assert.match(readme, /`jq` 1\.6 or newer/i);
  assert.match(readme, /global `WebSocket`/i);
  assert.match(readme, /CHROME_BIN/);
  assert.match(readme, /process inventory/);
  assert.equal(packageData.engines?.node, ">=22");
});

test("design QA evidence records the process inventory and detail comparisons", async () => {
  const designQa = await readFile(
    new URL("../design-qa.md", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(designQa, /\/tmp\//);
  assert.match(designQa, /original process-ledger prototype/i);
  assert.match(designQa, /The detail route is `\/process\/:processId`/);
  assert.match(designQa, /production browser check passed/i);
  for (const asset of [
    "react-processes-desktop.png",
    "react-process-detail-desktop.png",
    "react-process-detail-mobile.png",
  ]) {
    const bytes = await readFile(
      new URL(`../docs/assets/design-qa/${asset}`, import.meta.url),
    );
    assert.ok(bytes.byteLength > 25_000, asset);
  }
});
