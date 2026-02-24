import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function parseFlagArgs(args = []) {
  const source = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if (!token.startsWith("--")) {
      source._.push(token);
      continue;
    }

    const key = token.slice(2).trim();
    if (!key) {
      continue;
    }

    if (key === "check" || key === "force") {
      source[key] = true;
      continue;
    }

    const valueToken = String(args[index + 1] || "").trim();
    if (!valueToken || valueToken.startsWith("--")) {
      source[key] = "";
      continue;
    }

    source[key] = valueToken;
    index += 1;
  }

  return source;
}

function resolveRequiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`Missing required --${label} option.`);
  }
  return normalized;
}

function resolveSourceSpecifierParts(sourceSpecifier) {
  const match = String(sourceSpecifier || "").match(/^(@[^/]+\/[^/]+)\/source\/(.+\.vue)$/);
  if (!match) {
    throw new Error(`Invalid --source value: ${sourceSpecifier}. Expected <package>/source/<Component>.vue`);
  }

  return {
    packageName: String(match[1] || ""),
    sourceRelativePath: String(match[2] || "")
  };
}

function resolvePackageRoot(appRoot, packageName) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const requireFromApp = createRequire(packageJsonPath);
  const resolvedPackageJsonPath = requireFromApp.resolve(`${packageName}/package.json`);
  return path.dirname(resolvedPackageJsonPath);
}

function resolveTargetPath(appRoot, targetValue) {
  const raw = String(targetValue || "").trim();
  if (!raw) {
    throw new Error("Missing required --target option.");
  }

  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }

  return path.resolve(appRoot, raw);
}

function stripEjectHeader(value) {
  const normalized = normalizeNewlines(value);
  const lines = normalized.split("\n");
  if (!lines[0]?.startsWith("<!-- EJECTED FROM:")) {
    return normalized;
  }

  let index = 0;
  while (index < lines.length && lines[index].startsWith("<!--")) {
    index += 1;
  }
  while (index < lines.length && lines[index].trim().length < 1) {
    index += 1;
  }

  return lines.slice(index).join("\n");
}

async function loadSourceContext({ appRoot, sourceSpecifier }) {
  const { packageName, sourceRelativePath } = resolveSourceSpecifierParts(sourceSpecifier);
  const packageRoot = resolvePackageRoot(appRoot, packageName);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const sourcePath = path.join(packageRoot, "src", sourceRelativePath);
  const sourceText = normalizeNewlines(await readFile(sourcePath, "utf8"));

  return {
    packageName,
    packageVersion: String(packageJson?.version || "0.0.0"),
    sourceRelativePath,
    sourcePath,
    sourceText
  };
}

export {
  loadSourceContext,
  normalizeNewlines,
  parseFlagArgs,
  resolveRequiredString,
  resolveTargetPath,
  stripEjectHeader
};
