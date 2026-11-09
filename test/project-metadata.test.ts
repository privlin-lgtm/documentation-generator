import { describe, expect, it } from "vitest";
import { readProjectMetadata } from "../src/core/project-metadata.js";
import { withTempDir } from "./helpers.js";

describe("readProjectMetadata", () => {
  it("returns nothing for a directory with no manifest files", async () => {
    await withTempDir({ "a.js": "" }, async (dir) => {
      expect(await readProjectMetadata(dir)).toEqual({ description: null, installSteps: {} });
    });
  });

  it("reads npm install and the description from package.json", async () => {
    await withTempDir(
      { "package.json": JSON.stringify({ name: "x", description: "  Does things.  " }) },
      async (dir) => {
        expect(await readProjectMetadata(dir)).toEqual({
          description: "Does things.",
          installSteps: { javascript: ["npm install"], typescript: ["npm install"] },
        });
      }
    );
  });

  it("tolerates a malformed package.json", async () => {
    await withTempDir({ "package.json": "{ not json" }, async (dir) => {
      expect(await readProjectMetadata(dir)).toEqual({
        description: null,
        installSteps: { javascript: ["npm install"], typescript: ["npm install"] },
      });
    });
  });

  it("prefers requirements.txt over pyproject.toml for the install step", async () => {
    await withTempDir(
      { "requirements.txt": "requests\n", "pyproject.toml": '[project]\nname = "x"\n' },
      async (dir) => {
        const meta = await readProjectMetadata(dir);
        expect(meta.installSteps.python).toEqual(["pip install -r requirements.txt"]);
      }
    );
  });

  it("reads pip install . and the [project] description from pyproject.toml", async () => {
    await withTempDir(
      {
        "pyproject.toml": [
          "[build-system]",
          'description = "not this one"',
          "",
          "[project]",
          'name = "x"',
          'description = "A Python library."',
          "",
        ].join("\n"),
      },
      async (dir) => {
        expect(await readProjectMetadata(dir)).toEqual({
          description: "A Python library.",
          installSteps: { python: ["pip install ."] },
        });
      }
    );
  });

  it("reads the [tool.poetry] description from pyproject.toml", async () => {
    await withTempDir(
      { "pyproject.toml": "[tool.poetry]\nname = 'x'\ndescription = 'Poetry project.'\n" },
      async (dir) => {
        expect((await readProjectMetadata(dir)).description).toBe("Poetry project.");
      }
    );
  });

  it("reads the [metadata] description from setup.cfg", async () => {
    await withTempDir(
      { "setup.cfg": "[metadata]\nname = x\ndescription = From setup.cfg\n\n[options]\n" },
      async (dir) => {
        expect(await readProjectMetadata(dir)).toEqual({
          description: "From setup.cfg",
          installSteps: { python: ["pip install ."] },
        });
      }
    );
  });

  describe("JavaScript package manager detection", () => {
    const pkg = JSON.stringify({ name: "x" });

    async function stepsFor(files: Record<string, string>) {
      let steps: Record<string, string[]> = {};
      await withTempDir(files, async (dir) => {
        steps = (await readProjectMetadata(dir)).installSteps;
      });
      return steps;
    }

    it.each([
      ["pnpm-lock.yaml", "pnpm install"],
      ["yarn.lock", "yarn install"],
      ["bun.lockb", "bun install"],
      ["bun.lock", "bun install"],
      ["package-lock.json", "npm install"],
    ])("maps %s to %s for both JavaScript and TypeScript", async (lockfile, command) => {
      expect(await stepsFor({ "package.json": pkg, [lockfile]: "" })).toEqual({
        javascript: [command],
        typescript: [command],
      });
    });

    it("falls back to npm install when there is no lockfile", async () => {
      expect(await stepsFor({ "package.json": pkg })).toEqual({
        javascript: ["npm install"],
        typescript: ["npm install"],
      });
    });

    it("lets the packageManager field win over a lockfile", async () => {
      const steps = await stepsFor({
        "package.json": JSON.stringify({ name: "x", packageManager: "pnpm@9.1.0" }),
        "yarn.lock": "",
      });
      expect(steps.javascript).toEqual(["pnpm install"]);
      expect(steps.typescript).toEqual(["pnpm install"]);
    });

    it("reads a packageManager field with a hash suffix", async () => {
      const steps = await stepsFor({
        "package.json": JSON.stringify({ packageManager: "yarn@4.5.0+sha512.abc123" }),
      });
      expect(steps.javascript).toEqual(["yarn install"]);
    });

    it("ignores an unknown packageManager value and uses the lockfile", async () => {
      const steps = await stepsFor({
        "package.json": JSON.stringify({ packageManager: "deno@2.0.0" }),
        "bun.lock": "",
      });
      expect(steps.javascript).toEqual(["bun install"]);
    });

    it("prefers pnpm, then yarn, then bun, then npm when several lockfiles exist", async () => {
      const all = {
        "package.json": pkg,
        "pnpm-lock.yaml": "",
        "yarn.lock": "",
        "bun.lockb": "",
        "package-lock.json": "{}",
      };
      expect((await stepsFor(all)).javascript).toEqual(["pnpm install"]);
      const { "pnpm-lock.yaml": _p, ...noPnpm } = all;
      expect((await stepsFor(noPnpm)).javascript).toEqual(["yarn install"]);
      const { "yarn.lock": _y, ...noYarn } = noPnpm;
      expect((await stepsFor(noYarn)).javascript).toEqual(["bun install"]);
    });

    it("ignores lockfiles when there is no package.json", async () => {
      expect(await stepsFor({ "pnpm-lock.yaml": "" })).toEqual({});
    });
  });
});
