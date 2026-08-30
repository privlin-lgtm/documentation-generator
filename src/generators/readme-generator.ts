import path from "node:path";
import type { ProjectStructure } from "../types.js";
import { renderSignature } from "./signature.js";

const INSTALL_SNIPPETS: Record<string, string[]> = {
  python: ["pip install -r requirements.txt"],
  javascript: ["npm install"],
};

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
        `\`${renderSignature(fn, structure.language)}\` — ${fn.docstring?.split("\n")[0] ?? "function"}`
      );
    }
  }
  return entries.slice(0, limit);
}

/** Builds a static README purely from extracted code structure (no LLM). */
export function generateStaticReadme(structure: ProjectStructure): string {
  const projectName = path.basename(structure.rootDir);
  const description = findProjectDescription(structure);
  const apiHighlights = summarizePublicApi(structure);
  const installLines = INSTALL_SNIPPETS[structure.language] ?? ["# TODO: add install instructions"];

  const lines: string[] = [];
  lines.push(`# ${projectName}`, "");
  lines.push(description ?? "_TODO: add a project description._", "");

  lines.push("## Installation", "");
  lines.push("```bash", ...installLines, "```", "");

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
