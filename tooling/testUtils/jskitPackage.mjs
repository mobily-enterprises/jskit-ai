import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let fixtureImportSequence = 0;

async function resolveMetadata(metadataOrExpression) {
  if (metadataOrExpression && typeof metadataOrExpression === "object") {
    return metadataOrExpression;
  }
  const source = String(metadataOrExpression || "").trim();
  if (!source) {
    throw new TypeError("JSKIT fixture metadata is required.");
  }
  fixtureImportSequence += 1;
  const encoded = Buffer.from(`export default ${source};`, "utf8").toString("base64");
  const moduleNamespace = await import(
    `data:text/javascript;base64,${encoded}#jskit-fixture-${fixtureImportSequence}`
  );
  return moduleNamespace.default;
}

async function writeJskitPackageMetadata(packageRoot, metadataOrExpression) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const metadata = await resolveMetadata(metadataOrExpression);
  const {
    packageId,
    packageVersion: _packageVersion,
    version,
    description,
    ...jskit
  } = metadata || {};

  if (packageId) {
    packageJson.name = packageId;
  }
  if (version) {
    packageJson.version = version;
  }
  if (description) {
    packageJson.description = description;
  }
  packageJson.jskit = jskit;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export { writeJskitPackageMetadata };
