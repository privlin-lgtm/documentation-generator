import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScannedModule } from "../src/types.js";

/** Writes `files` into a fresh temp dir, runs `fn`, then deletes the dir. */
export async function withTempDir(
  files: Record<string, string>,
  fn: (dir: string, paths: Record<string, string>) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "docgen-"));
  const paths: Record<string, string> = {};
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await writeFile(filePath, content, "utf8");
      paths[name] = filePath;
    }
    await fn(dir, paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Builds a ScannedModule fixture with sensible defaults for generator tests. */
export function makeModule(overrides: Partial<ScannedModule> = {}): ScannedModule {
  return {
    filePath: "/project/module.py",
    docstring: null,
    imports: [],
    classes: [],
    functions: [],
    language: "python",
    ...overrides,
  };
}
