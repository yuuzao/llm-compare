import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { service: "llm-compare" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["*.env[*].value", "env[*].value", "*.authorization", "*.cookie"], censor: "[已脱敏]" },
});

export type Logger = typeof logger;
