import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");

export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  const version = String(pkg.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid package.json version: ${version || "(empty)"}`);
  }
  return version;
}