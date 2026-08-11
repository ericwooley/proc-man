import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  parseChecksums,
  renderFormula,
} from "../scripts/render-homebrew-formula.mjs";

const checksums = `
${"1".repeat(64)}  proc-man_2.3.4_darwin_amd64.tar.gz
${"2".repeat(64)}  proc-man_2.3.4_darwin_arm64.tar.gz
${"3".repeat(64)}  proc-man_2.3.4_linux_amd64.tar.gz
${"4".repeat(64)}  proc-man_2.3.4_linux_arm64.tar.gz
${"5".repeat(64)}  proc-man_2.3.4_windows_amd64.zip
`;

test("parseChecksums ignores malformed lines", () => {
  const result = parseChecksums(`invalid\n${checksums}`);
  assert.equal(result.size, 5);
});

test("renderFormula inserts the version and required checksums", async () => {
  const template = await readFile(
    new URL("../.github/homebrew/proc-man.rb.tmpl", import.meta.url),
    "utf8",
  );

  const result = renderFormula(template, "2.3.4", checksums);

  assert.match(result, /version "2\.3\.4"/);
  assert.match(result, new RegExp(`sha256 "${"1".repeat(64)}"`));
  assert.match(result, new RegExp(`sha256 "${"4".repeat(64)}"`));
  assert.doesNotMatch(result, /__[A-Z0-9_]+__/);
  assert.match(result, /system bin\/"proc-man", "daemon", "install", "--now"/);
});

test("renderFormula rejects an invalid version", () => {
  assert.throws(
    () => renderFormula("__VERSION__", "2.3.4; unsafe", checksums),
    /invalid release version/,
  );
});

test("renderFormula requires each supported archive", () => {
  assert.throws(
    () => renderFormula("__VERSION__", "2.3.4", checksums.replace(/.*linux_arm64.*\n/, "")),
    /missing checksum for proc-man_2\.3\.4_linux_arm64\.tar\.gz/,
  );
});
