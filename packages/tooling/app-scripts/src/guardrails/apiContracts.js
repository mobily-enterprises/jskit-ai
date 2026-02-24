import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const API_CONTRACTS_START_MARKER = "<!-- API_CONTRACTS_START -->";
const API_CONTRACTS_END_MARKER = "<!-- API_CONTRACTS_END -->";

function createControllerProxy() {
  const noop = () => {};
  return new Proxy(noop, {
    get() {
      return createControllerProxy();
    },
    apply() {
      return undefined;
    }
  });
}

function resolveRouteProvider(routeProvider = {}) {
  const source = routeProvider && typeof routeProvider === "object" ? routeProvider : {};
  const modulePath = String(source.modulePath || "").trim() || "server/modules/api/routes.js";
  const exportName = String(source.exportName || "").trim() || "buildDefaultRoutes";

  return {
    modulePath,
    exportName
  };
}

async function loadBuildRoutesFunction({ appRoot, routeProvider } = {}) {
  const resolvedRoot = path.resolve(String(appRoot || process.cwd()));
  const provider = resolveRouteProvider(routeProvider);
  const absoluteModulePath = path.isAbsolute(provider.modulePath)
    ? provider.modulePath
    : path.resolve(resolvedRoot, provider.modulePath);

  let loadedModule;
  try {
    loadedModule = await import(pathToFileURL(absoluteModulePath).href);
  } catch (error) {
    throw new Error(
      `Failed to load API contract route module "${provider.modulePath}": ${String(error?.message || error)}`
    );
  }

  const buildRoutes = loadedModule?.[provider.exportName];
  if (typeof buildRoutes !== "function") {
    throw new Error(
      `Route provider export "${provider.exportName}" was not found in module "${provider.modulePath}".`
    );
  }

  return buildRoutes;
}

function listApiContractEndpoints(buildRoutes) {
  const routes = buildRoutes(createControllerProxy());
  const seen = new Set();
  const endpoints = [];

  for (const route of routes) {
    const method = String(route?.method || "")
      .trim()
      .toUpperCase();
    const pathValue = String(route?.path || "").trim();
    if (!method || !pathValue) {
      continue;
    }

    const endpoint = `${method} ${pathValue}`;
    if (seen.has(endpoint)) {
      continue;
    }

    seen.add(endpoint);
    endpoints.push(endpoint);
  }

  return endpoints;
}

function renderApiContractsBlock({
  endpoints,
  startMarker = API_CONTRACTS_START_MARKER,
  endMarker = API_CONTRACTS_END_MARKER
} = {}) {
  return [startMarker, ...endpoints.map((endpoint) => `- \`${endpoint}\``), endMarker].join("\n");
}

function updateReadmeApiContracts({
  readmeContent,
  endpoints,
  startMarker = API_CONTRACTS_START_MARKER,
  endMarker = API_CONTRACTS_END_MARKER
} = {}) {
  const source = String(readmeContent || "");
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error("README API contracts markers not found.");
  }

  const replacement = renderApiContractsBlock({
    endpoints,
    startMarker,
    endMarker
  });
  const afterEndIndex = endIndex + endMarker.length;
  return `${source.slice(0, startIndex)}${replacement}${source.slice(afterEndIndex)}`;
}

function resolveApiContractsConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  const markersSource = source.markers && typeof source.markers === "object" ? source.markers : {};

  return {
    readmePath: String(source.readmePath || "").trim() || "README.md",
    routeProvider: resolveRouteProvider(source.routeProvider),
    markers: {
      start: String(markersSource.start || "").trim() || API_CONTRACTS_START_MARKER,
      end: String(markersSource.end || "").trim() || API_CONTRACTS_END_MARKER
    }
  };
}

async function runApiContractsGuardrail({ appRoot, config, checkOnly = false } = {}) {
  const resolvedRoot = path.resolve(String(appRoot || process.cwd()));
  const resolvedConfig = resolveApiContractsConfig(config);
  const readmePath = path.resolve(resolvedRoot, resolvedConfig.readmePath);
  const currentReadme = await readFile(readmePath, "utf8");

  const buildRoutes = await loadBuildRoutesFunction({
    appRoot: resolvedRoot,
    routeProvider: resolvedConfig.routeProvider
  });
  const endpoints = listApiContractEndpoints(buildRoutes);
  const nextReadme = updateReadmeApiContracts({
    readmeContent: currentReadme,
    endpoints,
    startMarker: resolvedConfig.markers.start,
    endMarker: resolvedConfig.markers.end
  });

  if (currentReadme === nextReadme) {
    return {
      ok: true,
      changed: false,
      checkOnly,
      endpoints
    };
  }

  if (checkOnly) {
    return {
      ok: false,
      changed: false,
      checkOnly,
      endpoints,
      errorMessage: "README API contracts are out of sync. Run `npm run docs:api-contracts`."
    };
  }

  await writeFile(readmePath, nextReadme, "utf8");
  return {
    ok: true,
    changed: true,
    checkOnly,
    endpoints
  };
}

export {
  API_CONTRACTS_START_MARKER,
  API_CONTRACTS_END_MARKER,
  resolveRouteProvider,
  resolveApiContractsConfig,
  loadBuildRoutesFunction,
  listApiContractEndpoints,
  renderApiContractsBlock,
  updateReadmeApiContracts,
  runApiContractsGuardrail
};
