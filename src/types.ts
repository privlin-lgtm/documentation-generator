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

export interface ProjectStructure {
  rootDir: string;
  language: string;
  modules: ModuleInfo[];
}

export interface LanguageParser {
  readonly language: string;
  /** Glob patterns (relative to project root) this parser should be given. */
  readonly filePatterns: string[];
  parseFiles(filePaths: string[], rootDir: string): Promise<ModuleInfo[]>;
}
