# doc-generator

A CLI that scans a project's source code and generates a `README.md` and
per-module API reference docs from the actual code structure — classes,
functions, signatures, and docstrings — rather than requiring you to write
them by hand.

Documentation is built from **static analysis** by default (accurate,
offline, no API key needed). Optionally, pass `--llm` to have Claude rewrite
the generated README into clearer prose while staying grounded in the
extracted code structure.

Currently supports **Python**. The parser layer is pluggable
(`src/types.ts` → `LanguageParser`), so support for other languages (e.g.
JavaScript/TypeScript) can be added as a new parser registered in
`src/parsers/registry.ts`.

## How it works

1. **Scan** — walks the target project (respecting `.gitignore`) for source files.
2. **Parse** — for Python, a small stdlib-only helper script
   (`src/parsers/python/ast_dump.py`) uses the `ast` module to extract
   modules, classes, functions, parameters, type annotations, decorators,
   and docstrings as JSON.
3. **Generate** — the structured data is rendered into:
   - `README.md` at the project root
   - `docs/api/*.md`, one file per module, plus an `index.md`
4. **Enhance (optional)** — with `--llm`, the static README draft and a
   structure summary are sent to Claude to produce more readable prose. If
   this step fails (e.g. no API key), the tool falls back to the static
   draft automatically.

## Requirements

- Node.js 18+
- Python 3 on `PATH` (used only to parse Python source; no packages needed)
- An `ANTHROPIC_API_KEY` environment variable, only if using `--llm`

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
node dist/cli.js generate <path-to-project> [options]
```

Or during development:

```bash
npm run dev -- generate <path-to-project>
```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `-l, --lang <language>` | Source language to scan | `python` |
| `-o, --out <dir>` | Output directory for API docs (relative to project root) | `docs/api` |
| `--llm` | Enhance the README using the Claude API | off |
| `--api-key <key>` | Anthropic API key (overrides `ANTHROPIC_API_KEY`) | — |
| `--readme-only` | Only generate `README.md` | off |
| `--api-only` | Only generate API docs | off |

### Examples

```bash
# Static generation only
node dist/cli.js generate ./my_python_project

# With Claude-enhanced README prose
ANTHROPIC_API_KEY=sk-... node dist/cli.js generate ./my_python_project --llm

# Just refresh the API reference
node dist/cli.js generate ./my_python_project --api-only
```

## Project Structure

```
src/
  types.ts                       # Shared, language-agnostic data model
  cli.ts                         # CLI entry point (commander)
  index.ts                       # Library exports
  core/
    scanner.ts                   # Finds source files, respects .gitignore
    project-scanner.ts           # Orchestrates scan + parse into a ProjectStructure
  parsers/
    registry.ts                  # Registered LanguageParser implementations
    python/
      ast_dump.py                # stdlib-only Python AST -> JSON extractor
      python-parser.ts           # Spawns ast_dump.py, normalizes its output
  generators/
    readme-generator.ts          # Static README from ProjectStructure
    api-doc-generator.ts         # Per-module API markdown + index
    signature.ts                 # Renders Python-style function signatures
  enhancers/
    enhancer.interface.ts        # ReadmeEnhancer contract
    claude-enhancer.ts           # Claude API-backed README rewriting
```

## Adding support for another language

1. Implement `LanguageParser` (see `src/types.ts`) — given a list of file
   paths, return normalized `ModuleInfo[]`.
2. Register it in `src/parsers/registry.ts`.
3. Pass `--lang <your-language>` to the CLI.

The generators (`readme-generator.ts`, `api-doc-generator.ts`) already work
against the language-agnostic model, so no changes are needed there.
