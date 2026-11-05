import fs from "node:fs";
import path from "node:path";
import { baseCompile } from "@intlify/message-compiler";
import { createI18n } from "vue-i18n";

import { flattenCatalog, formatMessage, messageKeyForCode, messageParams } from "../../packages/kernel/shared/i18n/index.js";

// Checks one package's locales/en.json against its source: every message is valid
// vue-i18n syntax that JSKIT's own formatter renders identically, every key and
// dotted code the source uses exists, no key is unused, no other package in the
// repo defines the same key, and every undotted code sent with a fixed English
// sentence has that English under jskit.errors.<code>.

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".vue"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "coverage", "test", "tests", "locales", "patterns", "templates", "fixtures"
]);
const KEY_LITERAL_PATTERN = /["'`](jskit\.[A-Za-z0-9_.]+)["'`]/g;
const CODE_PATTERN = /\b(?:code|messageCode)\s*[:=]\s*["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)["'`]/g;
const UNDOTTED_CODE_PATTERN = /\bcode\s*[:=]\s*["'`]([A-Za-z][A-Za-z0-9_]*)["'`]/g;
// A fixed English sentence: a quoted literal that starts with a capital, has more
// than one word, ends a sentence and interpolates nothing.
const SENTENCE_PATTERN = /(["'`])([A-Z][^"'`\n]*\s[^"'`\n]*[.!?])\1/g;
// A coded entry written as one literal, { code, message } in either order.
const CODED_ENTRY_PATTERNS = [
  /\bcode\s*:\s*["']([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)["']\s*,\s*message\s*:\s*"((?:[^"\\]|\\.)*)"/g,
  /\bmessage\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*code\s*:\s*["']([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)["']/g
];
const STATEMENT_BOUNDARIES = [";", "{\n", "}\n", "\n\n"];
const STATEMENT_REACH = { before: 400, after: 200 };

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

// The statement around a code literal, which holds the sentence sent with it:
// from the previous statement boundary to the next semicolon or blank line.
function statementAround(source, start, end) {
  const from = Math.max(start - STATEMENT_REACH.before,
    ...STATEMENT_BOUNDARIES.map((boundary) => {
      const index = source.lastIndexOf(boundary, start);
      return index < 0 ? 0 : index + boundary.length;
    }));
  const ends = [";", "\n\n"].map((boundary) => source.indexOf(boundary, end)).filter((index) => index >= 0);
  return source.slice(from, Math.min(end + STATEMENT_REACH.after, ...ends));
}

// An undotted code renders from jskit.errors.<code>, which this package or another
// (the kernel's not_found, validation_failed) defines. A site that sends its own
// sentence under such a code names it with a messageCode instead.
function undottedCodeProblems(files, ownKeys, otherKeys, variableCodes) {
  const problems = [];
  for (const source of files) {
    for (const match of source.matchAll(UNDOTTED_CODE_PATTERN)) {
      const code = match[1];
      const statement = statementAround(source, match.index, match.index + match[0].length);
      const sentences = [...statement.matchAll(SENTENCE_PATTERN)].map((sentence) => sentence[2]);
      if (sentences.length < 1 || statement.includes("messageCode") || variableCodes.includes(code)) continue;
      const key = `jskit.errors.${code}`;
      const english = Object.hasOwn(ownKeys, key) ? ownKeys[key] : otherKeys.get(key);
      if (english === undefined) {
        problems.push(`code ${code} is sent with the fixed English "${sentences[0]}" but ${key} is missing; ` +
          "catalog it, give the site a messageCode, or list the code in variableCodes");
      } else if (messageParams(english).length < 1 && !sentences.includes(english)) {
        problems.push(`code ${code} is sent with "${sentences[0]}", not ${key}'s English; give the site a messageCode`);
      }
    }
  }
  return problems;
}

// A literal { code, message } entry must send the catalog's English for its code,
// so the client's safety rule lets it translate; entries with params are checked
// where they are built.
function codedEntryProblems(sources, keys) {
  const problems = [];
  const [codeFirst, messageFirst] = CODED_ENTRY_PATTERNS;
  const entries = [
    ...[...sources.matchAll(codeFirst)].map((match) => [match[1], match[2]]),
    ...[...sources.matchAll(messageFirst)].map((match) => [match[2], match[1]])
  ];
  for (const [code, literal] of entries) {
    const english = keys[messageKeyForCode(code)];
    const message = JSON.parse(`"${literal}"`);
    if (english !== undefined && messageParams(english).length < 1 && english !== message) {
      problems.push(`code ${code} is sent with "${message}", not its catalog English "${english}"`);
    }
  }
  return problems;
}

function otherPackageKeys(repoRoot, packageDir) {
  const packagesDir = path.join(repoRoot, "packages");
  const keysByPackage = new Map();
  for (const other of fs.readdirSync(packagesDir)) {
    const otherDir = path.join(packagesDir, other);
    if (otherDir === path.resolve(packageDir) || !fs.existsSync(path.join(otherDir, "locales", "en.json"))) continue;
    keysByPackage.set(other, flattenCatalog(readCatalog(otherDir)));
  }
  return keysByPackage;
}

// nonMessageLiterals: jskit.* strings in the source that are not message keys, such
// as injection keys or Symbol.for names. variableCodes: undotted codes whose English
// varies (a provider's own message), so they have no catalog entry.
function evaluateI18nCatalogContract({
  repoRoot,
  packageDir,
  externalCodes = [],
  nonMessageLiterals = [],
  variableCodes = []
}) {
  const problems = [];
  const keys = flattenCatalog(readCatalog(packageDir));
  const namespaces = new Set(Object.keys(keys).map((key) => key.split(".")[1]));

  for (const [key, message] of Object.entries(keys)) {
    if (!key.startsWith("jskit.")) problems.push(`${key} is outside the jskit namespace`);
    problems.push(...syntaxProblems(key, message));
  }

  const used = new Set();
  const usedPrefixes = [];
  const files = sourceFiles(packageDir).map((file) => fs.readFileSync(file, "utf8"));
  const sources = files.join("\n");
  for (const [, literal] of sources.matchAll(KEY_LITERAL_PATTERN)) {
    if (!namespaces.has(literal.split(".")[1]) || nonMessageLiterals.includes(literal)) continue;
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

  const otherKeys = new Map();
  for (const [other, otherCatalog] of otherPackageKeys(repoRoot, packageDir)) {
    for (const [key, message] of Object.entries(otherCatalog)) {
      if (Object.hasOwn(keys, key)) problems.push(`${key} is also defined by packages/${other}`);
      otherKeys.set(key, message);
    }
  }
  problems.push(...codedEntryProblems(sources, keys));
  problems.push(...undottedCodeProblems(files, keys, otherKeys, variableCodes));

  return { keys, problems };
}

export { evaluateI18nCatalogContract };
