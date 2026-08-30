import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { javascriptParser } from "../src/parsers/javascript/js-parser.js";
import { withTempDir } from "./helpers.js";

const SAMPLE_JS = `/**
 * Sample widget helpers.
 */
import fs from "node:fs";
const path = require("node:path");

/**
 * Adds two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add(a, b = 0) {
  return a + b;
}

/**
 * @param {string[]} items
 */
export const join = (...items) => items.join(",");

/**
 * A labeled box.
 */
export class Widget extends Base {
  /**
   * @param {string} label
   */
  constructor(label) {
    this.label = label;
  }

  /** @returns {string} */
  get name() {
    return this.label;
  }

  async render() {
    return this.label;
  }
}
`;

const HEADER_NO_IMPORTS = `/**
 * Config defaults for a file with no imports.
 */
export const DEFAULTS = { retries: 3 };
`;

describe("javascriptParser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts modules, JSDoc types, classes, and imports from a representative file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withTempDir({ "widget.js": SAMPLE_JS }, async (dir, paths) => {
      const missing = path.join(dir, "missing.js");
      const [widget, broken] = await javascriptParser.parseFiles(
        [paths["widget.js"], missing],
        dir
      );

      expect(widget.filePath).toBe(paths["widget.js"]);
      expect(widget.docstring).toContain("Sample widget helpers.");
      expect(widget.imports).toEqual(["node:fs", "node:path"]);

      const add = widget.functions.find((f) => f.name === "add");
      expect(add).toMatchObject({
        returnType: "number",
        isAsync: false,
        params: [
          { name: "a", annotation: "number", default: null },
          { name: "b", annotation: "number", default: "0" },
        ],
      });
      expect(add?.docstring).toContain("Adds two numbers.");

      const join = widget.functions.find((f) => f.name === "join");
      expect(join?.params).toEqual([{ name: "...items", annotation: "string[]", default: null }]);

      expect(widget.classes).toHaveLength(1);
      const widgetClass = widget.classes[0];
      expect(widgetClass.name).toBe("Widget");
      expect(widgetClass.bases).toEqual(["Base"]);
      expect(widgetClass.docstring).toContain("A labeled box.");
      expect(widgetClass.methods.map((m) => m.name)).toEqual(["constructor", "name", "render"]);
      expect(widgetClass.methods.find((m) => m.name === "name")?.decorators).toContain("get");
      expect(widgetClass.methods.find((m) => m.name === "render")?.isAsync).toBe(true);

      expect(broken).toEqual({
        filePath: missing,
        docstring: null,
        imports: [],
        classes: [],
        functions: [],
      });
    });
  });

  it("treats a leading JSDoc as the module docstring when the file has no imports", async () => {
    await withTempDir({ "config.js": HEADER_NO_IMPORTS }, async (dir, paths) => {
      const [mod] = await javascriptParser.parseFiles([paths["config.js"]], dir);
      expect(mod.docstring).toContain("Config defaults for a file with no imports.");
      expect(mod.imports).toEqual([]);
      expect(mod.functions).toHaveLength(0);
    });
  });

  it("does not steal a lone JSDoc from the first function as the module docstring", async () => {
    const source = `/**
 * Greets someone.
 * @param {string} name
 */
export function greet(name) {
  return name;
}
`;
    await withTempDir({ "greet.js": source }, async (dir, paths) => {
      const [mod] = await javascriptParser.parseFiles([paths["greet.js"]], dir);
      expect(mod.docstring).toBeNull();
      expect(mod.functions[0]?.docstring).toContain("Greets someone.");
      expect(mod.functions[0]?.params[0]).toMatchObject({ name: "name", annotation: "string" });
    });
  });
});
