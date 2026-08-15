import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOUNDATION_PATTERNS_ROOT = path.join(REPO_ROOT, "packages", "agent-docs", "patterns");

async function copyFoundationPattern({ cwd, name, pattern = "shell-foundation" } = {}) {
  const appName = String(name || "").trim();
  if (!appName) {
    throw new Error("copyFoundationPattern requires name.");
  }

  const sourceRoot = path.join(FOUNDATION_PATTERNS_ROOT, pattern, "example");
  const appRoot = path.join(path.resolve(cwd), appName);
  await mkdir(appRoot, { recursive: true });
  await cp(sourceRoot, appRoot, { recursive: true, errorOnExist: true, force: false });
  await rename(path.join(appRoot, "gitignore"), path.join(appRoot, ".gitignore"));

  for (const fileName of ["package.json", "app.json"]) {
    const filePath = path.join(appRoot, fileName);
    const document = JSON.parse(await readFile(filePath, "utf8"));
    document.name = appName;
    await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }

  return appRoot;
}

export { copyFoundationPattern };
