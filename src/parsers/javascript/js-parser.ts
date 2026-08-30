import { readFile } from "node:fs/promises";
import { parse } from "@babel/parser";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type {
  ClassInfo,
  FunctionInfo,
  LanguageParser,
  ModuleInfo,
  ParamInfo,
} from "../../types.js";

// Babel 8's parser enables most modern syntax (class fields, optional chaining,
// nullish coalescing, dynamic import, top-level await, etc.) without a plugin.
// Only genuinely optional/legacy syntax needs to be listed explicitly.
const PARSE_PLUGINS = ["jsx", "decorators-legacy", "exportDefaultFrom"] as const;

function code(node: t.Node): string {
  return generate(node, { compact: true }).code;
}

/** Strips the leading `*` gutter from each line of a JSDoc comment's raw value. */
function cleanJsDoc(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

function isJsDocBlock(comment: t.Comment): boolean {
  return comment.type === "CommentBlock" && comment.value.trimStart().startsWith("*");
}

/** Looks for a JSDoc block among the leading comments of the given nodes, most specific first. */
function getJsDoc(...nodes: Array<t.Node | null | undefined>): string | null {
  for (const node of nodes) {
    const comments = node?.leadingComments;
    if (!comments) continue;
    const block = [...comments].reverse().find(isJsDocBlock);
    if (block) return cleanJsDoc(block.value) || null;
  }
  return null;
}

/** A file-level JSDoc block is only recognized when it precedes the first import/require. */
function extractModuleDocstring(program: t.Program): string | null {
  const first = program.body[0];
  if (!first) return null;

  const isImportLike =
    t.isImportDeclaration(first) ||
    (t.isVariableDeclaration(first) &&
      first.declarations.some(
        (d) => t.isCallExpression(d.init) && t.isIdentifier(d.init.callee, { name: "require" })
      ));
  if (!isImportLike) return null;

  const comments = first.leadingComments;
  const block = comments?.find(isJsDocBlock);
  return block ? cleanJsDoc(block.value) || null : null;
}

function collectImports(program: t.Program): string[] {
  const imports: string[] = [];
  for (const stmt of program.body) {
    if (t.isImportDeclaration(stmt)) {
      imports.push(stmt.source.value);
    } else if (t.isVariableDeclaration(stmt)) {
      for (const decl of stmt.declarations) {
        if (
          t.isCallExpression(decl.init) &&
          t.isIdentifier(decl.init.callee, { name: "require" }) &&
          decl.init.arguments[0] &&
          t.isStringLiteral(decl.init.arguments[0])
        ) {
          imports.push(decl.init.arguments[0].value);
        }
      }
    }
  }
  return imports;
}

function paramFromNode(node: t.Node): ParamInfo {
  if (t.isIdentifier(node)) {
    return { name: node.name, annotation: null, default: null };
  }
  if (t.isAssignmentPattern(node)) {
    const left = node.left;
    const name = t.isIdentifier(left) ? left.name : code(left);
    return { name, annotation: null, default: code(node.right) };
  }
  if (t.isRestElement(node)) {
    const argName = t.isIdentifier(node.argument) ? node.argument.name : code(node.argument);
    return { name: `...${argName}`, annotation: null, default: null };
  }
  // Destructured (object/array) params: fall back to rendering the pattern as-is.
  return { name: code(node), annotation: null, default: null };
}

/** Fills in param/return types from JSDoc @param and @returns tags when present. */
function applyJsDocTypes(docstring: string | null, params: ParamInfo[]): string | null {
  if (!docstring) return null;
  let returns: string | null = null;
  for (const line of docstring.split("\n")) {
    const paramMatch = line.match(/@param\s+\{([^}]+)\}\s+\[?([\w.]+)/);
    if (paramMatch) {
      const [, type, name] = paramMatch;
      const param = params.find((p) => p.name === name || p.name === `...${name}`);
      if (param) param.annotation = type;
      continue;
    }
    const returnMatch = line.match(/@returns?\s+\{([^}]+)\}/);
    if (returnMatch) returns = returnMatch[1];
  }
  return returns;
}

interface FunctionLike {
  params: t.Node[];
  async: boolean;
  body: t.Node;
}

function buildFunctionInfo(
  name: string,
  fnNode: FunctionLike,
  lineNumber: number,
  decorators: string[],
  ...jsDocHosts: Array<t.Node | null | undefined>
): FunctionInfo {
  const params = fnNode.params.map(paramFromNode);
  const docstring = getJsDoc(...jsDocHosts);
  const returnType = applyJsDocTypes(docstring, params);

  return {
    name,
    params,
    returnType,
    docstring,
    decorators,
    isAsync: fnNode.async,
    lineNumber,
  };
}

function classMethodName(key: t.ClassMethod["key"]): string {
  if (t.isIdentifier(key)) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  return code(key);
}

function buildClassInfo(node: t.ClassDeclaration, jsDocHost: t.Node | null | undefined): ClassInfo {
  const methods: FunctionInfo[] = [];

  for (const member of node.body.body) {
    if (!t.isClassMethod(member) && !t.isClassPrivateMethod(member)) continue;
    const name = t.isClassPrivateMethod(member) ? `#${(member.key as t.PrivateName).id.name}` : classMethodName(member.key as t.ClassMethod["key"]);
    const decorators = (member.decorators ?? []).map((d) => code(d.expression));
    if (member.kind === "get") decorators.unshift("get");
    if (member.kind === "set") decorators.unshift("set");

    methods.push(buildFunctionInfo(name, member, member.loc?.start.line ?? 0, decorators, member));
  }

  return {
    name: node.id?.name ?? "(anonymous)",
    bases: node.superClass ? [code(node.superClass)] : [],
    docstring: getJsDoc(node, jsDocHost),
    methods,
    lineNumber: node.loc?.start.line ?? 0,
  };
}

/** Unwraps `export`/`export default` to get at the underlying declaration, if any. */
function unwrapExport(stmt: t.Statement): t.Statement | null {
  if (t.isExportNamedDeclaration(stmt)) return stmt.declaration ?? null;
  if (t.isExportDefaultDeclaration(stmt)) {
    return t.isDeclaration(stmt.declaration) ? stmt.declaration : null;
  }
  return stmt;
}

function parseSource(source: string, filePath: string): ModuleInfo {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: [...PARSE_PLUGINS],
    errorRecovery: true,
  });

  const program = ast.program;
  const classes: ClassInfo[] = [];
  const functions: FunctionInfo[] = [];

  for (const stmt of program.body) {
    const outer = stmt;
    const inner = unwrapExport(stmt);
    if (!inner) continue;

    if (t.isClassDeclaration(inner)) {
      classes.push(buildClassInfo(inner, outer));
    } else if (t.isFunctionDeclaration(inner)) {
      const decorators: string[] = [];
      functions.push(
        buildFunctionInfo(
          inner.id?.name ?? "(anonymous)",
          inner,
          inner.loc?.start.line ?? 0,
          decorators,
          inner,
          outer
        )
      );
    } else if (t.isVariableDeclaration(inner)) {
      for (const decl of inner.declarations) {
        if (
          t.isIdentifier(decl.id) &&
          decl.init &&
          (t.isArrowFunctionExpression(decl.init) || t.isFunctionExpression(decl.init))
        ) {
          functions.push(
            buildFunctionInfo(decl.id.name, decl.init, inner.loc?.start.line ?? 0, [], inner, outer)
          );
        }
      }
    }
  }

  return {
    filePath,
    docstring: extractModuleDocstring(program),
    imports: collectImports(program),
    classes,
    functions,
  };
}

export const javascriptParser: LanguageParser = {
  language: "javascript",
  filePatterns: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
  async parseFiles(filePaths: string[]): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];
    for (const filePath of filePaths) {
      try {
        const source = await readFile(filePath, "utf8");
        modules.push(parseSource(source, filePath));
      } catch (err) {
        console.warn(`Skipping ${filePath}: ${(err as Error).message}`);
        modules.push({ filePath, docstring: null, imports: [], classes: [], functions: [] });
      }
    }
    return modules;
  },
};
