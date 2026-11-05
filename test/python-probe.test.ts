import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake every probe so these tests don't depend on (or wait for) a real Python.
const spawnSyncMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

function result(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null, ...overrides };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the call to throw");
}

// findPythonExecutable caches its answer at module level, so load a fresh copy per test.
async function loadFind() {
  vi.resetModules();
  return (await import("../src/parsers/python/python-parser.js")).findPythonExecutable;
}

describe("findPythonExecutable probe", () => {
  beforeEach(() => spawnSyncMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("gives each probe a generous timeout and returns the first working candidate", async () => {
    spawnSyncMock.mockReturnValue(result({ status: 0 }));
    const find = await loadFind();
    expect(typeof find()).toBe("string");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][2]).toMatchObject({ timeout: 20_000 });
  });

  it("says Python may be slow when a probe timed out", async () => {
    spawnSyncMock
      .mockReturnValueOnce(result({ status: null, signal: "SIGTERM", error: errno("ETIMEDOUT") }))
      .mockReturnValue(result({ status: null, error: errno("ENOENT") }));
    const find = await loadFind();
    const message = thrownMessage(find);
    expect(message).toMatch(/Could not find a Python 3 interpreter/);
    expect(message).toMatch(/timed out after 20s; Python may be slow to start/);
  });

  it("keeps the plain not-found message when nothing timed out", async () => {
    spawnSyncMock.mockReturnValue(result({ status: null, error: errno("ENOENT") }));
    const find = await loadFind();
    const message = thrownMessage(find);
    expect(message).toMatch(/Is Python 3 installed and on PATH\?$/);
    expect(message).not.toMatch(/timed out/);
  });
});
