/** Node bridge: keep in sync with src/lib/wxt-public-env.ts (subset). */
export function parseWxtPublicEnvFile(content) {
  const out = {};
  for (const line of String(content).split(/\r?\n/)) {
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

export function officialPackClientConflict(productionClientId, localDevClientId) {
  const production = productionClientId.trim();
  const localDev = localDevClientId.trim();
  if (!production || !localDev) return null;
  if (production === localDev) {
    return "Refusing to pack a store zip with the local dev Google OAuth client from .env.local.";
  }
  return null;
}