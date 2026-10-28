import fs from "node:fs";
import path from "node:path";
import { baseCompile } from "@intlify/message-compiler";
import { createI18n } from "vue-i18n";

import { flattenCatalog, formatMessage, messageKeyForCode, messageParams } from "../../packages/kernel/shared/i18n/index.js";

// Checks one package's locales/en.json against its source: every message is valid
// vue-i18n syntax that JSKIT's own formatter renders identically, every key and
// dotted code the source uses exists, no key is unused, and no other package in the
// repo defines the same key.

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "coverage", "test", "tests", "locales", "patterns", "templates", "fixtures"
]);
const KEY_LITERAL_PATTERN = /["'`](jskit\.[A-Za-z0-9_.]+)["'`]/g;
const CODE_PATTERN = /\b(?:code|messageCode)\s*[:=]\s*["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)["'`]/g;

function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(entryPath));
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name)) && !/\.(test|spec)\.[a-z]+$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function readCatalog(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, "locales", "en.json"), "utf8"));
}

function syntaxProblems(key, message) {
  const problems = [];
  if (typeof message !== "string") {
    return [`${key} is not a string`];
  }
  if (/@[.:]/u.test(message.replace(/\{'[^']*'\}/gu, ""))) {
    problems.push(`${key} uses a linked message; JSKIT catalogs do not`);
  }
  baseCompile(message, { onError: (error) => problems.push(`${key}: ${error.message}`) });
  if (problems.length > 0) {
    return problems;
  }
  const names = messageParams(message);
  const sample = Object.fromEntries(names.map((name) => [name, `<${name}>`]));
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: { message } }, missingWarn: false });
  const counts = message.includes("|") ? [0, 1, 2, 5] : [undefined];
  for (const count of counts) {
    const params = count === undefined ? sample : { ...sample, count };
    const expected = i18n.global.t("message", params, count === undefined ? {} : { plural: count });
    if (formatMessage(message, params) !== expected) {
      problems.push(`${key} renders differently through vue-i18n: ${JSON.stringify(expected)}`);
    }
  }
  return problems;
}

function evaluateI18nCatalogContract({ repoRoot, packageDir, externalCodes = [] }) {
  const problems = [];
  const keys = flattenCatalog(readCatalog(packageDir));
  const namespaces = new Set(Object.keys(keys).map((key) => key.split(".")[1]));

  for (const [key, message] of Object.entries(keys)) {
    if (!key.startsWith("jskit.")) problems.push(`${key} is outside the jskit namespace`);
    problems.push(...syntaxProblems(key, message));
  }

  const used = new Set();
  const usedPrefixes = [];
  const sources = sourceFiles(packageDir).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const [, literal] of sources.matchAll(KEY_LITERAL_PATTERN)) {
    if (!namespaces.has(literal.split(".")[1])) continue;
    if (literal.endsWith(".")) {
      usedPrefixes.push(literal);
    } else {
      used.add(literal);
      if (!Object.hasOwn(keys, literal)) problems.push(`${literal} is used but missing from locales/en.json`);
    }
  }
  for (const [, code] of sources.matchAll(CODE_PATTERN)) {
    const key = messageKeyForCode(code);
    if (!namespaces.has(code.split(".")[0])) continue;
    used.add(key);
    if (!Object.hasOwn(keys, key)) problems.push(`code ${code} is thrown but ${key} is missing from locales/en.json`);
  }
  for (const key of Object.keys(keys)) {
    const errorCode = key.startsWith("jskit.errors.") ? key.slice("jskit.errors.".length) : "";
    const referenced = used.has(key) || usedPrefixes.some((prefix) => key.startsWith(prefix)) ||
      (errorCode && (externalCodes.includes(errorCode) || sources.includes(`"${errorCode}"`) || sources.includes(`'${errorCode}'`)));
    if (!referenced) problems.push(`${key} is not used by the package`);
  }

  const packagesDir = path.join(repoRoot, "packages");
  for (const other of fs.readdirSync(packagesDir)) {
    const otherDir = path.join(packagesDir, other);
    if (otherDir === path.resolve(packageDir) || !fs.existsSync(path.join(otherDir, "locales", "en.json"))) continue;
    for (const key of Object.keys(flattenCatalog(readCatalog(otherDir)))) {
      if (Object.hasOwn(keys, key)) problems.push(`${key} is also defined by packages/${other}`);
    }
  }

  return { keys, problems };
}

export { evaluateI18nCatalogContract };
