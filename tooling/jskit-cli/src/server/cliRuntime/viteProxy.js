import { rm } from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import {
  interpolateOptionValue
} from "../shared/optionInterpolation.js";
import {
  fileExists,
  readFileBufferIfExists,
  writeJsonFile,
  normalizeRelativePath,
  loadMutationWhenConfigContext
} from "./ioAndMigrations.js";
import {
  normalizeMutationWhen,
  shouldApplyMutationWhen
} from "./mutationWhen.js";

const VITE_DEV_PROXY_CONFIG_RELATIVE_PATH = ".jskit/vite.dev.proxy.json";
const VITE_DEV_PROXY_CONFIG_VERSION = 1;

function createEmptyViteDevProxyConfig() {
  return Object.freeze({
    version: VITE_DEV_PROXY_CONFIG_VERSION,
    entries: Object.freeze([])
  });
}

function normalizeViteDevProxyPath(value = "", { context = "vite proxy entry" } = {}) {
  const normalizedPath = String(value || "").trim();
  if (!normalizedPath || !normalizedPath.startsWith("/")) {
    throw createCliError(`${context} requires "path" starting with "/".`);
  }
  return normalizedPath.replace(/\/{2,}/g, "/");
}

function normalizeViteDevProxyEntry(value = {}, { context = "vite proxy entry" } = {}) {
  const source = ensureObject(value);
  const packageId = String(source.packageId || "").trim();
  const entryId = String(source.id || "").trim();
  if (!packageId) {
    throw createCliError(`${context} requires "packageId".`);
  }
  if (!entryId) {
    throw createCliError(`${context} requires "id".`);
  }

  const normalized = {
    packageId,
    id: entryId,
    path: normalizeViteDevProxyPath(source.path, {
      context: `${context} (${packageId}:${entryId})`
    })
  };

  const target = String(source.target || "").trim();
  if (target) {
    normalized.target = target;
  }
  if (Object.prototype.hasOwnProperty.call(source, "changeOrigin")) {
    normalized.changeOrigin = source.changeOrigin === true;
  }
  if (Object.prototype.hasOwnProperty.call(source, "ws")) {
    normalized.ws = source.ws === true;
  }

  return Object.freeze(normalized);
}

function normalizeViteDevProxyConfig(value = {}, { context = "vite proxy config" } = {}) {
  const source = ensureObject(value);
  const normalizedEntries = [];
  const seenEntryKeys = new Set();
  const seenPaths = new Set();

  for (const [index, entry] of ensureArray(source.entries).entries()) {
    const normalizedEntry = normalizeViteDevProxyEntry(entry, {
      context: `${context}.entries[${index}]`
    });
    const entryKey = `${normalizedEntry.packageId}::${normalizedEntry.id}`;
    if (seenEntryKeys.has(entryKey)) {
      throw createCliError(`${context} has duplicate entry "${entryKey}".`);
    }
    if (seenPaths.has(normalizedEntry.path)) {
      throw createCliError(`${context} has duplicate path "${normalizedEntry.path}".`);
    }

    seenEntryKeys.add(entryKey);
    seenPaths.add(normalizedEntry.path);
    normalizedEntries.push(normalizedEntry);
  }

  normalizedEntries.sort((left, right) => {
    const pathDiff = left.path.localeCompare(right.path);
    if (pathDiff !== 0) {
      return pathDiff;
    }
    const packageDiff = left.packageId.localeCompare(right.packageId);
    if (packageDiff !== 0) {
      return packageDiff;
    }
    return left.id.localeCompare(right.id);
  });

  return Object.freeze({
    version: VITE_DEV_PROXY_CONFIG_VERSION,
    entries: Object.freeze(normalizedEntries)
  });
}

function resolveViteDevProxyConfigAbsolutePath(appRoot) {
  return path.join(appRoot, VITE_DEV_PROXY_CONFIG_RELATIVE_PATH);
}

async function loadViteDevProxyConfig(appRoot, { context = "vite proxy config" } = {}) {
  const absolutePath = resolveViteDevProxyConfigAbsolutePath(appRoot);
  const existing = await readFileBufferIfExists(absolutePath);
  if (!existing.exists) {
    return Object.freeze({
      absolutePath,
      exists: false,
      config: createEmptyViteDevProxyConfig()
    });
  }

  const relativePath = normalizeRelativePath(appRoot, absolutePath);
  let parsed = {};
  try {
    parsed = JSON.parse(existing.buffer.toString("utf8"));
  } catch {
    throw createCliError(`Invalid ${context} at ${relativePath}: expected valid JSON.`);
  }

  return Object.freeze({
    absolutePath,
    exists: true,
    config: normalizeViteDevProxyConfig(parsed, {
      context: `${context} (${relativePath})`
    })
  });
}

async function writeViteDevProxyConfig(appRoot, config = {}, touchedFiles = null, { dryRun = false } = {}) {
  const absolutePath = resolveViteDevProxyConfigAbsolutePath(appRoot);
  const relativePath = normalizeRelativePath(appRoot, absolutePath);
  const normalizedConfig = normalizeViteDevProxyConfig(config);

  if (normalizedConfig.entries.length < 1) {
    if (await fileExists(absolutePath)) {
      if (!dryRun) {
        await rm(absolutePath);
      }
      if (touchedFiles && typeof touchedFiles.add === "function") {
        touchedFiles.add(relativePath);
      }
    }
    return;
  }

  if (!dryRun) {
    await writeJsonFile(absolutePath, normalizedConfig);
  }
  if (touchedFiles && typeof touchedFiles.add === "function") {
    touchedFiles.add(relativePath);
  }
}

function normalizeViteProxyMutationRecord(value = {}) {
  const source = ensureObject(value);
  const changeOrigin = Object.prototype.hasOwnProperty.call(source, "changeOrigin")
    ? source.changeOrigin === true
    : undefined;
  const ws = Object.prototype.hasOwnProperty.call(source, "ws") ? source.ws === true : undefined;
  return Object.freeze({
    id: String(source.id || "").trim(),
    path: String(source.path || "").trim(),
    target: String(source.target || "").trim(),
    changeOrigin,
    ws,
    when: normalizeMutationWhen(source.when)
  });
}

async function applyViteMutations(
  packageEntry,
  appRoot,
  viteMutations,
  options,
  managedVite,
  touchedFiles,
  { dryRun = false } = {}
) {
  const mutations = ensureArray(ensureObject(viteMutations).proxy).map((entry) => normalizeViteProxyMutationRecord(entry));
  if (mutations.length < 1) {
    return;
  }

  const { config: currentConfig } = await loadViteDevProxyConfig(appRoot, {
    context: `vite proxy config for ${packageEntry.packageId}`
  });
  const nextEntries = [...currentConfig.entries];
  let changed = false;

  for (const mutation of mutations) {
    const configContext = mutation.when?.config ? await loadMutationWhenConfigContext(appRoot) : {};
    if (
      !shouldApplyMutationWhen(mutation.when, {
        options,
        configContext,
        packageId: packageEntry.packageId,
        mutationContext: "vite proxy mutation"
      })
    ) {
      continue;
    }

    const normalizedId = interpolateOptionValue(
      mutation.id,
      options,
      packageEntry.packageId,
      "mutations.vite.proxy.id"
    );
    if (!normalizedId) {
      throw createCliError(`Invalid vite proxy mutation in ${packageEntry.packageId}: "id" is required.`);
    }

    const normalizedPath = normalizeViteDevProxyPath(
      interpolateOptionValue(
        mutation.path,
        options,
        packageEntry.packageId,
        `mutations.vite.proxy.${normalizedId}.path`
      ),
      {
        context: `Invalid vite proxy mutation in ${packageEntry.packageId} (${normalizedId})`
      }
    );

    const normalizedTarget = mutation.target
      ? String(
          interpolateOptionValue(
            mutation.target,
            options,
            packageEntry.packageId,
            `mutations.vite.proxy.${normalizedId}.target`
          ) || ""
        ).trim()
      : "";

    for (let index = nextEntries.length - 1; index >= 0; index -= 1) {
      const entry = nextEntries[index];
      if (entry.packageId === packageEntry.packageId && entry.id === normalizedId) {
        nextEntries.splice(index, 1);
        changed = true;
      }
    }

    const conflictingEntry = nextEntries.find((entry) => entry.path === normalizedPath);
    if (conflictingEntry) {
      throw createCliError(
        `Invalid vite proxy mutation in ${packageEntry.packageId}: path "${normalizedPath}" conflicts with ${conflictingEntry.packageId} (${conflictingEntry.id}).`
      );
    }

    nextEntries.push(
      Object.freeze({
        packageId: packageEntry.packageId,
        id: normalizedId,
        path: normalizedPath,
        ...(normalizedTarget ? { target: normalizedTarget } : {}),
        ...(typeof mutation.changeOrigin === "boolean" ? { changeOrigin: mutation.changeOrigin } : {}),
        ...(typeof mutation.ws === "boolean" ? { ws: mutation.ws } : {})
      })
    );
    changed = true;

    const mutationKey = `${normalizedPath}::${normalizedId}`;
    managedVite[mutationKey] = Object.freeze({
      op: "upsert-vite-proxy",
      id: normalizedId,
      path: normalizedPath
    });
  }

  if (!changed) {
    return;
  }

  const nextConfig = normalizeViteDevProxyConfig(
    {
      entries: nextEntries
    },
    {
      context: `vite proxy config for ${packageEntry.packageId}`
    }
  );

  if (JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) {
    return;
  }

  await writeViteDevProxyConfig(appRoot, nextConfig, touchedFiles, { dryRun });
}

async function removeManagedViteProxyEntries({
  appRoot,
  packageId,
  managedViteChanges = {},
  touchedFiles = null,
  dryRun = false
} = {}) {
  const managedChanges = Object.values(ensureObject(managedViteChanges))
    .map((entry) => ensureObject(entry))
    .filter((entry) => String(entry.op || "").trim() === "upsert-vite-proxy");
  if (managedChanges.length < 1) {
    return;
  }

  const { exists, config: currentConfig } = await loadViteDevProxyConfig(appRoot, {
    context: `vite proxy config while removing ${packageId}`
  });
  if (!exists) {
    return;
  }

  let nextEntries = [...currentConfig.entries];
  for (const change of managedChanges) {
    const changeId = String(change.id || "").trim();
    const changePath = String(change.path || "").trim();
    if (!changeId) {
      continue;
    }
    nextEntries = nextEntries.filter((entry) => {
      if (entry.packageId !== packageId || entry.id !== changeId) {
        return true;
      }
      if (changePath && entry.path !== changePath) {
        return true;
      }
      return false;
    });
  }

  const nextConfig = normalizeViteDevProxyConfig(
    {
      entries: nextEntries
    },
    {
      context: `vite proxy config while removing ${packageId}`
    }
  );
  if (JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) {
    return;
  }

  await writeViteDevProxyConfig(appRoot, nextConfig, touchedFiles, { dryRun });
}

export {
  createEmptyViteDevProxyConfig,
  normalizeViteDevProxyPath,
  normalizeViteDevProxyEntry,
  normalizeViteDevProxyConfig,
  resolveViteDevProxyConfigAbsolutePath,
  loadViteDevProxyConfig,
  writeViteDevProxyConfig,
  normalizeViteProxyMutationRecord,
  applyViteMutations,
  removeManagedViteProxyEntries
};
