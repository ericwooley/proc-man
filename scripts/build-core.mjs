const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

export function contentTypeFor(pathname) {
  const dotIndex = pathname.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : pathname.slice(dotIndex).toLowerCase();

  return CONTENT_TYPES.get(extension) ?? "application/octet-stream";
}

export function createAssetRecord(pathname, bytes) {
  return {
    body: bytes.toString("base64"),
    cacheControl: pathname.endsWith(".html")
      ? "no-cache"
      : "public, max-age=86400",
    contentType: contentTypeFor(pathname),
  };
}

export function createWorkerSource(files) {
  return `
const FILES = ${JSON.stringify(files)};

function decodeBase64(value) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return bytes;
}

function responseFor(file, method) {
  return new Response(method === "HEAD" ? null : decodeBase64(file.body), {
    headers: {
      "cache-control": file.cacheControl,
      "content-type": file.contentType,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" }
      });
    }

    const url = new URL(request.url);
    const exactFile = FILES[url.pathname];

    if (exactFile) {
      return responseFor(exactFile, request.method);
    }

    if (url.pathname.startsWith("/assets/")) {
      return new Response(request.method === "HEAD" ? null : "Not Found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff"
        }
      });
    }

    return responseFor(FILES["/"], request.method);
  }
};
`;
}
