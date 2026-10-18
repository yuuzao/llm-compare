import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { AppError } from "../errors.ts";

export const UI_COOKIE = "llm_compare_ui";
export const UI_HEADER = "x-llm-compare";

export function loadUiToken(dataDir: string): string {
  const path = join(dataDir, "ui-session-token");
  if (existsSync(path)) {
    const t = readFileSync(path, "utf8").trim();
    if (t.length < 32) throw new Error(`${path} 内容无效，请删除后重启`);
    return t;
  }
  const t = randomBytes(32).toString("base64url");
  writeFileSync(path, t, { mode: 0o600 });
  return t;
}

export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let host: string;
  try {
    host = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]";
}

export const hostGuard: MiddlewareHandler = async (c, next) => {
  if (!isLoopbackHost(c.req.header("host"))) throw new AppError("forbidden_host", "只接受回环地址访问");
  await next();
};

export function writeGuard(token: string): MiddlewareHandler {
  return async (c, next) => {
    const isStream = c.req.path.endsWith("/stream");
    const isWrite = !["GET", "HEAD"].includes(c.req.method);
    if (isWrite || isStream) {
      const origin = c.req.header("origin");
      if (origin && !isLoopbackHost(new URL(origin).host)) throw new AppError("unauthenticated", "请求来源不是本机工作台");
      if (getCookie(c, UI_COOKIE) !== token) throw new AppError("unauthenticated", "缺少工作台会话，请刷新页面");
      if (isWrite && c.req.header(UI_HEADER) !== "1") throw new AppError("unauthenticated", "写操作只接受工作台前端的请求");
    }
    await next();
  };
}
