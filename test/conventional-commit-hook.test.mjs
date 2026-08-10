import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const hook = resolve(".githooks/commit-msg");

async function checkMessage(message) {
  const directory = await mkdtemp(join(tmpdir(), "proc-man-commit-message-"));
  const messageFile = join(directory, "COMMIT_EDITMSG");
  await writeFile(messageFile, `${message}\n`);
  const result = spawnSync(hook, [messageFile], { encoding: "utf8" });
  await rm(directory, { recursive: true, force: true });
  return result;
}

test("commit-msg hook accepts Conventional Commit headers", async () => {
  for (const message of [
    "feat: add release archives",
    "fix(cli)!: change the command contract",
    "docs(readme): explain installation",
    'Revert "feat: add release archives"',
    "Merge branch 'main'",
  ]) {
    const result = await checkMessage(message);
    assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  }
});

test("commit-msg hook rejects nonconforming headers", async () => {
  for (const message of [
    "add release archives",
    "Feature: add release archives",
    "feat add release archives",
    "feat:",
    "wip: add release archives",
  ]) {
    const result = await checkMessage(message);
    assert.notEqual(result.status, 0, message);
    assert.match(result.stderr, /Conventional Commit/);
  }
});
