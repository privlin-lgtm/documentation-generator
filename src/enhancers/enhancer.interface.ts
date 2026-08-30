import type { ProjectStructure } from "../types.js";

export interface ReadmeEnhancer {
  /**
   * Given the extracted project structure and the static README draft,
   * returns an improved README. Implementations should throw on failure;
   * callers are expected to fall back to the static draft.
   */
  enhanceReadme(structure: ProjectStructure, staticDraft: string): Promise<string>;
}
