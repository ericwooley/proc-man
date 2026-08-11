import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("CLI docs cover process registration, execution, logs, and manifest hooks", async () => {
  const cli = await readFile(
    new URL("../docs/cli.md", import.meta.url),
    "utf8",
  );

  assert.match(cli, /proc-man process register/);
  assert.match(cli, /proc-man process list --directory \./);
  assert.match(cli, /without a manifest file/);
  assert.match(cli, /proc-man process start PROCESS_ID/);
  assert.match(cli, /proc-man process run PROCESS_ID/);
  assert.match(cli, /proc-man process logs PROCESS_ID/);
  assert.match(cli, /proc-man process deregister PROCESS_ID/);
  assert.match(cli, /proc-man register --dry-run --json/);
  assert.match(
    cli,
    /proc-man deregister --source "\$PWD\/\.proc-man\.yaml"/,
  );
  assert.doesNotMatch(cli, /├── worktree|├── command/);
});

test("daemon documentation uses one default command on Linux and macOS", async () => {
  const paths = [
    "../README.md",
    "../docs/operations.md",
    "../docs/cli.md",
    "../internal/cli/agent_instructions.md",
  ];

  for (const path of paths) {
    const content = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(content, /proc-man daemon install --now/, path);
    assert.match(content, /Linux/, path);
    assert.match(content, /macOS/, path);
  }
});
