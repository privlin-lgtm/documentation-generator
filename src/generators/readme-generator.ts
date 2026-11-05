import path from "node:path";
import { EMPTY_PROJECT_METADATA, type ProjectMetadata } from "../core/project-metadata.js";
import type { ProjectStructure } from "../types.js";
import { renderSignature } from "./signature.js";

const INSTALL_SNIPPETS: Record<string, string[]> = {
  python: ["pip install -r requirements.txt"],
  javascript: ["npm install"],
};

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
};

function displayName(language: string): string {
  return LANGUAGE_DISPLAY_NAMES[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

function isPackageEntryFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === "__init__.py" || /^index\.(js|jsx|mjs|cjs)$/.test(base);
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
 * has known steps. A single-language project gets one plain snippet; a
 * mixed-language scan gets one labeled subsection per language so neither
 * install step is lost or implied to be the other's replacement.
 */
function renderInstallSection(structure: ProjectStructure, metadata: ProjectMetadata): string[] {
  const languagesPresent = [...new Set(structure.modules.map((m) => m.language))];
  const snippets = languagesPresent
    .map((language) => ({
      language,
      snippet: metadata.installSteps[language] ?? INSTALL_SNIPPETS[language],
    }))
    .filter((entry): entry is { language: string; snippet: string[] } => !!entry.snippet?.length);

  if (snippets.length === 0) return [];

  const lines = ["## Installation", ""];
  for (const { language, snippet } of snippets) {
    if (snippets.length > 1) {
      lines.push(`### ${displayName(language)}`, "");
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
