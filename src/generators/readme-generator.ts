import path from "node:path";
import type { ProjectStructure } from "../types.js";
import { renderSignature } from "./signature.js";

function findProjectDescription(structure: ProjectStructure): string | null {
  const initModule = structure.modules.find((m) =>
    m.filePath.endsWith(path.join("", "__init__.py"))
  );
  if (initModule?.docstring) return initModule.docstring.trim();

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
      entries.push(`\`${renderSignature(fn)}\` — ${fn.docstring?.split("\n")[0] ?? "function"}`);
    }
  }
  return entries.slice(0, limit);
}

/** Builds a static README purely from extracted code structure (no LLM). */
export function generateStaticReadme(structure: ProjectStructure): string {
  const projectName = path.basename(structure.rootDir);
  const description = findProjectDescription(structure);
  const apiHighlights = summarizePublicApi(structure);

  const lines: string[] = [];
  lines.push(`# ${projectName}`, "");
  lines.push(description ?? "_TODO: add a project description._", "");

  lines.push("## Installation", "");
  lines.push("```bash", "pip install -r requirements.txt", "```", "");

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
