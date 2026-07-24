import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const socialCard = await readFile(new URL("../public/og.png", import.meta.url));
const encodedSocialCard = socialCard.toString("base64");

const worker = `
const HTML = ${JSON.stringify(html)};
const SOCIAL_CARD = ${JSON.stringify(encodedSocialCard)};

function decodeBase64(value) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return bytes;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/og.png") {
      return new Response(decodeBase64(SOCIAL_CARD), {
        headers: {
          "cache-control": "public, max-age=86400",
          "content-type": "image/png"
        }
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" }
      });
    }

    return new Response(request.method === "HEAD" ? null : HTML, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      }
    });
  }
};
`;

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist/server", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/server/index.js", import.meta.url), worker);

console.log("Built the Port Start HTML prototype.");
