import path from "node:path";
import { findSourceFiles } from "./scanner.js";
import { getParser } from "../parsers/registry.js";
import type { ProjectStructure } from "../types.js";

/** Scans `rootDir` for source files in `language` and parses them into a ProjectStructure. */
export async function scanProject(
  rootDir: string,
  language: string
): Promise<ProjectStructure> {
  const parser = getParser(language);
  if (!parser) {
    throw new Error(
      `No parser registered for language "${language}". Supported: python, javascript`
    );
  }

  const absoluteRoot = path.resolve(rootDir);
  const filePaths = await findSourceFiles(absoluteRoot, parser.filePatterns);
  const modules = await parser.parseFiles(filePaths, absoluteRoot);

  return {
    rootDir: absoluteRoot,
    language,
    modules,
  };
}
