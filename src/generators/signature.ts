import type { FunctionInfo } from "../types.js";

/** Renders a function/method as a Python-style signature string, e.g. `foo(x: int, y=1) -> bool`. */
export function renderSignature(fn: FunctionInfo): string {
  const params = fn.params
    .map((p) => {
      let s = p.name;
      if (p.annotation) s += `: ${p.annotation}`;
      if (p.default !== null) s += p.annotation ? ` = ${p.default}` : `=${p.default}`;
      return s;
    })
    .join(", ");

  const asyncPrefix = fn.isAsync ? "async " : "";
  const returnSuffix = fn.returnType ? ` -> ${fn.returnType}` : "";
  return `${asyncPrefix}def ${fn.name}(${params})${returnSuffix}`;
}
