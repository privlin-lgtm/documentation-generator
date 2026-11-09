import { describe, expect, it } from "vitest";
import { generateStaticReadme } from "../src/generators/readme-generator.js";
import type { FunctionInfo, ProjectStructure } from "../src/types.js";
import { makeModule } from "./helpers.js";

function fn(name: string, overrides: Partial<FunctionInfo> = {}): FunctionInfo {
  return {
    name,
    params: [],
    returnType: null,
    docstring: null,
    decorators: [],
    isAsync: false,
    lineNumber: 1,
    ...overrides,
  };
}

describe("generateStaticReadme", () => {
  it("pulls the description from __init__.py and lists a single install snippet", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/my_pkg",
      languages: ["python"],
      modules: [
        makeModule({
          filePath: "/project/my_pkg/__init__.py",
          docstring: "A tiny package.",
          language: "python",
        }),
      ],
    };

    const readme = generateStaticReadme(structure);
    expect(readme).toContain("# my_pkg");
    expect(readme).toContain("A tiny package.");
    expect(readme).toContain("pip install -r requirements.txt");
    expect(readme).not.toContain("npm install");
    expect(readme).not.toContain("### Python");
  });

  it("labels a subsection per language when the scan is mixed", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/full-stack",
      languages: ["python", "javascript"],
      modules: [
        makeModule({ filePath: "/project/full-stack/api/app.py", language: "python" }),
        makeModule({ filePath: "/project/full-stack/web/index.js", language: "javascript" }),
      ],
    };

    const readme = generateStaticReadme(structure);
    expect(readme).toContain("### Python");
    expect(readme).toContain("### JavaScript");
    expect(readme).toContain("pip install -r requirements.txt");
    expect(readme).toContain("npm install");
  });

  it("renders each function's signature in its own module's language", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/full-stack",
      languages: ["python", "javascript"],
      modules: [
        makeModule({
          filePath: "/project/full-stack/api/app.py",
          language: "python",
          functions: [fn("add", { returnType: "int" })],
        }),
        makeModule({
          filePath: "/project/full-stack/web/index.js",
          language: "javascript",
          functions: [fn("render", { returnType: "string" })],
        }),
      ],
    };

    const readme = generateStaticReadme(structure);
    expect(readme).toContain("def add() -> int");
    expect(readme).toContain("function render(): string");
  });

  it("omits the description and install section when nothing is known (no modules)", () => {
    const structure: ProjectStructure = { rootDir: "/project/empty", languages: [], modules: [] };
    const readme = generateStaticReadme(structure);
    expect(readme).not.toMatch(/todo/i);
    expect(readme).not.toContain("## Installation");
    expect(readme).not.toContain("## Project Structure");
    expect(readme.startsWith("# empty\n\n## Documentation")).toBe(true);
  });

  it("omits the install snippet for a language with no known steps", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/polyglot",
      languages: ["python", "cobol"],
      modules: [
        makeModule({ filePath: "/project/polyglot/app.py", language: "python" }),
        makeModule({ filePath: "/project/polyglot/main.cbl", language: "cobol" }),
      ],
    };
    const readme = generateStaticReadme(structure);
    expect(readme).not.toMatch(/todo/i);
    expect(readme).toContain("pip install -r requirements.txt");
    // Only one language has steps, so no per-language subsection headers.
    expect(readme).not.toContain("### Python");
    expect(readme).not.toContain("### Cobol");
  });

  it("omits the whole install section when no scanned language has known steps", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/legacy",
      languages: ["cobol"],
      modules: [makeModule({ filePath: "/project/legacy/main.cbl", language: "cobol" })],
    };
    const readme = generateStaticReadme(structure);
    expect(readme).not.toMatch(/todo/i);
    expect(readme).not.toContain("## Installation");
  });

  it("uses the manifest description when no docstring is found", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/tool",
      languages: ["javascript"],
      modules: [makeModule({ filePath: "/project/tool/index.js", language: "javascript" })],
    };
    const readme = generateStaticReadme(structure, {
      description: "A handy tool.",
      installSteps: {},
    });
    expect(readme).toContain("# tool\n\nA handy tool.\n");
  });

  it("prefers a docstring over the manifest description", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/tool",
      languages: ["javascript"],
      modules: [
        makeModule({
          filePath: "/project/tool/index.js",
          language: "javascript",
          docstring: "From the code.",
        }),
      ],
    };
    const readme = generateStaticReadme(structure, {
      description: "From package.json.",
      installSteps: {},
    });
    expect(readme).toContain("From the code.");
    expect(readme).not.toContain("From package.json.");
  });

  it("prefers detected install steps over the language default", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/lib",
      languages: ["python"],
      modules: [makeModule({ filePath: "/project/lib/lib.py", language: "python" })],
    };
    const readme = generateStaticReadme(structure, {
      description: null,
      installSteps: { python: ["pip install ."] },
    });
    expect(readme).toContain("pip install .");
    expect(readme).not.toContain("requirements.txt");
  });

  it("merges JavaScript and TypeScript into one plain block when their steps match", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/web",
      languages: ["javascript", "typescript"],
      modules: [
        makeModule({ filePath: "/project/web/legacy.js", language: "javascript" }),
        makeModule({ filePath: "/project/web/index.ts", language: "typescript" }),
      ],
    };

    const readme = generateStaticReadme(structure);
    expect(readme).toContain("## Installation\n\n```bash\nnpm install\n```\n");
    expect(readme.match(/npm install/g)).toHaveLength(1);
    expect(readme).not.toMatch(/^### /m);
  });

  it("gives one subheading per group when JS and TS share steps alongside Python", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/full-stack",
      languages: ["javascript", "python", "typescript"],
      modules: [
        makeModule({ filePath: "/project/full-stack/web/index.js", language: "javascript" }),
        makeModule({ filePath: "/project/full-stack/api/app.py", language: "python" }),
        makeModule({ filePath: "/project/full-stack/web/types.ts", language: "typescript" }),
      ],
    };

    const readme = generateStaticReadme(structure);
    const install = readme.slice(
      readme.indexOf("## Installation"),
      readme.indexOf("## Project Structure")
    );
    expect(install).toBe(
      [
        "## Installation",
        "",
        "### JavaScript / TypeScript",
        "",
        "```bash",
        "npm install",
        "```",
        "",
        "### Python",
        "",
        "```bash",
        "pip install -r requirements.txt",
        "```",
        "",
        "",
      ].join("\n")
    );
  });

  it("keeps JavaScript and TypeScript separate when detected steps differ", () => {
    const structure: ProjectStructure = {
      rootDir: "/project/web",
      languages: ["javascript", "typescript"],
      modules: [
        makeModule({ filePath: "/project/web/legacy.js", language: "javascript" }),
        makeModule({ filePath: "/project/web/index.ts", language: "typescript" }),
      ],
    };

    const readme = generateStaticReadme(structure, {
      description: null,
      installSteps: { typescript: ["npm install", "npm run build"] },
    });
    expect(readme).toContain("### JavaScript\n\n```bash\nnpm install\n```");
    expect(readme).toContain("### TypeScript\n\n```bash\nnpm install\nnpm run build\n```");
    expect(readme).not.toContain("JavaScript / TypeScript");
  });
});
