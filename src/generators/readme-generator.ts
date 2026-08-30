import path from "node:path";
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
 * Renders the Installation section. A single-language project gets one plain
 * snippet; a mixed-language scan gets one labeled subsection per language so
 * neither install step is lost or implied to be the other's replacement.
 */
function renderInstallSection(structure: ProjectStructure): string[] {
  const languagesPresent = [...new Set(structure.modules.map((m) => m.language))];
  const lines = ["## Installation", ""];

  if (languagesPresent.length === 0) {
    lines.push("```bash", "# TODO: add install instructions", "```", "");
    return lines;
  }

  for (const language of languagesPresent) {
    const snippet = INSTALL_SNIPPETS[language] ?? ["# TODO: add install instructions"];
    if (languagesPresent.length > 1) {
      lines.push(`### ${displayName(language)}`, "");
    }
    lines.push("```bash", ...snippet, "```", "");
  }
  return lines;
}

/** Builds a static README purely from extracted code structure (no LLM). */
export function generateStaticReadme(structure: ProjectStructure): string {
  const projectName = path.basename(structure.rootDir);
  const description = findProjectDescription(structure);
  const apiHighlights = summarizePublicApi(structure);

  const lines: string[] = [];
  lines.push(`# ${projectName}`, "");
  lines.push(description ?? "_TODO: add a project description._", "");

  lines.push(...renderInstallSection(structure));

  lines.push("## Project Structure", "");
  lines.push("```");
  for (const mod of structure.modules) {
    lines.push(path.relative(structure.rootDir, mod.filePath).replace(/\\/g, "/"));
  }
  lines.push("```", "");

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
