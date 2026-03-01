import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

function listFilesRecursive(rootDir, predicate = () => true) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (predicate(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export { listFilesRecursive };
