#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readPackageVersion, repoRoot } from "./lib/read-package-version.mjs";
import { findReleaseSection } from "./lib/changelog-release-notes.mjs";

const version = process.argv[2] || readPackageVersion();
const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const notes = findReleaseSection(changelog, version);
if (!notes) {
  console.error(`No CHANGELOG section for version ${version}`);
  process.exit(1);
}
process.stdout.write(notes + "\n");