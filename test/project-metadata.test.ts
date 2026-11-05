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
          installSteps: { javascript: ["npm install"] },
        });
      }
    );
  });

  it("tolerates a malformed package.json", async () => {
    await withTempDir({ "package.json": "{ not json" }, async (dir) => {
      expect(await readProjectMetadata(dir)).toEqual({
        description: null,
        installSteps: { javascript: ["npm install"] },
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
});
