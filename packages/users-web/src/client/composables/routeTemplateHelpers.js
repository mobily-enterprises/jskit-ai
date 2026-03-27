import { unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";

const ROUTE_PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function normalizeRouteParamName(value = "", { context = "users-web route param" } = {}) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    throw new TypeError(`${context} must be a non-empty route parameter name.`);
  }
  if (!ROUTE_PARAM_NAME_PATTERN.test(normalizedValue)) {
    throw new TypeError(
      `${context} "${normalizedValue}" is invalid. Use letters, numbers, and underscores only.`
    );
  }

  return normalizedValue;
}

function toRouteParamValue(value) {
  if (Array.isArray(value)) {
    return toRouteParamValue(value[0]);
  }
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function resolveRouteSourceValue(source = null) {
  if (typeof source === "function") {
    return source();
  }

  return unref(source);
}

function resolveRouteParamsSource(source = null) {
  return asPlainObject(resolveRouteSourceValue(source));
}

function normalizeRoutePathname(value = "") {
  const rawPathname = String(value || "").trim();
  const sanitizedPathname = rawPathname.split(/[?#]/u, 1)[0] || "";
  if (!sanitizedPathname) {
    return "/";
  }

  return sanitizedPathname.startsWith("/") ? sanitizedPathname : `/${sanitizedPathname}`;
}

function resolveRoutePathnameSource(source = "") {
  return normalizeRoutePathname(resolveRouteSourceValue(source));
}

function resolveRouteTemplatePath(routeTemplate = "", params = {}) {
  const normalizedTemplate = String(routeTemplate || "").trim();
  if (!normalizedTemplate) {
    return "";
  }

  const source = asPlainObject(params);
  const missingParams = [];
  const resolvedPath = normalizedTemplate.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, key) => {
    const value = toRouteParamValue(source[key]);
    if (!value) {
      missingParams.push(key);
      return `:${key}`;
    }

    return encodeURIComponent(value);
  });

  if (missingParams.length > 0) {
    return "";
  }

  return resolvedPath;
}

function resolveRouteTemplateLocation(routeTemplate = "", { params = {}, currentPathname = "/" } = {}) {
  const resolvedTemplatePath = resolveRouteTemplatePath(routeTemplate, params);
  if (!resolvedTemplatePath) {
    return "";
  }
  if (resolvedTemplatePath.startsWith("/")) {
    return resolvedTemplatePath;
  }

  const normalizedCurrentPathname = resolveRoutePathnameSource(currentPathname);
  const basePathname = normalizedCurrentPathname.endsWith("/")
    ? normalizedCurrentPathname
    : `${normalizedCurrentPathname}/`;
  const resolvedPathname = new URL(resolvedTemplatePath, `https://jskit.local${basePathname}`).pathname;
  if (resolvedPathname.length > 1 && resolvedPathname.endsWith("/")) {
    return resolvedPathname.slice(0, -1);
  }

  return resolvedPathname;
}

export {
  normalizeRouteParamName,
  toRouteParamValue,
  resolveRouteParamsSource,
  resolveRoutePathnameSource,
  resolveRouteTemplatePath,
  resolveRouteTemplateLocation
};
