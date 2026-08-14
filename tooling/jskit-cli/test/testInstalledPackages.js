import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function declareInstalledPackages(appRoot, installedPackages = {}) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies = { ...(packageJson.dependencies || {}) };

  for (const packageId of Object.keys(installedPackages).sort((left, right) => left.localeCompare(right))) {
    const packageName = packageId.startsWith("@jskit-ai/")
      ? packageId.slice("@jskit-ai/".length)
      : "";
    if (!packageName) {
      throw new Error(`Test fixture requires an explicit source for non-JSKIT package ${packageId}.`);
    }
    const packageRoot = path.join(REPO_ROOT, "packages", packageName);
    const relativeRoot = path.relative(appRoot, packageRoot).replaceAll(path.sep, "/");
    packageJson.dependencies[packageId] = `file:${relativeRoot}`;
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export { declareInstalledPackages };
