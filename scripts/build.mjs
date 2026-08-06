import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createAssetRecord, createWorkerSource } from "./build-core.mjs";

const prototypeRoot = new URL("../prototype/", import.meta.url);
const files = {};

async function addFile(route, sourceUrl) {
  files[route] = createAssetRecord(sourceUrl.pathname, await readFile(sourceUrl));
}

async function addDirectory(directoryUrl, routePrefix) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourceUrl = new URL(entry.name, directoryUrl);
    const route = `${routePrefix}/${entry.name}`;

    if (entry.isDirectory()) {
      await addDirectory(new URL(`${entry.name}/`, directoryUrl), route);
    } else if (entry.isFile()) {
      await addFile(route, sourceUrl);
    }
  }
}

await addFile("/", new URL("index.html", prototypeRoot));
files["/index.html"] = files["/"];
await addFile(
  "/logo-showcase.html",
  new URL("logo-showcase.html", prototypeRoot),
);
await addDirectory(new URL("assets/", prototypeRoot), "/assets");

const worker = createWorkerSource(files);

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist/server", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/server/index.js", import.meta.url), worker);

console.log("Built the Proc Man HTML prototype.");
