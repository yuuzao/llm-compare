declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
export const buildInfo = {
  version: typeof __APP_VERSION__ === "undefined" ? "development" : __APP_VERSION__,
  commit: typeof __BUILD_COMMIT__ === "undefined" ? "development" : __BUILD_COMMIT__,
};
