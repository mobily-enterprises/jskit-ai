import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SUPPORTED_ROUTE_EXTENSIONS = new Set([".vue", ".mjs", ".cjs", ".js", ".ts", ".tsx", ".jsx"]);
const SUPPORTED_ENTRY_EXTENSIONS = new Set([".mjs", ".cjs", ".js"]);
const KNOWN_SLOTS = new Set(["drawer", "top", "config"]);

const APP_ROOT = process.cwd();
const SRC_ROOT = path.join(APP_ROOT, "src");
const PAGES_ROOT = path.join(SRC_ROOT, "pages");
const SURFACES_ROOT = path.join(SRC_ROOT, "surfaces");
const GENERATED_DIR = path.join(SRC_ROOT, "runtime", "generated");
const GENERATED_FILE = path.join(GENERATED_DIR, "filesystemManifest.generated.js");
const SURFACES_MODULE_FILE = path.join(SRC_ROOT, "runtime", "surfaces.generated.js");

async function loadSurfaceDefinitions() {
  const moduleUrl = pathToFileURL(SURFACES_MODULE_FILE).href;
  const loadedModule = await import(moduleUrl);
  const sourceDefinitions =
    typeof loadedModule.listSurfaceDefinitions === "function"
      ? loadedModule.listSurfaceDefinitions()
      : loadedModule.SURFACE_DEFINITIONS;

  if (!Array.isArray(sourceDefinitions) || sourceDefinitions.length < 1) {
    throw new Error("src/runtime/surfaces.generated.js must export at least one surface definition.");
  }

  const normalizedDefinitions = sourceDefinitions.map((definition, index) => {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new Error(`Surface definition at index ${index} must be an object.`);
    }
    const id = String(definition.id || "").trim().toLowerCase();
    const prefix = normalizePath(definition.prefix);
    if (!id) {
      throw new Error(`Surface definition at index ${index} must define id.`);
    }
    if (!prefix || prefix === "/") {
      throw new Error(`Surface definition "${id}" must define a non-root prefix.`);
    }
    return Object.freeze({
      id,
      prefix
    });
  });

  const defaultSurfaceId = String(loadedModule.DEFAULT_SURFACE_ID || normalizedDefinitions[0].id).trim().toLowerCase();
  if (!normalizedDefinitions.some((definition) => definition.id === defaultSurfaceId)) {
    throw new Error(`DEFAULT_SURFACE_ID "${defaultSurfaceId}" is not present in surface definitions.`);
  }

  return {
    definitions: Object.freeze(normalizedDefinitions),
    defaultSurfaceId
  };
}

const { definitions: SURFACE_DEFINITIONS, defaultSurfaceId: DEFAULT_SURFACE_ID } = await loadSurfaceDefinitions();
const KNOWN_SURFACES = new Set(SURFACE_DEFINITIONS.map((definition) => definition.id));
const SURFACE_PREFIX_BY_ID = Object.freeze(
  Object.fromEntries(SURFACE_DEFINITIONS.map((definition) => [definition.id, definition.prefix]))
);
const GENERATED_FILE_BY_SURFACE = Object.freeze(
  Object.fromEntries(
    SURFACE_DEFINITIONS.map((definition) => [
      definition.id,
      path.join(GENERATED_DIR, `filesystemManifest.${definition.id}.generated.js`)
    ])
  )
);

function resolveLazyRoutesFlag() {
  const raw = String(process.env.VITE_WEB_SHELL_LAZY || "").trim().toLowerCase();
  if (!raw) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(raw)) {
    return false;
  }
  return true;
}

const LAZY_ROUTES = resolveLazyRoutesFlag();

function toPosixPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePath(pathname) {
  const normalized = normalizeText(pathname);
  if (!normalized || normalized === "/") {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }
  return squashed;
}

function normalizeSurface(value, { fallback = DEFAULT_SURFACE_ID } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!KNOWN_SURFACES.has(normalized)) {
    return fallback;
  }
  return normalized;
}

function toSurfaceRoutePath(surface, routePath) {
  const normalizedSurface = normalizeSurface(surface);
  const normalizedRoutePath = normalizePath(routePath);
  const prefix = SURFACE_PREFIX_BY_ID[normalizedSurface] || "";
  if (!prefix) {
    return normalizedRoutePath;
  }
  if (normalizedRoutePath === "/") {
    return prefix;
  }
  return normalizePath(`${prefix}${normalizedRoutePath}`);
}

async function listFilesRecursive(rootDir) {
  const output = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        output.push(absolutePath);
      }
    }
  }

  await walk(rootDir);
  return output;
}

function toImportPath(fromDir, targetFilePath) {
  const relative = toPosixPath(path.relative(fromDir, targetFilePath));
  if (relative.startsWith(".")) {
    return relative;
  }
  return `./${relative}`;
}

function stripExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!extension) {
    return { extension: "", baseName: fileName };
  }
  return {
    extension,
    baseName: fileName.slice(0, -extension.length)
  };
}

function toRoutePathFromFile(relativePagePath) {
  const segments = toPosixPath(relativePagePath)
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  const surface = normalizeSurface(segments[0], { fallback: "" });
  if (!surface) {
    return null;
  }

  const fileSegments = segments.slice(1);
  if (fileSegments.length < 1) {
    return null;
  }

  const fileInfo = stripExtension(fileSegments[fileSegments.length - 1]);
  if (!SUPPORTED_ROUTE_EXTENSIONS.has(fileInfo.extension)) {
    return null;
  }

  fileSegments[fileSegments.length - 1] = fileInfo.baseName;
  if (fileSegments[fileSegments.length - 1].toLowerCase() === "index") {
    fileSegments.pop();
  }

  const routePath = normalizePath(fileSegments.join("/"));
  return {
    surface,
    routePath,
    fullPath: toSurfaceRoutePath(surface, routePath)
  };
}

function normalizeGuard(guard) {
  if (!guard || typeof guard !== "object" || Array.isArray(guard)) {
    return null;
  }

  const requiredAnyPermission = Array.isArray(guard.requiredAnyPermission)
    ? guard.requiredAnyPermission.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  const normalized = {
    requiredAnyPermission,
    featureFlag: normalizeText(guard.featureFlag),
    requiredFeaturePermissionKey: normalizeText(guard.requiredFeaturePermissionKey),
    policy: normalizeText(guard.policy)
  };

  if (
    normalized.requiredAnyPermission.length < 1 &&
    !normalized.featureFlag &&
    !normalized.requiredFeaturePermissionKey &&
    !normalized.policy
  ) {
    return null;
  }

  return normalized;
}

async function collectShellEntries() {
  const files = await listFilesRecursive(SURFACES_ROOT);
  const bySurface = Object.fromEntries(
    SURFACE_DEFINITIONS.map((definition) => [definition.id, { drawer: [], top: [], config: [] }])
  );

  const guardBySurfaceRoute = new Map();

  for (const absolutePath of files) {
    const relative = toPosixPath(path.relative(SURFACES_ROOT, absolutePath));
    const segments = relative.split("/").map((segment) => normalizeText(segment)).filter(Boolean);
    if (segments.length < 3) {
      continue;
    }

    const surface = normalizeSurface(segments[0], { fallback: "" });
    const rawSlot = normalizeText(segments[1]).toLowerCase();
    const slot = rawSlot.endsWith(".d") ? rawSlot.slice(0, -2) : rawSlot;
    if (!surface || !KNOWN_SLOTS.has(slot)) {
      continue;
    }

    const fileInfo = stripExtension(segments[segments.length - 1]);
    if (!SUPPORTED_ENTRY_EXTENSIONS.has(fileInfo.extension)) {
      continue;
    }
    if (!fileInfo.baseName.toLowerCase().endsWith(".entry")) {
      continue;
    }

    const fallbackId = fileInfo.baseName.replace(/\.entry$/i, "");
    const moduleUrl = pathToFileURL(absolutePath).href;
    const loadedModule = await import(moduleUrl);
    const entry = loadedModule?.default;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Shell entry file ${relative} must default-export an object.`);
    }

    const id = normalizeText(entry.id) || fallbackId;
    const title = normalizeText(entry.title);
    const route = normalizePath(entry.route);
    if (!id || !title || !route) {
      throw new Error(`Shell entry file ${relative} must define id/title/route.`);
    }

    const guard = normalizeGuard(entry.guard);
    const normalizedEntry = Object.freeze({
      id,
      title,
      route,
      icon: normalizeText(entry.icon),
      group: normalizeText(entry.group),
      description: normalizeText(entry.description),
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100,
      guard,
      resolvedRoute: toSurfaceRoutePath(surface, route)
    });

    bySurface[surface][slot].push(normalizedEntry);

    if (guard) {
      const guardKey = `${surface}:${route}`;
      if (!guardBySurfaceRoute.has(guardKey)) {
        guardBySurfaceRoute.set(guardKey, guard);
      }
    }
  }

  for (const surface of Object.keys(bySurface)) {
    for (const slot of Object.keys(bySurface[surface])) {
      bySurface[surface][slot].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    }
  }

  return {
    bySurface,
    guardBySurfaceRoute
  };
}

async function collectRouteEntries(guardBySurfaceRoute) {
  const files = await listFilesRecursive(PAGES_ROOT);
  const entries = [];

  for (const absolutePath of files) {
    const relative = toPosixPath(path.relative(PAGES_ROOT, absolutePath));
    const routeInfo = toRoutePathFromFile(relative);
    if (!routeInfo) {
      continue;
    }

    const routeKey = `${routeInfo.surface}:${routeInfo.routePath}`;
    entries.push({
      id: `${routeInfo.surface}:${routeInfo.routePath}`,
      surface: routeInfo.surface,
      routePath: routeInfo.routePath,
      fullPath: routeInfo.fullPath,
      importPath: toImportPath(GENERATED_DIR, absolutePath),
      guard: guardBySurfaceRoute.get(routeKey) || null
    });
  }

  entries.sort((left, right) => left.fullPath.localeCompare(right.fullPath) || left.id.localeCompare(right.id));

  return entries;
}

function serializeObject(value, indent = 0) {
  const spacing = "  ".repeat(indent);
  const childSpacing = "  ".repeat(indent + 1);

  if (value == null) {
    return "null";
  }

  if (Array.isArray(value)) {
    if (value.length < 1) {
      return "[]";
    }
    return `[
${value.map((entry) => `${childSpacing}${serializeObject(entry, indent + 1)}`).join(",\n")}
${spacing}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length < 1) {
      return "{}";
    }

    return `{
${keys
      .map((key) => `${childSpacing}${JSON.stringify(key)}: ${serializeObject(value[key], indent + 1)}`)
      .join(",\n")}
${spacing}}`;
  }

  return JSON.stringify(value);
}

function buildManifestSource({ routes, entriesBySurface, lazyRoutes }) {
  const lines = [];
  lines.push("// GENERATED FILE. DO NOT EDIT MANUALLY.");
  lines.push("// Run: npm run web-shell:generate");
  lines.push(`// Route loading mode: ${lazyRoutes ? "lazy" : "eager"}`);
  lines.push("");

  if (!lazyRoutes) {
    routes.forEach((route, index) => {
      lines.push(`import RouteComponent${index} from ${JSON.stringify(route.importPath)};`);
    });
    if (routes.length > 0) {
      lines.push("");
    }
  }

  lines.push("export const filesystemRouteEntries = Object.freeze([");

  for (const [index, route] of routes.entries()) {
    lines.push("  Object.freeze({");
    lines.push(`    id: ${JSON.stringify(route.id)},`);
    lines.push(`    surface: ${JSON.stringify(route.surface)},`);
    lines.push(`    routePath: ${JSON.stringify(route.routePath)},`);
    lines.push(`    fullPath: ${JSON.stringify(route.fullPath)},`);
    lines.push(`    guard: ${route.guard ? `Object.freeze(${serializeObject(route.guard, 2)})` : "null"},`);
    if (lazyRoutes) {
      lines.push(`    loadModule: () => import(${JSON.stringify(route.importPath)})`);
    } else {
      lines.push(`    component: RouteComponent${index}`);
    }
    lines.push("  }),");
  }

  lines.push("]);");
  lines.push("");

  lines.push("export const shellEntriesBySurface = Object.freeze({");
  for (const surface of SURFACE_DEFINITIONS.map((definition) => definition.id)) {
    const slotEntries = entriesBySurface[surface] || { drawer: [], top: [], config: [] };
    lines.push(`  ${surface}: Object.freeze({`);
    for (const slot of ["drawer", "top", "config"]) {
      const entries = slotEntries[slot] || [];
      lines.push(`    ${slot}: Object.freeze([`);
      for (const entry of entries) {
        const serialized = serializeObject(entry, 3);
        lines.push(`      Object.freeze(${serialized}),`);
      }
      lines.push("    ]),");
    }
    lines.push("  }),");
  }
  lines.push("});");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function summarizeEntries(entriesBySurface) {
  return Object.values(entriesBySurface || {})
    .flatMap((surfaceSlots) => Object.values(surfaceSlots || {}))
    .reduce((sum, entries) => sum + entries.length, 0);
}

async function main() {
  const { bySurface, guardBySurfaceRoute } = await collectShellEntries();
  const routes = await collectRouteEntries(guardBySurfaceRoute);
  const manifestSource = buildManifestSource({
    routes,
    entriesBySurface: bySurface,
    lazyRoutes: LAZY_ROUTES
  });

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(GENERATED_FILE, manifestSource, "utf8");

  const summaryEntries = summarizeEntries(bySurface);
  process.stdout.write(
    `[web-shell] generated ${path.relative(APP_ROOT, GENERATED_FILE)} (${routes.length} routes, ${summaryEntries} entries)\n`
  );

  for (const surface of Object.keys(GENERATED_FILE_BY_SURFACE)) {
    const surfaceRoutes = routes.filter((entry) => entry.surface === surface);
    const surfaceEntries = { [surface]: bySurface[surface] || { drawer: [], top: [], config: [] } };
    const surfaceManifest = buildManifestSource({
      routes: surfaceRoutes,
      entriesBySurface: surfaceEntries,
      lazyRoutes: LAZY_ROUTES
    });
    const targetFile = GENERATED_FILE_BY_SURFACE[surface];
    await writeFile(targetFile, surfaceManifest, "utf8");
    process.stdout.write(
      `[web-shell] generated ${path.relative(APP_ROOT, targetFile)} (${surfaceRoutes.length} routes, ${summarizeEntries(
        surfaceEntries
      )} entries)\n`
    );
  }

  process.stdout.write(`[web-shell] route loading mode: ${LAZY_ROUTES ? "lazy" : "eager"}\n`);
}

main().catch((error) => {
  process.stderr.write(`[web-shell] generation failed: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
