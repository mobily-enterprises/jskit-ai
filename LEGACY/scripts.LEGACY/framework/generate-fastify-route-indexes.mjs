import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const templatePath = path.join(__dirname, "templates", "fastify-routes-index.js");

const targets = [
  "packages/workspace/console-errors-fastify-routes/src/shared/index.js",
  "packages/workspace/console-fastify-routes/src/shared/index.js",
  "packages/workspace/settings-fastify-routes/src/shared/index.js",
  "packages/workspace/workspace-fastify-routes/src/shared/index.js",
  "packages/runtime/health-fastify-routes/src/shared/index.js",
  "packages/observability/observability-fastify-routes/src/shared/index.js"
];

const template = await readFile(templatePath, "utf8");

await Promise.all(
  targets.map(async (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    await writeFile(absolutePath, template, "utf8");
  })
);
