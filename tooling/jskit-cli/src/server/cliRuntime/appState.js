import path from "node:path";
import process from "node:process";
import { createCliError } from "../shared/cliError.js";
import { ensureObject } from "../shared/collectionUtils.js";
import { escapeRegExp } from "../shared/optionInterpolation.js";
import {
  fileExists,
  readJsonFile
} from "./ioAndMigrations.js";

const APP_ROOT_MARKER_RELATIVE_PATHS = Object.freeze([
  "app.json"
]);

async function directoryLooksLikeJskitAppRoot(directoryPath) {
  for (const relativePath of APP_ROOT_MARKER_RELATIVE_PATHS) {
    if (await fileExists(path.join(directoryPath, relativePath))) {
      return true;
    }
  }
  return false;
}

async function resolveAppRootFromCwd(cwd) {
  const startDirectory = path.resolve(String(cwd || process.cwd()));
  let currentDirectory = startDirectory;
  let fallbackPackageRoot = "";

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (await fileExists(packageJsonPath)) {
      if (!fallbackPackageRoot) {
        fallbackPackageRoot = currentDirectory;
      }
      if (await directoryLooksLikeJskitAppRoot(currentDirectory)) {
        return currentDirectory;
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      if (fallbackPackageRoot) {
        return fallbackPackageRoot;
      }
      throw createCliError(
        `Could not locate package.json starting from ${startDirectory}. Run jskit from an app directory (or a child directory of one).`
      );
    }
    currentDirectory = parentDirectory;
  }
}

async function loadAppPackageJson(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  return {
    packageJsonPath,
    packageJson
  };
}

function ensurePackageJsonSection(packageJson, sectionName) {
  const sectionValue = ensureObject(packageJson[sectionName]);
  packageJson[sectionName] = sectionValue;
  return sectionValue;
}

function applyPackageJsonField(packageJson, sectionName, key, value) {
  const section = ensurePackageJsonSection(packageJson, sectionName);
  const nextValue = String(value);
  const hadPrevious = Object.prototype.hasOwnProperty.call(section, key);
  const previousValue = hadPrevious ? String(section[key]) : "";
  const changed = !hadPrevious || previousValue !== nextValue;
  section[key] = nextValue;
  return {
    changed,
    previousValue: hadPrevious ? previousValue : undefined,
    value: nextValue
  };
}

function removePackageJsonField(packageJson, sectionName, key) {
  const section = ensureObject(packageJson[sectionName]);
  if (!Object.prototype.hasOwnProperty.call(section, key)) {
    return false;
  }
  delete section[key];
  if (Object.keys(section).length < 1) {
    delete packageJson[sectionName];
  }
  return true;
}

function parseEnvLineValue(line, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  if (!pattern.test(line)) {
    return null;
  }
  const index = line.indexOf("=");
  if (index === -1) {
    return "";
  }
  return line.slice(index + 1);
}

function upsertEnvValue(content, key, value) {
  const lines = String(content || "").split(/\r?\n/);
  const lookupPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  let index = -1;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    if (lookupPattern.test(lines[cursor])) {
      index = cursor;
      break;
    }
  }

  const hadPrevious = index >= 0;
  const previousValue = hadPrevious ? String(parseEnvLineValue(lines[index], key) || "") : "";
  const nextLine = `${key}=${value}`;

  if (hadPrevious) {
    lines[index] = nextLine;
  } else {
    if (lines.length === 1 && lines[0] === "") {
      lines[0] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  const normalized = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  return {
    hadPrevious,
    previousValue,
    content: normalized
  };
}

export {
  directoryLooksLikeJskitAppRoot,
  resolveAppRootFromCwd,
  loadAppPackageJson,
  ensurePackageJsonSection,
  applyPackageJsonField,
  removePackageJsonField,
  parseEnvLineValue,
  upsertEnvValue
};
