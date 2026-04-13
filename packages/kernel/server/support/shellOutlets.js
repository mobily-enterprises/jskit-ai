import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadInstalledPackageDescriptor } from "../../internal/node/installedPackageDescriptor.js";
import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { resolveRequiredAppRoot, toPosixPath } from "./path.js";
import {
  describeShellOutletTargets,
  discoverShellOutletTargetsFromVueSource,
  findShellOutletTargetById,
  normalizeShellOutletTargetId,
  normalizeShellOutletTargetRecord
} from "../../shared/support/shellLayoutTargets.js";
import { loadAppConfigFromModuleUrl } from "./appConfigFiles.js";

const VUE_DISCOVERY_IGNORED_ERROR_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
const LOCK_FILE_RELATIVE_PATH = ".jskit/lock.json";
const ROUTE_TAG_PATTERN = /<route\b([^>]*)>([\s\S]*?)<\/route>/g;
const ATTRIBUTE_PATTERN = /([:@]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function parseTagAttributes(attributesSource = "") {
  const attributes = {};
  const source = String(attributesSource || "");
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const attributeName = normalizeText(match[1]);
    if (!attributeName) {
      continue;
    }

    const hasValue = match[2] != null || match[3] != null;
    const attributeValue = hasValue ? String(match[2] ?? match[3] ?? "") : true;
    attributes[attributeName] = attributeValue;
  }

  return attributes;
}

function isDefaultEnabled(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value == null) {
    return false;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeAppRouteOutletTarget({
  outlet = {},
  sourcePath = ""
} = {}) {
  const normalizedTarget = normalizeShellOutletTargetRecord(outlet, {
    context: sourcePath || "route meta"
  });
  if (!normalizedTarget) {
    return null;
  }
  return Object.freeze({
    ...normalizedTarget,
    default: isDefaultEnabled(normalizedTarget.default),
    sourcePath
  });
}

function discoverRouteMetaOutletTargetsFromVueSource(source = "", { context = "shell layout" } = {}) {
  const sourceText = String(source || "");
  const resolvedContext = normalizeText(context) || "shell layout";
  const targetById = new Map();
  let defaultTargetId = "";

  for (const routeTagMatch of sourceText.matchAll(ROUTE_TAG_PATTERN)) {
    const routeTagAttributes = parseTagAttributes(routeTagMatch[1]);
    const routeTagLanguage = normalizeText(routeTagAttributes.lang).toLowerCase();
    if (routeTagLanguage !== "json") {
      continue;
    }

    const routeMetaSource = String(routeTagMatch[2] || "").trim();
    if (!routeMetaSource) {
      continue;
    }

    let routeMetaRecord = null;
    try {
      routeMetaRecord = JSON.parse(routeMetaSource);
    } catch (error) {
      throw new Error(
        `${resolvedContext} contains invalid <route lang="json"> block: ${String(error?.message || error || "unknown error")}`
      );
    }

    const routeMeta = normalizeObject(normalizeObject(routeMetaRecord).meta);
    const jskitMeta = normalizeObject(routeMeta.jskit);
    const placementsMeta = normalizeObject(jskitMeta.placements);
    const outlets = Array.isArray(placementsMeta.outlets) ? placementsMeta.outlets : [];
    for (const outlet of outlets) {
      const normalizedTarget = normalizeAppRouteOutletTarget({
        outlet,
        sourcePath: resolvedContext
      });
      if (!normalizedTarget) {
        continue;
      }
      if (targetById.has(normalizedTarget.id)) {
        throw new Error(`${resolvedContext} contains duplicate route meta placement target "${normalizedTarget.id}".`);
      }
      if (normalizedTarget.default === true) {
        if (defaultTargetId && defaultTargetId !== normalizedTarget.id) {
          throw new Error(
            `${resolvedContext} defines multiple default route meta placement targets: "${defaultTargetId}" and "${normalizedTarget.id}".`
          );
        }
        defaultTargetId = normalizedTarget.id;
      }
      targetById.set(normalizedTarget.id, normalizedTarget);
    }
  }

  return Object.freeze({
    targets: Object.freeze([...targetById.values()]),
    defaultTargetId
  });
}

async function collectVueFilePaths(rootDirectoryPath) {
  const absoluteRoot = path.resolve(String(rootDirectoryPath || ""));
  const stack = [absoluteRoot];
  const files = [];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    let directoryEntries = [];
    try {
      directoryEntries = await readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      const errorCode = normalizeText(error?.code).toUpperCase();
      if (!VUE_DISCOVERY_IGNORED_ERROR_CODES.has(errorCode)) {
        throw error;
      }
      continue;
    }

    for (const entry of directoryEntries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".vue")) {
        continue;
      }

      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function readInstalledPackageStates(appRoot) {
  const lockPath = path.resolve(appRoot, LOCK_FILE_RELATIVE_PATH);
  let lockSource = "";
  try {
    lockSource = await readFile(lockPath, "utf8");
  } catch (error) {
    const errorCode = normalizeText(error?.code).toUpperCase();
    if (errorCode === "ENOENT") {
      return {};
    }
    throw error;
  }

  let lockPayload = {};
  try {
    lockPayload = JSON.parse(lockSource);
  } catch (error) {
    throw new Error(`Invalid JSON in ${LOCK_FILE_RELATIVE_PATH}.`);
  }

  return normalizeObject(lockPayload.installedPackages);
}

function normalizePackageOutletTarget({
  packageId = "",
  outlet = {},
  descriptorPath = ""
} = {}) {
  const normalizedPackageId = normalizeText(packageId);
  if (!normalizedPackageId) {
    return null;
  }

  const normalizedTarget = normalizeShellOutletTargetRecord(outlet, {
    context: `package:${normalizedPackageId}`
  });
  if (!normalizedTarget) {
    return null;
  }

  const outletRecord = normalizeObject(outlet);
  const source = normalizeText(outletRecord.source);
  const sourcePath = source
    ? `package:${normalizedPackageId}:${toPosixPath(source)}`
    : `package:${normalizedPackageId}${descriptorPath ? `:${toPosixPath(descriptorPath)}` : ""}`;

  return Object.freeze({
    ...normalizedTarget,
    default: false,
    sourcePath,
    sourcePackageId: normalizedPackageId
  });
}

async function loadOutletDefaultOverrides(appRoot = "") {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "discoverShellOutletTargetsFromApp"
  });
  let appConfig = {};
  try {
    appConfig = normalizeObject(
      await loadAppConfigFromModuleUrl({
        moduleUrl: pathToFileURL(path.join(resolvedAppRoot, "config", "public.js")).href
      })
    );
  } catch {
    return {};
  }
  return normalizeObject(normalizeObject(appConfig.ui).outletDefaults);
}

function applyOutletDefaultOverrides(target = {}, outletDefaultOverrides = {}) {
  const targetRecord = normalizeObject(target);
  const outletTargetId = normalizeShellOutletTargetId(targetRecord.id);
  if (!outletTargetId) {
    return targetRecord;
  }

  const overrideRecord = outletDefaultOverrides?.[outletTargetId];
  const normalizedOverrideToken =
    typeof overrideRecord === "string"
      ? normalizeText(overrideRecord)
      : normalizeText(normalizeObject(overrideRecord).linkComponentToken) ||
        normalizeText(normalizeObject(overrideRecord)["link-component-token"]);
  if (!normalizedOverrideToken) {
    return targetRecord;
  }

  return Object.freeze({
    ...targetRecord,
    defaultLinkComponentToken: normalizedOverrideToken
  });
}

async function collectInstalledPackageOutletTargets(appRoot) {
  const installedPackageStates = await readInstalledPackageStates(appRoot);
  const packageIds = Object.keys(installedPackageStates).sort((left, right) => left.localeCompare(right));
  const targets = [];

  for (const packageId of packageIds) {
    const installedPackageState = normalizeObject(installedPackageStates[packageId]);
    const descriptorRecord = await loadInstalledPackageDescriptor({
      appRoot,
      packageId,
      installedPackageState
    });
    const descriptor = normalizeObject(descriptorRecord.descriptor);
    const metadata = normalizeObject(descriptor.metadata);
    const ui = normalizeObject(metadata.ui);
    const placements = normalizeObject(ui.placements);
    const outlets = Array.isArray(placements.outlets) ? placements.outlets : [];
    for (const outlet of outlets) {
      const normalizedTarget = normalizePackageOutletTarget({
        packageId,
        outlet,
        descriptorPath: descriptorRecord.descriptorPath
      });
      if (normalizedTarget) {
        targets.push(normalizedTarget);
      }
    }
  }

  return targets;
}

async function discoverShellOutletTargetsFromApp({ appRoot, sourceRoot = "src" } = {}) {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "discoverShellOutletTargetsFromApp"
  });
  const outletDefaultOverrides = await loadOutletDefaultOverrides(resolvedAppRoot);

  const sourceDirectory = path.resolve(resolvedAppRoot, String(sourceRoot || "src"));
  const targetById = new Map();
  let defaultTargetId = "";
  let defaultTargetSource = "";
  const vueFiles = await collectVueFilePaths(sourceDirectory);

  for (const absoluteFilePath of vueFiles) {
    const relativePath = toPosixPath(path.relative(resolvedAppRoot, absoluteFilePath));
    const source = await readFile(absoluteFilePath, "utf8");
    if (!source.includes("<ShellOutlet") && !source.includes("<route")) {
      continue;
    }

    const discoveredShellOutlets = source.includes("<ShellOutlet")
      ? discoverShellOutletTargetsFromVueSource(source, {
          context: relativePath
        })
      : { targets: [], defaultTargetId: "" };
    const discoveredRouteMetaOutlets = source.includes("<route")
      ? discoverRouteMetaOutletTargetsFromVueSource(source, {
          context: relativePath
        })
      : { targets: [], defaultTargetId: "" };
    const discoveredTargets = [
      ...(Array.isArray(discoveredShellOutlets.targets) ? discoveredShellOutlets.targets : []),
      ...(Array.isArray(discoveredRouteMetaOutlets.targets)
        ? discoveredRouteMetaOutlets.targets
        : [])
    ];
    for (const target of discoveredTargets) {
      if (!targetById.has(target.id)) {
        targetById.set(
          target.id,
          Object.freeze({
            ...target,
            sourcePath: relativePath
          })
        );
      }
    }

    const discoveredDefaultTargetIds = [
      normalizeShellOutletTargetId(discoveredShellOutlets.defaultTargetId),
      normalizeShellOutletTargetId(discoveredRouteMetaOutlets.defaultTargetId)
    ].filter(Boolean);
    for (const discoveredDefaultTargetId of discoveredDefaultTargetIds) {
      if (defaultTargetId && discoveredDefaultTargetId !== defaultTargetId) {
        throw new Error(
          `Multiple default ShellOutlet targets found in app source: "${defaultTargetId}" (${defaultTargetSource}) and ` +
          `"${discoveredDefaultTargetId}" (${relativePath}).`
        );
      }

      defaultTargetId = discoveredDefaultTargetId;
      defaultTargetSource = relativePath;
    }
  }

  const packageTargets = await collectInstalledPackageOutletTargets(resolvedAppRoot);
  for (const target of packageTargets) {
    if (!targetById.has(target.id)) {
      targetById.set(target.id, target);
    }
  }

  const targets = [...targetById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const normalizedTargets = targets.map((target) =>
    applyOutletDefaultOverrides({
      ...target,
      default: target.id === defaultTargetId
    }, outletDefaultOverrides)
  );

  return Object.freeze({
    targets: Object.freeze(normalizedTargets),
    defaultTargetId
  });
}

async function resolveShellOutletPlacementTargetFromApp({ appRoot, placement = "", context = "ui-generator" } = {}) {
  const resolvedContext = normalizeText(context) || "ui-generator";
  const requestedPlacementOption = normalizeText(placement);
  const requestedPlacementTargetId = normalizeShellOutletTargetId(requestedPlacementOption);
  if (requestedPlacementOption && !requestedPlacementTargetId) {
    throw new Error(`${resolvedContext} option "placement" must be a target in "host:position" format.`);
  }

  const discovered = await discoverShellOutletTargetsFromApp({ appRoot, sourceRoot: "src" });
  const targets = Array.isArray(discovered.targets) ? discovered.targets : [];
  if (targets.length < 1) {
    throw new Error(
      `${resolvedContext} could not find any placement targets from app Vue outlets or installed package metadata.`
    );
  }

  if (requestedPlacementTargetId) {
    const requestedTarget = findShellOutletTargetById(targets, requestedPlacementTargetId);
    if (!requestedTarget) {
      const availableTargets = describeShellOutletTargets(targets);
      throw new Error(
        `${resolvedContext} option "placement" target "${requestedPlacementTargetId}" is not declared in app or package placement outlets. ` +
        `Available targets: ${availableTargets || "<none>"}.`
      );
    }

    return requestedTarget;
  }

  const defaultTarget = findShellOutletTargetById(targets, discovered.defaultTargetId);
  if (defaultTarget) {
    return defaultTarget;
  }

  const availableTargets = describeShellOutletTargets(targets);
  throw new Error(
    `${resolvedContext} could not resolve a default ShellOutlet target from app Vue outlets. ` +
    `Set one outlet as default (e.g. <ShellOutlet target="shell-layout:primary-menu" default />) ` +
    `or pass "--placement shell-layout:primary-menu". Available targets: ${availableTargets || "<none>"}.`
  );
}

export {
  discoverShellOutletTargetsFromApp,
  resolveShellOutletPlacementTargetFromApp
};
