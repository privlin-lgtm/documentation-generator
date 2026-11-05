import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../src/cli.js";
import { findPythonExecutable } from "../src/parsers/python/python-parser.js";
import { withTempDir } from "./helpers.js";

function pythonAvailable(): boolean {
  try {
    findPythonExecutable();
    return true;
  } catch {
    return false;
  }
}

function run(args: string[]) {
  // Commander's convention: argv[0]=exec, argv[1]=script, argv[2..]=actual args.
  return createProgram().parseAsync(["node", "docgen", ...args]);
}

describe("docgen generate (CLI)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("writes README.md and namespaced-free API docs for a single-language project", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await withTempDir(
      {
        "index.js": [
          "/**",
          " * Demo module.",
          " */",
          "/**",
          " * Adds two numbers.",
          " * @param {number} a",
          " * @param {number} b",
          " * @returns {number}",
          " */",
          "export function add(a, b) {",
          "  return a + b;",
          "}",
          "",
        ].join("\n"),
      },
      async (dir) => {
        await run(["generate", dir, "--lang", "javascript"]);

        const readme = await readFile(path.join(dir, "README.md"), "utf8");
        expect(readme).toContain("Demo module.");
        expect(readme).toContain("npm install");
        expect(readme).toContain("function add(a: number, b: number): number");

        const apiIndex = await readFile(path.join(dir, "docs/api/index.md"), "utf8");
        expect(apiIndex).toContain("[index](./modules/index.md)");

        const moduleDoc = await readFile(path.join(dir, "docs/api/modules/index.md"), "utf8");
        expect(moduleDoc).toContain("Adds two numbers.");
      }
    );
  });

  it("uses package.json for the description when the code has no docstring", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await withTempDir(
      {
        "package.json": JSON.stringify({ name: "demo", description: "Demo from package.json." }),
        "index.js": "export function add(a, b) {\n  return a + b;\n}\n",
      },
      async (dir) => {
        await run(["generate", dir, "--lang", "javascript"]);

        const readme = await readFile(path.join(dir, "README.md"), "utf8");
        expect(readme).toContain("Demo from package.json.");
        expect(readme).toContain("npm install");
        expect(readme).not.toMatch(/todo/i);
      }
    );
  });

  it("rejects --readme-only combined with --api-only and writes nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await withTempDir({ "a.js": "export function f() {}\n" }, async (dir) => {
      await run(["generate", dir, "--lang", "javascript", "--readme-only", "--api-only"]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"));
      await expect(readFile(path.join(dir, "README.md"), "utf8")).rejects.toThrow();
    });
  });

  it("--readme-only skips API docs; --api-only skips the README", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await withTempDir({ "a.js": "export function f() {}\n" }, async (dir) => {
      await run(["generate", dir, "--lang", "javascript", "--readme-only"]);
      await expect(readFile(path.join(dir, "README.md"), "utf8")).resolves.toBeTruthy();
      await expect(readFile(path.join(dir, "docs/api/index.md"), "utf8")).rejects.toThrow();
    });

    await withTempDir({ "a.js": "export function f() {}\n" }, async (dir) => {
      await run(["generate", dir, "--lang", "javascript", "--api-only"]);
      await expect(readFile(path.join(dir, "README.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(dir, "docs/api/index.md"), "utf8")).resolves.toBeTruthy();
    });
  });

  it("--check reports drift without writing, then reports up to date after a real run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await withTempDir({ "a.js": "export function f() { return 1; }\n" }, async (dir) => {
      await run(["generate", dir, "--lang", "javascript", "--check"]);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("out of date"));
      await expect(readFile(path.join(dir, "README.md"), "utf8")).rejects.toThrow();

      process.exitCode = 0;
      await run(["generate", dir, "--lang", "javascript"]);
      await run(["generate", dir, "--lang", "javascript", "--check"]);
      expect(process.exitCode).toBe(0);
    });
  });

  it.skipIf(!pythonAvailable())(
    "merges Python and JavaScript modules when scanning both languages",
    async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await withTempDir(
        {
          "app.py":
            '"""Backend."""\ndef add(a: int, b: int) -> int:\n    """Adds."""\n    return a + b\n',
          "index.js": "export function render() { return 'ok'; }\n",
        },
        async (dir) => {
          await run(["generate", dir, "--lang", "python,javascript"]);

          const readme = await readFile(path.join(dir, "README.md"), "utf8");
          expect(readme).toContain("pip install -r requirements.txt");
          expect(readme).toContain("npm install");
          expect(readme).toContain("def add(");
          expect(readme).toContain("function render()");

          const pyDoc = await readFile(path.join(dir, "docs/api/modules/python/app.md"), "utf8");
          expect(pyDoc).toContain("Adds.");
          const jsDoc = await readFile(
            path.join(dir, "docs/api/modules/javascript/index.md"),
            "utf8"
          );
          expect(jsDoc).toContain("function render()");
        }
      );
    }
  );

  it("reports an error and exits 1 for an unsupported language", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await withTempDir({ "a.js": "export function f() {}\n" }, async (dir) => {
      await run(["generate", dir, "--lang", "cobol"]);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No parser registered for language "cobol"')
      );
    });
  });
});
