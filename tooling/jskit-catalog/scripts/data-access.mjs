import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, lintIgnores, sourceFiles } from "./data-access-files.mjs";
import { toPosixPath } from "./files.mjs";
import { blankJsComments, lineIndex } from "./material3-source.mjs";

// The data part of plain `jskit check`, read from source, never run. It backs up what the lint rules cannot see across
// files: every table has exactly one table resource (`defineTableResource({ name, tableName })`) across the app and its
// installed @jskit-ai packages, so a duplicate name or table fails here before the boot-time throw; every system scope
// (a feature's `systemScope: "<reason>"` and every `systemContext("<reason>")` call) is listed with its reason, and one
// without a literal reason fails; and every file the infrastructure exception lifts past the data-access lint rules is
// listed for review. In the app's own code, which no lint directive can hide from it, a feature's system scope and an
// infrastructure exception fail until the checked-in BASELINE_FILE lists them, so each new one is reviewed; a module
// that requires a capability handing out power past the owners (CROSS_OWNER_CAPABILITIES) fails until it is reviewed
// too; an eslint-disable or inline eslint config that turns off a data-access rule, or every rule, fails in any file
// but the client's; and so does an app file the app's own ESLint config lints without every data-access rule as an
// error, or ignores though it is server code. Whatever else that config ignores, no lint reads, so neither does this
// check: it lists what it skipped. As information, it lists the fields of each app table resource that its CRUD contracts
// never name, which no API shows or accepts.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/data-access";
const SECTIONS = Object.freeze({
  "data/one-resource-per-table": "layer-1-the-table-resource",
  "data/system-scope": "background-work",
  "data/infrastructure-excuses": "hard-rules",
  "data/baseline": "hard-rules",
  "data/runtime-capability": "the-resource-is-the-only-door",
  "data/lint-disabled": "hard-rules",
  "data/lint-config": "hard-rules",
  "data/unnamed-fields": "layer-2-the-crud-surface"
});
// What each rule asks, said once above its findings in the report.
const RULE_EXPLANATIONS = Object.freeze({
  "data/one-resource-per-table": "every table has exactly one table resource, under a name no other resource has.",
  "data/system-scope": "every system scope and systemContext() call gives its reason as a string literal.",
  "data/baseline": "each infrastructure exception and feature system scope of the app is reviewed, then listed in the checked-in " +
    "jskit-data-access.json; review each one below, then add the entry it shows.",
  "data/runtime-capability": "a module that requires a capability handing out power past the owners reaches rows past the " +
    "features that own them. A feature owns its tables with owns and gets their handles; only a module whose job is data " +
    "access itself, declared with the infrastructure exception, takes runtime.database or runtime.resources, and a module " +
    "takes any other one once the baseline's systemScopes lists it with its reason.",
  "data/lint-disabled": "neither eslint-disable nor an inline eslint config comment can turn off a data-access rule, and a " +
    "disable that names no rule turns them all off. Change the code, or name the rules the directive turns off.",
  "data/lint-config": "the app's ESLint config makes every data-access rule an error in each server file, and ignores no " +
    "server code; a config that turns one off, lowers it or ignores the file hides that code from it. Put the rule back, or, " +
    "once the module's whole job is data access, list { \"file\", \"rule\" } in the baseline's \"infrastructure\"."
});
// The reviewed list of the app's infrastructure exceptions and feature system scopes, at the app's root.
const BASELINE_FILE = "jskit-data-access.json";
const DATA_ACCESS_RULES = Object.freeze(["no-direct-knex", "no-transaction-reader", "sql-literal", "no-hand-scope", "no-hand-context", "knex-reason"]);
// An eslint-disable directive and the rules it names, before any "--" description.
const LINT_DISABLE = /\/[/*]\s*eslint-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/gu;
// An inline config comment's text, `eslint jskit/no-direct-knex: "off"`, and the rules it sets.
const LINT_CONFIG = /^\s*eslint\s([\s\S]*)$/u;
// The capabilities that hand a module power past the features owning the rows, with what each gives: one list. Requiring
// runtime.database or runtime.resources is for a module declared infrastructure only; requiring any other one passes
// once the baseline's systemScopes lists it, with its reason: { "file", "capability", "systemScope": "<reason>" }.
const CROSS_OWNER_CAPABILITIES = Object.freeze({
  "runtime.database": { gives: "the database, past every owner", infrastructureOnly: true },
  "runtime.resources": { gives: "every table resource's handle", infrastructureOnly: true },
  "realtime.audience-scope": { gives: "contexts for any workspace and user (forWorkspace, forUser, forWorkspaceUser)" },
  "auth.local.accounts": { gives: "every local sign-in account, read and written in local auth's system context" },
  "auth.local.sessions": { gives: "every sign-in session, read and written in local auth's system context" },
  "auth.local.recovery": { gives: "every recovery token, read and written in local auth's system context" },
  "connectors.store": { gives: "every owner's connections, with their credentials decrypted" },
  "assistant.repositories": { gives: "every actor's and workspace's assistant conversations, messages and settings" },
  "payments.store": { gives: "every merchant's payment accounts, customers and catalogues" }
});
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
// A capability id written as a string, compared as the kernel resolves it: trimmed and in any case.
const CAPABILITY_NAMES = Object.keys(CROSS_OWNER_CAPABILITIES).map(escapeRegExp).join("|");
const CROSS_OWNER_CAPABILITY = new RegExp(`(["'\`])\\s*(${CAPABILITY_NAMES})\\s*\\1`, "giu");
// Client code, which the data-access rules leave alone: a package's src/client. An app's own src/ is linted whole, since
// server code sits there too.
const CLIENT_FILE = new RegExp(`^${ROOT}src/client/`, "u");
// What the data-access lint leaves alone (NOT_DATA_ACCESS_SOURCE in @jskit-ai/config-eslint's dataAccess.js), for a path
// from the directory of the ESLint config that governs the file, a nested application's own included: client code,
// tests, migrations, seeds and build output at a root, seed scripts, and test files.
const LINT_EXEMPT = new RegExp(`^${ROOT}(?:(?:src/client|src/test|test|tests|__tests__|e2e|test-support|migrations|seeds?|` +
  "dist|build|coverage)/|(?:(?:scripts|bin)/)?seed[^/]*\\.[cm]?js$)|\\.(?:test|spec|vitest)\\.[^/]*$", "u");
const MARKERS = new RegExp(`defineTableResource|defineCrudContract|systemScope|systemContext|readable-check: allow|eslint|${CAPABILITY_NAMES}`, "iu");
const TABLE_RESOURCE_CALL = /\bdefineTableResource\s*\(/gu;
const TABLE_RESOURCE_MARKER = /\bdefineTableResource\s*\(/u;
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
const INFRASTRUCTURE_EXCUSE = /readable-check: allow (?:jskit\/)?(no-direct-knex|no-transaction-reader|no-hand-scope|sql-literal) - (infrastructure:.*?)\s*(?:\*\/)?\s*$/u;

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
  return { source, code, masked: maskStrings(code), position: lineIndex(source) };
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
    const keys = topLevelKeys(masked, object.start, object.end, ["name", "tableName", "ownership", "schema", "foreignKeys"]);
    const ownership = keyValue(code, masked, keys, "ownership")?.text ?? null;
    resources.push({
      file,
      line: position(match.index).line,
      name: keyValue(code, masked, keys, "name")?.text ?? null,
      tableName: keyValue(code, masked, keys, "tableName")?.text ?? null,
      variable: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/u.exec(masked.slice(Math.max(0, match.index - 120), match.index))?.[1] ?? null,
      fields: readSchemaFields(code, masked, keys, ownership),
      foreignKeys: keys.has("foreignKeys")
    });
  }
  return resources;
}

// Every CRUD contract a file defines: the variable of its table resource and the fields its `fields` names, null when
// they are not all written as literal keys.
function readCrudContracts({ code, masked }) {
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
    const known = at === undefined || (named && !named.partial);
    contracts.push({ resource: match[1], fields: at === undefined ? [] : known ? named.keys.map(({ key }) => key) : null });
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

// A function of the file's own named systemContext: declared in the file (`function systemContext(`, `const
// systemContext =`), or handed in under a JSDoc type that is not JSKIT's SystemContext factory, such as
// `@param {() => { root: string }} dependencies.systemContext`.
const LOCAL_SYSTEM_CONTEXT = /\bfunction\s*\*?\s*systemContext\s*\(|\b(?:const|let|var)\s+systemContext\s*=/u;
const PARAM_TYPE = /@param\s*\{/gu;
const SYSTEM_CONTEXT_PARAM = /^\s*\[?(?:[\w$]+\.)*systemContext\b/u;

// Whether the file's systemContext is its own function, not the one JSKIT hands a feature with a systemScope: the
// check reads JSKIT's binding, not every function of that name.
function ownsSystemContextName(source, masked) {
  if (LOCAL_SYSTEM_CONTEXT.test(masked)) return true;
  for (const match of source.matchAll(PARAM_TYPE)) {
    const close = closingOffset(source, match.index + match[0].length - 1);
    if (close > 0 && SYSTEM_CONTEXT_PARAM.test(source.slice(close, close + 120))) {
      return !/\bSystemContext\b/u.test(source.slice(match.index, close));
    }
  }
  return false;
}

// Every system scope a file declares or calls: a feature's systemScope and each call of JSKIT's systemContext(...),
// with its reason, null when it is not a literal.
function readSystemScopes(file, { source, code, masked, position }) {
  const scopes = [];
  for (const match of masked.matchAll(FEATURE_CALL)) {
    const object = objectArgument(masked, match.index, match[0].length);
    if (!object) continue;
    const keys = topLevelKeys(masked, object.start, object.end, ["id", "systemScope"]);
    const reason = keyValue(code, masked, keys, "systemScope");
    if (reason === undefined) continue;
    scopes.push({ file, line: position(match.index).line, kind: "feature", id: keyValue(code, masked, keys, "id")?.text || "", reason: reason.text });
  }
  const calls = ownsSystemContextName(source, masked) ? [] : masked.matchAll(SYSTEM_CONTEXT_CALL);
  for (const match of calls) {
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

const isDataAccessRule = (rule) => DATA_ACCESS_RULES.includes(rule.replace(/^jskit\//u, ""));

// The block comments of a file, each { index, value }, read as blankJsComments reads comments: text in a string or a line
// comment is no comment. ESLint reads inline config only from block comments.
function blockComments(source) {
  const comments = [];
  let index = 0;
  while (index < source.length) {
    const opening = source.slice(index, index + 2);
    if (opening === "//" || opening === "/*") {
      const end = source.indexOf(opening === "//" ? "\n" : "*/", index + 2);
      const stop = end < 0 ? source.length : end;
      if (opening === "/*") comments.push({ index, value: source.slice(index + 2, stop) });
      index = opening === "/*" ? stop + 2 : stop;
    } else if ("\"'`".includes(source[index])) {
      const quote = source[index];
      index += 1;
      while (index < source.length && source[index] !== quote && (quote === "`" || source[index] !== "\n")) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
    } else {
      index += 1;
    }
  }
  return comments;
}

// Every eslint-disable in a file that turns off a data-access rule: one that names one, or one that names no rule and so
// turns off every rule; and every inline config comment that sets a data-access rule, which can only weaken it.
function readLintDisables(file, source, position) {
  const disables = [];
  for (const match of source.matchAll(LINT_DISABLE)) {
    const named = match[1].replace(/\*\/.*$/u, "").split(/\s--\s|\s--$/u)[0].split(",").map((rule) => rule.trim()).filter(Boolean);
    const rules = named.filter(isDataAccessRule);
    if (named.length < 1 || rules.length > 0) {
      disables.push({ file, line: position(match.index).line, kind: "disable", rules });
    }
  }
  for (const comment of blockComments(source)) {
    const settings = LINT_CONFIG.exec(comment.value)?.[1].split(/\s--\s/u)[0] || "";
    const rules = [...settings.matchAll(/(?:^|[\s,{])["']?((?:jskit\/)?[a-z][\w-]*)["']?\s*:/gu)].map((rule) => rule[1]).filter(isDataAccessRule);
    if (rules.length > 0) {
      disables.push({ file, line: position(comment.index).line, kind: "config", rules });
    }
  }
  return disables;
}

// Every place a file's code takes a cross-owner capability: each time it names one outside a provides object (the module
// that provides it), and other than as the id of a feature that provides it in the same file.
function readRuntimeCapabilities(file, { code, masked, position }) {
  const provides = [...masked.matchAll(/\bprovides\s*:\s*\{/gu)].map((match) => {
    const start = match.index + match[0].length - 1;
    return { start, end: closingOffset(masked, start) };
  });
  const names = [...code.matchAll(CROSS_OWNER_CAPABILITY)].map((match) => ({
    match,
    capability: match[2].toLowerCase(),
    provided: provides.some(({ start, end }) => match.index > start && match.index < end)
  }));
  const provided = new Set(names.filter((name) => name.provided).map(({ capability }) => capability));
  const ownId = ({ match, capability }) => provided.has(capability) &&
    /\bid\s*:\s*$/u.test(masked.slice(Math.max(0, match.index - 12), match.index));
  return names.filter((name) => !name.provided && !ownId(name))
    .map(({ match, capability }) => ({ file, line: position(match.index).line, capability }));
}

// Whether a rule's setting in a computed config is "error", which ESLint gives as 2 or [2, ...options].
const isError = (setting) => [2, "error"].includes(Array.isArray(setting) ? setting[0] : setting);

// Fails each app file its ESLint config lints without every data-access rule as an error, and each server file it
// ignores, unless the baseline's infrastructure lists { file, rule } for each rule that is not on. Each file is judged by
// the config that governs it, as `eslint` does, and what the rules leave alone (LINT_EXEMPT) is told from that config's
// directory: a nested application's client code is its own.
function checkLintConfig({ configs, error }, baseline, report) {
  if (error) report({ file: error.file, line: 1 }, "data/lint-config", `ESLint cannot read the app's config for this file: ${error.message}`);
  for (const { file, governed, config } of configs) {
    if (LINT_EXEMPT.test(governed) || lintIgnores({ governed, config })) continue;
    const off = DATA_ACCESS_RULES.filter((rule) => !isError(config?.rules?.[`jskit/${rule}`]) &&
      !baseline.infrastructure.some((item) => item?.file === file && item?.rule === rule));
    if (off.length < 1) continue;
    report({ file, line: 1 }, "data/lint-config", config
      ? `the ESLint config does not make ${off.map((rule) => `jskit/${rule}`).join(", ")} an error here`
      : "the ESLint config ignores this server file, so no data-access rule checks it");
  }
}

// Fails each cross-owner capability a module requires that is not reviewed: runtime.database and runtime.resources
// outside a module declared infrastructure, and any other one the baseline's systemScopes does not list with a reason.
function checkCapabilities(baseline, uses, report) {
  for (const { file, line, capability, infrastructure } of uses) {
    const { gives, infrastructureOnly } = CROSS_OWNER_CAPABILITIES[capability];
    if (infrastructureOnly) {
      if (!infrastructure) report({ file, line }, "data/runtime-capability", `requires ${capability}`);
      continue;
    }
    const entry = baseline.systemScopes.find((item) => item?.file === file && item?.capability === capability);
    if (typeof entry?.systemScope !== "string" || !entry.systemScope.trim()) {
      report({ file, line }, "data/runtime-capability", `requires ${capability}, which gives ${gives}: once the module must, add ` +
        `${JSON.stringify({ file, capability, systemScope: "<why it needs this>" })} to "systemScopes".`);
    }
  }
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
    report({ file: BASELINE_FILE, line: 1 }, "data/baseline", `${BASELINE_FILE} is not JSON; it lists { "infrastructure": [{ "file", "rule" }], "systemScopes": [{ "feature", "systemScope" }, { "file", "capability", "systemScope" }] }.`);
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
 * The table resources the app and its installed @jskit-ai packages define, read from source as checkDataAccess reads
 * them: each { file, absolute, framework, name, tableName, foreignKeys }, `foreignKeys` true when the definition
 * declares them. `jskit test --databases` checks the declared keys against the database.
 * @param {{ projectRoot?: string }} options
 */
async function readTableResourceSources({ projectRoot = process.cwd() } = {}) {
  const resources = [];
  for (const { file, absolute, framework } of (await sourceFiles(path.resolve(projectRoot))).sources) {
    const source = await readFile(absolute, "utf8");
    if (!TABLE_RESOURCE_MARKER.test(source)) continue;
    const read = readSourceFile(source);
    resources.push(...readTableResources(toPosixPath(file), read).map(({ file: name, line, name: resourceName, tableName, foreignKeys }) =>
      ({ file: name, line, absolute, framework, name: resourceName, tableName, foreignKeys })));
  }
  return resources;
}

/**
 * Reads the app's source and its installed @jskit-ai packages for table resources, system scopes and infrastructure
 * exceptions.
 * @param {{ projectRoot?: string }} options
 */
async function checkDataAccess({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const { sources, lint, skipped } = await sourceFiles(root);
  const resources = [];
  const contracts = [];
  const scopes = [];
  const excuses = [];
  const capabilities = [];
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
    contracts.push(...readCrudContracts(read));
    const fileExcuses = readInfrastructureExcuses(name, source);
    excuses.push(...fileExcuses);
    capabilities.push(...readRuntimeCapabilities(name, read).map((use) => ({ ...use, infrastructure: fileExcuses.length > 0 })));
    if (CLIENT_FILE.test(name)) continue;
    for (const disable of readLintDisables(name, source, read.position)) {
      report(disable, "data/lint-disabled", disable.kind === "config"
        ? `an inline eslint config sets ${disable.rules.join(", ")}`
        : disable.rules.length > 0 ? `eslint-disable turns off ${disable.rules.join(", ")}` : "eslint-disable names no rule");
    }
  }
  checkTables(resources, report);
  checkSystemScopes(scopes, report);
  const baseline = await readBaseline(root, report);
  checkBaseline(baseline, excuses, scopes, report);
  checkCapabilities(baseline, capabilities, report);
  checkLintConfig(lint, baseline, report);
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return {
    ok: findings.length < 1,
    findings,
    files: sources.length,
    resources: resources.length,
    systemScopes: scopes.filter((scope) => scope.reason !== null),
    excuses,
    unnamedFields: unnamedFields(resources, contracts),
    skipped
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
  if (result.skipped.length > 0) {
    lines.push(`Skipped, as the app's ESLint config ignores them and they hold no server code (${result.skipped.length}):`);
    for (const skipped of result.skipped) lines.push(`  ${skipped}`);
  }
  const listed = `${result.systemScopes.length} system scope(s) and ${result.excuses.length} infrastructure exception(s) listed for review`;
  lines.push(result.ok
    ? `JSKIT data access: ${result.resources} table resource(s), each table and name defined once; ${listed}.`
    : `JSKIT data access: ${result.findings.length} error(s). Each finding says what to change; a new infrastructure exception or system scope passes once reviewed and listed in ${BASELINE_FILE}; ${listed}.`);
  return lines.join("\n");
}

export { checkDataAccess, formatDataAccessReport, readTableResourceSources };
