import { readFile, writeFile } from "node:fs/promises";
import { updateReadmeApiContracts } from "../lib/readmeApiContracts.js";

const README_PATH = new URL("../README.md", import.meta.url);

async function main() {
  const checkOnly = process.argv.includes("--check");
  const current = await readFile(README_PATH, "utf8");
  const next = updateReadmeApiContracts(current);

  if (current === next) {
    return;
  }

  if (checkOnly) {
    process.stderr.write("README API contracts are out of sync. Run `npm run docs:api-contracts`.\n");
    process.exitCode = 1;
    return;
  }

  await writeFile(README_PATH, next, "utf8");
}

await main();
