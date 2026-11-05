import type { LanguageParser } from "../types.js";
import { pythonParser } from "./python/python-parser.js";
import { javascriptParser } from "./javascript/js-parser.js";
import { typescriptParser } from "./typescript/ts-parser.js";

/** Add new language parsers here to extend scanning support. */
export const availableParsers: LanguageParser[] = [
  pythonParser,
  javascriptParser,
  typescriptParser,
];

export function getParser(language: string): LanguageParser | undefined {
  return availableParsers.find((p) => p.language === language);
}

/** Languages with a registered parser, for error messages and CLI help text. */
export function supportedLanguages(): string[] {
  return availableParsers.map((p) => p.language);
}
