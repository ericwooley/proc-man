import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));

test("the CLI cross-compiles for Windows", { timeout: 120_000 }, async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "proc-man-windows-build-"));
  const binary = join(outputDirectory, "proc-man.exe");

  try {
    const result = await run("go", ["build", "-o", binary, "./cmd/proc-man"], {
      ...process.env,
      CGO_ENABLED: "0",
      GOARCH: "amd64",
      GOOS: "windows",
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
});

function run(command, arguments_, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: repository, env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}
