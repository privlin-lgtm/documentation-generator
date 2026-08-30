#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import { scanProject } from "./core/project-scanner.js";
import { generateStaticReadme } from "./generators/readme-generator.js";
import { generateApiDocs, generateApiIndex } from "./generators/api-doc-generator.js";
import { ClaudeReadmeEnhancer } from "./enhancers/claude-enhancer.js";
import { supportedLanguages } from "./parsers/registry.js";

interface PlannedWrite {
  filePath: string;
  content: string;
}

/** "auto" scans every registered language; a comma-separated list scans exactly those. */
function resolveLanguages(langOpt: string): string[] {
  if (langOpt === "auto") return supportedLanguages();
  return langOpt
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fileMatches(filePath: string, expectedContent: string): Promise<boolean> {
  try {
    return (await readFile(filePath, "utf8")) === expectedContent;
  } catch {
    return false;
  }
}

/** Builds a fresh CLI program. Exported (rather than a module-level singleton)
 * so tests can invoke isolated runs without option state leaking between them. */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("docgen")
    .description("Scans a project's source code and generates README and API documentation.")
    .version("0.1.0");

  program
    .command("generate")
    .description("Scan a project and generate README.md and docs/api/*.md")
    .argument("<projectPath>", "path to the project to scan")
    .option(
      "-l, --lang <languages>",
      `comma-separated languages to scan, or "auto" to scan all supported languages (${supportedLanguages().join(", ")})`,
      "auto"
    )
    .option("-o, --out <dir>", "output directory for API docs", "docs/api")
    .option("--llm", "enhance the README using the Claude API (requires ANTHROPIC_API_KEY)", false)
    .option("--api-key <key>", "Anthropic API key (overrides ANTHROPIC_API_KEY env var)")
    .option("--readme-only", "only generate README.md", false)
    .option("--api-only", "only generate API docs", false)
    .option(
      "--check",
      "compare generated docs against what's on disk and exit 1 on drift, without writing anything",
      false
    )
    .action(async (projectPath: string, opts) => {
      if (opts.apiOnly && opts.readmeOnly) {
        console.error(
          pc.red("--readme-only and --api-only are mutually exclusive; pass at most one.")
        );
        process.exitCode = 1;
        return;
      }

      try {
        const languages = resolveLanguages(opts.lang);
        console.log(pc.cyan(`Scanning ${path.resolve(projectPath)} (${languages.join(", ")})...`));
        const structure = await scanProject(projectPath, languages);
        console.log(pc.dim(`Found ${structure.modules.length} module(s).`));

        const writes: PlannedWrite[] = [];

        if (!opts.apiOnly) {
          let readme = generateStaticReadme(structure);

          if (opts.llm) {
            try {
              console.log(pc.cyan("Enhancing README with Claude..."));
              const enhancer = new ClaudeReadmeEnhancer(opts.apiKey);
              readme = await enhancer.enhanceReadme(structure, readme);
            } catch (err) {
              console.warn(
                pc.yellow(
                  `LLM enhancement failed, falling back to static README: ${(err as Error).message}`
                )
              );
            }
          }

          writes.push({ filePath: path.join(structure.rootDir, "README.md"), content: readme });
        }

        if (!opts.readmeOnly) {
          const apiFiles = generateApiDocs(structure);
          const outDir = path.resolve(structure.rootDir, opts.out);
          const modulesDir = "modules";

          for (const file of apiFiles) {
            writes.push({
              filePath: path.join(outDir, modulesDir, file.relativePath),
              content: file.content,
            });
          }
          writes.push({
            filePath: path.join(outDir, "index.md"),
            content: generateApiIndex(apiFiles, modulesDir),
          });
        }

        if (opts.check) {
          const drifted: string[] = [];
          for (const write of writes) {
            if (!(await fileMatches(write.filePath, write.content))) drifted.push(write.filePath);
          }

          if (drifted.length > 0) {
            console.error(
              pc.red(
                `Docs are out of date (${drifted.length}/${writes.length} file(s) would change):`
              )
            );
            for (const filePath of drifted) console.error(pc.red(`  ${filePath}`));
            process.exitCode = 1;
          } else {
            console.log(pc.green(`Docs are up to date (checked ${writes.length} file(s)).`));
          }
          return;
        }

        for (const write of writes) {
          await mkdir(path.dirname(write.filePath), { recursive: true });
          await writeFile(write.filePath, write.content, "utf8");
          console.log(pc.green(`Wrote ${write.filePath}`));
        }
      } catch (err) {
        console.error(pc.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  return program;
}

const isMainModule = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  createProgram().parse();
}
