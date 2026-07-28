import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentTypeFor,
  createAssetRecord,
  createWorkerSource,
} from "../scripts/build-core.mjs";

test("contentTypeFor maps supported prototype assets deterministically", () => {
  assert.equal(contentTypeFor("/index.HTML"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("/assets/app.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("/assets/mark.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("/assets/font.woff2"), "font/woff2");
  assert.equal(contentTypeFor("/og.png"), "image/png");
  assert.equal(contentTypeFor("/assets/unknown.bin"), "application/octet-stream");
});

test("createAssetRecord keeps cache policy separate from content bytes", () => {
  const html = createAssetRecord("/index.html", Buffer.from("<h1>Hello</h1>"));
  const logo = createAssetRecord("/assets/logo.svg", Buffer.from("<svg/>"));

  assert.equal(html.cacheControl, "no-cache");
  assert.equal(html.contentType, "text/html; charset=utf-8");
  assert.equal(
    Buffer.from(html.body, "base64").toString("utf8"),
    "<h1>Hello</h1>",
  );
  assert.equal(logo.cacheControl, "public, max-age=86400");
  assert.equal(logo.contentType, "image/svg+xml");
});

test("createWorkerSource serializes a self-contained worker module", () => {
  const source = createWorkerSource({
    "/": createAssetRecord("/index.html", Buffer.from("prototype")),
  });

  assert.match(source, /const FILES =/);
  assert.match(source, /Method Not Allowed/);
  assert.match(source, /url\.pathname\.startsWith\("\/assets\/"\)/);
  assert.doesNotMatch(source, /\[object Object\]/);
});
