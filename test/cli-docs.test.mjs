import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const executeFile = promisify(execFile);

function firstRunShell(cli) {
  const section = cli.match(
    /The root help includes this manifest-independent first-run path[\s\S]*?```sh\n([\s\S]*?)\n```/,
  );
  assert.ok(section, "CLI docs should contain the root first-run shell block");
  return section[1];
}

test("CLI first-run flow continues diagnostics and selects deterministically", async () => {
  const cli = await readFile(
    new URL("../docs/cli.md", import.meta.url),
    "utf8",
  );
  const script = firstRunShell(cli);
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "port-start-cli-docs-"));
  const fakeCli = join(fixtureDirectory, "port-start");
  const callsPath = join(fixtureDirectory, "calls.log");

  await writeFile(
    fakeCli,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PORT_START_CALLS"
case "$*" in
  "daemon install --now")
    exit 0
    ;;
  "worktree register --json")
    printf '%s\\n' '{"ok":true,"data":{"worktree":{"selector":"wt_fixture"}}}'
    ;;
  "process list --worktree wt_fixture --json")
    printf '%s\\n' '{"ok":true,"data":{"processes":[{"selector":"proc_z","endpoints":[{"selector":"proc_z:http_z","protocol":"http"}]},{"selector":"proc_a","endpoints":[{"selector":"proc_a:https_b","protocol":"https"},{"selector":"proc_a:http_a","protocol":"http"}]}]}}'
    ;;
  "process start --worktree wt_fixture")
    exit 7
    ;;
  *)
    exit 0
    ;;
esac
`,
    "utf8",
  );
  await chmod(fakeCli, 0o755);

  try {
    await executeFile("/bin/sh", ["-c", script], {
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH}`,
        PORT_START_CALLS: callsPath,
      },
    });
    const calls = await readFile(callsPath, "utf8");
    assert.match(calls, /^process logs proc_a --run latest$/m);
    assert.match(calls, /^open proc_a:http_a$/m);
    assert.match(calls, /^worktree deregister wt_fixture$/m);
    assert.match(
      calls,
      /^run list --worktree wt_fixture --include-deregistered$/m,
    );
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
