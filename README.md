# doc-generator

[![CI](https://github.com/privlin-lgtm/documentation-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/privlin-lgtm/documentation-generator/actions/workflows/ci.yml)

A CLI that scans a project's source code and generates a `README.md` and
per-module API reference docs from the actual code structure — classes,
functions, signatures, and docstrings — rather than requiring you to write
them by hand.

Documentation is built from **static analysis** by default (accurate,
offline, no API key needed). Optionally, pass `--llm` to have Claude rewrite
the generated README into clearer prose while staying grounded in the
extracted code structure.

Currently supports **Python**, **JavaScript** (`.js`/`.jsx`/`.mjs`/`.cjs`,
both ESM and CommonJS) and **TypeScript** (`.ts`/`.tsx`/`.mts`/`.cts`;
`.d.ts` declaration files are skipped), including scanning **all of them in
one run** for mixed-language repos. The parser layer is pluggable
(`src/types.ts` → `LanguageParser`), so support for other languages can be
added as a new parser registered in `src/parsers/registry.ts`.

## Example

Given this JavaScript module:

```js
/**
 * Shopping cart helpers for the checkout flow.
 */

/**
 * A shopping cart that tracks line items and computes totals.
 */
class Cart {
  constructor() {
    this.items = [];
  }

  /**
   * Adds an item to the cart.
   * @param {string} name - item name
   * @param {number} price - unit price
   * @param {number} [quantity=1] - number of units
   */
  addItem(name, price, quantity = 1) {
    this.items.push({ name, price, quantity });
  }

  /**
   * Computes the cart total, including tax.
   * @param {number} [taxRate=0] - tax rate as a decimal (e.g. 0.08)
   * @returns {number} the total price
   */
  total(taxRate = 0) {
    const subtotal = this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return subtotal * (1 + taxRate);
  }
}

/**
 * Formats a number as a USD currency string.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

export { Cart, formatCurrency };
```

Running `docgen generate .` produces this `README.md` (unedited tool output):

```md
# docgen_demo

Shopping cart helpers for the checkout flow.

## Installation

\`\`\`bash
npm install
\`\`\`

## Project Structure

\`\`\`
cart.js
\`\`\`

## Highlights

- `Cart` — A shopping cart that tracks line items and computes totals.
- `function formatCurrency(amount: number): string` — Formats a number as a USD currency string.

## Documentation

See [docs/api](./docs/api) for full API reference.
```

...and this `docs/api/modules/cart.md` (also unedited):

```md
# `cart`

Source: `cart.js`

Shopping cart helpers for the checkout flow.

## Classes

### class `Cart`

A shopping cart that tracks line items and computes totals.

#### `constructor()`

_No docstring provided._

#### `addItem(name: string, price: number, quantity: number = 1)`

Adds an item to the cart.
@param {string} name - item name
@param {number} price - unit price
@param {number} [quantity=1] - number of units

#### `total(taxRate: number = 0): number`

Computes the cart total, including tax.
@param {number} [taxRate=0] - tax rate as a decimal (e.g. 0.08)
@returns {number} the total price

## Functions

### `function formatCurrency(amount: number): string`

Formats a number as a USD currency string.
@param {number} amount
@returns {string}
```

Note the `@param`/`@returns` JSDoc types feeding straight into the rendered
signatures (`amount: number`, `: string`) — the tool reads and applies them,
it doesn't just paste the docstring text below a heading.

## How it works

1. **Scan** — walks the target project (respecting `.gitignore`) for source files.
2. **Parse**:
   - Python: a small stdlib-only helper script (`src/parsers/python/ast_dump.py`)
     uses the `ast` module to extract modules, classes, functions, parameters,
     type annotations, decorators, and docstrings as JSON.
   - JavaScript: parsed in-process with `@babel/parser`, extracting top-level
     functions, classes, `require`/`import` statements, and JSDoc comments
     (including `@param`/`@returns` types).
   - TypeScript: the same Babel pipeline with the `typescript` plugin, so real
     parameter and return type annotations are used (falling back to JSDoc
     types where a parameter has none), along with TSDoc/JSDoc comments,
     `implements` clauses and constructor parameter properties. `private`
     methods, overload signatures and `.d.ts` files are left out.
3. **Generate** — the structured data is rendered into:
   - `README.md` at the project root
   - `docs/api/index.md` (an index) and `docs/api/modules/*.md` (one file per module)
4. **Enhance (optional)** — with `--llm`, the static README draft and a
   structure summary are sent to Claude to produce more readable prose. If
   this step fails (e.g. no API key), the tool falls back to the static
   draft automatically.

Scanning more than one language in a single run merges everything into one
`README.md` (with a labeled install section per language) and namespaces API
doc filenames by language only when needed to avoid collisions (e.g. a
Python `utils.py` and a JS `utils.js` both existing in the same repo).

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

| Flag                    | Description                                                                | Default    |
| ------------------------ | --------------------------------------------------------------------------- | ---------- |
| `-l, --lang <languages>` | Comma-separated languages to scan, or `auto` to scan all supported ones     | `auto`     |
| `-o, --out <dir>`        | Output directory for API docs (relative to project root)                  | `docs/api` |
| `--llm`                  | Enhance the README using the Claude API                                   | off        |
| `--api-key <key>`        | Anthropic API key (overrides `ANTHROPIC_API_KEY`)                         | —          |
| `--readme-only`          | Only generate `README.md`                                                 | off        |
| `--api-only`             | Only generate API docs                                                    | off        |
| `--check`                | Compare generated docs against what's on disk; exit 1 on drift, write nothing | off    |

### Examples

```bash
# Auto-detect and scan every supported language present
node dist/cli.js generate ./my_project

# Scan only Python
node dist/cli.js generate ./my_python_project --lang python

# Scan a mixed Python + JavaScript repo in one run
node dist/cli.js generate ./my_fullstack_repo --lang python,javascript

# Scan only TypeScript
node dist/cli.js generate ./my_ts_project --lang typescript

# With Claude-enhanced README prose
ANTHROPIC_API_KEY=sk-... node dist/cli.js generate ./my_project --llm

# Just refresh the API reference
node dist/cli.js generate ./my_project --api-only

# CI-friendly: fail if committed docs are stale, without touching them
node dist/cli.js generate ./my_project --check
```

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # prettier --check
npm test             # vitest
npm run build        # tsup
```

All of the above run in CI (`.github/workflows/ci.yml`) on every push and
pull request. Tests cover both parsers, the README/API generators, and the
CLI's `generate` command end-to-end (temp-directory fixtures, no mocked
filesystem).

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
    javascript/
      js-parser.ts                # @babel/parser-based JS/JSX extractor
    typescript/
      ts-parser.ts                # TS/TSX via the same Babel pipeline
  generators/
    readme-generator.ts          # Static README from ProjectStructure
    api-doc-generator.ts         # Per-module API markdown + index
    signature.ts                 # Renders per-language function signatures
  enhancers/
    enhancer.interface.ts        # ReadmeEnhancer contract
    claude-enhancer.ts           # Claude API-backed README rewriting
test/                            # vitest: parsers, generators, CLI
.github/workflows/ci.yml         # typecheck, lint, format:check, test, build
```

## Adding support for another language

1. Implement `LanguageParser` (see `src/types.ts`) — given a list of file
   paths, return normalized `ModuleInfo[]`.
2. Register it in `src/parsers/registry.ts`.
3. Pass `--lang <your-language>` (or `--lang auto`, once registered) to the CLI.

The generators (`readme-generator.ts`, `api-doc-generator.ts`) already work
against the language-agnostic model, so no changes are needed there.

## License

[MIT](./LICENSE)
