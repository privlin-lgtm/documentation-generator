import type { FunctionInfo } from "../types.js";

export type SignatureContext = "function" | "method";

function renderParams(fn: FunctionInfo): string {
  return fn.params
    .map((p) => {
      let s = p.name;
      if (p.annotation) s += `: ${p.annotation}`;
      if (p.default !== null) s += p.annotation ? ` = ${p.default}` : `=${p.default}`;
      return s;
    })
    .join(", ");
}

/**
 * Renders a function/method signature in a style appropriate to `language`.
 * Python always uses `def`, matching real method syntax; JavaScript uses
 * `function name(...)` for standalone functions and bare `name(...)` for
 * class methods, matching how each would actually be written.
 */
export function renderSignature(
  fn: FunctionInfo,
  language: string,
  context: SignatureContext = "function"
): string {
  const params = renderParams(fn);
  const asyncPrefix = fn.isAsync ? "async " : "";

  if (language === "python") {
    const returnSuffix = fn.returnType ? ` -> ${fn.returnType}` : "";
    return `${asyncPrefix}def ${fn.name}(${params})${returnSuffix}`;
  }

  const returnSuffix = fn.returnType ? `: ${fn.returnType}` : "";
  const keyword = context === "function" ? "function " : "";
  return `${asyncPrefix}${keyword}${fn.name}(${params})${returnSuffix}`;
}
