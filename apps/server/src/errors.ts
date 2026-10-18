export type ErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden_host"
  | "not_found"
  | "conflict"
  | "unsupported_configuration"
  | "service_unavailable";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden_host: 403,
  not_found: 404,
  conflict: 409,
  unsupported_configuration: 422,
  service_unavailable: 503,
};

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.status = STATUS[code];
  }
}

export const notFound = (what: string): AppError => new AppError("not_found", `${what}不存在`);
export const conflict = (message: string): AppError => new AppError("conflict", message);
export const unsupported = (message: string, fields?: Record<string, string>): AppError =>
  new AppError("unsupported_configuration", message, fields);
