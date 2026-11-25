/** Injected at build time from package.json via wxt vite `define` (single version source). */
declare const __LESEN_VERSION__: string;

export const PRODUCT_VERSION: string =
  typeof __LESEN_VERSION__ !== "undefined" ? __LESEN_VERSION__ : "0.0.0-dev";