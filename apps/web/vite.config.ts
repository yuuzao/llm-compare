import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { parse } from "yaml"

function backendTarget(): string {
  const path = resolve(import.meta.dirname, "../../config.yaml")
  const config = parse(readFileSync(path, "utf8")) as { server?: { host?: unknown; port?: unknown } }
  const host = config.server?.host
  const port = config.server?.port
  if (typeof host !== "string" || typeof port !== "number") {
    throw new Error(`${path} 缺少 server.host 或 server.port`)
  }
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: command === "serve" ? { proxy: { "/api": { target: backendTarget(), changeOrigin: false } } } : undefined,
}))
