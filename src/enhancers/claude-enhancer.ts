import Anthropic from "@anthropic-ai/sdk";
import type { ProjectStructure } from "../types.js";
import type { ReadmeEnhancer } from "./enhancer.interface.js";

const MODEL = "claude-sonnet-5";

function summarizeStructureForPrompt(structure: ProjectStructure): string {
  const parts: string[] = [`Languages: ${structure.languages.join(", ")}`];
  for (const mod of structure.modules) {
    const classNames = mod.classes.map((c) => c.name);
    const fnNames = mod.functions.map((f) => f.name);
    if (classNames.length === 0 && fnNames.length === 0 && !mod.docstring) continue;
    parts.push(
      [
        `Module: ${mod.filePath}`,
        mod.docstring ? `Docstring: ${mod.docstring}` : null,
        classNames.length ? `Classes: ${classNames.join(", ")}` : null,
        fnNames.length ? `Functions: ${fnNames.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return parts.join("\n\n");
}

/** Uses the Claude API to rewrite the static README draft with clearer prose. Requires ANTHROPIC_API_KEY. */
export class ClaudeReadmeEnhancer implements ReadmeEnhancer {
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Set it in your environment or pass --api-key to enable LLM enhancement."
      );
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async enhanceReadme(structure: ProjectStructure, staticDraft: string): Promise<string> {
    const structureSummary = summarizeStructureForPrompt(structure);

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            "You are improving a README.md that was auto-generated from static code analysis.",
            "Rewrite it to be clearer and more useful, while staying accurate to the provided code structure.",
            "Keep all real information (installation, structure, API highlights). Do not invent features, dependencies, or behavior that isn't evidenced by the code structure below.",
            "Return only the final Markdown for the README, with no commentary.",
            "",
            "## Code structure summary",
            structureSummary || "(no classes or functions were found)",
            "",
            "## Static draft to improve",
            staticDraft,
          ].join("\n"),
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude response did not contain text content.");
    }
    return textBlock.text.trim();
  }
}
