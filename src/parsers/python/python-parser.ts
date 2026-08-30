import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { LanguageParser, ModuleInfo } from "../../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The build copies ast_dump.py next to this file's compiled output (see tsup.config.ts). */
function resolveAstDumpScript(): string {
  return path.join(__dirname, "ast_dump.py");
}

function findPythonExecutable(): string {
  return process.platform === "win32" ? "python" : "python3";
}

interface RawModule {
  filePath: string;
  docstring?: string | null;
  imports?: string[];
  classes?: ModuleInfo["classes"];
  functions?: ModuleInfo["functions"];
  error?: string;
}

async function runAstDump(filePaths: string[]): Promise<RawModule[]> {
  const script = resolveAstDumpScript();
  const python = findPythonExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to launch "${python}". Is Python 3 installed and on PATH? (${err.message})`
        )
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python AST parser exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as RawModule[]);
      } catch (err) {
        reject(new Error(`Failed to parse AST parser output: ${(err as Error).message}`));
      }
    });

    child.stdin.write(filePaths.join("\n"));
    child.stdin.end();
  });
}

export const pythonParser: LanguageParser = {
  language: "python",
  filePatterns: ["**/*.py"],
  async parseFiles(filePaths: string[]): Promise<ModuleInfo[]> {
    if (filePaths.length === 0) return [];
    const raw = await runAstDump(filePaths);

    return raw.map((mod) => {
      if (mod.error) {
        console.warn(`Skipping ${mod.filePath}: ${mod.error}`);
        return {
          filePath: mod.filePath,
          docstring: null,
          imports: [],
          classes: [],
          functions: [],
        };
      }
      return {
        filePath: mod.filePath,
        docstring: mod.docstring ?? null,
        imports: mod.imports ?? [],
        classes: mod.classes ?? [],
        functions: mod.functions ?? [],
      };
    });
  },
};
