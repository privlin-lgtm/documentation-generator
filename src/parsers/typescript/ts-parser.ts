import { readFile } from "node:fs/promises";
import type { LanguageParser, ModuleInfo } from "../../types.js";
import { parseSource } from "../javascript/js-parser.js";
import { emptyModule } from "../shared.js";

/** Declaration files describe APIs implemented elsewhere and are skipped by default. */
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

/**
 * TypeScript parser. Reuses the JavaScript parser's Babel pipeline with the
 * `typescript` plugin enabled, so real type annotations on parameters and
 * return types are extracted alongside TSDoc/JSDoc comments, without adding
 * a runtime dependency on the TypeScript compiler.
 */
export const typescriptParser: LanguageParser = {
  language: "typescript",
  filePatterns: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
  async parseFiles(filePaths: string[]): Promise<ModuleInfo[]> {
    const sourceFiles = filePaths.filter((filePath) => !DECLARATION_FILE.test(filePath));
    return Promise.all(
      sourceFiles.map(async (filePath) => {
        try {
          const source = await readFile(filePath, "utf8");
          return parseSource(source, filePath, {
            typescript: true,
            jsx: filePath.endsWith(".tsx"),
          });
        } catch (err) {
          console.warn(`Skipping ${filePath}: ${(err as Error).message}`);
          return emptyModule(filePath);
        }
      })
    );
  },
};
