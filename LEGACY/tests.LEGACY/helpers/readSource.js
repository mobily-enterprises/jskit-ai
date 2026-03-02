import { readFileSync } from "node:fs";

function readSource(filePath) {
  return readFileSync(filePath, "utf8");
}

export { readSource };
