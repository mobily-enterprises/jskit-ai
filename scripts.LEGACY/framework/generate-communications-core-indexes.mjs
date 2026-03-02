import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const templatePath = path.join(__dirname, "templates", "communications-core-index.js");

const targets = [
  "packages/communications/email-core/src/shared/index.js",
  "packages/communications/sms-core/src/shared/index.js"
];

const template = await readFile(templatePath, "utf8");

await Promise.all(
  targets.map(async (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    await writeFile(absolutePath, template, "utf8");
  })
);
