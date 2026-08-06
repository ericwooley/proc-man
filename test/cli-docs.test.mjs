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
    /## First-run path[\s\S]*?```sh\n([\s\S]*?)\n```/,
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
  let jqVersion;
  try {
    jqVersion = await executeFile("jq", ["--version"]);
  } catch {
    assert.fail(
      "jq 1.6 or newer is required for the documented CLI walkthrough test; see README.md",
    );
  }
  const version = jqVersion.stdout.trim().match(/^jq-(\d+)\.(\d+)/);
  assert.ok(
    version &&
      (Number(version[1]) > 1 ||
        (Number(version[1]) === 1 && Number(version[2]) >= 6)),
    "jq 1.6 or newer is required for the documented CLI walkthrough test",
  );
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "proc-man-cli-docs-"));
  const fakeCli = join(fixtureDirectory, "proc-man");
  const callsPath = join(fixtureDirectory, "calls.log");

  await writeFile(
    fakeCli,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PROC_MAN_CALLS"
case "$*" in
  "daemon install --now")
    exit 0
    ;;
  "register --json")
    printf '%s\\n' '{"ok":true,"data":{"processes":[{"selector":"proc_z","kind":"task","endpoints":[]},{"selector":"proc_a","kind":"service","endpoints":[{"selector":"endpoint_https_b","protocol":"https"},{"selector":"endpoint_http_a","protocol":"http"}]}]}}'
    ;;
  "process start proc_a")
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
        PROC_MAN_CALLS: callsPath,
      },
    });
    const calls = await readFile(callsPath, "utf8");
    assert.match(calls, /^process logs proc_a --run latest$/m);
    assert.match(calls, /^open endpoint_http_a$/m);
    assert.match(calls, /^process list$/m);
    assert.match(calls, /^process start proc_a$/m);
    assert.doesNotMatch(calls, /^worktree /m);
    assert.doesNotMatch(calls, /^command /m);
    assert.match(
      cli,
      /## Worktree hook example[\s\S]*?proc-man register --json[\s\S]*?proc-man deregister --source "\$PWD\/\.proc-man\.yaml"/,
    );
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
