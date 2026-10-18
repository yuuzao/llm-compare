import { getAsset, getAssetKeys, isSea } from "node:sea";
import type { MiddlewareHandler } from "hono";
import { extname } from "node:path";

export function embeddedWeb(): MiddlewareHandler {
  if (!isSea()) throw new Error("embedded 前端只能由发行版可执行文件提供，请为源码运行配置 web_dist_dir 路径");
  const keys = new Set(getAssetKeys().filter((key) => key.startsWith("web/")));
  if (!keys.has("web/index.html")) throw new Error("可执行文件缺少前端入口");
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
    ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  };
  return async (c) => {
    if (!["GET", "HEAD"].includes(c.req.method)) return c.notFound();
    let path: string;
    try { path = decodeURIComponent(c.req.path); } catch { return c.notFound(); }
    if (path.split("/").some((part) => part === ".." || part === "." || part.includes("\\"))) return c.notFound();
    let key = `web${path}`;
    if (!keys.has(key)) {
      if (path.startsWith("/assets/") || extname(path)) return c.notFound();
      key = "web/index.html";
    }
    const data = getAsset(key);
    const headers = {
      "content-type": types[extname(key)] ?? "application/octet-stream",
      "content-length": String(data.byteLength),
      "cache-control": key.startsWith("web/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    };
    return new Response(c.req.method === "HEAD" ? null : data, { headers });
  };
}
