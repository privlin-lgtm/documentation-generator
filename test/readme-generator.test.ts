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

  it("falls back to a TODO description and install snippet with no modules", () => {
    const structure: ProjectStructure = { rootDir: "/project/empty", languages: [], modules: [] };
    const readme = generateStaticReadme(structure);
    expect(readme).toContain("TODO: add a project description");
    expect(readme).toContain("TODO: add install instructions");
  });
});
