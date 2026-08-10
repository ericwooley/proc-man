import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("release configuration builds all supported desktop systems", async () => {
  const configuration = await readFile(
    new URL("../.goreleaser.yaml", import.meta.url),
    "utf8",
  );

  assert.match(configuration, /goos:\s*[\s\S]*- darwin[\s\S]*- linux[\s\S]*- windows/);
  assert.match(configuration, /goarch:\s*[\s\S]*- amd64[\s\S]*- arm64/);
  assert.match(configuration, /^dist: release-dist$/m);
  assert.match(configuration, /goos: windows\s*\n\s*formats:\s*\[zip\]/);
  assert.match(configuration, /homebrew_casks:/);
  assert.match(configuration, /homepage:.*GITHUB_REPOSITORY/);
  assert.match(configuration, /name: homebrew-tap/);
  assert.match(configuration, /HOMEBREW_TAP_GITHUB_TOKEN/);
});

test("tag workflow publishes releases after building the React application", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /npm ci --prefix web/);
  assert.match(workflow, /npm run build:web/);
  assert.match(workflow, /goreleaser\/goreleaser-action@v7/);
  assert.match(workflow, /args: release --clean/);
});
