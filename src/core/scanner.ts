import fg from "fast-glob";
import ignore from "ignore";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/__pycache__/**",
  "**/*.min.js",
  "**/venv/**",
  "**/.venv/**",
];

/** Finds files matching `patterns` under `rootDir`, respecting the project's .gitignore. */
export async function findSourceFiles(rootDir: string, patterns: string[]): Promise<string[]> {
  const ig = ignore();
  try {
    const gitignore = await readFile(path.join(rootDir, ".gitignore"), "utf8");
    ig.add(gitignore);
  } catch {
    // No .gitignore present; proceed without extra rules.
  }

  const matches = await fg(patterns, {
    cwd: rootDir,
    ignore: DEFAULT_IGNORES,
    absolute: false,
    dot: false,
  });

  return matches
    .filter((relPath) => !ig.ignores(relPath))
    .map((relPath) => path.join(rootDir, relPath))
    .sort();
}
