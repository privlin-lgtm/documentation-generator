import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { typescriptParser } from "../src/parsers/typescript/ts-parser.js";
import { withTempDir } from "./helpers.js";

const SAMPLE_TS = `/**
 * Inventory service for the warehouse.
 */
import type { Item } from "./types";
import { readFile } from "node:fs/promises";

interface HasId {
  id: string;
}

/**
 * Tracks stock levels.
 */
export class Inventory<T extends Item = Item> extends Store<T> implements HasId {
  id = "inv";

  constructor(private readonly prefix: string, public limit?: number) {
    super();
  }

  /**
   * Adds stock for an item.
   * @param item the item
   * @param qty how many
   */
  add(item: T, qty: number = 1): void {}

  /** Loads stock from disk. */
  async load(file: string): Promise<Map<string, T>> {
    return new Map();
  }

  private secret(): void {}

  maybe?(): void;
}

/**
 * Sums values.
 * @param values numbers to add
 */
export function sum(...values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Formats a value.
 * @param {string} label
 */
export const fmt = (n: number | string, label, opts: { digits?: number } = {}): string =>
  String(n);

export function over(a: string): string;
export function over(a: number): number;
export function over(a: string | number): string | number {
  return a;
}

export default async function main({ verbose }: { verbose: boolean }): Promise<void> {}

const cast = <number>(<unknown>"1");
`;

const SAMPLE_TSX = `/** Renders a greeting. */
export function Hello({ name }: { name: string }): JSX.Element {
  return <div>{name}</div>;
}
`;

describe("typescriptParser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts typed params, return types, classes, TSDoc and imports", async () => {
    await withTempDir({ "inventory.ts": SAMPLE_TS }, async (dir, paths) => {
      const [mod] = await typescriptParser.parseFiles([paths["inventory.ts"]], dir);

      expect(mod.docstring).toContain("Inventory service for the warehouse.");
      expect(mod.imports).toEqual(["./types", "node:fs/promises"]);

      expect(mod.classes).toHaveLength(1);
      const inventory = mod.classes[0];
      expect(inventory.name).toBe("Inventory");
      expect(inventory.bases).toEqual(["Store<T>", "HasId"]);
      expect(inventory.docstring).toContain("Tracks stock levels.");
      // private methods and bodiless (overload/optional) signatures are left out.
      expect(inventory.methods.map((m) => m.name)).toEqual(["constructor", "add", "load"]);

      const [ctor, add, load] = inventory.methods;
      expect(ctor.params).toEqual([
        { name: "private readonly prefix", annotation: "string", default: null },
        { name: "public limit?", annotation: "number", default: null },
      ]);
      expect(add).toMatchObject({
        returnType: "void",
        params: [
          { name: "item", annotation: "T", default: null },
          { name: "qty", annotation: "number", default: "1" },
        ],
      });
      expect(add.docstring).toContain("Adds stock for an item.");
      expect(load).toMatchObject({ isAsync: true, returnType: "Promise<Map<string, T>>" });

      const byName = Object.fromEntries(mod.functions.map((f) => [f.name, f]));
      expect(Object.keys(byName)).toEqual(["sum", "fmt", "over", "main"]);
      expect(byName.sum).toMatchObject({
        returnType: "number",
        params: [{ name: "...values", annotation: "number[]", default: null }],
      });
      // TS annotations win; a JSDoc type only fills a param that has none.
      expect(byName.fmt.params).toEqual([
        { name: "n", annotation: "number | string", default: null },
        { name: "label", annotation: "string", default: null },
        { name: "opts", annotation: "{ digits?: number; }", default: "{}" },
      ]);
      // Overload signatures are skipped; the implementation is documented once.
      expect(byName.over.returnType).toBe("string | number");
      expect(byName.main).toMatchObject({ isAsync: true, returnType: "Promise<void>" });
    });
  });

  it("parses JSX in .tsx files", async () => {
    await withTempDir({ "hello.tsx": SAMPLE_TSX }, async (dir, paths) => {
      const [mod] = await typescriptParser.parseFiles([paths["hello.tsx"]], dir);
      expect(mod.functions[0]).toMatchObject({
        name: "Hello",
        returnType: "JSX.Element",
        docstring: "Renders a greeting.",
      });
    });
  });

  it("skips .d.ts declaration files and keeps going past unreadable files", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withTempDir(
      {
        "types.d.ts": "export declare function nope(): void;\n",
        "a.mts": "export function f(x: number): number { return x; }\n",
      },
      async (dir, paths) => {
        const missing = path.join(dir, "missing.cts");
        const modules = await typescriptParser.parseFiles(
          [paths["types.d.ts"], paths["a.mts"], missing],
          dir
        );
        expect(modules.map((m) => m.filePath)).toEqual([paths["a.mts"], missing]);
        expect(modules[0].functions[0]?.params[0]).toMatchObject({ annotation: "number" });
        expect(modules[1]).toEqual({
          filePath: missing,
          docstring: null,
          imports: [],
          classes: [],
          functions: [],
        });
      }
    );
  });
});
