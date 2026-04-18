import { spawnSync } from "node:child_process";

const GENERATED_PATHS = Object.freeze([
  "packages/agent-docs/reference/autogen",
  "packages/agent-docs/guide/agent",
  "tooling/jskit-catalog/catalog/packages.json"
]);

function main() {
  const result = spawnSync(
    "git",
    ["status", "--short", "--untracked-files=all", "--", ...GENERATED_PATHS],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Unable to inspect generated file status.\n");
    process.exit(result.status || 1);
  }

  const output = String(result.stdout || "").trim();
  if (!output) {
    process.stdout.write("Generated files are up to date.\n");
    return;
  }

  process.stderr.write("Generated files are out of date or uncommitted:\n");
  process.stderr.write(`${output}\n`);
  process.stderr.write("Run `npm run catalog:build` and `npm run agent-docs:build`, then commit the results.\n");
  process.exit(1);
}

main();
