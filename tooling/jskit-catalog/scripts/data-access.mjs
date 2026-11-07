import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./files.mjs";
import { blankJsComments, lineIndex } from "./material3-source.mjs";

// The data part of plain `jskit check`, read from source, never run. It backs up what the lint rules cannot see across
// files: every table has exactly one table resource (`defineTableResource({ name, tableName })`) across the app and its
// installed @jskit-ai packages, so a duplicate name or table fails here before the boot-time throw; every system scope
// (a feature's `systemScope: "<reason>"` and every `systemContext("<reason>")` call) is listed with its reason, and one
// without a literal reason fails; and every file the infrastructure exception lifts past the data-access lint rules is
// listed for review. In the app's own code, which no lint directive can hide from it, a feature's system scope and an
// infrastructure exception fail until the checked-in BASELINE_FILE lists them, so each new one is reviewed; a module
// that requires runtime.database or runtime.resources fails unless it is declared infrastructure; and an eslint-disable
// that names a data-access rule, or no rule at all, fails in any file but the client's. As information, it lists the
// fields of each app table resource that its CRUD contracts never name, which no API shows or accepts.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access";
const SECTIONS = Object.freeze({
  "data/one-resource-per-table": "layer-1-the-table-resource",
  "data/system-scope": "background-work",
  "data/infrastructure-excuses": "hard-rules",
  "data/baseline": "hard-rules",
  "data/runtime-capability": "the-resource-is-the-only-door",
  "data/lint-disabled": "hard-rules",
  "data/unnamed-fields": "layer-2-the-crud-surface"
});
// What each rule asks, said once above its findings in the report.
const RULE_EXPLANATIONS = Object.freeze({
  "data/one-resource-per-table": "every table has exactly one table resource, under a name no other resource has.",
  "data/system-scope": "every system scope and systemContext() call gives its reason as a string literal.",
  "data/baseline": "each infrastructure exception and feature system scope of the app is reviewed, then listed in the checked-in " +
    "jskit-data-access.json; review each one below, then add the entry it shows.",
  "data/runtime-capability": "a module that requires runtime.database or runtime.resources reaches tables past the features that " +
    "own them. A feature owns its tables with owns and gets their handles; only a module whose job is data access itself, " +
    "declared with the infrastructure exception, takes them.",
  "data/lint-disabled": "eslint-disable cannot turn off a data-access rule, and one that names no rule turns them all off. Change the " +
    "code, or name the rules the directive turns off."
});
// The reviewed list of the app's infrastructure exceptions and feature system scopes, at the app's root.
const BASELINE_FILE = "jskit-data-access.json";
const DATA_ACCESS_RULES = Object.freeze(["no-direct-knex", "no-transaction-reader", "sql-literal", "no-hand-scope", "no-hand-context", "knex-reason"]);
// An eslint-disable directive and the rules it names, before any "--" description.
const LINT_DISABLE = /\/[/*]\s*eslint-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/gu;
// A module that takes the database, or every table, past the features that own them.
const RUNTIME_CAPABILITY = /(["'`])(runtime\.(?:database|resources))\1/gu;
// An app's client code, which the data-access rules leave alone: its own src/ but src/server and src/shared, and every
// package's src/client.
const CLIENT_FILE = /^src\/(?!server\/|shared\/)|(?:^|\/)src\/client\//u;
const FRAMEWORK_DIRECTORY = path.join("node_modules", "@jskit-ai");
const SOURCE_FILE = /\.[cm]?js$/u;
const SKIPPED_FILE = /\.(?:test|spec|vitest)\.[cm]?js$/u;
// Code that defines no table resource or system scope an app runs: dependencies, build output, tests and fixtures,
// migrations and seeds, and the examples, templates and documentation JSKIT packages carry.
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "coverage", "test", "tests", "__tests__", "e2e", "fixtures", "test-results",
  "migrations", "seeds", "templates", "patterns", "examples", "docs", "site", "skills", "test-support"
]);
const MARKERS = /defineTableResource|defineCrudContract|systemScope|systemContext|readable-check: allow|eslint-disable|runtime\.(?:database|resources)/u;
const TABLE_RESOURCE_CALL = /\bdefineTableResource\s*\(/gu;
// A CRUD contract on a table resource named by its variable: `defineCrudContract(receivalResource, { ... })`.
const CRUD_CONTRACT_CALL = /\bdefineCrudContract\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*/gu;
// The fields an ownership kind keeps for itself: json-rest-api fills them from the context.
const OWNERSHIP_FIELDS = Object.freeze({
  workspace: ["workspaceId"],
  workspace_or_shared: ["workspaceId"],
  user: ["userId"],
  workspace_user: ["workspaceId", "userId"]
});
// The stamped timestamps every contract shows without an entry.
const STAMPED_FIELDS = Object.freeze(["createdAt", "updatedAt"]);
const FEATURE_CALL = /\bdefine(?:Crud)?Feature\s*\(/gu;
const SYSTEM_CONTEXT_CALL = /\bsystemContext\s*\(/gu;
const INFRASTRUCTURE_EXCUSE = /readable-check: allow (?:jskit\/)?(no-direct-knex|no-transaction-reader) - (infrastructure:.*?)\s*(?:\*\/)?\s*$/u;

const blank = (text) => text.replace(/[^\n]/gu, " ");

// Code with its comments and the contents of its strings and templates blanked to spaces, every offset kept: calls
// and keys are found in it, values are read from the code at the same offsets.
function maskStrings(code) {
  let output = "";
  let index = 0;
  while (index < code.length) {
    const quote = code[index];
    if (quote !== "\"" && quote !== "'" && quote !== "`") {
      output += quote;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < code.length && code[end] !== quote && (quote === "`" || code[end] !== "\n")) {
      end += code[end] === "\\" ? 2 : 1;
    }
    output += quote + blank(code.slice(index + 1, end)) + code.slice(end, end + 1);
    index = end + 1;
  }
  return output;
}

// The offset just past the bracket that closes the one at `start`, in masked code; -1 when it never closes.
function closingOffset(masked, start) {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    if ("([{".includes(masked[index])) depth += 1;
    else if (")]}".includes(masked[index]) && --depth === 0) return index + 1;
  }
  return -1;
}

const nextCodeOffset = (text, offset) => offset + (/^\s*/u.exec(text.slice(offset))?.[0].length || 0);

// The string a top-level `const NAME = "..."` gives, or null.
function constantValue(code, name) {
  const match = new RegExp(`(?:^|[\\s;])const\\s+${name}\\s*=\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1\\s*[;,\\n]`, "u").exec(code);
  return match && !(match[1] === "`" && match[2].includes("${")) ? match[2] : null;
}

/**
 * The value written at an offset, read up to the comma or bracket that ends it: { text } for a string literal, a
 * template without expressions, or a const holding one; { text: null } for anything else.
 */
function readValue(code, masked, offset) {
  const start = nextCodeOffset(code, offset);
  const quote = code[start];
  if (quote === "\"" || quote === "'" || quote === "`") {
    let end = start + 1;
    while (end < code.length && code[end] !== quote) end += code[end] === "\\" ? 2 : 1;
    const after = masked[nextCodeOffset(masked, end + 1)];
    const text = code.slice(start + 1, end);
    const whole = after === "," || after === "}" || after === ")";
    return { text: whole && !(quote === "`" && text.includes("${")) ? text.replace(/\\(.)/gu, "$1") : null };
  }
  const identifier = /^[A-Za-z_$][\w$]*(?=\s*[,})])/u.exec(code.slice(start));
  return { text: identifier ? constantValue(code, identifier[0]) : null };
}

// The top-level keys of the object literal between `start` and `end`, in masked code: for each wanted key, the offset
// just past its colon, or "shorthand" for `{ name }`.
function topLevelKeys(masked, start, end, names) {
  let depth = 0;
  let top = "";
  for (let index = start; index < end; index += 1) {
    const char = masked[index];
    if ("([{".includes(char)) depth += 1;
    top += depth === 1 || char === "\n" ? char : " ";
    if (")]}".includes(char)) depth -= 1;
  }
  const keys = new Map();
  for (const match of top.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(:|(?=[,}]))/gu)) {
    const [whole, key, colon] = match;
    if (names.includes(key) && !keys.has(key)) keys.set(key, colon ? start + match.index + whole.length : "shorthand");
  }
  return keys;
}

// The object literal a call at `callOffset` takes as its first argument: { start, end } in masked code, or null when the
// call is a declaration (`function defineFeature(`) or its first argument is anything else.
function objectArgument(masked, callOffset, matchLength) {
  if (/function\s*\*?\s*$/u.test(masked.slice(Math.max(0, callOffset - 20), callOffset))) return null;
  const start = nextCodeOffset(masked, callOffset + matchLength);
  if (masked[start] !== "{") return null;
  const end = closingOffset(masked, start);
  return end < 0 ? null : { start, end };
}

// The value of one key of an object literal, as readValue reads it; undefined when the object has no such key.
function keyValue(code, masked, keys, key) {
  const at = keys.get(key);
  if (at === undefined) return undefined;
  return at === "shorthand" ? { text: constantValue(code, key) } : readValue(code, masked, at);
}

function readSourceFile(source) {
  const code = blankJsComments(source);
  return { code, masked: maskStrings(code), position: lineIndex(source) };
}

// Every key of the object literal between `start` and `end` (masked code), in order, and whether the literal also
// spreads or computes keys, so that its keys are not all known.
function objectKeys(masked, start, end) {
  let depth = 0;
  let top = "";
  for (let index = start; index < end; index += 1) {
    const char = masked[index];
    if ("([{".includes(char)) depth += 1;
    top += depth === 1 || char === "\n" ? char : " ";
    if (")]}".includes(char)) depth -= 1;
  }
  const keys = [...top.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?::|(?=[,}]))/gu)].map((match) => ({
    key: match[1],
    at: start + match.index + match[0].length
  }));
  return { keys, partial: /(?:^|[{,])\s*(?:\.\.\.|["'`[])/u.test(top) };
}

// The object literal written at an offset: { start, end } in masked code, or null for anything else.
function objectAt(masked, offset) {
  const start = nextCodeOffset(masked, offset);
  if (masked[start] !== "{") return null;
  const end = closingOffset(masked, start);
  return end < 0 ? null : { start, end };
}

// A table resource's schema fields that a CRUD contract could show: { names, partial }, or null when the schema is
// not an object literal. The ownership fields, the stamped timestamps, the primary key and hidden fields are left out.
function readSchemaFields(code, masked, keys, ownership) {
  const at = keys.get("schema");
  const schema = typeof at === "number" ? objectAt(masked, at) : null;
  if (!schema) return null;
  const { keys: fields, partial } = objectKeys(masked, schema.start, schema.end);
  const kept = new Set([...(OWNERSHIP_FIELDS[ownership] || []), ...STAMPED_FIELDS]);
  const names = fields.filter(({ key, at: valueAt }) => {
    if (kept.has(key)) return false;
    const field = objectAt(masked, valueAt);
    if (!field) return true;
    const flags = topLevelKeys(masked, field.start, field.end, ["hidden", "primary"]);
    return ![...flags.values()].some((flagAt) => typeof flagAt === "number" && code.slice(nextCodeOffset(code, flagAt)).startsWith("true"));
  }).map(({ key }) => key);
  return { names, partial };
}

// Every table resource a file defines: its name and table, each null when the source does not write it as a literal,
// the variable it is assigned to and the schema fields a CRUD contract could show.
function readTableResources(file, { code, masked, position }) {
  const resources = [];
  for (const match of masked.matchAll(TABLE_RESOURCE_CALL)) {
    const object = objectArgument(masked, match.index, match[0].length);
    if (!object) continue;
    const keys = topLevelKeys(masked, object.start, object.end, ["name", "tableName", "ownership", "schema"]);
    const ownership = keyValue(code, masked, keys, "ownership")?.text ?? null;
    resources.push({
      file,
      line: position(match.index).line,
      name: keyValue(code, masked, keys, "name")?.text ?? null,
      tableName: keyValue(code, masked, keys, "tableName")?.text ?? null,
      variable: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/u.exec(masked.slice(Math.max(0, match.index - 120), match.index))?.[1] ?? null,
      fields: readSchemaFields(code, masked, keys, ownership)
    });
  }
  return resources;
}

// Every CRUD contract a file defines: the variable of its table resource and the fields its `fields` names, null when
// they are not all written as literal keys.
function readCrudContracts(masked) {
  const contracts = [];
  for (const match of masked.matchAll(CRUD_CONTRACT_CALL)) {
    const config = objectAt(masked, match.index + match[0].length);
    if (!config) {
      contracts.push({ resource: match[1], fields: null });
      continue;
    }
    const at = topLevelKeys(masked, config.start, config.end, ["fields"]).get("fields");
    const fields = typeof at === "number" ? objectAt(masked, at) : null;
    const named = fields ? objectKeys(masked, fields.start, fields.end) : null;
    contracts.push({ resource: match[1], fields: at === undefined ? [] : named && !named.partial ? named.keys.map(({ key }) => key) : null });
  }
  return contracts;
}

// The fields of each app table resource that its CRUD contracts never name, for a resource with at least one contract
// whose fields are all known.
function unnamedFields(resources, contracts) {
  const byResource = Map.groupBy(contracts, ({ resource }) => resource);
  const unnamed = [];
  for (const resource of resources) {
    const own = byResource.get(resource.variable);
    if (resource.framework || !resource.fields || !own || own.some(({ fields }) => fields === null)) continue;
    const named = new Set(own.flatMap(({ fields }) => fields));
    const fields = resource.fields.names.filter((name) => !named.has(name));
    if (fields.length > 0) unnamed.push({ file: resource.file, line: resource.line, name: resource.name, fields });
  }
  return unnamed;
}

// Every system scope a file declares or calls: a feature's systemScope and each systemContext(...) call, with its
// reason, null when it is not a literal.
function readSystemScopes(file, { code, masked, position }) {
  const scopes = [];
  for (const match of masked.matchAll(FEATURE_CALL)) {
    const object = objectArgument(masked, match.index, match[0].length);
    if (!object) continue;
    const keys = topLevelKeys(masked, object.start, object.end, ["id", "systemScope"]);
    const reason = keyValue(code, masked, keys, "systemScope");
    if (reason === undefined) continue;
    scopes.push({ file, line: position(match.index).line, kind: "feature", id: keyValue(code, masked, keys, "id")?.text || "", reason: reason.text });
  }
  for (const match of masked.matchAll(SYSTEM_CONTEXT_CALL)) {
    const open = match.index + match[0].length - 1;
    const close = closingOffset(masked, open);
    const before = masked.slice(Math.max(0, match.index - 20), match.index);
    // A declaration, not a call: `function systemContext(reason) {` or a method `systemContext(reason) {`.
    if (close < 0 || /function\s*\*?\s*$/u.test(before) || masked[nextCodeOffset(masked, close)] === "{") continue;
    const empty = masked.slice(open + 1, close - 1).trim() === "";
    const reason = empty ? { text: "" } : readValue(code, masked, open + 1);
    scopes.push({ file, line: position(match.index).line, kind: "call", id: "", reason: reason.text });
  }
  return scopes;
}

// The infrastructure exceptions in a file's first lines, before its first line of code.
function readInfrastructureExcuses(file, source) {
  const header = /^(?:#![^\n]*\n)?(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/u.exec(source)[0];
  return header.split("\n").flatMap((text, index) => {
    const match = INFRASTRUCTURE_EXCUSE.exec(text);
    return match ? [{ file, line: index + 1, rule: match[1], reason: match[2] }] : [];
  });
}

// Every eslint-disable in a file that turns off a data-access rule: one that names one, or one that names no rule and so
// turns off every rule.
function readLintDisables(file, source, position) {
  const disables = [];
  for (const match of source.matchAll(LINT_DISABLE)) {
    const named = match[1].replace(/\*\/.*$/u, "").split(/\s--\s|\s--$/u)[0].split(",").map((rule) => rule.trim()).filter(Boolean);
    const rules = named.filter((rule) => DATA_ACCESS_RULES.includes(rule.replace(/^jskit\//u, "")));
    if (named.length < 1 || rules.length > 0) {
      disables.push({ file, line: position(match.index).line, rules });
    }
  }
  return disables;
}

// Every place a file's code takes runtime.database or runtime.resources: each time it names one outside a provides
// object, the module that provides it.
function readRuntimeCapabilities(file, { code, masked, position }) {
  const provides = [...masked.matchAll(/\bprovides\s*:\s*\{/gu)].map((match) => {
    const start = match.index + match[0].length - 1;
    return { start, end: closingOffset(masked, start) };
  });
  return [...code.matchAll(RUNTIME_CAPABILITY)]
    .filter((match) => !provides.some(({ start, end }) => match.index > start && match.index < end))
    .map((match) => ({ file, line: position(match.index).line, capability: match[2] }));
}

// The app's reviewed baseline, or empty lists when it has none; a file that is not that JSON is a finding.
async function readBaseline(root, report) {
  let text;
  try {
    text = await readFile(path.join(root, BASELINE_FILE), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { infrastructure: [], systemScopes: [] };
    throw error;
  }
  try {
    const baseline = JSON.parse(text);
    return {
      infrastructure: Array.isArray(baseline.infrastructure) ? baseline.infrastructure : [],
      systemScopes: Array.isArray(baseline.systemScopes) ? baseline.systemScopes : []
    };
  } catch {
    report({ file: BASELINE_FILE, line: 1 }, "data/baseline", `${BASELINE_FILE} is not JSON; it lists { "infrastructure": [{ "file", "rule" }], "systemScopes": [{ "feature", "systemScope" }] }.`);
    return { infrastructure: [], systemScopes: [] };
  }
}

// Fails each infrastructure exception and feature system scope of the app's own code that the baseline does not list.
function checkBaseline(baseline, excuses, scopes, report) {
  const listed = (list, entry) => list.some((item) => Object.entries(entry).every(([key, value]) => item?.[key] === value));
  for (const { file, line, rule } of excuses) {
    if (!listed(baseline.infrastructure, { file, rule })) {
      report({ file, line }, "data/baseline", `the infrastructure exception from ${rule}: once the whole module's job is data access, add ${JSON.stringify({ file, rule })} to "infrastructure".`);
    }
  }
  for (const { file, line, kind, id, reason, framework } of scopes) {
    if (framework || kind !== "feature" || reason === null || !reason.trim()) continue;
    if (!listed(baseline.systemScopes, { feature: id, systemScope: reason })) {
      report({ file, line }, "data/baseline", `the system scope of feature "${id}": once it must work across every workspace and user, add ${JSON.stringify({ feature: id, systemScope: reason })} to "systemScopes".`);
    }
  }
}

async function walk(root, directory, files) {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = directory ? path.join(directory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) await walk(root, relative, files);
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      files.push(relative);
    }
  }
}

// The installed @jskit-ai packages outside the app's own tree (a workspace's linked packages are read as app source),
// each as { directory, real }: where the app sees it and where it is.
async function frameworkPackages(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, FRAMEWORK_DIRECTORY), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const packages = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(FRAMEWORK_DIRECTORY, entry.name);
    const real = await realpath(path.join(root, directory)).catch(() => "");
    const inside = path.relative(root, real);
    const appSource = real && !inside.startsWith("..") && !path.isAbsolute(inside) && !inside.split(path.sep).includes("node_modules");
    if (real && !appSource) packages.push({ directory, real });
  }
  return packages;
}

// Every table resource of a table, and of a name, that another one shares: each one is reported, naming the others.
function checkTables(resources, report) {
  const where = (resource) => `${resource.file}:${resource.line}`;
  const groups = { tableName: new Map(), name: new Map() };
  for (const resource of resources) {
    if (resource.name === null || resource.tableName === null) {
      if (!resource.framework) {
        report(resource, "data/one-resource-per-table",
          "defineTableResource() does not write its name and tableName as string literals (or consts holding them), so this check cannot see which table it owns.");
      }
      continue;
    }
    for (const key of ["tableName", "name"]) {
      groups[key].set(resource[key], [...(groups[key].get(resource[key]) || []), resource]);
    }
  }
  for (const [key, byValue] of Object.entries(groups)) {
    for (const [value, group] of byValue) {
      for (const resource of group.length > 1 ? group : []) {
        const others = group.filter((other) => other !== resource).map(where).join(", ");
        report(resource, "data/one-resource-per-table", key === "tableName"
          ? `table "${value}" has another table resource at ${others}; a table has exactly one table resource, owned by one feature.`
          : `resource name "${value}" is also the name of the table resource at ${others}; every table resource has its own name.`);
      }
    }
  }
}

function checkSystemScopes(scopes, report) {
  for (const scope of scopes) {
    if (scope.reason === null && !scope.framework) {
      report(scope, "data/system-scope", scope.kind === "feature"
        ? "systemScope is not a string literal; write the reason this feature reads past ownership where it is declared."
        : "systemContext() does not take its reason as a string literal; write why this call reads past ownership at the call.");
    } else if (scope.reason !== null && scope.reason.trim() === "") {
      report(scope, "data/system-scope", scope.kind === "feature"
        ? "systemScope gives no reason; say why this feature reads past ownership."
        : "systemContext() gives no reason; say why this call reads past ownership.");
    }
  }
}

/**
 * Reads the app's source and its installed @jskit-ai packages for table resources, system scopes and infrastructure
 * exceptions.
 * @param {{ projectRoot?: string }} options
 */
async function checkDataAccess({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const sources = [];
  const appFiles = [];
  await walk(root, "", appFiles);
  sources.push(...appFiles.map((file) => ({ file, absolute: path.join(root, file), framework: false })));
  for (const { directory, real } of await frameworkPackages(root)) {
    const files = [];
    await walk(real, "", files);
    sources.push(...files.map((file) => ({ file: path.join(directory, file), absolute: path.join(real, file), framework: true })));
  }
  const resources = [];
  const contracts = [];
  const scopes = [];
  const excuses = [];
  const findings = [];
  const report = ({ file, line }, rule, message) => findings.push({ file, line, rule, message });
  for (const { file, absolute, framework } of sources) {
    const source = await readFile(absolute, "utf8");
    if (!MARKERS.test(source)) continue;
    const name = toPosixPath(file);
    const read = readSourceFile(source);
    resources.push(...readTableResources(name, read).map((resource) => ({ ...resource, framework })));
    scopes.push(...readSystemScopes(name, read).map((scope) => ({ ...scope, framework })));
    if (framework) continue;
    contracts.push(...readCrudContracts(read.masked));
    const fileExcuses = readInfrastructureExcuses(name, source);
    excuses.push(...fileExcuses);
    if (fileExcuses.length < 1) {
      for (const use of readRuntimeCapabilities(name, read)) {
        report(use, "data/runtime-capability", `requires ${use.capability}`);
      }
    }
    if (CLIENT_FILE.test(name)) continue;
    for (const disable of readLintDisables(name, source, read.position)) {
      report(disable, "data/lint-disabled", disable.rules.length > 0
        ? `eslint-disable turns off ${disable.rules.join(", ")}`
        : "eslint-disable names no rule");
    }
  }
  checkTables(resources, report);
  checkSystemScopes(scopes, report);
  checkBaseline(await readBaseline(root, report), excuses, scopes, report);
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return {
    ok: findings.length < 1,
    findings,
    files: sources.length,
    resources: resources.length,
    systemScopes: scopes.filter((scope) => scope.reason !== null),
    excuses,
    unnamedFields: unnamedFields(resources, contracts)
  };
}

function formatDataAccessReport(result) {
  const lines = [];
  // Each rule's explanation and guide section once, then its findings.
  for (const [rule, findings] of Map.groupBy(result.findings, ({ rule }) => rule)) {
    lines.push(`${rule} (${findings.length}): ${RULE_EXPLANATIONS[rule]} ${GUIDE}#${SECTIONS[rule]}`);
    for (const { file, line, message } of findings) lines.push(`  ${file}:${line}  ${message}`);
  }
  if (result.systemScopes.length > 0) {
    lines.push(`System scopes (${result.systemScopes.length}), each reading past ownership for its reason (data/system-scope; ${GUIDE}#${SECTIONS["data/system-scope"]}):`);
    for (const { file, line, kind, id, reason } of result.systemScopes) {
      lines.push(`  ${file}:${line}  ${kind === "feature" ? `feature ${id || "(no id)"}` : "systemContext()"}  "${reason}"`);
    }
  }
  if (result.excuses.length > 0) {
    lines.push(`Infrastructure exceptions (${result.excuses.length}), each a whole file past a data-access lint rule (data/infrastructure-excuses; ${GUIDE}#${SECTIONS["data/infrastructure-excuses"]}):`);
    for (const { file, line, rule, reason } of result.excuses) lines.push(`  ${file}:${line}  ${rule}  ${reason}`);
  }
  if (result.unnamedFields.length > 0) {
    lines.push(`Fields no CRUD contract names (${result.unnamedFields.length} table resource(s)), so no API shows or accepts them; ` +
      `name one in a contract's fields to offer it (data/unnamed-fields; ${GUIDE}#${SECTIONS["data/unnamed-fields"]}):`);
    for (const { file, line, name, fields } of result.unnamedFields) lines.push(`  ${file}:${line}  ${name}: ${fields.join(", ")}`);
  }
  const listed = `${result.systemScopes.length} system scope(s) and ${result.excuses.length} infrastructure exception(s) listed for review`;
  lines.push(result.ok
    ? `JSKIT data access: ${result.resources} table resource(s), each table and name defined once; ${listed}.`
    : `JSKIT data access: ${result.findings.length} error(s). Each finding says what to change; a new infrastructure exception or system scope passes once reviewed and listed in ${BASELINE_FILE}; ${listed}.`);
  return lines.join("\n");
}

export { checkDataAccess, formatDataAccessReport };
