import type { ModuleInfo } from "../types.js";

/** The placeholder a parser returns for a file it could not process, so a
 * single unreadable/unparsable file doesn't drop out of the module list
 * entirely (it still shows up, just with no extracted structure). */
export function emptyModule(filePath: string): ModuleInfo {
  return { filePath, docstring: null, imports: [], classes: [], functions: [] };
}
