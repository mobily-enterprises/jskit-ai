import ts from "typescript";
import { bindFeatures } from "./features.js";
import { collectFileFunctions, isFunctionLike, point } from "./functions.js";
import { createEvaluator } from "./evaluate.js";
import { loadCallProgram } from "./program.js";
import { createResolver } from "./resolve.js";
import { createSymbols } from "./symbols.js";
import { collectTransportSites, matchSite, routeTable, sitePatterns } from "./transports.js";

const MAX_CALLS_PER_FILE = 2000;
const MAX_CALLEE_LENGTH = 120;

function calleeText(call) {
  return call.expression.getText().replace(/\s+/gu, " ").slice(0, MAX_CALLEE_LENGTH);
}

// The callee's own name token, so calls that start together (`a.b().c()`)
// keep distinct identities.
function callIdentityPosition(call) {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.getStart();
  }
  if (ts.isElementAccessExpression(callee)) {
    return callee.argumentExpression.getStart();
  }
  return callee.getStart();
}

function rangeOf(sourceFile, node) {
  return { start: point(sourceFile, node.getStart(sourceFile)), end: point(sourceFile, node.end) };
}

// Function-level facts for the declared project scripts: per-file functions,
// resolved calls and call sites, transport operation uses, named action entry
// points and entry operation controllers. `reuse` holds
// earlier call records of files whose own and directly imported sources are
// unchanged; they are kept unless a target no longer exists.
function inspectCalls({
  projectRoot,
  sources,
  hashes,
  resolveImport,
  entryOperations,
  handlerRanges,
  transports,
  parentIdForFile,
  prefixAliases,
  diagnose,
  reuse = new Map()
}) {
  const loaded = loadCallProgram({ projectRoot, sources, resolveImport });
  const { checker, sourceFiles, fileOf } = loaded;
  // TypeScript recovers from syntax errors; such a file's functions and calls
  // may be incomplete.
  let complete = loaded.complete;
  for (const [file, sourceFile] of sourceFiles) {
    if (loaded.program.getSyntacticDiagnostics(sourceFile).length) {
      complete = false;
      diagnose("SCRIPT_SYNTAX_RECOVERED", "The script has syntax errors, so its functions and calls may be incomplete.", file);
    }
  }
  const symbols = createSymbols({ checker, fileOf, resolveImport, isLibrary: loaded.isLibrary });
  const evaluator = createEvaluator({ symbols, fileOf });

  const functionsByFile = new Map();
  const nodeById = new Map();
  const recordByNode = new Map();
  const moduleByFile = new Map();
  const startByNode = new Map();
  const functionNames = new Map();
  const callsByFile = new Map();
  const allCalls = [];
  for (const [file, sourceFile] of sourceFiles) {
    const collected = collectFileFunctions({ file, hash: hashes.get(file), sourceFile, checker });
    functionsByFile.set(file, collected.functions);
    moduleByFile.set(file, collected.module);
    for (const { node, record, startPosition } of collected.nodes) {
      recordByNode.set(node, record);
      nodeById.set(record.id, node);
      startByNode.set(node, startPosition);
      if (record.name && record.kind !== "constructor") {
        functionNames.set(record.name, [...(functionNames.get(record.name) || []), node]);
      }
    }
    const calls = [];
    const visit = (node) => {
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.expression) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    callsByFile.set(file, calls);
    allCalls.push(...calls);
  }

  const features = bindFeatures({ calls: allCalls.filter((call) => ts.isCallExpression(call)), symbols, evaluator });
  const actionsById = new Map();
  const unresolvedActionFiles = new Set();
  for (const action of features.actions) {
    if (!action.actionId) {
      unresolvedActionFiles.add(fileOf(action.object));
      continue;
    }
    const known = actionsById.get(action.actionId) || [];
    if (!known.some((entry) => entry.object === action.object)) {
      actionsById.set(action.actionId, [...known, action]);
    }
  }
  for (const file of unresolvedActionFiles) {
    diagnose("ACTION_ID_UNRESOLVED", "An action definition's id is not a literal, constant or literal-array element.", file);
  }

  const resolver = createResolver({
    program: loaded.program,
    checker,
    symbols,
    evaluator,
    bindings: features.bindings,
    actionsById,
    fileOf,
    functionNames
  });
  const functionId = (node) => recordByNode.get(node)?.id;
  const functionIds = new Set(nodeById.keys());
  const reused = new Set([...reuse].filter(([file, cached]) => callsByFile.has(file) &&
    cached.calls.every((record) => record.targets.every((target) => functionIds.has(target)))).map(([file]) => file));
  // Each file's checker targets per call position, in call order, so argument
  // flow into closures that run later sees the same call sites whether a file
  // is reused or resolved.
  const sitesByFile = new Map();
  for (const [file, calls] of callsByFile) {
    if (reused.has(file)) {
      const callAt = new Map(calls.map((call) => [call.getStart(), call]));
      for (const [position, targets] of reuse.get(file).sites) {
        resolver.indexSite(callAt.get(position), targets.map((target) => nodeById.get(target)));
      }
      sitesByFile.set(file, reuse.get(file).sites);
      continue;
    }
    const sites = [];
    resolver.indexCalls(calls).forEach((targets, index) => {
      if (targets.length) {
        sites.push([calls[index].getStart(), targets.map(functionId)]);
      }
    });
    sitesByFile.set(file, sites);
  }

  function enclosingFunction(node) {
    const position = node.getStart();
    for (let current = node.parent; current; current = current.parent) {
      if (isFunctionLike(current) && startByNode.get(current) <= position) {
        return recordByNode.get(current);
      }
    }
    return moduleByFile.get(fileOf(node));
  }

  const fileRecords = new Map();
  let truncated = false;
  for (const [file, calls] of callsByFile) {
    if (reused.has(file)) {
      const cached = reuse.get(file);
      fileRecords.set(file, { functions: functionsByFile.get(file), calls: cached.calls, sites: cached.sites, truncated: cached.truncated });
      if (cached.truncated) {
        truncated = true;
        diagnose("CALLS_TRUNCATED", `Only the first ${MAX_CALLS_PER_FILE} calls of this file are recorded.`, file);
      }
      continue;
    }
    const sourceFile = sourceFiles.get(file);
    const records = [];
    let fileTruncated = false;
    const identities = new Set();
    let count = 0;
    for (const call of calls) {
      const from = enclosingFunction(call);
      // The call itself, then what it reaches through the functions it passes.
      const results = from ? [resolver.resolve(call, file), resolver.passedCall(call)].filter(Boolean) : [];
      if (count + results.length > MAX_CALLS_PER_FILE) {
        fileTruncated = true;
        truncated = true;
        diagnose("CALLS_TRUNCATED", `Only the first ${MAX_CALLS_PER_FILE} calls of this file are recorded.`, file);
        break;
      }
      const position = point(sourceFile, callIdentityPosition(call));
      for (const result of results) {
        count += 1;
        let id = `call:jskit:${file}#${position.line}:${position.column}`;
        for (let suffix = 2; identities.has(id); suffix += 1) {
          id = `call:jskit:${file}#${position.line}:${position.column}~${suffix}`;
        }
        identities.add(id);
        records.push({
          id,
          resolution: result.resolution,
          certainty: result.certainty,
          method: result.method,
          fromFunctionId: from.id,
          targets: result.targets.map(functionId),
          callee: calleeText(call),
          evidence: [{ path: file, hash: hashes.get(file), ...rangeOf(sourceFile, call) }]
        });
      }
    }
    fileRecords.set(file, { functions: functionsByFile.get(file), calls: records, sites: sitesByFile.get(file), truncated: fileTruncated });
  }

  const routes = routeTable(entryOperations);
  const operationUses = [];
  for (const site of transports ? collectTransportSites({ calls: allCalls, symbols, evaluator, fileOf }) : []) {
    const sourceFile = sourceFiles.get(site.file);
    const from = enclosingFunction(site.call);
    if (!from) {
      continue;
    }
    const position = point(sourceFile, site.call.getStart());
    const baseId = `operation-use:${site.file}#${position.line}:${position.column}`;
    const parentId = parentIdForFile(site.file);
    const evidence = [{ path: site.file, hash: hashes.get(site.file), ...rangeOf(sourceFile, site.call) }];
    const matched = matchSite({ patterns: sitePatterns(site, evaluator), methods: site.methods }, routes, prefixAliases)
      .flatMap(({ method, matches }) => (matches.length ? matches : [{ method, route: null }]).map((match) => ({ method, ...match })));
    const uses = matched.length ? matched : [{ method: null, route: null }];
    uses.forEach((use, index) => {
      operationUses.push({
        id: uses.length === 1 ? baseId : `${baseId}:${use.method || "ANY"}:${index + 1}`,
        ...(parentId ? { parentId } : {}),
        fromFunctionId: from.id,
        resolution: use.route ? "resolved" : "unresolved",
        ...(use.route ? { key: use.route.key, keyCertainty: use.keyCertainty } : {}),
        evidence
      });
    });
  }

  const entryPoints = [];
  for (const [actionId, definitions] of actionsById) {
    const executes = [...new Set(definitions.flatMap((definition) => definition.execute))];
    const first = definitions[0].object;
    const file = fileOf(first);
    entryPoints.push({
      id: `entry:action:${actionId}`,
      resolution: "resolved",
      kind: "action",
      title: actionId,
      file,
      functionIds: executes.map(functionId).filter(Boolean),
      pageId: null,
      componentId: null,
      operationKey: null,
      actionId,
      evidence: definitions.map((definition) => {
        const owner = fileOf(definition.object);
        return { path: owner, hash: hashes.get(owner), ...rangeOf(sourceFiles.get(owner), definition.object) };
      })
    });
  }

  function actionController(actionId) {
    const definitions = actionsById.get(actionId) || [];
    const executes = definitions.flatMap((definition) => definition.execute);
    return definitions.length === 1 && executes.length === 1 ? functionId(executes[0]) : null;
  }
  // The function whose source range (start offset .. end offset) is given.
  function functionAt({ file, start, end }) {
    const sourceFile = sourceFiles.get(file);
    let found = null;
    const visit = (node) => {
      if (found || node.end < start || node.pos > end) {
        return;
      }
      if (isFunctionLike(node) && node.getStart(sourceFile) === start && node.end === end) {
        found = recordByNode.get(node);
        return;
      }
      ts.forEachChild(node, visit);
    };
    if (sourceFile) {
      visit(sourceFile);
    }
    return found?.id || null;
  }
  // Each entry operation's controller: its action's execute function, or the
  // inline handler. Only plain records are returned, so the program can be
  // released before the output is written.
  const controllers = new Map();
  for (const entry of entryOperations) {
    const handler = handlerRanges.get(entry);
    const controller = entry.actionId ? actionController(entry.actionId) : handler && functionAt(handler);
    if (controller) {
      controllers.set(entry, controller);
    }
  }

  return { fileRecords, operationUses, entryPoints, controllers, complete, truncated };
}

export { inspectCalls };
