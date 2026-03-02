import { escapeRegExp } from "@jskit-ai/surface-routing/client";
import { resolveRouteMountPathByKey } from "../../framework/composeRouteMounts.js";

const DEFAULT_PROJECTS_MOUNT_PATH = "/projects";
const PROJECTS_MOUNT_PATH = resolveRouteMountPathByKey("admin", "projects.workspace", {
  required: false,
  fallbackPath: DEFAULT_PROJECTS_MOUNT_PATH
});

function normalizeRelativeSuffix(suffix = "") {
  const normalizedSuffix = String(suffix || "").trim();
  if (!normalizedSuffix || normalizedSuffix === "/") {
    return "";
  }

  return normalizedSuffix.startsWith("/") ? normalizedSuffix : `/${normalizedSuffix}`;
}

function buildProjectsRouteSuffix(suffix = "") {
  return `${PROJECTS_MOUNT_PATH}${normalizeRelativeSuffix(suffix)}`.replace(/\/+/g, "/");
}

function resolveProjectIdFromPath(pathname) {
  const pattern = new RegExp(`${escapeRegExp(PROJECTS_MOUNT_PATH)}/([^/]+)`, "i");
  const match = String(pathname || "").match(pattern);
  if (!match) {
    return "";
  }

  return decodeURIComponent(String(match[1] || "")).trim();
}

export { PROJECTS_MOUNT_PATH, buildProjectsRouteSuffix, resolveProjectIdFromPath };
