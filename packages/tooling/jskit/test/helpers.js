import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

export { runCli, writeJsonFile, readJsonFile, readFileSync };
