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
import { emptyModule } from "../shared.js";

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

/** True when the statement itself is a documented declaration that should own its leading JSDoc. */
function declarationOwnsJsDoc(stmt: t.Statement): boolean {
  const inner = unwrapExport(stmt);
  if (!inner) return false;
  if (t.isFunctionDeclaration(inner) || t.isClassDeclaration(inner)) return true;
  return (
    t.isVariableDeclaration(inner) &&
    inner.declarations.some(
      (d) => !!d.init && (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init))
    )
  );
}

function isImportLike(stmt: t.Statement): boolean {
  return (
    t.isImportDeclaration(stmt) ||
    (t.isVariableDeclaration(stmt) &&
      stmt.declarations.some(
        (d) => t.isCallExpression(d.init) && t.isIdentifier(d.init.callee, { name: "require" })
      ))
  );
}

/**
 * File-level JSDoc: a header before the first import/require, a header above a
 * non-declaration statement (e.g. a file with no imports), or the first of
 * several JSDocs when the first statement is a class/function that owns the last one.
 */
function extractModuleDocstring(program: t.Program): string | null {
  const first = program.body[0];
  if (!first) {
    const comments = program.innerComments ?? program.leadingComments;
    const block = comments?.find(isJsDocBlock);
    return block ? cleanJsDoc(block.value) || null : null;
  }

  const jsDocs = (first.leadingComments ?? []).filter(isJsDocBlock);
  if (jsDocs.length === 0) return null;

  if (isImportLike(first) || !declarationOwnsJsDoc(first) || jsDocs.length > 1) {
    return cleanJsDoc(jsDocs[0].value) || null;
  }
  return null;
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

/**
 * Reads JSDoc `@param`/`@returns` tags and applies their types to `params`.
 * Pure: returns a new params array (with matching entries' `annotation`
 * filled in) plus the inferred return type, rather than mutating the input.
 */
function applyJsDocTypes(
  docstring: string | null,
  params: ParamInfo[]
): { params: ParamInfo[]; returnType: string | null } {
  if (!docstring) return { params, returnType: null };

  const typesByName = new Map<string, string>();
  let returnType: string | null = null;
  for (const line of docstring.split("\n")) {
    const paramMatch = line.match(/@param\s+\{([^}]+)\}\s+\[?([\w.]+)/);
    if (paramMatch) {
      const [, type, name] = paramMatch;
      typesByName.set(name, type);
      continue;
    }
    const returnMatch = line.match(/@returns?\s+\{([^}]+)\}/);
    if (returnMatch) returnType = returnMatch[1];
  }
  if (typesByName.size === 0) return { params, returnType };

  const updatedParams = params.map((p) => {
    const type = typesByName.get(p.name) ?? typesByName.get(p.name.replace(/^\.\.\./, ""));
    return type ? { ...p, annotation: type } : p;
  });
  return { params: updatedParams, returnType };
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
  const docstring = getJsDoc(...jsDocHosts);
  const { params, returnType } = applyJsDocTypes(docstring, fnNode.params.map(paramFromNode));

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
    const name = t.isClassPrivateMethod(member)
      ? `#${(member.key as t.PrivateName).id.name}`
      : classMethodName(member.key as t.ClassMethod["key"]);
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
    // Reads run in parallel; Promise.all preserves input order regardless of
    // completion order, so output order still matches filePaths.
    return Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const source = await readFile(filePath, "utf8");
          return parseSource(source, filePath);
        } catch (err) {
          console.warn(`Skipping ${filePath}: ${(err as Error).message}`);
          return emptyModule(filePath);
        }
      })
    );
  },
};
