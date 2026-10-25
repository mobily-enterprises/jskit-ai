import { API_BASE_PATH, normalizePathname } from "./paths.js";

function normalizeRouteTemplateParams(params = null) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }
  return params;
}

function materializeRouteTemplate(routeTemplate = "/", { params = {}, strictParams = true, context = "materializeRouteTemplate" } = {}) {
  const normalizedTemplate = normalizePathname(routeTemplate);
  const normalizedParams = normalizeRouteTemplateParams(params);
  const missingParams = new Set();
  const outputPath = String(normalizedTemplate || "/").replace(/:([A-Za-z0-9_]+)/g, (_full, rawName) => {
    const paramName = String(rawName || "").trim();
    const rawValue = normalizedParams[paramName];
    const paramValue = String(Array.isArray(rawValue) ? rawValue[0] : rawValue ?? "").trim();
    if (!paramValue) {
      missingParams.add(paramName);
      return `:${paramName}`;
    }
    return encodeURIComponent(paramValue);
  });

  if (strictParams && missingParams.size > 0) {
    throw new Error(`${context} missing required route params: ${[...missingParams].sort().join(", ")}.`);
  }

  return outputPath;
}

function resolveScopedRouteBase(routeBase = "/") {
  const normalizedRouteBase = normalizePathname(routeBase);
  const segments = normalizedRouteBase.split("/").filter(Boolean);
  let lastDynamicIndex = -1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.startsWith(":") && segment.length > 1) {
      lastDynamicIndex = index;
    }
  }

  if (lastDynamicIndex < 0) {
    return "/";
  }

  return `/${segments.slice(0, lastDynamicIndex + 1).join("/")}`;
}

function resolveScopedApiBasePath({
  routeBase = "/",
  relativePath = "/",
  params = {},
  strictParams = true
} = {}) {
  const scopedRouteBase = resolveScopedRouteBase(routeBase);
  const materializedScopeBase = materializeRouteTemplate(scopedRouteBase, {
    params,
    strictParams,
    context: "resolveScopedApiBasePath"
  });
  const basePath = materializedScopeBase === "/" ? API_BASE_PATH : `${API_BASE_PATH}${materializedScopeBase}`;
  const normalizedRelativePath = normalizePathname(relativePath || "/");

  if (normalizedRelativePath === "/") {
    return basePath;
  }

  return `${basePath}${normalizedRelativePath}`;
}

export {
  resolveScopedRouteBase,
  resolveScopedApiBasePath
};
