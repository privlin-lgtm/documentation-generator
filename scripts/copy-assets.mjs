import { cpSync } from "node:fs";

cpSync("src/parsers/python/ast_dump.py", "dist/ast_dump.py");
