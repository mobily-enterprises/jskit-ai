import { normalizeSurfaceId, normalizeSurfacePrefix } from "@jskit-ai/kernel/shared/surface/registry";

function normalizePathname(pathname) {
  const rawValue = String(pathname || "/").trim();
  if (!rawValue) {
    return "/";
  }

  const withoutQuery = rawValue.split("?")[0].split("#")[0];
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (squashed === "/") {
    return "/";
  }

  return squashed.replace(/\/+$/, "") || "/";
}

function normalizeWorkspaceBasePath(workspaceBasePath = "/w") {
  return normalizePathname(workspaceBasePath || "/w");
}

function normalizeSurfaceSegment(segmentLike = "") {
  const normalizedPath = normalizePathname(segmentLike || "/");
  if (normalizedPath === "/") {
    return "";
  }
  return normalizedPath.replace(/^\/+/, "");
}

function normalizeSurfaceSegmentFromPrefix(prefix) {
  const normalizedPrefix = normalizeSurfacePrefix(prefix);
  if (!normalizedPrefix) {
    return "";
  }
  return normalizedPrefix.replace(/^\/+/, "");
}

function parseWorkspacePathname(pathname = "", { workspaceBasePath = "/w" } = {}) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedWorkspaceBasePath = normalizeWorkspaceBasePath(workspaceBasePath);
  if (!normalizedPathname.startsWith(`${normalizedWorkspaceBasePath}/`)) {
    return null;
  }

  const trailingPath = normalizedPathname.slice(`${normalizedWorkspaceBasePath}/`.length);
  const segments = trailingPath.split("/").filter(Boolean);
  if (segments.length < 1) {
    return null;
  }

  const [workspaceSlug, ...suffixSegments] = segments;
  return {
    workspaceSlug: String(workspaceSlug || "").trim(),
    suffixSegments
  };
}

function resolveDefaultWorkspaceSurfaceId({
  defaultSurfaceId = "",
  workspaceSurfaceIds = [],
  surfaceRequiresWorkspace = null
} = {}) {
  const normalizedDefaultSurfaceId = normalizeSurfaceId(defaultSurfaceId);
  if (
    normalizedDefaultSurfaceId &&
    typeof surfaceRequiresWorkspace === "function" &&
    surfaceRequiresWorkspace(normalizedDefaultSurfaceId)
  ) {
    return normalizedDefaultSurfaceId;
  }

  for (const workspaceSurfaceId of Array.isArray(workspaceSurfaceIds) ? workspaceSurfaceIds : []) {
    const normalizedWorkspaceSurfaceId = normalizeSurfaceId(workspaceSurfaceId);
    if (normalizedWorkspaceSurfaceId) {
      return normalizedWorkspaceSurfaceId;
    }
  }

  return normalizedDefaultSurfaceId;
}

function resolveWorkspaceSurfaceIdFromSuffixSegments({
  suffixSegments = [],
  defaultWorkspaceSurfaceId = "",
  workspaceSurfaces = []
} = {}) {
  const normalizedDefaultWorkspaceSurfaceId = normalizeSurfaceId(defaultWorkspaceSurfaceId);
  if (!Array.isArray(suffixSegments) || suffixSegments.length < 1) {
    return normalizedDefaultWorkspaceSurfaceId;
  }

  const suffixPath = suffixSegments.join("/");
  const candidates = (Array.isArray(workspaceSurfaces) ? workspaceSurfaces : [])
    .map((entry) => {
      const surfaceId = normalizeSurfaceId(entry?.surfaceId || entry?.id);
      if (!surfaceId || surfaceId === normalizedDefaultWorkspaceSurfaceId) {
        return null;
      }

      const segment =
        normalizeSurfaceSegment(entry?.segment) ||
        normalizeSurfaceSegmentFromPrefix(entry?.prefix) ||
        surfaceId;
      if (!segment) {
        return null;
      }

      return {
        surfaceId,
        segment
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.segment.length - left.segment.length);

  for (const candidate of candidates) {
    if (suffixPath === candidate.segment || suffixPath.startsWith(`${candidate.segment}/`)) {
      return candidate.surfaceId;
    }
  }

  return normalizedDefaultWorkspaceSurfaceId;
}

export {
  normalizePathname,
  normalizeSurfaceSegmentFromPrefix,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId,
  resolveWorkspaceSurfaceIdFromSuffixSegments
};
