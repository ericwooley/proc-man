import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("release configuration builds all supported desktop systems", async () => {
  const [configuration, formula] = await Promise.all([
    readFile(new URL("../.goreleaser.yaml", import.meta.url), "utf8"),
    readFile(
      new URL("../.github/homebrew/proc-man.rb.tmpl", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(configuration, /goos:\s*[\s\S]*- darwin[\s\S]*- linux[\s\S]*- windows/);
  assert.match(configuration, /goarch:\s*[\s\S]*- amd64[\s\S]*- arm64/);
  assert.match(configuration, /^dist: release-dist$/m);
  assert.match(configuration, /goos: windows\s*\n\s*formats:\s*\[zip\]/);
  assert.doesNotMatch(configuration, /^brews:$/m);
  assert.doesNotMatch(configuration, /homebrew_casks:/);
  assert.doesNotMatch(configuration, /FileUtils\./);
  assert.match(configuration, /release:\s*[\s\S]*mode: keep-existing/);
  assert.match(configuration, /replace_existing_artifacts: true/);
  assert.match(configuration, /files:\s*[\s\S]*- LICENSE[\s\S]*- README\.md/);
  assert.match(formula, /on_macos do[\s\S]*on_intel do[\s\S]*on_arm do/);
  assert.match(formula, /on_linux do[\s\S]*on_intel do[\s\S]*on_arm do/);
  assert.doesNotMatch(formula, /def post_install/);
  assert.match(formula, /proc-man daemon install --now/);
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
  assert.match(workflow, /macos-arm64-formula:/);
  assert.match(workflow, /needs: release/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /brew install ericwooley\/apps\/proc-man/);
  assert.doesNotMatch(workflow, /brew install --cask ericwooley\/apps\/proc-man/);
  assert.match(workflow, /render-homebrew-formula\.mjs/);
  assert.match(workflow, /Formula\/proc-man\.rb/);
  assert.match(workflow, /gh api --method PUT/);
  assert.doesNotMatch(workflow, /Casks\/proc-man\.rb/);
  assert.doesNotMatch(workflow, /gh api --method DELETE/);
  assert.match(workflow, /proc-man daemon install --now/);
  assert.match(workflow, /launchctl print/);
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

test("macOS ARM64 Formula checks CLI startup and LaunchAgent installation", async () => {
  const goModule = await readFile(new URL("../go.mod", import.meta.url), "utf8");
  const workflow = await readFile(
    new URL("../.github/workflows/macos-arm64.yml", import.meta.url),
    "utf8",
  );

  assert.match(goModule, /^go 1\.26$/m);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /GOARCH:\s*arm64/);
  assert.match(workflow, /mkdir -p "\$tap_path\/Formula"/);
  assert.match(workflow, /proc-man --help/);
  assert.match(workflow, /proc-man daemon install --now/);
  assert.match(workflow, /launchctl print/);
  assert.match(workflow, /brew install proc-man\/ci\/proc-man-ci/);
  assert.doesNotMatch(workflow, /brew install --cask/);
});
