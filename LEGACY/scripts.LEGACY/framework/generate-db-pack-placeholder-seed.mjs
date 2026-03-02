import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const templatePath = path.join(__dirname, "templates", "db-pack-placeholder-seed.cjs");

const targets = [
  "packages/tooling/jskit/packages/db-postgres/templates/seeds/000_placeholder_seed.cjs",
  "packages/tooling/jskit/packages/db-mysql/templates/seeds/000_placeholder_seed.cjs"
];

const template = await readFile(templatePath, "utf8");

await Promise.all(
  targets.map(async (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    await writeFile(absolutePath, template, "utf8");
  })
);
