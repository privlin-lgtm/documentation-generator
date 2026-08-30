import path from "node:path";
import type { ClassInfo, FunctionInfo, ModuleInfo, ProjectStructure } from "../types.js";
import { renderSignature } from "./signature.js";

const SOURCE_EXTENSIONS = /\.(py|jsx?|mjs|cjs)$/;
/** Files whose module acts as a package's public surface (Python's __init__.py, JS's index.js). */
const PACKAGE_ENTRY_STEM = /\.(__init__|index)$/;

function toModuleDottedName(rootDir: string, filePath: string): string {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
  return rel.replace(SOURCE_EXTENSIONS, "").replace(/\//g, ".").replace(PACKAGE_ENTRY_STEM, "");
}

function renderFunction(
  fn: FunctionInfo,
  headingLevel: number,
  language: string,
  context: "function" | "method"
): string {
  const heading = "#".repeat(headingLevel);
  const lines = [`${heading} \`${renderSignature(fn, language, context)}\``, ""];
  if (fn.decorators.length > 0) {
    lines.push(fn.decorators.map((d) => `\`@${d}\``).join(" "), "");
  }
  lines.push(fn.docstring ? fn.docstring.trim() : "_No docstring provided._", "");
  return lines.join("\n");
}

function renderClass(cls: ClassInfo, headingLevel: number, language: string): string {
  const heading = "#".repeat(headingLevel);
  const bases = cls.bases.length > 0 ? `(${cls.bases.join(", ")})` : "";
  const lines = [`${heading} class \`${cls.name}${bases}\``, ""];
  lines.push(cls.docstring ? cls.docstring.trim() : "_No docstring provided._", "");

  for (const method of cls.methods) {
    lines.push(renderFunction(method, headingLevel + 1, language, "method"));
  }
  return lines.join("\n");
}

function renderModule(rootDir: string, mod: ModuleInfo, language: string): string {
  const dottedName = toModuleDottedName(rootDir, mod.filePath);
  const lines = [`# \`${dottedName}\``, ""];
  const relPath = path.relative(rootDir, mod.filePath).replace(/\\/g, "/");
  lines.push(`Source: \`${relPath}\``, "");

  if (mod.docstring) {
    lines.push(mod.docstring.trim(), "");
  }

  if (mod.classes.length === 0 && mod.functions.length === 0) {
    lines.push("_This module has no top-level classes or functions._", "");
    return lines.join("\n");
  }

  if (mod.classes.length > 0) {
    lines.push("## Classes", "");
    for (const cls of mod.classes) {
      lines.push(renderClass(cls, 3, language));
    }
  }

  if (mod.functions.length > 0) {
    lines.push("## Functions", "");
    for (const fn of mod.functions) {
      lines.push(renderFunction(fn, 3, language, "function"));
    }
  }

  return lines.join("\n");
}

export interface ApiDocFile {
  /** Path relative to the output directory, e.g. "my_pkg.utils.md". */
  relativePath: string;
  content: string;
}

/** Generates one Markdown file per module documenting its classes and functions. */
export function generateApiDocs(structure: ProjectStructure): ApiDocFile[] {
  // A mixed-language scan could otherwise produce the same dotted name twice
  // (e.g. Python's utils.py and JS's utils.js both -> "utils.md"); namespace
  // by language only when more than one is actually present, to keep
  // single-language output filenames unchanged.
  const languagesPresent = new Set(structure.modules.map((mod) => mod.language));
  const namespaceByLanguage = languagesPresent.size > 1;

  return structure.modules
    .filter((mod) => mod.classes.length > 0 || mod.functions.length > 0)
    .map((mod) => {
      const dottedName = toModuleDottedName(structure.rootDir, mod.filePath) || "module";
      const relativePath = namespaceByLanguage
        ? `${mod.language}/${dottedName}.md`
        : `${dottedName}.md`;
      return {
        relativePath,
        content: renderModule(structure.rootDir, mod, mod.language),
      };
    });
}

/**
 * Builds a Markdown index linking to each per-module API doc file. Per-module
 * files are expected to live under a `modulesDir` (e.g. "modules") so that a
 * source module named `index` can never collide with this index file itself.
 */
export function generateApiIndex(files: ApiDocFile[], modulesDir: string): string {
  const lines = ["# API Reference", ""];
  if (files.length === 0) {
    lines.push("_No documented modules were found._");
    return lines.join("\n");
  }
  for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const name = file.relativePath.replace(/\.md$/, "");
    lines.push(`- [${name}](./${modulesDir}/${file.relativePath})`);
  }
  return lines.join("\n");
}
