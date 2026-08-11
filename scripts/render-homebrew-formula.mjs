#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const targets = [
  ["DARWIN_AMD64", "darwin_amd64"],
  ["DARWIN_ARM64", "darwin_arm64"],
  ["LINUX_AMD64", "linux_amd64"],
  ["LINUX_ARM64", "linux_arm64"],
];

export function parseChecksums(text) {
  const checksums = new Map();

  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+(.+)$/);
    if (match) {
      checksums.set(match[2], match[1]);
    }
  }

  return checksums;
}

export function renderFormula(template, version, checksumText) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }

  const checksums = parseChecksums(checksumText);
  let result = template.replaceAll("__VERSION__", version);

  for (const [placeholderTarget, artifactTarget] of targets) {
    const artifact = `proc-man_${version}_${artifactTarget}.tar.gz`;
    const checksum = checksums.get(artifact);
    if (!checksum) {
      throw new Error(`missing checksum for ${artifact}`);
    }
    result = result.replaceAll(`__${placeholderTarget}_SHA256__`, checksum);
  }

  if (/__[A-Z0-9_]+__/.test(result)) {
    throw new Error("the Formula template contains an unresolved placeholder");
  }

  return result;
}

async function main([version, checksumPath, templatePath, outputPath]) {
  if (!version || !checksumPath || !templatePath || !outputPath) {
    throw new Error(
      "usage: render-homebrew-formula VERSION CHECKSUMS TEMPLATE OUTPUT",
    );
  }

  const [checksumText, template] = await Promise.all([
    readFile(checksumPath, "utf8"),
    readFile(templatePath, "utf8"),
  ]);
  await writeFile(outputPath, renderFormula(template, version, checksumText));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
