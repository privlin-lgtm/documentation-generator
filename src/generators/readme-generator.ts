import path from "node:path";
import { EMPTY_PROJECT_METADATA, type ProjectMetadata } from "../core/project-metadata.js";
import type { ProjectStructure } from "../types.js";
import { renderSignature } from "./signature.js";

const INSTALL_SNIPPETS: Record<string, string[]> = {
  python: ["pip install -r requirements.txt"],
  javascript: ["npm install"],
  typescript: ["npm install"],
};

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
};

function displayName(language: string): string {
  return LANGUAGE_DISPLAY_NAMES[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

function isPackageEntryFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === "__init__.py" || /^index\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(base);
}

function findProjectDescription(structure: ProjectStructure): string | null {
  const entryModule = structure.modules.find((m) => isPackageEntryFile(m.filePath));
  if (entryModule?.docstring) return entryModule.docstring.trim();

  const anyDocstring = structure.modules.find((m) => m.docstring)?.docstring;
  return anyDocstring ? anyDocstring.trim() : null;
}

function summarizePublicApi(structure: ProjectStructure, limit = 12): string[] {
  const entries: string[] = [];
  for (const mod of structure.modules) {
    for (const cls of mod.classes) {
      if (cls.name.startsWith("_")) continue;
      entries.push(`\`${cls.name}\` — ${cls.docstring?.split("\n")[0] ?? "class"}`);
    }
    for (const fn of mod.functions) {
      if (fn.name.startsWith("_")) continue;
      entries.push(
        `\`${renderSignature(fn, mod.language)}\` — ${fn.docstring?.split("\n")[0] ?? "function"}`
      );
    }
  }
  return entries.slice(0, limit);
}

/**
 * Renders the Installation section. Steps detected from the project's own
 * files win over the per-language defaults in INSTALL_SNIPPETS; a language
 * with neither is left out, and the whole section is omitted when no language
 * has known steps. Languages whose step lists are identical share one block
 * (e.g. JavaScript and TypeScript both using `npm install`), so the same
 * command is never repeated. When only one block remains it is rendered plain;
 * otherwise each block gets a subheading naming its languages, joined with
 * " / " in order of first appearance, so no install step is lost or implied to
 * be another's replacement. Blocks are ordered by how many scanned modules
 * their languages cover (most first, so the project's main language leads),
 * with ties broken by first appearance.
 */
function renderInstallSection(structure: ProjectStructure, metadata: ProjectMetadata): string[] {
  const moduleCounts = new Map<string, number>();
  for (const { language } of structure.modules) {
    moduleCounts.set(language, (moduleCounts.get(language) ?? 0) + 1);
  }
  const languagesPresent = [...moduleCounts.keys()];
  const groups: { languages: string[]; snippet: string[]; moduleCount: number }[] = [];
  const groupsByKey = new Map<string, (typeof groups)[number]>();

  for (const language of languagesPresent) {
    const snippet = metadata.installSteps[language] ?? INSTALL_SNIPPETS[language];
    if (!snippet?.length) continue;

    const key = JSON.stringify(snippet);
    const count = moduleCounts.get(language) ?? 0;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.languages.push(language);
      existing.moduleCount += count;
    } else {
      const group = { languages: [language], snippet, moduleCount: count };
      groupsByKey.set(key, group);
      groups.push(group);
    }
  }

  if (groups.length === 0) return [];
  // Main language first: most modules wins. Array.prototype.sort is stable,
  // so ties keep their order of first appearance.
  groups.sort((a, b) => b.moduleCount - a.moduleCount);

  const lines = ["## Installation", ""];
  for (const { languages, snippet } of groups) {
    if (groups.length > 1) {
      lines.push(`### ${languages.map(displayName).join(" / ")}`, "");
    }
    lines.push("```bash", ...snippet, "```", "");
  }
  return lines;
}

/**
 * Builds a static README from extracted code structure (no LLM). `metadata`
 * carries facts read from the project's manifest files (see
 * readProjectMetadata); without it, only the code structure is used.
 * Sections the generator has nothing real to say about are omitted.
 */
export function generateStaticReadme(
  structure: ProjectStructure,
  metadata: ProjectMetadata = EMPTY_PROJECT_METADATA
): string {
  const projectName = path.basename(structure.rootDir);
  const description = findProjectDescription(structure) ?? metadata.description;
  const apiHighlights = summarizePublicApi(structure);

  const lines: string[] = [];
  lines.push(`# ${projectName}`, "");
  if (description) {
    lines.push(description, "");
  }

  lines.push(...renderInstallSection(structure, metadata));

  if (structure.modules.length > 0) {
    lines.push("## Project Structure", "");
    lines.push("```");
    for (const mod of structure.modules) {
      lines.push(path.relative(structure.rootDir, mod.filePath).replace(/\\/g, "/"));
    }
    lines.push("```", "");
  }

  if (apiHighlights.length > 0) {
    lines.push("## Highlights", "");
    for (const entry of apiHighlights) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  lines.push("## Documentation", "");
  lines.push("See [docs/api](./docs/api) for full API reference.", "");

  return lines.join("\n");
}
