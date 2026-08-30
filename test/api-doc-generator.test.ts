import { describe, expect, it } from "vitest";
import { generateApiDocs, generateApiIndex } from "../src/generators/api-doc-generator.js";
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

describe("generateApiDocs", () => {
  it("names files after the module's dotted path with no language prefix when single-language", () => {
    const structure: ProjectStructure = {
      rootDir: "/project",
      languages: ["python"],
      modules: [
        makeModule({
          filePath: "/project/pkg/utils.py",
          functions: [fn("helper")],
          language: "python",
        }),
      ],
    };

    const files = generateApiDocs(structure);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("pkg.utils.md");
    expect(files[0].content).toContain("def helper()");
  });

  it("skips modules with no classes or functions", () => {
    const structure: ProjectStructure = {
      rootDir: "/project",
      languages: ["python"],
      modules: [makeModule({ filePath: "/project/empty.py" })],
    };
    expect(generateApiDocs(structure)).toHaveLength(0);
  });

  it("namespaces filenames by language to avoid collisions in a mixed-language scan", () => {
    const structure: ProjectStructure = {
      rootDir: "/project",
      languages: ["python", "javascript"],
      modules: [
        makeModule({
          filePath: "/project/utils.py",
          functions: [fn("helper")],
          language: "python",
        }),
        makeModule({
          filePath: "/project/utils.js",
          functions: [fn("helper")],
          language: "javascript",
        }),
      ],
    };

    const files = generateApiDocs(structure);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(["javascript/utils.md", "python/utils.md"]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("renders JS methods and functions differently in the same doc", () => {
    const structure: ProjectStructure = {
      rootDir: "/project",
      languages: ["javascript"],
      modules: [
        makeModule({
          filePath: "/project/index.js",
          language: "javascript",
          functions: [fn("standalone")],
          classes: [
            {
              name: "Widget",
              bases: [],
              docstring: null,
              lineNumber: 1,
              methods: [fn("render")],
            },
          ],
        }),
      ],
    };

    const [file] = generateApiDocs(structure);
    expect(file.content).toContain("function standalone()");
    expect(file.content).toContain("render()");
    expect(file.content).not.toContain("function render()");
  });
});

describe("generateApiIndex", () => {
  it("links to each file under the given modules directory", () => {
    const index = generateApiIndex(
      [
        { relativePath: "b.md", content: "" },
        { relativePath: "a.md", content: "" },
      ],
      "modules"
    );
    expect(index).toContain("- [a](./modules/a.md)");
    expect(index).toContain("- [b](./modules/b.md)");
    expect(index.indexOf("a.md")).toBeLessThan(index.indexOf("b.md"));
  });

  it("reports no documented modules for an empty list", () => {
    expect(generateApiIndex([], "modules")).toContain("No documented modules");
  });
});
