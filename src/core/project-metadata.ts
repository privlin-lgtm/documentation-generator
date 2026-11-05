import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Facts read from manifest files in the project root (package.json,
 * pyproject.toml, setup.cfg, requirements.txt). The README generator uses
 * them when the source code alone doesn't say how to install the project or
 * what it is.
 */
export interface ProjectMetadata {
  /** A one-line project description from a manifest, if any declares one. */
  description: string | null;
  /** Install commands detected from root files, keyed by language. */
  installSteps: Record<string, string[]>;
}

export const EMPTY_PROJECT_METADATA: ProjectMetadata = { description: null, installSteps: {} };

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function packageJsonDescription(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "description" in parsed) {
      return nonEmpty((parsed as { description: unknown }).description);
    }
  } catch {
    // A malformed package.json shouldn't abort README generation.
  }
  return null;
}

/** Returns the body of one `[section]` of an INI/TOML file, up to the next header. */
function sectionBody(raw: string, section: string): string | null {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Reads `description = "..."` from pyproject.toml's `[project]` (or `[tool.poetry]`) table. */
function pyprojectDescription(raw: string): string | null {
  for (const section of ["project", "tool.poetry"]) {
    const body = sectionBody(raw, section);
    const match = body?.match(/^\s*description\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/m);
    const value = nonEmpty(match?.[1] ?? match?.[2]);
    if (value) return value;
  }
  return null;
}

/** Reads `description = ...` from setup.cfg's `[metadata]` section. */
function setupCfgDescription(raw: string): string | null {
  const match = sectionBody(raw, "metadata")?.match(/^\s*description\s*[=:]\s*(.+)$/m);
  return nonEmpty(match?.[1]);
}

/** Reads manifest files from `rootDir`. Missing or unreadable files are skipped. */
export async function readProjectMetadata(rootDir: string): Promise<ProjectMetadata> {
  const [packageJson, pyproject, setupCfg, setupPy, requirements] = await Promise.all(
    ["package.json", "pyproject.toml", "setup.cfg", "setup.py", "requirements.txt"].map((name) =>
      readOptional(path.join(rootDir, name))
    )
  );

  const installSteps: Record<string, string[]> = {};
  if (packageJson !== null) {
    installSteps.javascript = ["npm install"];
  }
  if (requirements !== null) {
    installSteps.python = ["pip install -r requirements.txt"];
  } else if (pyproject !== null || setupCfg !== null || setupPy !== null) {
    installSteps.python = ["pip install ."];
  }

  const description =
    (packageJson !== null ? packageJsonDescription(packageJson) : null) ??
    (pyproject !== null ? pyprojectDescription(pyproject) : null) ??
    (setupCfg !== null ? setupCfgDescription(setupCfg) : null);

  return { description, installSteps };
}
