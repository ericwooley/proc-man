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
  assert.match(configuration, /release:\s*[\s\S]*mode: keep-existing/);
  assert.match(configuration, /replace_existing_artifacts: true/);
  assert.match(configuration, /files:\s*[\s\S]*- LICENSE[\s\S]*- README\.md/);
});

test("main workflow versions Conventional Commits and publishes release artifacts", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /googleapis\/release-please-action@v4/);
  assert.match(workflow, /release_created == 'true'/);
  assert.match(workflow, /inputs\.tag/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /npm ci --prefix web/);
  assert.match(workflow, /npm run build:web/);
  assert.match(workflow, /goreleaser\/goreleaser-action@v7/);
  assert.match(workflow, /args: release --clean/);
});

test("release manifest bootstraps proc-man semantic versions", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("../release-please-config.json", import.meta.url), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(new URL("../.release-please-manifest.json", import.meta.url), "utf8"),
  );

  assert.equal(configuration.packages["."]["release-type"], "go");
  assert.equal(configuration.packages["."]["package-name"], "proc-man");
  assert.match(configuration["bootstrap-sha"], /^[0-9a-f]{40}$/);
  assert.equal(manifest["."], "0.0.0");
});
