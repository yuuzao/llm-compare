import type { ApiError } from "@llm-compare/shared"

const BASE = "/api/v1"

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

let session: Promise<void> | null = null

function ensureSession(): Promise<void> {
  session ??= fetch(`${BASE}/ui-session`, { credentials: "same-origin" }).then(async (res) => {
    if (!res.ok) {
      session = null
      throw await toError(res)
    }
  })
  return session
}

async function toError(res: Response): Promise<ApiRequestError> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as ApiError
    return new ApiRequestError(res.status, body.error.code, body.error.message, body.error.fields ?? {})
  } catch {
    return new ApiRequestError(res.status, "network", `服务暂时无法访问（HTTP ${res.status}）`, {})
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  await ensureSession()
  const headers: Record<string, string> = {}
  if (method !== "GET") headers["x-llm-compare"] = "1"
  if (body !== undefined && !(body instanceof FormData)) headers["content-type"] = "application/json"
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, "network", "无法连接到工作台后端，请确认后端已启动", {})
  }
  if (!res.ok) throw await toError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: (path: string) => request<void>("DELETE", path),
}

export function streamUrl(path: string, after: number): string {
  return `${BASE}${path}?after=${after}`
}

export { ensureSession }

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const fields = Object.entries(err.fields)
    return fields.length > 0 ? `${err.message}（${fields.map(([k, v]) => `${k}: ${v}`).join("；")}）` : err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ""
}
