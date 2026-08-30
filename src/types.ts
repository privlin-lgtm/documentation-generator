/** Language-agnostic model that every parser normalizes its output into. */

export interface ParamInfo {
  name: string;
  annotation: string | null;
  default: string | null;
}

export interface FunctionInfo {
  name: string;
  params: ParamInfo[];
  returnType: string | null;
  docstring: string | null;
  decorators: string[];
  isAsync: boolean;
  lineNumber: number;
}

export interface ClassInfo {
  name: string;
  bases: string[];
  docstring: string | null;
  methods: FunctionInfo[];
  lineNumber: number;
}

export interface ModuleInfo {
  filePath: string;
  /** Module-level docstring, if any. */
  docstring: string | null;
  imports: string[];
  classes: ClassInfo[];
  functions: FunctionInfo[];
}

/** A parsed module tagged with the language whose parser produced it. Set by
 * scanProject, not by individual parsers, so a single scan can merge output
 * from multiple LanguageParsers (e.g. a repo with both Python and JS). */
export interface ScannedModule extends ModuleInfo {
  language: string;
}

export interface ProjectStructure {
  rootDir: string;
  languages: string[];
  modules: ScannedModule[];
}

export interface LanguageParser {
  readonly language: string;
  /** Glob patterns (relative to project root) this parser should be given. */
  readonly filePatterns: string[];
  parseFiles(filePaths: string[], rootDir: string): Promise<ModuleInfo[]>;
}
