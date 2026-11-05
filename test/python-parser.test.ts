import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findPythonExecutable, pythonParser } from "../src/parsers/python/python-parser.js";
import { withTempDir } from "./helpers.js";

// A cold Python start can blow past vitest's 5 s default on a slow CI runner.
const PYTHON_TEST_TIMEOUT_MS = 30_000;
const PYTHON_PROBE_TIMEOUT_MS = 20_000;

function pythonAvailable(): boolean {
  try {
    findPythonExecutable();
    return true;
  } catch {
    return false;
  }
}

const SAMPLE_PY = `"""Sample math helpers."""
from typing import Optional
import os

class Widget:
    """A labeled box."""

    def __init__(self, label: str) -> None:
        self.label = label

    async def render(self) -> str:
        """Draw the widget."""
        return self.label

def add(a: int, b: int = 0) -> int:
    """Adds two numbers."""
    return a + b

def clamp(value: int, /, low: int = 0, *, high: int = 100) -> int:
    return max(low, min(value, high))
`;

describe.skipIf(!pythonAvailable())("pythonParser", { timeout: PYTHON_TEST_TIMEOUT_MS }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts modules, types, positional-only params, and skips a bad file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withTempDir({ "widget.py": SAMPLE_PY, "broken.py": "def (" }, async (dir, paths) => {
      const [widget, broken] = await pythonParser.parseFiles(
        [paths["widget.py"], paths["broken.py"]],
        dir
      );

      expect(widget.filePath).toBe(paths["widget.py"]);
      expect(widget.docstring).toBe("Sample math helpers.");
      expect(widget.imports).toEqual(expect.arrayContaining(["typing.Optional", "os"]));

      const add = widget.functions.find((f) => f.name === "add");
      expect(add).toMatchObject({
        returnType: "int",
        isAsync: false,
        docstring: "Adds two numbers.",
        params: [
          { name: "a", annotation: "int", default: null },
          { name: "b", annotation: "int", default: "0" },
        ],
      });

      const clamp = widget.functions.find((f) => f.name === "clamp");
      expect(clamp?.params.map((p) => p.name)).toEqual(["value", "/", "low", "*", "high"]);
      expect(clamp?.params.find((p) => p.name === "value")).toMatchObject({
        annotation: "int",
        default: null,
      });
      expect(clamp?.params.find((p) => p.name === "high")).toMatchObject({
        annotation: "int",
        default: "100",
      });

      expect(widget.classes).toHaveLength(1);
      const widgetClass = widget.classes[0];
      expect(widgetClass.name).toBe("Widget");
      expect(widgetClass.docstring).toBe("A labeled box.");
      expect(widgetClass.methods.map((m) => m.name)).toEqual(["__init__", "render"]);
      expect(widgetClass.methods.find((m) => m.name === "render")).toMatchObject({
        isAsync: true,
        returnType: "str",
        docstring: "Draw the widget.",
      });

      expect(broken).toEqual({
        filePath: paths["broken.py"],
        docstring: null,
        imports: [],
        classes: [],
        functions: [],
      });
    });
  });

  it("uses a Python 3 executable that is actually on PATH", () => {
    const python = findPythonExecutable();
    const probe = spawnSync(
      python,
      ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3,) else 1)"],
      { encoding: "utf8", timeout: PYTHON_PROBE_TIMEOUT_MS, windowsHide: true }
    );
    expect(probe.error).toBeUndefined();
    expect(probe.status).toBe(0);
  });
});
