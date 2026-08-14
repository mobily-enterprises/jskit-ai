import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let fixtureImportSequence = 0;

async function resolveJskitConfig(jskitOrSource) {
  if (jskitOrSource && typeof jskitOrSource === "object") {
    return jskitOrSource;
  }
  const source = String(jskitOrSource || "").trim();
  if (!source) {
    throw new TypeError("JSKIT fixture config is required.");
  }
  fixtureImportSequence += 1;
  const encoded = Buffer.from(`export default ${source};`, "utf8").toString("base64");
  const moduleNamespace = await import(
    `data:text/javascript;base64,${encoded}#jskit-fixture-${fixtureImportSequence}`
  );
  return moduleNamespace.default;
}

async function writeJskitConfig(packageRoot, jskitOrSource) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.jskit = await resolveJskitConfig(jskitOrSource);
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export { writeJskitConfig };
