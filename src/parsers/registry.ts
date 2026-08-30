import type { LanguageParser } from "../types.js";
import { pythonParser } from "./python/python-parser.js";
import { javascriptParser } from "./javascript/js-parser.js";

/** Add new language parsers here to extend scanning support. */
export const availableParsers: LanguageParser[] = [pythonParser, javascriptParser];

export function getParser(language: string): LanguageParser | undefined {
  return availableParsers.find((p) => p.language === language);
}
