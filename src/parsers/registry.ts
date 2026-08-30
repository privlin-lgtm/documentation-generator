import type { LanguageParser } from "../types.js";
import { pythonParser } from "./python/python-parser.js";

/** Add new language parsers here to extend scanning support. */
export const availableParsers: LanguageParser[] = [pythonParser];

export function getParser(language: string): LanguageParser | undefined {
  return availableParsers.find((p) => p.language === language);
}
