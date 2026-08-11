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
  assert.match(configuration, /name: homebrew-apps/);
  assert.match(configuration, /HOMEBREW_TAP_GITHUB_TOKEN/);
  assert.match(configuration, /hooks:\s*[\s\S]*uninstall:\s*\|[\s\S]*\["daemon", "uninstall"\]/);
  assert.match(configuration, /hooks:\s*[\s\S]*install:\s*\|[\s\S]*\["daemon", "install", "--now"\]/);
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
  assert.match(workflow, /release:\s*\n\s*name: Version and publish\s*\n\s*environment: release/);
  assert.match(workflow, /semantic-release@25\.0\.9/);
  assert.match(workflow, /steps\.version\.outputs\.tag/);
  assert.match(workflow, /inputs\.tag/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /npm ci --prefix web/);
  assert.match(workflow, /npm run build:web/);
  assert.match(workflow, /goreleaser\/goreleaser-action@v7/);
  assert.match(workflow, /args: release --clean/);
});

test("semantic release publishes Conventional Commit versions from main", async () => {
  const configuration = await readFile(
    new URL("../release.config.cjs", import.meta.url),
    "utf8",
  );

  assert.match(configuration, /branches:\s*\["main"\]/);
  assert.match(configuration, /tagFormat:\s*"v\$\{version\}"/);
  assert.match(configuration, /@semantic-release\/commit-analyzer/);
  assert.match(configuration, /@semantic-release\/release-notes-generator/);
  assert.match(configuration, /@semantic-release\/github/);
});
