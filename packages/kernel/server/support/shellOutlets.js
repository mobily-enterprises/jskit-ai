import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { loadInstalledPackageDescriptor } from "../../internal/node/installedPackageDescriptor.js";
import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { resolveRequiredAppRoot, toPosixPath } from "./path.js";
import {
  describeShellOutletTargets,
  discoverShellOutletTargetsFromVueSource,
  findShellOutletTargetById,
  normalizeShellOutletTargetId
} from "../../shared/support/shellLayoutTargets.js";

const VUE_DISCOVERY_IGNORED_ERROR_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
const LOCK_FILE_RELATIVE_PATH = ".jskit/lock.json";

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

  const outletRecord = normalizeObject(outlet);
  const outletTargetId = normalizeShellOutletTargetId(
    `${normalizeText(outletRecord.host)}:${normalizeText(outletRecord.position)}`
  );
  if (!outletTargetId) {
    return null;
  }

  const separatorIndex = outletTargetId.indexOf(":");
  const host = outletTargetId.slice(0, separatorIndex);
  const position = outletTargetId.slice(separatorIndex + 1);
  const source = normalizeText(outletRecord.source);
  const sourcePath = source
    ? `package:${normalizedPackageId}:${toPosixPath(source)}`
    : `package:${normalizedPackageId}${descriptorPath ? `:${toPosixPath(descriptorPath)}` : ""}`;

  return Object.freeze({
    id: outletTargetId,
    host,
    position,
    default: false,
    sourcePath,
    sourcePackageId: normalizedPackageId
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

  const sourceDirectory = path.resolve(resolvedAppRoot, String(sourceRoot || "src"));
  const targetById = new Map();
  let defaultTargetId = "";
  let defaultTargetSource = "";
  const vueFiles = await collectVueFilePaths(sourceDirectory);

  for (const absoluteFilePath of vueFiles) {
    const relativePath = toPosixPath(path.relative(resolvedAppRoot, absoluteFilePath));
    const source = await readFile(absoluteFilePath, "utf8");
    if (!source.includes("<ShellOutlet")) {
      continue;
    }

    const discovered = discoverShellOutletTargetsFromVueSource(source, {
      context: relativePath
    });
    const targets = Array.isArray(discovered.targets) ? discovered.targets : [];
    for (const target of targets) {
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

    const discoveredDefaultTargetId = normalizeShellOutletTargetId(discovered.defaultTargetId);
    if (!discoveredDefaultTargetId) {
      continue;
    }

    if (defaultTargetId && discoveredDefaultTargetId !== defaultTargetId) {
      throw new Error(
        `Multiple default ShellOutlet targets found in app source: "${defaultTargetId}" (${defaultTargetSource}) and ` +
        `"${discoveredDefaultTargetId}" (${relativePath}).`
      );
    }

    defaultTargetId = discoveredDefaultTargetId;
    defaultTargetSource = relativePath;
  }

  const packageTargets = await collectInstalledPackageOutletTargets(resolvedAppRoot);
  for (const target of packageTargets) {
    if (!targetById.has(target.id)) {
      targetById.set(target.id, target);
    }
  }

  const targets = [...targetById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const normalizedTargets = targets.map((target) =>
    Object.freeze({
      ...target,
      default: target.id === defaultTargetId
    })
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
    throw new Error(`${resolvedContext} option "placement" must be in "host:position" format.`);
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
    `Set one outlet as default (e.g. <ShellOutlet host="shell-layout" position="primary-menu" default />) ` +
    `or pass "--placement host:position". Available targets: ${availableTargets || "<none>"}.`
  );
}

export {
  discoverShellOutletTargetsFromApp,
  resolveShellOutletPlacementTargetFromApp
};
