import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  normalizeSurfaceId,
  normalizeSurfacePagesRoot
} from "../../shared/surface/index.js";
import {
  normalizeObject,
  normalizeText
} from "../../shared/support/normalize.js";
import {
  discoverShellOutletTargetsFromVueSource,
  findShellOutletTargetById,
  normalizeShellOutletTargetId
} from "../../shared/support/shellLayoutTargets.js";
import { resolveShellOutletPlacementTargetFromApp } from "./shellOutlets.js";
import { resolveRequiredAppRoot, toPosixPath } from "./path.js";
import { loadAppConfigFromModuleUrl } from "./appConfigFiles.js";

const DEFAULT_PAGE_LINK_COMPONENT_TOKEN = "local.main.ui.surface-aware-menu-link-item";
const DEFAULT_SUBPAGE_LINK_COMPONENT_TOKEN = "local.main.ui.tab-link-item";
const PAGE_ROOT_PREFIX = "src/pages/";
const ROUTER_VIEW_TAG_PATTERN = /<RouterView\b/i;

function normalizeRelativeFilePath(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .trim();
}

function validateVueTargetFile(relativePath = "", { context = "page target" } = {}) {
  const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
  if (!normalizedRelativePath.endsWith(".vue")) {
    throw new Error(`${context} target file must be a .vue file: ${normalizedRelativePath || "<empty>"}.`);
  }
  return normalizedRelativePath;
}

function isAbsolutePathInput(value = "") {
  const normalizedValue = normalizeRelativeFilePath(value);
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.startsWith("/")) {
    return true;
  }

  return /^[A-Za-z]:\//u.test(normalizedValue);
}

function resolvePagesRelativeAppPath(
  value = "",
  {
    context = "page target",
    label = "target path"
  } = {}
) {
  const normalizedValue = normalizeRelativeFilePath(value);
  if (!normalizedValue) {
    throw new Error(`${context} requires ${label}.`);
  }
  if (isAbsolutePathInput(normalizedValue)) {
    throw new Error(`${context} ${label} must be relative to src/pages/: ${normalizedValue}.`);
  }
  if (normalizedValue === "src/pages" || normalizedValue === PAGE_ROOT_PREFIX) {
    throw new Error(
      `${context} ${label} must include a path under src/pages/: ${normalizedValue}.`
    );
  }
  if (normalizedValue.startsWith(PAGE_ROOT_PREFIX)) {
    return normalizedValue;
  }
  if (normalizedValue.startsWith("src/")) {
    throw new Error(
      `${context} ${label} must be relative to src/pages/ or start with src/pages/: ${normalizedValue}.`
    );
  }

  return `${PAGE_ROOT_PREFIX}${normalizedValue}`;
}

function normalizePagesRelativeTargetFile(
  targetFile = "",
  {
    context = "page target",
    label = "target file"
  } = {}
) {
  return validateVueTargetFile(
    resolvePagesRelativeAppPath(targetFile, { context, label }),
    { context }
  );
}

function normalizePagesRelativeTargetRoot(
  targetRoot = "",
  {
    context = "page target",
    label = "target root"
  } = {}
) {
  const normalizedRelativePath = resolvePagesRelativeAppPath(targetRoot, {
    context,
    label
  });
  if (normalizedRelativePath.endsWith(".vue")) {
    throw new Error(`${context} ${label} must be a route directory, not a .vue file: ${normalizedRelativePath}.`);
  }
  return normalizedRelativePath;
}

function splitTextIntoWords(value = "") {
  const normalized = String(value || "")
    .replace(/^\[|\]$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}

function wordsToKebab(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function toTitleCase(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const value = String(word || "");
      if (!value) {
        return "";
      }
      return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function isRouteGroupSegment(value = "") {
  const normalizedValue = normalizeText(value);
  return normalizedValue.startsWith("(") && normalizedValue.endsWith(")");
}

function isIndexRouteSegment(value = "") {
  return normalizeText(value).toLowerCase() === "index";
}

function isPathlessRouteSegment(value = "") {
  return isRouteGroupSegment(value) || isIndexRouteSegment(value);
}

function normalizePlacementIdSegment(value = "") {
  return wordsToKebab(splitTextIntoWords(value));
}

function humanizePageSegment(value = "", fallback = "Page") {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return fallback;
  }
  return toTitleCase(words);
}

async function loadPublicConfig(appRoot = "", { context = "page target" } = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, { context });
  try {
    const config = normalizeObject(
      await loadAppConfigFromModuleUrl({
        moduleUrl: pathToFileURL(path.join(resolvedAppRoot, "config", "public.js")).href
      })
    );
    if (Object.keys(config).length < 1) {
      throw new Error("requires exported config in config/public.js.");
    }
    return config;
  } catch (error) {
    throw new Error(
      `${context} could not load config/public.js: ${String(error?.message || error || "unknown error")}`
    );
  }
}

function normalizeSurfaceAccessPolicyId(value = "") {
  return normalizeText(value).toLowerCase();
}

function resolveSurfaceRequiresAuth(surfaceDefinition = {}, surfaceAccessPolicies = {}) {
  const normalizedDefinition = normalizeObject(surfaceDefinition);
  const normalizedPolicies = normalizeObject(surfaceAccessPolicies);
  const accessPolicyId = normalizeSurfaceAccessPolicyId(normalizedDefinition.accessPolicyId);
  const configuredPolicy = accessPolicyId
    ? normalizeObject(normalizedPolicies[accessPolicyId])
    : {};

  if (Object.hasOwn(configuredPolicy, "requireAuth")) {
    return configuredPolicy.requireAuth === true;
  }

  return normalizedDefinition.requiresAuth === true;
}

async function listSurfacePageRoots(appRoot = "", { context = "page target" } = {}) {
  const config = await loadPublicConfig(appRoot, { context });
  const surfaceDefinitions = normalizeObject(config.surfaceDefinitions);
  const surfaceAccessPolicies = normalizeObject(config.surfaceAccessPolicies);

  return Object.freeze(
    Object.entries(surfaceDefinitions)
      .map(([key, value]) => {
        const definition = normalizeObject(value);
        const surfaceId = normalizeSurfaceId(definition.id || key);
        if (!surfaceId || definition.enabled === false) {
          return null;
        }

        return Object.freeze({
          id: surfaceId,
          pagesRoot: normalizeSurfacePagesRoot(definition.pagesRoot),
          requiresAuth: resolveSurfaceRequiresAuth(definition, surfaceAccessPolicies)
        });
      })
      .filter(Boolean)
  );
}

function deriveSurfaceMatchesFromPageFile(relativePath = "", surfacePageRoots = []) {
  const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
  if (!normalizedRelativePath.startsWith(PAGE_ROOT_PREFIX)) {
    return [];
  }

  const pagePathWithinPagesRoot = normalizedRelativePath.slice(PAGE_ROOT_PREFIX.length);
  return (Array.isArray(surfacePageRoots) ? surfacePageRoots : [])
    .map((surface) => {
      const pagesRoot = normalizeSurfacePagesRoot(surface?.pagesRoot);
      if (!pagesRoot) {
        return Object.freeze({
          surfaceId: normalizeSurfaceId(surface?.id),
          pagesRoot,
          requiresAuth: surface?.requiresAuth === true,
          surfaceRelativeFilePath: pagePathWithinPagesRoot
        });
      }

      const requiredPrefix = `${pagesRoot}/`;
      if (!pagePathWithinPagesRoot.startsWith(requiredPrefix)) {
        return null;
      }

      return Object.freeze({
        surfaceId: normalizeSurfaceId(surface?.id),
        pagesRoot,
        requiresAuth: surface?.requiresAuth === true,
        surfaceRelativeFilePath: pagePathWithinPagesRoot.slice(requiredPrefix.length)
      });
    })
    .filter(Boolean);
}

function compareSurfaceMatchSpecificity(leftMatch = {}, rightMatch = {}) {
  const leftPagesRoot = normalizeSurfacePagesRoot(leftMatch?.pagesRoot);
  const rightPagesRoot = normalizeSurfacePagesRoot(rightMatch?.pagesRoot);
  const leftSegmentCount = leftPagesRoot ? leftPagesRoot.split("/").filter(Boolean).length : 0;
  const rightSegmentCount = rightPagesRoot ? rightPagesRoot.split("/").filter(Boolean).length : 0;

  if (leftSegmentCount !== rightSegmentCount) {
    return rightSegmentCount - leftSegmentCount;
  }
  if (leftPagesRoot.length !== rightPagesRoot.length) {
    return rightPagesRoot.length - leftPagesRoot.length;
  }
  return leftPagesRoot.localeCompare(rightPagesRoot);
}

function resolveBestSurfaceMatchFromPageFile(relativePath = "", surfacePageRoots = [], { context = "page target" } = {}) {
  const matches = deriveSurfaceMatchesFromPageFile(relativePath, surfacePageRoots);
  if (matches.length < 1) {
    return null;
  }

  const sortedMatches = [...matches].sort(compareSurfaceMatchSpecificity);
  const bestMatch = sortedMatches[0];
  const bestPagesRoot = normalizeSurfacePagesRoot(bestMatch?.pagesRoot);
  const conflictingMatches = sortedMatches.filter(
    (match) => normalizeSurfacePagesRoot(match?.pagesRoot) === bestPagesRoot
  );
  if (conflictingMatches.length > 1) {
    const surfaceIds = conflictingMatches.map((match) => match.surfaceId).filter(Boolean).join(", ");
    const pagesRootLabel = bestPagesRoot || "/";
    throw new Error(
      `${context} target file is ambiguous because multiple surfaces share pagesRoot "${pagesRootLabel}" (${surfaceIds}): ${normalizeRelativeFilePath(relativePath)}.`
    );
  }

  return bestMatch;
}

function deriveRouteInfoFromSurfaceRelativeFile(surfaceRelativeFilePath = "", surfaceId = "") {
  const normalizedRelativeFilePath = validateVueTargetFile(surfaceRelativeFilePath, {
    context: "page target"
  });
  const withoutExtension = normalizedRelativeFilePath.slice(0, -".vue".length);
  const fileSegments = withoutExtension
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  const routeSegments = [...fileSegments];
  if (routeSegments[routeSegments.length - 1] === "index") {
    routeSegments.pop();
  }

  const visibleRouteSegments = routeSegments.filter((segment) => !isPathlessRouteSegment(segment));
  const routeUrlSuffix = visibleRouteSegments.length > 0 ? `/${visibleRouteSegments.join("/")}` : "/";
  const surfacePlacementIdSegment = normalizePlacementIdSegment(surfaceId || "root") || "root";
  const placementIdSegments = visibleRouteSegments
    .map((segment) => normalizePlacementIdSegment(segment))
    .filter(Boolean);
  const pageLeafSegment = visibleRouteSegments[visibleRouteSegments.length - 1] || "";
  const defaultNameSource = pageLeafSegment || surfaceId || "page";
  const defaultName = humanizePageSegment(defaultNameSource, "Page");

  return Object.freeze({
    fileSegments,
    routeSegments,
    visibleRouteSegments,
    routeUrlSuffix,
    pageLeafSegment,
    defaultName,
    placementId:
      placementIdSegments.length > 0
        ? `ui-generator.page.${surfacePlacementIdSegment}.${placementIdSegments.join(".")}.link`
        : `ui-generator.page.${surfacePlacementIdSegment}.link`
  });
}

function buildRouteUrlSuffixFromVisibleSegments(segments = []) {
  const visibleSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  return visibleSegments.length > 0 ? `/${visibleSegments.join("/")}` : "/";
}

function buildAncestorRouteContexts(pageTarget = {}) {
  const routeSegments = Array.isArray(pageTarget?.routeSegments)
    ? pageTarget.routeSegments
    : [];
  const visibleRouteSegments = Array.isArray(pageTarget?.visibleRouteSegments)
    ? pageTarget.visibleRouteSegments
    : [];
  if (visibleRouteSegments.length < 2) {
    return [];
  }

  const ancestors = [];

  for (let visiblePrefixLength = visibleRouteSegments.length - 1; visiblePrefixLength >= 1; visiblePrefixLength -= 1) {
    const parentVisibleSegments = visibleRouteSegments.slice(0, visiblePrefixLength);
      const actualRouteSegments = [];
      let collectedVisibleSegments = 0;

    for (const segment of routeSegments) {
      actualRouteSegments.push(segment);
      if (!isPathlessRouteSegment(segment)) {
        collectedVisibleSegments += 1;
      }
      if (collectedVisibleSegments >= visiblePrefixLength) {
        break;
      }
    }

    if (collectedVisibleSegments !== visiblePrefixLength) {
      continue;
    }

    const nextRouteSegment = normalizeText(routeSegments[actualRouteSegments.length]);
    ancestors.push(
      Object.freeze({
        visibleRouteSegments: parentVisibleSegments,
        actualRouteSegments,
        childUsesIndexRouteOwner: isIndexRouteSegment(nextRouteSegment)
      })
    );
  }

  return ancestors;
}

function buildParentPageFileCandidates(pageTarget = {}, ancestorRoute = {}) {
  const surfacePagesRootSegments = normalizeRelativeFilePath(pageTarget?.surfacePagesRoot)
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  const routeSegments = (Array.isArray(ancestorRoute?.actualRouteSegments) ? ancestorRoute.actualRouteSegments : [])
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (routeSegments.length < 1) {
    return [];
  }

  const baseSegments = ["src/pages", ...surfacePagesRootSegments, ...routeSegments];
  const fileRoutePath = `${baseSegments.join("/")}.vue`;
  const indexRoutePath = [...baseSegments, "index.vue"].join("/");
  const preferredCandidates = ancestorRoute?.childUsesIndexRouteOwner === true
    ? [indexRoutePath, fileRoutePath]
    : [fileRoutePath, indexRoutePath];

  return preferredCandidates.map((relativePath) =>
    Object.freeze({
      relativePath,
      pageShape: relativePath.endsWith("/index.vue") ? "index" : "file"
    })
  );
}

function resolveSubpagesHostTargetFromPageSource(source = "") {
  const sourceText = String(source || "");
  if (!ROUTER_VIEW_TAG_PATTERN.test(sourceText)) {
    return null;
  }

  const discoveredTargets = discoverShellOutletTargetsFromVueSource(sourceText, {
    context: "subpages host"
  });
  const targets = Array.isArray(discoveredTargets.targets) ? discoveredTargets.targets : [];
  if (targets.length !== 1) {
    return null;
  }

  const target = findShellOutletTargetById(targets, targets[0]?.id);
  if (!target) {
    return null;
  }

  return Object.freeze({
    id: target.id
  });
}

async function resolvePageTargetDetails({
  appRoot,
  targetFile = "",
  context = "page target"
} = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, { context });
  const normalizedRelativePath = normalizePagesRelativeTargetFile(targetFile, {
    context,
    label: "target file"
  });

  const surfacePageRoots = await listSurfacePageRoots(resolvedAppRoot, { context });
  const surfaceMatch = resolveBestSurfaceMatchFromPageFile(normalizedRelativePath, surfacePageRoots, { context });
  if (!surfaceMatch) {
    throw new Error(
      `${context} target file must be relative to src/pages/ and resolve to a configured surface: ${normalizeRelativeFilePath(targetFile)}.`
    );
  }
  const routeInfo = deriveRouteInfoFromSurfaceRelativeFile(surfaceMatch.surfaceRelativeFilePath, surfaceMatch.surfaceId);
  const absolutePath = path.resolve(resolvedAppRoot, normalizedRelativePath);

  return Object.freeze({
    appRoot: resolvedAppRoot,
    targetFilePath: Object.freeze({
      absolutePath,
      relativePath: normalizedRelativePath
    }),
    surfaceId: surfaceMatch.surfaceId,
    surfacePagesRoot: surfaceMatch.pagesRoot,
    surfaceRequiresAuth: surfaceMatch.requiresAuth === true,
    surfaceRelativeFilePath: surfaceMatch.surfaceRelativeFilePath,
    ...routeInfo
  });
}

function deriveDefaultSubpagesHost(pageTarget = {}) {
  const visibleRouteSegments = Array.isArray(pageTarget?.visibleRouteSegments)
    ? pageTarget.visibleRouteSegments
    : [];
  const hostSegments = visibleRouteSegments
    .map((segment) => normalizePlacementIdSegment(segment))
    .filter(Boolean);

  if (hostSegments.length > 0) {
    return hostSegments.join("-");
  }

  return normalizePlacementIdSegment(pageTarget?.surfaceId || "page") || "page";
}

async function resolveNearestParentSubpagesHost({
  appRoot,
  pageTarget = {},
  context = "page target"
} = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, { context });
  const ancestorRoutes = buildAncestorRouteContexts(pageTarget);
  if (ancestorRoutes.length < 1) {
    return null;
  }

  for (const ancestorRoute of ancestorRoutes) {
    const candidatePages = buildParentPageFileCandidates(pageTarget, ancestorRoute);

    for (const candidatePage of candidatePages) {
      const candidatePath = path.resolve(resolvedAppRoot, candidatePage.relativePath);
      let source = "";
      try {
        source = await readFile(candidatePath, "utf8");
      } catch {
        continue;
      }

      const target = resolveSubpagesHostTargetFromPageSource(source);
      if (!target) {
        continue;
      }

      return Object.freeze({
        ...target,
        pageFile: toPosixPath(path.relative(resolvedAppRoot, candidatePath)),
        pageShape: candidatePage.pageShape,
        visibleRouteSegments: ancestorRoute.visibleRouteSegments,
        routeUrlSuffix: buildRouteUrlSuffixFromVisibleSegments(ancestorRoute.visibleRouteSegments)
      });
    }
  }

  return null;
}

function normalizePlacementTargetId(target = {}) {
  return normalizeShellOutletTargetId(target?.id || target?.target || target);
}

function resolveRelativeLinkToFromParent(pageTarget = {}, parentHost = null) {
  const childSegments = Array.isArray(pageTarget?.visibleRouteSegments) ? pageTarget.visibleRouteSegments : [];
  const parentSegments = Array.isArray(parentHost?.visibleRouteSegments) ? parentHost.visibleRouteSegments : [];
  if (parentSegments.length < 1 || childSegments.length <= parentSegments.length) {
    return "";
  }

  const relativeSegments = childSegments.slice(parentSegments.length);
  if (relativeSegments.length < 1) {
    return "";
  }

  return `./${relativeSegments.join("/")}`;
}

function resolveRelativeLinkToFromNearestIndexOwner(pageTarget = {}) {
  const routeSegments = Array.isArray(pageTarget?.routeSegments) ? pageTarget.routeSegments : [];
  const deepestIndexOwnerIndex = routeSegments.findLastIndex((segment) => isIndexRouteSegment(segment));
  if (deepestIndexOwnerIndex < 0 || deepestIndexOwnerIndex >= routeSegments.length - 1) {
    return "";
  }

  const relativeSegments = routeSegments
    .slice(deepestIndexOwnerIndex + 1)
    .filter((segment) => !isPathlessRouteSegment(segment));
  if (relativeSegments.length < 1) {
    return "";
  }

  return `./${relativeSegments.join("/")}`;
}

function resolveInferredPageLinkTo({
  explicitLinkTo = "",
  pageTarget = {},
  parentHost = null,
  placementTarget = null
} = {}) {
  const normalizedExplicitLinkTo = normalizeText(explicitLinkTo);
  if (normalizedExplicitLinkTo) {
    return normalizedExplicitLinkTo;
  }

  const parentTargetId = normalizePlacementTargetId(parentHost);
  const placementTargetId = normalizePlacementTargetId(placementTarget);
  if (parentTargetId && parentTargetId === placementTargetId) {
    const inferredLinkTo = resolveRelativeLinkToFromParent(pageTarget, parentHost);
    if (inferredLinkTo) {
      return inferredLinkTo;
    }
  }

  if (normalizeText(parentHost?.pageShape) === "index") {
    const inferredLinkTo = resolveRelativeLinkToFromParent(pageTarget, parentHost);
    if (inferredLinkTo) {
      return inferredLinkTo;
    }
  }

  const inferredLinkTo = resolveRelativeLinkToFromNearestIndexOwner(pageTarget);
  if (inferredLinkTo) {
    return inferredLinkTo;
  }
  return "";
}

function resolveInferredPageLinkComponentToken({
  explicitComponentToken = "",
  parentHost = null,
  placementTarget = null,
  defaultComponentToken = DEFAULT_PAGE_LINK_COMPONENT_TOKEN,
  subpageComponentToken = DEFAULT_SUBPAGE_LINK_COMPONENT_TOKEN
} = {}) {
  const normalizedExplicitToken = normalizeText(explicitComponentToken);
  if (normalizedExplicitToken) {
    return normalizedExplicitToken;
  }

  const normalizedPlacementTargetDefaultToken = normalizeText(placementTarget?.defaultLinkComponentToken);
  if (normalizedPlacementTargetDefaultToken) {
    return normalizedPlacementTargetDefaultToken;
  }

  const parentTargetId = normalizePlacementTargetId(parentHost);
  const placementTargetId = normalizePlacementTargetId(placementTarget);
  if (parentTargetId && parentTargetId === placementTargetId) {
    return normalizeText(subpageComponentToken) || DEFAULT_SUBPAGE_LINK_COMPONENT_TOKEN;
  }

  return normalizeText(defaultComponentToken) || DEFAULT_PAGE_LINK_COMPONENT_TOKEN;
}

function renderPageLinkWhenLine(pageTarget = {}) {
  if (pageTarget?.surfaceRequiresAuth !== true) {
    return "";
  }

  return "    when: ({ auth }) => Boolean(auth?.authenticated)\n";
}

async function resolvePageLinkTargetDetails({
  appRoot,
  targetFile = "",
  pageTarget = null,
  placement = "",
  componentToken = "",
  linkTo = "",
  defaultComponentToken = DEFAULT_PAGE_LINK_COMPONENT_TOKEN,
  subpageComponentToken = DEFAULT_SUBPAGE_LINK_COMPONENT_TOKEN,
  context = "page target"
} = {}) {
  const resolvedPageTarget = pageTarget || await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context
  });
  const parentHost = await resolveNearestParentSubpagesHost({
    appRoot: resolvedPageTarget.appRoot,
    pageTarget: resolvedPageTarget,
    context
  });
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot: resolvedPageTarget.appRoot,
    context,
    placement: normalizeText(placement) || parentHost?.id || ""
  });

  return Object.freeze({
    pageTarget: resolvedPageTarget,
    parentHost,
    placementTarget,
    componentToken: resolveInferredPageLinkComponentToken({
      explicitComponentToken: componentToken,
      parentHost,
      placementTarget,
      defaultComponentToken,
      subpageComponentToken
    }),
    whenLine: renderPageLinkWhenLine(resolvedPageTarget),
    linkTo: resolveInferredPageLinkTo({
      explicitLinkTo: linkTo,
      pageTarget: resolvedPageTarget,
      parentHost,
      placementTarget
    })
  });
}

export {
  DEFAULT_PAGE_LINK_COMPONENT_TOKEN,
  DEFAULT_SUBPAGE_LINK_COMPONENT_TOKEN,
  listSurfacePageRoots,
  normalizePagesRelativeTargetFile,
  normalizePagesRelativeTargetRoot,
  resolveBestSurfaceMatchFromPageFile,
  resolvePageTargetDetails,
  deriveDefaultSubpagesHost,
  resolveNearestParentSubpagesHost,
  resolvePageLinkTargetDetails
};
