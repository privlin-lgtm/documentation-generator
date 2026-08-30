import { describe, expect, it } from "vitest";
import { renderSignature } from "../src/generators/signature.js";
import type { FunctionInfo } from "../src/types.js";

function fn(overrides: Partial<FunctionInfo> = {}): FunctionInfo {
  return {
    name: "greet",
    params: [{ name: "name", annotation: null, default: null }],
    returnType: null,
    docstring: null,
    decorators: [],
    isAsync: false,
    lineNumber: 1,
    ...overrides,
  };
}

describe("renderSignature", () => {
  it("renders Python functions with def and -> return arrow, for both function and method context", () => {
    const info = fn({ returnType: "str", isAsync: true });
    expect(renderSignature(info, "python", "function")).toBe("async def greet(name) -> str");
    // Python methods still use `def`, unlike JS.
    expect(renderSignature(info, "python", "method")).toBe("async def greet(name) -> str");
  });

  it("renders JS standalone functions with the function keyword and : return type", () => {
    const info = fn({ returnType: "string" });
    expect(renderSignature(info, "javascript", "function")).toBe("function greet(name): string");
  });

  it("renders JS methods without the function keyword", () => {
    const info = fn({ isAsync: true });
    expect(renderSignature(info, "javascript", "method")).toBe("async greet(name)");
  });

  it("renders params with annotations and defaults", () => {
    const info = fn({
      params: [
        { name: "a", annotation: "number", default: null },
        { name: "b", annotation: "number", default: "1" },
        { name: "c", annotation: null, default: "2" },
      ],
    });
    expect(renderSignature(info, "javascript")).toBe(
      "function greet(a: number, b: number = 1, c=2)"
    );
  });
});
