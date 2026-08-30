import path from "node:path";
import { findSourceFiles } from "./scanner.js";
import { getParser, supportedLanguages } from "../parsers/registry.js";
import type { ProjectStructure, ScannedModule } from "../types.js";

/**
 * Scans `rootDir` for source files in each of `languages` and merges the
 * results into one ProjectStructure, tagging every module with the language
 * that produced it. Passing more than one language lets a single scan cover
 * a mixed-language repo (e.g. a Python backend alongside a JS frontend).
 */
export async function scanProject(rootDir: string, languages: string[]): Promise<ProjectStructure> {
  if (languages.length === 0) {
    throw new Error("At least one language must be specified.");
  }

  const absoluteRoot = path.resolve(rootDir);
  const modules: ScannedModule[] = [];

  for (const language of languages) {
    const parser = getParser(language);
    if (!parser) {
      throw new Error(
        `No parser registered for language "${language}". Supported: ${supportedLanguages().join(", ")}`
      );
    }

    const filePaths = await findSourceFiles(absoluteRoot, parser.filePatterns);
    const parsed = await parser.parseFiles(filePaths, absoluteRoot);
    for (const mod of parsed) {
      modules.push({ ...mod, language });
    }
  }

  return {
    rootDir: absoluteRoot,
    languages,
    modules,
  };
}
