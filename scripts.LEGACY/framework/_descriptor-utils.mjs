import { access, constants as fsConstants, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const parsed = {
    root: DEFAULT_REPO_ROOT,
    packageFilter: "",
    dryRun: false,
    write: false,
    force: false,
    json: false
  };

  while (args.length > 0) {
    const token = String(args.shift() || "").trim();

    if (token === "--root") {
      parsed.root = path.resolve(String(args.shift() || "").trim() || parsed.root);
      continue;
    }
    if (token === "--package") {
      parsed.packageFilter = String(args.shift() || "").trim();
      continue;
    }
    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (token === "--force") {
      parsed.force = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return parsed;
}

export async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

export async function writeTextFile(absolutePath, source) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
}

export async function collectPackageEntries(repoRoot) {
  const packagesRoot = path.join(repoRoot, "packages");
  const domains = await readdir(packagesRoot, { withFileTypes: true });
  const entries = [];

  for (const domainEntry of domains) {
    if (!domainEntry.isDirectory()) {
      continue;
    }

    const domainRoot = path.join(packagesRoot, domainEntry.name);
    const domainPackageJson = path.join(domainRoot, "package.json");
    if (await fileExists(domainPackageJson)) {
      const descriptorPath = path.join(domainRoot, "package.descriptor.mjs");
      entries.push({
        domain: domainEntry.name,
        packageName: domainEntry.name,
        packageRoot: domainRoot,
        packageJsonPath: domainPackageJson,
        descriptorPath,
        relativePackagePath: path.relative(repoRoot, domainRoot).replaceAll("\\", "/")
      });
      continue;
    }

    const children = await readdir(domainRoot, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }

      const packageRoot = path.join(domainRoot, child.name);
      const packageJsonPath = path.join(packageRoot, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        continue;
      }

      entries.push({
        domain: domainEntry.name,
        packageName: child.name,
        packageRoot,
        packageJsonPath,
        descriptorPath: path.join(packageRoot, "package.descriptor.mjs"),
        relativePackagePath: path.relative(repoRoot, packageRoot).replaceAll("\\", "/")
      });
    }
  }

  return entries.sort((left, right) => {
    const domainCompare = left.domain.localeCompare(right.domain);
    return domainCompare === 0 ? left.packageName.localeCompare(right.packageName) : domainCompare;
  });
}

export async function loadDescriptor(descriptorPath) {
  const href = `${pathToFileURL(descriptorPath).href}?cacheBust=${Date.now()}`;
  const module = await import(href);
  return module?.default ?? null;
}

export function renderDescriptor(descriptor) {
  return `export default Object.freeze(${JSON.stringify(descriptor, null, 2)});\n`;
}

export async function listFilesRecursive(rootPath, relativePath = "") {
  const absolutePath = relativePath ? path.join(rootPath, relativePath) : rootPath;
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(rootPath, entryRelativePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryRelativePath.replaceAll("\\", "/"));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function detectTemplateMappings(packageRoot) {
  const templatesRoot = path.join(packageRoot, "templates");
  if (!(await fileExists(templatesRoot))) {
    return [];
  }

  const templateFiles = await listFilesRecursive(templatesRoot);
  return templateFiles.map((entry) => ({
    from: `templates/${entry}`,
    to: entry
  }));
}

export function toSortedObject(source) {
  const output = {};
  for (const key of Object.keys(source || {}).sort((left, right) => left.localeCompare(right))) {
    output[key] = source[key];
  }
  return output;
}

export function normalizeDescriptorShape(descriptor, packageId, packageVersion) {
  const current = descriptor && typeof descriptor === "object" ? descriptor : {};
  const currentMutations = current.mutations && typeof current.mutations === "object" ? current.mutations : {};
  const currentDependencies = currentMutations.dependencies && typeof currentMutations.dependencies === "object"
    ? currentMutations.dependencies
    : {};
  const currentPackageJson = currentMutations.packageJson && typeof currentMutations.packageJson === "object"
    ? currentMutations.packageJson
    : {};

  return {
    packageVersion: Number(current.packageVersion) || 1,
    packageId: String(current.packageId || packageId),
    version: String(current.version || packageVersion || "0.0.0"),
    dependsOn: Array.isArray(current.dependsOn) ? current.dependsOn : [],
    capabilities: {
      provides: Array.isArray(current.capabilities?.provides) ? current.capabilities.provides : [],
      requires: Array.isArray(current.capabilities?.requires) ? current.capabilities.requires : []
    },
    mutations: {
      dependencies: {
        runtime: toSortedObject(currentDependencies.runtime || {}),
        dev: toSortedObject(currentDependencies.dev || {})
      },
      packageJson: {
        scripts: toSortedObject(currentPackageJson.scripts || {})
      },
      procfile: toSortedObject(currentMutations.procfile || {}),
      files: Array.isArray(currentMutations.files) ? currentMutations.files : []
    }
  };
}
