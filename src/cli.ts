#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { scanProject } from "./core/project-scanner.js";
import { generateStaticReadme } from "./generators/readme-generator.js";
import { generateApiDocs, generateApiIndex } from "./generators/api-doc-generator.js";
import { ClaudeReadmeEnhancer } from "./enhancers/claude-enhancer.js";

const program = new Command();

program
  .name("docgen")
  .description("Scans a project's source code and generates README and API documentation.")
  .version("0.1.0");

program
  .command("generate")
  .description("Scan a project and generate README.md and docs/api/*.md")
  .argument("<projectPath>", "path to the project to scan")
  .option("-l, --lang <language>", "source language to scan", "python")
  .option("-o, --out <dir>", "output directory for API docs", "docs/api")
  .option("--llm", "enhance the README using the Claude API (requires ANTHROPIC_API_KEY)", false)
  .option("--api-key <key>", "Anthropic API key (overrides ANTHROPIC_API_KEY env var)")
  .option("--readme-only", "only generate README.md", false)
  .option("--api-only", "only generate API docs", false)
  .action(async (projectPath: string, opts) => {
    if (opts.apiOnly && opts.readmeOnly) {
      console.error(pc.red("--readme-only and --api-only are mutually exclusive; pass at most one."));
      process.exitCode = 1;
      return;
    }
    try {
      console.log(pc.cyan(`Scanning ${path.resolve(projectPath)} (${opts.lang})...`));
      const structure = await scanProject(projectPath, opts.lang);
      console.log(pc.dim(`Found ${structure.modules.length} module(s).`));

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

        const readmePath = path.join(structure.rootDir, "README.md");
        await writeFile(readmePath, readme, "utf8");
        console.log(pc.green(`Wrote ${readmePath}`));
      }

      if (!opts.readmeOnly) {
        const apiFiles = generateApiDocs(structure);
        const outDir = path.resolve(structure.rootDir, opts.out);
        const modulesDir = "modules";
        await mkdir(path.join(outDir, modulesDir), { recursive: true });

        for (const file of apiFiles) {
          await writeFile(path.join(outDir, modulesDir, file.relativePath), file.content, "utf8");
        }
        await writeFile(path.join(outDir, "index.md"), generateApiIndex(apiFiles, modulesDir), "utf8");

        console.log(pc.green(`Wrote ${apiFiles.length} API doc file(s) to ${outDir}`));
      }
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exitCode = 1;
    }
  });

program.parse();
