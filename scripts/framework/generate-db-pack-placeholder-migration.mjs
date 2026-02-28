import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const templatePath = path.join(__dirname, "templates", "db-pack-placeholder-migration.cjs");

const targets = [
  "packages/tooling/jskit/packages/db-postgres/templates/migrations/20260101000000_create_placeholder_table.cjs",
  "packages/tooling/jskit/packages/db-mysql/templates/migrations/20260101000000_create_placeholder_table.cjs"
];

const template = await readFile(templatePath, "utf8");

await Promise.all(
  targets.map(async (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    await writeFile(absolutePath, template, "utf8");
  })
);
