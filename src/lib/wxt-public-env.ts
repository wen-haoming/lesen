/** Load WXT_PUBLIC_* env files with Vite-compatible later-wins order. Existing process.env wins. */

export const WXT_PUBLIC_ENV_FILE_ORDER = [
  ".env",
  ".env.local",
  ".env.$MODE",
  ".env.$MODE.local",
] as const;

export function publicEnvFileNames(mode: string): string[] {
  return [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
}

export function parseWxtPublicEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key.startsWith("WXT_PUBLIC_")) continue;
    out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function mergeWxtPublicEnvFiles(
  filesInOrder: Array<Record<string, string>>,
  existingProcessEnv: Record<string, string | undefined>,
): Record<string, string> {
  const fromFiles: Record<string, string> = {};
  for (const file of filesInOrder) {
    Object.assign(fromFiles, file);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fromFiles)) {
    const existing = existingProcessEnv[key];
    result[key] = existing !== undefined ? existing : value;
  }
  return result;
}

export function isOfficialZipCommand(argv: string[], lifecycleEvent?: string): boolean {
  if (lifecycleEvent === "zip" || lifecycleEvent === "store:zip") return true;
  return argv.some((arg) => arg === "zip" || arg.endsWith("/zip") || arg.endsWith("\\zip"));
}

export function officialPackClientConflict(productionClientId: string, localDevClientId: string): string | null {
  const production = productionClientId.trim();
  const localDev = localDevClientId.trim();
  if (!production || !localDev) return null;
  if (production === localDev) {
    return "Refusing to pack a store zip with the local dev Google OAuth client from .env.local. Put the Chrome Extension client for the store item ID in .env.production.local.";
  }
  return null;
}
