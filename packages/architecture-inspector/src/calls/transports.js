import ts from "typescript";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { isFunctionLike, unwrapExpression } from "./functions.js";
import { ANY, SEGMENT, isLiteralPattern } from "./evaluate.js";
import { codeSide } from "./resolve.js";

const HTTP_WEB = "@jskit-ai/http-web";
const METHOD_PATTERN = /^[A-Za-z]+$/u;
const MAX_PROBABLE_ROUTES = 3;

function literalMethods(evaluator, node) {
  if (!node) {
    return undefined;
  }
  const values = evaluator.evaluate(node);
  return values.every((value) => isLiteralPattern(value) && METHOD_PATTERN.test(value))
    ? [...new Set(values.map((value) => value.toUpperCase()))]
    : null;
}

function isFalse(node) {
  return unwrapExpression(node)?.kind === ts.SyntaxKind.FalseKeyword;
}

// JSKIT client transport call sites with their partially evaluated paths and
// methods (`methods: null` means any method).
function collectTransportSites({ calls, symbols, evaluator, fileOf }) {
  const sites = [];
  const option = (call, name, index = 0) => {
    const options = unwrapExpression(call.arguments[index]);
    return options && ts.isObjectLiteralExpression(options) ? evaluator.propertyInitializer(options, name) : undefined;
  };
  const isHttpClient = (expression) => {
    let value = unwrapExpression(expression);
    if (value && ts.isIdentifier(value)) {
      const declaration = symbols.declarationOf(value);
      value = declaration && ts.isVariableDeclaration(declaration) ? unwrapExpression(declaration.initializer) : null;
    }
    return Boolean(value) && ts.isCallExpression(value) && ts.isIdentifier(value.expression) &&
      symbols.isImportOf(value.expression, HTTP_WEB, ["getHttpWebClient"]);
  };
  for (const call of calls) {
    if (!ts.isCallExpression(call)) {
      continue;
    }
    const callee = unwrapExpression(call.expression);
    const file = fileOf(call);
    if (ts.isIdentifier(callee) && symbols.isImportOf(callee, HTTP_WEB, ["useEndpointResource"])) {
      const reads = !isFalse(option(call, "enabled"));
      const writeMethod = option(call, "writeMethod");
      const writes = writeMethod ? literalMethods(evaluator, writeMethod) : reads ? [] : ["PATCH"];
      sites.push({ call, file, kind: "useEndpointResource", path: option(call, "path"), methods: writes === null ? null : [...(reads ? ["GET"] : []), ...writes] });
    } else if (ts.isIdentifier(callee) && symbols.isImportOf(callee, HTTP_WEB, ["useCommand"])) {
      const build = unwrapExpression(option(call, "buildCommandOptions"));
      const built = build && isFunctionLike(build) ? unwrapExpression(evaluator.functionReturns(build)[0]) : null;
      const builtObject = built && ts.isObjectLiteralExpression(built) ? built : null;
      const builtPath = builtObject && evaluator.propertyInitializer(builtObject, "path");
      const builtMethod = builtObject && literalMethods(evaluator, evaluator.propertyInitializer(builtObject, "method"));
      const writeMethod = literalMethods(evaluator, option(call, "writeMethod"));
      sites.push({
        call,
        file,
        kind: "useCommand",
        path: builtPath || null,
        apiSuffix: builtPath ? null : option(call, "apiSuffix"),
        methods: builtMethod || writeMethod || (writeMethod === null ? null : ["POST"])
      });
    } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "request" && isHttpClient(callee.expression)) {
      const method = option(call, "method", 1);
      sites.push({ call, file, kind: "request", path: call.arguments[0], methods: method ? literalMethods(evaluator, method) : ["GET"] });
    } else if (ts.isIdentifier(callee) && callee.text === "fetch" && codeSide(file) !== "server") {
      const symbol = symbols.symbolAt(callee);
      if (symbol && symbols.isLibrarySymbol(symbol)) {
        const method = option(call, "method", 1);
        sites.push({ call, file, kind: "fetch", path: call.arguments[0], methods: method ? literalMethods(evaluator, method) : ["GET"] });
      }
    }
  }
  return sites;
}

function sitePatterns(site, evaluator) {
  if (site.path) {
    return evaluator.evaluate(site.path);
  }
  if (site.apiSuffix) {
    return evaluator.evaluate(site.apiSuffix).map((suffix) =>
      resolveScopedApiBasePath({ relativePath: suffix.startsWith("/") || suffix.startsWith(ANY) ? suffix : `/${suffix}`, strictParams: false }));
  }
  return [];
}

// Client path pattern -> path segments, after the declared prefix aliases.
function clientSegments(pattern, prefixAliases) {
  let value = pattern.replace(/^https?:\/\/[^/]+/u, "").split("?")[0].split("#")[0];
  for (const { client, route } of prefixAliases) {
    if (value === client || value.startsWith(`${client}/`)) {
      value = `${route}${value.slice(client.length)}`;
      break;
    }
  }
  return value.split("/").filter(Boolean);
}

// Aligns client segments with a route template. ANY spans one or more route
// segments; SEGMENT and alias parameters (`:slug`) fill one. The score counts
// route literals matched by client literals and by wildcards.
function matchSegments(client, route, clientIndex = 0, routeIndex = 0, score = { literal: 0, wildcard: 0 }) {
  if (clientIndex === client.length) {
    return routeIndex === route.length ? score : null;
  }
  const segment = client[clientIndex];
  if (segment.includes(ANY)) {
    let best = null;
    for (let take = 1; routeIndex + take <= route.length; take += 1) {
      const covered = route.slice(routeIndex, routeIndex + take).filter((part) => !part.startsWith(":")).length;
      const result = matchSegments(client, route, clientIndex + 1, routeIndex + take, { literal: score.literal, wildcard: score.wildcard + covered });
      if (result && (!best || result.literal > best.literal || (result.literal === best.literal && result.wildcard < best.wildcard))) {
        best = result;
      }
    }
    return best;
  }
  if (routeIndex >= route.length) {
    return null;
  }
  const target = route[routeIndex];
  if (target.startsWith(":")) {
    return matchSegments(client, route, clientIndex + 1, routeIndex + 1, score);
  }
  if (segment.includes(SEGMENT) || segment.startsWith(":")) {
    const [prefix, suffix = ""] = segment.startsWith(":") ? ["", ""] : segment.split(SEGMENT);
    if (!target.startsWith(prefix) || !target.endsWith(suffix)) {
      return null;
    }
    return matchSegments(client, route, clientIndex + 1, routeIndex + 1, { literal: score.literal, wildcard: score.wildcard + 1 });
  }
  return segment === target
    ? matchSegments(client, route, clientIndex + 1, routeIndex + 1, { literal: score.literal + 1, wildcard: score.wildcard })
    : null;
}

function routeLiterals(route) {
  return route.segments.filter((part) => !part.startsWith(":")).length;
}

// Matches one site against the statically discovered HTTP entry operations.
// Returns, per method, the matched routes and whether each key was evaluated
// exactly: one best route (or one per evaluated alternative) whose every
// literal segment aligns with a client literal.
function matchSite({ patterns, methods }, routes, prefixAliases) {
  const literal = patterns.map((pattern) => clientSegments(pattern, prefixAliases))
    .filter((segments) => segments.some((segment) => isLiteralPattern(segment) && !segment.startsWith(":") && segment !== "api"));
  const methodsToMatch = methods || [...new Set(routes.map((route) => route.key.method))];
  return methodsToMatch.map((method) => {
    if (!literal.length) {
      return { method, matches: [] };
    }
    const candidates = new Map();
    for (const segments of literal) {
      for (const route of routes) {
        if (route.key.method !== method) {
          continue;
        }
        const score = matchSegments(segments, route.segments);
        const previous = candidates.get(route);
        if (score && (!previous || previous.literal < score.literal)) {
          candidates.set(route, score);
        }
      }
    }
    const ranked = [...candidates.entries()].sort((left, right) => right[1].literal - left[1].literal || left[1].wildcard - right[1].wildcard);
    if (!ranked.length) {
      return { method, matches: [] };
    }
    const top = ranked.filter(([, score]) => score.literal === ranked[0][1].literal);
    const exact = top.length <= literal.length && top.every(([route, score]) => score.wildcard === 0 && score.literal === routeLiterals(route));
    if (exact) {
      return { method, matches: top.map(([route]) => ({ route, keyCertainty: "exact" })) };
    }
    if (top.length <= MAX_PROBABLE_ROUTES) {
      return { method, matches: top.map(([route]) => ({ route, keyCertainty: "probable" })) };
    }
    return { method, matches: [] };
  }).filter((entry) => methods || entry.matches.length);
}

function routeTable(entryOperations) {
  return entryOperations
    .filter((entry) => entry.resolution === "resolved" && entry.key?.protocol === "http" && typeof entry.key.operation === "string")
    .map((entry) => ({ key: entry.key, segments: entry.key.operation.split("/").filter(Boolean) }));
}

export { collectTransportSites, matchSite, routeTable, sitePatterns };
