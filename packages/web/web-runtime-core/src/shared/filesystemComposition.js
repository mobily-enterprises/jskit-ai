const SUPPORTED_ROUTE_FILE_EXTENSIONS = Object.freeze([".vue", ".mjs", ".cjs", ".js", ".tsx", ".jsx", ".ts"]);
const SUPPORTED_ENTRY_FILE_EXTENSIONS = Object.freeze([".mjs", ".cjs", ".js", ".ts"]);
const KNOWN_SURFACES = Object.freeze(new Set(["app", "admin", "console"]));
const KNOWN_SLOTS = Object.freeze(new Set(["drawer", "top", "config"]));
const ENTRY_KEYS = Object.freeze(new Set(["id", "title", "route", "icon", "order", "guard", "group", "description"]));

function normalizeText(value) {
  return String(value || "").trim();
}

function toPosixPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function ensureRecord(value, contextLabel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${contextLabel} must be an object.`);
  }
  return value;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRoutePath(pathname) {
  const normalized = normalizeText(pathname);
  if (!normalized) {
    return "/";
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }
  return squashed;
}

function stripKnownExtension(fileName, supportedExtensions, contextLabel) {
  const normalized = normalizeText(fileName);
  for (const extension of supportedExtensions) {
    if (normalized.toLowerCase().endsWith(extension)) {
      return normalized.slice(0, -extension.length);
    }
  }
  throw new TypeError(`${contextLabel} must end with one of: ${supportedExtensions.join(", ")}.`);
}

function extractSubPathFromDirectory(filePath, directoryName, contextLabel) {
  const normalizedPath = toPosixPath(filePath);
  const normalizedDirectory = normalizeText(directoryName);
  if (!normalizedDirectory) {
    throw new TypeError("directoryName is required.");
  }

  const matcher = new RegExp(`(?:^|/)${escapeRegExp(normalizedDirectory)}/(.+)$`);
  const match = normalizedPath.match(matcher);
  if (!match) {
    throw new TypeError(`${contextLabel} must contain /${normalizedDirectory}/ segment.`);
  }

  return {
    normalizedPath,
    subPath: match[1]
  };
}

function assertKnownSurface(surface, contextLabel) {
  const normalized = normalizeText(surface).toLowerCase();
  if (!KNOWN_SURFACES.has(normalized)) {
    throw new TypeError(`${contextLabel} has unknown surface "${surface}".`);
  }
  return normalized;
}

function assertKnownSlot(slot, contextLabel) {
  const normalized = normalizeText(slot).toLowerCase();
  if (!KNOWN_SLOTS.has(normalized)) {
    throw new TypeError(`${contextLabel} has unknown shell slot "${slot}".`);
  }
  return normalized;
}

function parseRouteFilePath(filePath, { directoryName = "pages" } = {}) {
  const { normalizedPath, subPath } = extractSubPathFromDirectory(filePath, directoryName, `Route file ${filePath}`);
  const segments = subPath.split("/").map((segment) => normalizeText(segment)).filter(Boolean);

  if (segments.length < 2) {
    throw new TypeError(`Route file ${filePath} must be nested as /${directoryName}/<surface>/<file>.`);
  }

  const surface = assertKnownSurface(segments[0], `Route file ${filePath}`);
  const routeSegments = segments.slice(1);
  routeSegments[routeSegments.length - 1] = stripKnownExtension(
    routeSegments[routeSegments.length - 1],
    SUPPORTED_ROUTE_FILE_EXTENSIONS,
    `Route file ${filePath}`
  );

  if (routeSegments[routeSegments.length - 1].toLowerCase() === "index") {
    routeSegments.pop();
  }

  return Object.freeze({
    filePath: normalizedPath,
    surface,
    routePath: normalizeRoutePath(routeSegments.join("/"))
  });
}

function resolveRouteMeta(moduleValue) {
  if (!moduleValue || typeof moduleValue !== "object" || Array.isArray(moduleValue)) {
    return Object.freeze({});
  }

  const directMeta = moduleValue.routeMeta;
  if (directMeta && typeof directMeta === "object" && !Array.isArray(directMeta)) {
    return Object.freeze({ ...directMeta });
  }

  const defaultMeta = moduleValue.default?.routeMeta;
  if (defaultMeta && typeof defaultMeta === "object" && !Array.isArray(defaultMeta)) {
    return Object.freeze({ ...defaultMeta });
  }

  return Object.freeze({});
}

function normalizeRouteModuleLoader(moduleValue, filePath) {
  if (typeof moduleValue === "function") {
    return moduleValue;
  }

  if (moduleValue && typeof moduleValue === "object" && !Array.isArray(moduleValue)) {
    return async () => moduleValue;
  }

  throw new TypeError(`Route module ${filePath} must be an imported module object or lazy import function.`);
}

function composeFilesystemRoutesFromModules({ modules = {}, surface = "", directoryName = "pages" } = {}) {
  const moduleMap = ensureRecord(modules, "modules");
  const normalizedSurface = normalizeText(surface).toLowerCase();
  if (normalizedSurface && !KNOWN_SURFACES.has(normalizedSurface)) {
    throw new TypeError(`Unknown surface "${surface}".`);
  }

  const routes = [];
  const claimedRoutePaths = new Set();

  for (const [filePath, moduleValue] of Object.entries(moduleMap)) {
    const parsed = parseRouteFilePath(filePath, { directoryName });
    if (normalizedSurface && parsed.surface !== normalizedSurface) {
      continue;
    }

    const routePathKey = `${parsed.surface}:${parsed.routePath}`;
    if (claimedRoutePaths.has(routePathKey)) {
      throw new Error(`Duplicate route path "${parsed.routePath}" on surface "${parsed.surface}".`);
    }

    const routeMeta = resolveRouteMeta(moduleValue);
    const routeId = normalizeText(routeMeta.id) || `${parsed.surface}:${parsed.routePath}`;

    claimedRoutePaths.add(routePathKey);
    routes.push(
      Object.freeze({
        id: routeId,
        filePath: parsed.filePath,
        surface: parsed.surface,
        routePath: parsed.routePath,
        routeMeta,
        loadModule: normalizeRouteModuleLoader(moduleValue, parsed.filePath)
      })
    );
  }

  return Object.freeze(routes.sort((left, right) => left.routePath.localeCompare(right.routePath) || left.id.localeCompare(right.id)));
}

function parseShellEntryFilePath(filePath, { directoryName = "surfaces" } = {}) {
  const { normalizedPath, subPath } = extractSubPathFromDirectory(filePath, directoryName, `Shell entry file ${filePath}`);
  const segments = subPath.split("/").map((segment) => normalizeText(segment)).filter(Boolean);

  if (segments.length < 3) {
    throw new TypeError(
      `Shell entry file ${filePath} must be nested as /${directoryName}/<surface>/<slot>/<entry>.entry.js.`
    );
  }

  const surface = assertKnownSurface(segments[0], `Shell entry file ${filePath}`);
  const slot = assertKnownSlot(segments[1], `Shell entry file ${filePath}`);
  const fileName = segments[segments.length - 1];
  const baseName = stripKnownExtension(fileName, SUPPORTED_ENTRY_FILE_EXTENSIONS, `Shell entry file ${filePath}`);
  const fallbackId = baseName.replace(/\.entry$/i, "");

  return Object.freeze({
    filePath: normalizedPath,
    surface,
    slot,
    fallbackId
  });
}

function normalizeGuard(guardValue, contextLabel) {
  if (guardValue == null) {
    return Object.freeze({});
  }

  const guard = ensureRecord(guardValue, `${contextLabel}.guard`);
  const requiredAnyPermission = Array.isArray(guard.requiredAnyPermission)
    ? guard.requiredAnyPermission.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  return Object.freeze({
    requiredAnyPermission,
    featureFlag: normalizeText(guard.featureFlag),
    requiredFeaturePermissionKey: normalizeText(guard.requiredFeaturePermissionKey)
  });
}

function normalizeShellEntry(entryValue, { filePath, surface, slot, fallbackId }) {
  const contextLabel = `Shell entry ${filePath}`;
  const entry = ensureRecord(entryValue, contextLabel);

  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) {
      throw new TypeError(`${contextLabel} uses unsupported key "${key}".`);
    }
  }

  const id = normalizeText(entry.id) || fallbackId;
  if (!id) {
    throw new TypeError(`${contextLabel} must define id.`);
  }

  const title = normalizeText(entry.title);
  if (!title) {
    throw new TypeError(`${contextLabel} must define title.`);
  }

  const route = normalizeRoutePath(entry.route);
  if (!route || route === "") {
    throw new TypeError(`${contextLabel} must define route.`);
  }

  const order = Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100;

  return Object.freeze({
    id,
    title,
    route,
    icon: normalizeText(entry.icon),
    group: normalizeText(entry.group),
    description: normalizeText(entry.description),
    order,
    guard: normalizeGuard(entry.guard, contextLabel),
    surface,
    slot,
    filePath
  });
}

function resolveEntryModuleValue(moduleValue, filePath) {
  if (typeof moduleValue === "function") {
    throw new TypeError(
      `Shell entry module ${filePath} must be eagerly loaded. Use import.meta.glob(..., { eager: true }).`
    );
  }

  if (!moduleValue || typeof moduleValue !== "object" || Array.isArray(moduleValue)) {
    throw new TypeError(`Shell entry module ${filePath} must export an object.`);
  }

  const candidate = moduleValue.default ?? moduleValue;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError(`Shell entry module ${filePath} default export must be an object.`);
  }

  return candidate;
}

function composeShellEntriesFromModules({ modules = {}, surface, slot, directoryName = "surfaces" } = {}) {
  const moduleMap = ensureRecord(modules, "modules");
  const normalizedSurface = assertKnownSurface(surface, "surface");
  const normalizedSlot = assertKnownSlot(slot, "slot");

  const entries = [];
  const claimedIds = new Set();

  for (const [filePath, moduleValue] of Object.entries(moduleMap)) {
    const location = parseShellEntryFilePath(filePath, { directoryName });
    if (location.surface !== normalizedSurface || location.slot !== normalizedSlot) {
      continue;
    }

    const entry = normalizeShellEntry(resolveEntryModuleValue(moduleValue, location.filePath), location);
    if (claimedIds.has(entry.id)) {
      throw new Error(`Duplicate shell entry id "${entry.id}" for ${normalizedSurface}/${normalizedSlot}.`);
    }

    claimedIds.add(entry.id);
    entries.push(entry);
  }

  return Object.freeze(entries.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
}

function composeShellEntriesBySlotFromModules({ modules = {}, surface, directoryName = "surfaces" } = {}) {
  const normalizedSurface = assertKnownSurface(surface, "surface");
  const output = {};

  for (const slot of KNOWN_SLOTS) {
    output[slot] = composeShellEntriesFromModules({
      modules,
      surface: normalizedSurface,
      slot,
      directoryName
    });
  }

  return Object.freeze(output);
}

const __testables = {
  normalizeRoutePath,
  parseRouteFilePath,
  parseShellEntryFilePath
};

export {
  KNOWN_SURFACES,
  KNOWN_SLOTS,
  parseRouteFilePath,
  composeFilesystemRoutesFromModules,
  parseShellEntryFilePath,
  composeShellEntriesFromModules,
  composeShellEntriesBySlotFromModules,
  __testables
};
