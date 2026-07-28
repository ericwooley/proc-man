import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { before, test } from "node:test";

const execFileAsync = promisify(execFile);
let worker;

before(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], {
    cwd: new URL("..", import.meta.url),
  });

  const workerUrl = new URL(
    `../dist/server/index.js?test=${Date.now()}`,
    import.meta.url,
  );
  ({ default: worker } = await import(workerUrl));
});

async function fetchBuilt(pathname, init) {
  return worker.fetch(new Request(`https://prototype.test${pathname}`, init));
}

test("build serves the full-bleed Twin Listener prototype as the canonical page", async () => {
  const response = await fetchBuilt("/");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(html, /assets\/logos\/twin-listener\.svg/);
  assert.match(html, /Keep[\s\S]*worktrees quiet/);
});

test("build serves the logo gallery and its relative SVG asset", async () => {
  const galleryResponse = await fetchBuilt("/logo-showcase.html");
  const gallery = await galleryResponse.text();
  const logoResponse = await fetchBuilt("/assets/logos/twin-listener.svg");
  const logo = await logoResponse.text();

  assert.equal(galleryResponse.status, 200);
  assert.match(gallery, /Twin Listener is currently installed/);
  assert.equal(logoResponse.status, 200);
  assert.equal(logoResponse.headers.get("content-type"), "image/svg+xml");
  assert.match(logo, /<title>Twin Listener<\/title>/);
});

test("build serves all live asset types with their real content types", async () => {
  const cases = [
    ["/assets/manrope.woff2", "font/woff2", 10_000],
    ["/assets/phosphor/Phosphor.woff2", "font/woff2", 10_000],
    ["/assets/phosphor/style.css", "text/css; charset=utf-8", 1_000],
  ];

  for (const [pathname, expectedType, minimumSize] of cases) {
    const response = await fetchBuilt(pathname);
    const bytes = new Uint8Array(await response.arrayBuffer());

    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("content-type"), expectedType, pathname);
    assert.ok(bytes.byteLength > minimumSize, pathname);
  }
});

test("built worker preserves HEAD and method handling", async () => {
  const headResponse = await fetchBuilt("/assets/logos/twin-listener.svg", {
    method: "HEAD",
  });
  const postResponse = await fetchBuilt("/", { method: "POST" });

  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
});

test("built worker returns a real 404 for missing assets", async () => {
  const response = await fetchBuilt("/assets/logos/not-there.svg");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.doesNotMatch(await response.text(), /<!doctype html>/i);
});

test("build preserves the social card route and applies method checks first", async () => {
  const getResponse = await fetchBuilt("/og.png");
  const bytes = new Uint8Array(await getResponse.arrayBuffer());
  const postResponse = await fetchBuilt("/og.png", { method: "POST" });

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("content-type"), "image/png");
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
});
