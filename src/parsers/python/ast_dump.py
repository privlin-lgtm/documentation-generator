"""Reads a list of Python file paths (one per line) from stdin, parses each
with the standard library `ast` module, and writes a JSON array of module
descriptions to stdout. Uses only the standard library so no environment
setup is required on the user's machine.
"""

import ast
import json
import sys


def unparse(node):
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def param_info(arg, default):
    return {
        "name": arg.arg,
        "annotation": unparse(arg.annotation),
        "default": unparse(default) if default is not None else None,
    }


def collect_params(fn):
    args = fn.args
    positional = args.posonlyargs + args.args
    defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
    params = [param_info(a, d) for a, d in zip(positional, defaults)]

    if args.posonlyargs:
        # Bare "/" marks the end of positional-only params (PEP 570); insert it
        # right after the last positional-only entry so the signature round-trips.
        params.insert(len(args.posonlyargs), {"name": "/", "annotation": None, "default": None})

    if args.vararg:
        params.append({"name": "*" + args.vararg.arg, "annotation": unparse(args.vararg.annotation), "default": None})
    elif args.kwonlyargs:
        # Bare "*" separator marks the start of keyword-only params (PEP 3102).
        params.append({"name": "*", "annotation": None, "default": None})

    kw_defaults = args.kw_defaults
    for a, d in zip(args.kwonlyargs, kw_defaults):
        params.append(param_info(a, d))

    if args.kwarg:
        params.append({"name": "**" + args.kwarg.arg, "annotation": unparse(args.kwarg.annotation), "default": None})

    return params


def function_info(node):
    return {
        "name": node.name,
        "params": collect_params(node),
        "returnType": unparse(node.returns),
        "docstring": ast.get_docstring(node),
        "decorators": [unparse(d) for d in node.decorator_list],
        "isAsync": isinstance(node, ast.AsyncFunctionDef),
        "lineNumber": node.lineno,
    }


def class_info(node):
    methods = [
        function_info(child)
        for child in node.body
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    return {
        "name": node.name,
        "bases": [unparse(b) for b in node.bases],
        "docstring": ast.get_docstring(node),
        "methods": methods,
        "lineNumber": node.lineno,
    }


def collect_imports(tree):
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports.extend(f"{module}.{alias.name}" if module else alias.name for alias in node.names)
    return imports


def parse_file(file_path):
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        source = f.read()

    tree = ast.parse(source, filename=file_path)

    classes = [class_info(n) for n in ast.iter_child_nodes(tree) if isinstance(n, ast.ClassDef)]
    functions = [
        function_info(n)
        for n in ast.iter_child_nodes(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]

    return {
        "filePath": file_path,
        "docstring": ast.get_docstring(tree),
        "imports": collect_imports(tree),
        "classes": classes,
        "functions": functions,
    }


def main():
    file_paths = [line.strip() for line in sys.stdin if line.strip()]
    results = []
    for file_path in file_paths:
        try:
            results.append(parse_file(file_path))
        except Exception as exc:
            # Catch-all: a single malformed/unusual file (bad encoding, a stdlib
            # `ast` edge case, etc.) must not abort the whole batch and lose
            # every other file's results.
            results.append({
                "filePath": file_path,
                "error": str(exc),
            })
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
