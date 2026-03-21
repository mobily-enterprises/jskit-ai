import { normalizeArray, normalizeText } from "../../../shared/support/normalize.js";
import { RouteRegistrationError } from "./errors.js";
import { normalizeMiddlewareEntry, resolveRouteLabel } from "./routeSupport.js";

async function executeMiddlewareStack(middleware, request, reply) {
  for (const handler of normalizeArray(middleware)) {
    await handler(request, reply);
    if (reply?.sent) {
      return;
    }
  }
}

function normalizeMiddlewareName(value) {
  return normalizeText(value);
}

function normalizeMiddlewareAliases(sourceAliases) {
  const source = sourceAliases && typeof sourceAliases === "object" && !Array.isArray(sourceAliases) ? sourceAliases : {};
  const aliases = new Map();

  for (const [rawName, handler] of Object.entries(source)) {
    const name = normalizeMiddlewareName(rawName);
    if (!name) {
      continue;
    }

    if (typeof handler !== "function") {
      throw new RouteRegistrationError(`middleware.aliases["${name}"] must be a function.`);
    }

    aliases.set(name, handler);
  }

  return aliases;
}

function normalizeMiddlewareGroups(sourceGroups) {
  const source = sourceGroups && typeof sourceGroups === "object" && !Array.isArray(sourceGroups) ? sourceGroups : {};
  const groups = new Map();

  for (const [rawName, entries] of Object.entries(source)) {
    const name = normalizeMiddlewareName(rawName);
    if (!name) {
      continue;
    }

    const normalizedEntries = normalizeArray(entries).map((entry, index) =>
      normalizeMiddlewareEntry(entry, {
        context: `middleware.groups["${name}"]`,
        index,
        ErrorType: RouteRegistrationError
      })
    );

    groups.set(name, Object.freeze(normalizedEntries));
  }

  return groups;
}

function normalizeRuntimeMiddlewareConfig(runtimeMiddleware) {
  const source = runtimeMiddleware && typeof runtimeMiddleware === "object" && !Array.isArray(runtimeMiddleware) ? runtimeMiddleware : {};
  const aliases = normalizeMiddlewareAliases(source.aliases);
  const groups = normalizeMiddlewareGroups(source.groups);

  for (const groupName of groups.keys()) {
    if (aliases.has(groupName)) {
      throw new RouteRegistrationError(`middleware name "${groupName}" cannot be both an alias and a group.`);
    }
  }

  return {
    aliases,
    groups
  };
}

function expandMiddlewareEntry({
  entry,
  runtimeMiddlewareConfig,
  resolvedHandlers,
  groupStack,
  routeLabel
}) {
  if (typeof entry === "function") {
    resolvedHandlers.push(entry);
    return;
  }

  const name = normalizeMiddlewareName(entry);
  if (!name) {
    throw new RouteRegistrationError(`Route ${routeLabel} middleware entries must be functions or non-empty strings.`);
  }

  if (runtimeMiddlewareConfig.aliases.has(name)) {
    resolvedHandlers.push(runtimeMiddlewareConfig.aliases.get(name));
    return;
  }

  if (runtimeMiddlewareConfig.groups.has(name)) {
    if (groupStack.includes(name)) {
      const cycle = [...groupStack, name].join(" -> ");
      throw new RouteRegistrationError(`Route ${routeLabel} middleware group cycle detected: ${cycle}.`);
    }

    const nextGroupStack = [...groupStack, name];
    const groupEntries = runtimeMiddlewareConfig.groups.get(name);
    for (const groupEntry of groupEntries) {
      expandMiddlewareEntry({
        entry: groupEntry,
        runtimeMiddlewareConfig,
        resolvedHandlers,
        groupStack: nextGroupStack,
        routeLabel
      });
    }
    return;
  }

  throw new RouteRegistrationError(
    `Route ${routeLabel} references unknown middleware "${name}". Define it under middleware.aliases or middleware.groups.`
  );
}

function resolveRouteMiddlewareHandlers(route, runtimeMiddlewareConfig) {
  const routeLabel = resolveRouteLabel(route);
  const sourceEntries = normalizeArray(route?.middleware).map((entry, index) =>
    normalizeMiddlewareEntry(entry, {
      context: `Route ${routeLabel} middleware`,
      index
    })
  );

  const resolvedHandlers = [];
  for (const entry of sourceEntries) {
    expandMiddlewareEntry({
      entry,
      runtimeMiddlewareConfig,
      resolvedHandlers,
      groupStack: [],
      routeLabel
    });
  }

  return Object.freeze(resolvedHandlers);
}

export { executeMiddlewareStack, normalizeRuntimeMiddlewareConfig, resolveRouteMiddlewareHandlers };
