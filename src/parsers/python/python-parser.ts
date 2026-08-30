import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { LanguageParser, ModuleInfo } from "../../types.js";
import { emptyModule } from "../shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AST_DUMP_TIMEOUT_MS = 60_000;
const AST_DUMP_MAX_STDOUT_BYTES = 50 * 1024 * 1024;

const PYTHON_CANDIDATES =
  process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

let cachedPython: string | undefined;

/** The build copies ast_dump.py next to this file's compiled output (see tsup.config.ts). */
function resolveAstDumpScript(): string {
  return path.join(__dirname, "ast_dump.py");
}

/** First Python 3 on PATH. Windows often has `python` or the `py` launcher; Unix is usually `python3`. */
export function findPythonExecutable(): string {
  if (cachedPython) return cachedPython;

  for (const cmd of PYTHON_CANDIDATES) {
    const probe = spawnSync(
      cmd,
      ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3,) else 1)"],
      { encoding: "utf8", timeout: 5_000, windowsHide: true }
    );
    if (probe.error || probe.status !== 0) continue;
    cachedPython = cmd;
    return cmd;
  }

  throw new Error(
    `Could not find a Python 3 interpreter. Tried: ${PYTHON_CANDIDATES.join(", ")}. Is Python 3 installed and on PATH?`
  );
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
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      killChild();
      settle(() => reject(new Error(`Python AST parser timed out after ${AST_DUMP_TIMEOUT_MS}ms`)));
    }, AST_DUMP_TIMEOUT_MS);

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    }

    function killChild() {
      child.kill();
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000).unref();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > AST_DUMP_MAX_STDOUT_BYTES) {
        killChild();
        settle(() =>
          reject(new Error(`Python AST parser stdout exceeded ${AST_DUMP_MAX_STDOUT_BYTES} bytes`))
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      settle(() =>
        reject(
          new Error(
            `Failed to launch "${python}". Is Python 3 installed and on PATH? (${err.message})`
          )
        )
      );
    });

    child.on("close", (code) => {
      settle(() => {
        if (code !== 0) {
          reject(new Error(`Python AST parser exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdoutChunks).toString("utf8")) as RawModule[]);
        } catch (err) {
          reject(new Error(`Failed to parse AST parser output: ${(err as Error).message}`));
        }
      });
    });

    try {
      child.stdin.write(filePaths.join("\n"));
      child.stdin.end();
    } catch (err) {
      killChild();
      settle(() =>
        reject(
          new Error(`Failed to send file list to Python AST parser: ${(err as Error).message}`)
        )
      );
    }
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
        return emptyModule(mod.filePath);
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
