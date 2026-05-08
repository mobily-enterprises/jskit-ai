import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";

const PLACEMENT_FILE_RELATIVE_PATH = "src/placement.js";
const MAIN_CLIENT_PROVIDERS_RELATIVE_PATH = "packages/main/src/client/providers";
const COMPONENT_TOKEN_PATTERN = /\bcomponentToken\s*:\s*["']([^"']+)["']/g;
const REGISTER_MAIN_CLIENT_COMPONENT_PATTERN = /registerMainClientComponent\(\s*["']([^"']+)["']\s*,/g;
const LINK_ITEM_TOKEN_SUFFIX = "link-item";
const JSKIT_SCOPE_PREFIX = "@jskit-ai/";
const FEATURE_SERVER_GENERATOR_PACKAGE_ID = "@jskit-ai/feature-server-generator";
const PLACEMENT_LAYOUT_CLASSES = Object.freeze(["compact", "medium", "expanded"]);
const PLACEMENT_KIND_COMPONENT = "component";
const PLACEMENT_KIND_LINK = "link";
const PROVIDER_SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const READ_FILE_IGNORE_ERROR_CODES = new Set(["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"]);
const READ_DIRECTORY_IGNORE_ERROR_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);

function collectTokenMatches(source = "", pattern = COMPONENT_TOKEN_PATTERN) {
  const sourceText = String(source || "");
  const tokens = [];
  for (const match of sourceText.matchAll(pattern)) {
    const token = String(match[1] || "").trim();
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

function appendTokenSource(map, token = "", source = "") {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return;
  }
  const normalizedSource = String(source || "").trim();
  const existingSources = map.get(normalizedToken) || new Set();
  if (normalizedSource) {
    existingSources.add(normalizedSource);
  }
  map.set(normalizedToken, existingSources);
}

function toShortPackageId(packageId = "") {
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId.startsWith(JSKIT_SCOPE_PREFIX)) {
    return normalizedPackageId;
  }
  return normalizedPackageId.slice(JSKIT_SCOPE_PREFIX.length);
}

function resolveGeneratorPrimarySubcommand(packageEntry = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  const metadata = ensureObject(descriptor.metadata);
  return String(metadata.generatorPrimarySubcommand || descriptor.generatorPrimarySubcommand || "").trim();
}

function resolveGeneratorDescription(packageEntry = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  return String(descriptor.description || "").trim();
}

function resolveGeneratorQuickStartRows(packageEntry = {}, { limit = 3 } = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  const metadata = ensureObject(descriptor.metadata);
  const subcommands = ensureObject(metadata.generatorSubcommands || descriptor.generatorSubcommands);
  const primarySubcommandName = resolveGeneratorPrimarySubcommand(packageEntry);
  const primarySubcommand = ensureObject(subcommands[primarySubcommandName]);
  const examples = ensureArray(primarySubcommand.examples);
  return examples
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((example) => ({
      label: String(ensureObject(example).label || "").trim(),
      lines: ensureArray(ensureObject(example).lines).map((value) => String(value || "").trim()).filter(Boolean)
    }))
    .filter((example) => example.lines.length > 0);
}

function isLinkItemToken(token = "") {
  return String(token || "").trim().toLowerCase().endsWith(LINK_ITEM_TOKEN_SUFFIX);
}

function collectPlacementRendererKinds(placementTarget = {}) {
  const kinds = new Set();
  const variants = ensureObject(placementTarget.variants);
  for (const layoutClass of PLACEMENT_LAYOUT_CLASSES) {
    const variant = ensureObject(variants[layoutClass]);
    const renderers = ensureObject(variant.renderers);
    for (const kind of Object.keys(renderers)) {
      const normalizedKind = String(kind || "").trim();
      if (normalizedKind) {
        kinds.add(normalizedKind);
      }
    }
  }
  if (kinds.size < 1) {
    kinds.add(PLACEMENT_KIND_COMPONENT);
  }
  return sortStrings([...kinds]);
}

function collectPlacementConcreteOutlets(placementTarget = {}) {
  const outlets = new Set();
  const variants = ensureObject(placementTarget.variants);
  for (const layoutClass of PLACEMENT_LAYOUT_CLASSES) {
    const variant = ensureObject(variants[layoutClass]);
    const outlet = String(variant.outlet || "").trim();
    if (outlet) {
      outlets.add(outlet);
    }
  }
  return sortStrings([...outlets]);
}

function classifyPlacementTarget(placementTarget = {}) {
  const owner = String(placementTarget.owner || "").trim();
  const kinds = collectPlacementRendererKinds(placementTarget);
  const acceptsLinks = kinds.includes(PLACEMENT_KIND_LINK);
  const acceptsComponents = kinds.includes(PLACEMENT_KIND_COMPONENT);

  if (acceptsLinks && acceptsComponents) {
    return owner ? "ownerMixed" : "mixed";
  }
  if (acceptsLinks) {
    return owner ? "ownerLinks" : "links";
  }
  return owner ? "ownerComponents" : "components";
}

function createConcreteTargetSourcePathMap(concreteTargets = []) {
  const sourcePathByTarget = new Map();
  for (const concreteTarget of ensureArray(concreteTargets)) {
    const target = String(ensureObject(concreteTarget).id || "").trim();
    const sourcePath = String(ensureObject(concreteTarget).sourcePath || "").trim();
    if (target && sourcePath && !sourcePathByTarget.has(target)) {
      sourcePathByTarget.set(target, sourcePath);
    }
  }
  return sourcePathByTarget;
}

function resolveChildPagePatternFromHostSourcePath(sourcePath = "") {
  const normalizedPath = String(sourcePath || "").replaceAll("\\", "/").trim();
  if (!normalizedPath.startsWith("src/pages/")) {
    return "";
  }
  const pagePath = normalizedPath.slice("src/pages/".length);
  if (pagePath.endsWith("/index.vue")) {
    const hostPath = pagePath.slice(0, -"/index.vue".length);
    return hostPath ? `${hostPath}/<page>/index.vue` : "<page>/index.vue";
  }
  if (pagePath.endsWith(".vue")) {
    const hostPath = pagePath.slice(0, -".vue".length);
    return hostPath ? `${hostPath}/<page>/index.vue` : "<page>/index.vue";
  }
  return "";
}

function resolveOwnerScopedChildPagePattern(placementTarget = {}, concreteSourcePathByTarget = new Map()) {
  const outlets = collectPlacementConcreteOutlets(placementTarget);
  for (const outlet of outlets) {
    const childPagePattern = resolveChildPagePatternFromHostSourcePath(
      concreteSourcePathByTarget.get(outlet) || ""
    );
    if (childPagePattern) {
      return childPagePattern;
    }
  }
  return "";
}

function createPlacementTargetSummary(placementTarget = {}, color, { concreteSourcePathByTarget = new Map() } = {}) {
  const placementId = String(placementTarget.id || "").trim();
  const owner = String(placementTarget.owner || "").trim();
  const ownerLabel = owner ? color.dim(` [owner:${owner}]`) : "";
  const defaultLabel = placementTarget.default === true ? color.installed(" (default)") : "";
  const description = String(placementTarget.description || "").trim();
  const childPagePattern = owner
    ? resolveOwnerScopedChildPagePattern(placementTarget, concreteSourcePathByTarget)
    : "";
  const childPagePatternLabel = childPagePattern ? ` -> ${color.dim(childPagePattern)}` : "";
  const descriptionSuffix = description ? `: ${description}` : "";
  return `- ${color.item(placementId)}${ownerLabel}${defaultLabel}${childPagePatternLabel}${descriptionSuffix}`;
}

function appendPlacementLayoutDetails(lines, placementTarget = {}, color) {
  const variants = ensureObject(placementTarget.variants);
  for (const layoutClass of PLACEMENT_LAYOUT_CLASSES) {
    const variant = ensureObject(variants[layoutClass]);
    const outlet = String(variant.outlet || "").trim();
    if (outlet) {
      lines.push(`  ${layoutClass} -> ${color.dim(outlet)}`);
    }
  }
}

function formatPlacementGuidanceLine(line = "", color) {
  const guidanceLine = String(line || "").trim();
  const labelMatch = /^([^:]+):\s*(.*)$/u.exec(guidanceLine);
  if (!labelMatch) {
    return `  ${color.dim(guidanceLine)}`;
  }
  const label = String(labelMatch[1] || "").trim();
  const value = String(labelMatch[2] || "").trim();
  const renderedLabel = color.installed(`${label}:`);
  const renderedValue = value ? ` ${color.provider(value)}` : "";
  return `  ${renderedLabel}${renderedValue}`;
}

function appendPlacementGroup(lines, {
  color,
  title = "",
  description = "",
  guidance = [],
  targets = [],
  concreteSourcePathByTarget = new Map(),
  showLayoutDetails = false
} = {}) {
  const placementTargets = ensureArray(targets);
  if (placementTargets.length < 1) {
    return;
  }
  if (lines.length > 1) {
    lines.push("");
  }
  lines.push(color.heading(title));
  if (description) {
    lines.push(description);
  }
  const guidanceLines = ensureArray(guidance).map((value) => String(value || "").trim()).filter(Boolean);
  for (const guidanceLine of guidanceLines) {
    lines.push(formatPlacementGuidanceLine(guidanceLine, color));
  }
  for (const placementTarget of placementTargets) {
    lines.push(createPlacementTargetSummary(placementTarget, color, { concreteSourcePathByTarget }));
    if (showLayoutDetails) {
      appendPlacementLayoutDetails(lines, placementTarget, color);
    }
  }
}

function appendSemanticPlacementGroups(lines, {
  color,
  semanticPlacements = [],
  concreteTargets = [],
  hostPathLookupError = null,
  showLayoutDetails = false
} = {}) {
  const concreteSourcePathByTarget = createConcreteTargetSourcePathMap(concreteTargets);
  const groupedTargets = {
    links: [],
    ownerLinks: [],
    components: [],
    ownerComponents: [],
    mixed: [],
    ownerMixed: []
  };

  for (const placementTarget of ensureArray(semanticPlacements)) {
    const groupKey = classifyPlacementTarget(placementTarget);
    if (groupedTargets[groupKey]) {
      groupedTargets[groupKey].push(placementTarget);
    }
  }

  appendPlacementGroup(lines, {
    color,
    title: "Navigation link placements",
    guidance: [
      'Format: npx jskit generate ui-generator page <page-file> --name "Label" --link-placement <placement>',
      'Example: npx jskit generate ui-generator page admin/reports/index.vue --name "Reports" --link-placement admin.tools-menu'
    ],
    targets: groupedTargets.links,
    concreteSourcePathByTarget,
    showLayoutDetails
  });

  appendPlacementGroup(lines, {
    color,
    title: "Owner-scoped navigation link placements",
    guidance: [
      'Format: npx jskit generate ui-generator page <host-path>/<page>/index.vue --name "Label"',
      'Example: npx jskit generate ui-generator page home/settings/profile/index.vue --name "Profile"',
      hostPathLookupError
        ? `Host path lookup failed: ${String(hostPathLookupError?.message || hostPathLookupError).trim()}`
        : ""
    ],
    targets: groupedTargets.ownerLinks,
    concreteSourcePathByTarget,
    showLayoutDetails
  });

  appendPlacementGroup(lines, {
    color,
    title: "Component, widget, and section placements",
    guidance: [
      'Format: npx jskit generate ui-generator placed-element --name "Widget Name" --placement <placement>',
      'Example: npx jskit generate ui-generator placed-element --name "Connection Status" --placement shell.status'
    ],
    targets: groupedTargets.components,
    concreteSourcePathByTarget,
    showLayoutDetails
  });

  appendPlacementGroup(lines, {
    color,
    title: "Owner-scoped component and section placements",
    guidance: [
      'Format: npx jskit generate ui-generator placed-element --name "Section Name" --placement <placement> --owner <owner>',
      'Example: npx jskit generate ui-generator placed-element --name "Security Section" --placement settings.sections --owner account-settings'
    ],
    targets: groupedTargets.ownerComponents,
    concreteSourcePathByTarget,
    showLayoutDetails
  });

  appendPlacementGroup(lines, {
    color,
    title: "Mixed-kind placements",
    description: "These topology entries accept more than one semantic kind. Choose the generator by what you are adding.",
    guidance: [
      'Link format: npx jskit generate ui-generator page <page-file> --name "Label" --link-placement <placement>',
      'Component format: npx jskit generate ui-generator placed-element --name "Widget Name" --placement <placement>',
      'Link example: npx jskit generate ui-generator page admin/reports/index.vue --name "Reports" --link-placement <placement>',
      'Component example: npx jskit generate ui-generator placed-element --name "Ops Panel" --placement <placement>'
    ],
    targets: groupedTargets.mixed,
    concreteSourcePathByTarget,
    showLayoutDetails
  });

  appendPlacementGroup(lines, {
    color,
    title: "Owner-scoped mixed-kind placements",
    description: "These owner-scoped entries accept more than one semantic kind. Include the owner when adding manual placement entries.",
    guidance: [
      'Link format: npx jskit generate ui-generator page <host-path>/<page>/index.vue --name "Label"',
      'Component format: npx jskit generate ui-generator placed-element --name "Widget Name" --placement <placement> --owner <owner>',
      'Link example: npx jskit generate ui-generator page home/settings/profile/index.vue --name "Profile"',
      'Component example: npx jskit generate ui-generator placed-element --name "Security Section" --placement <placement> --owner <owner>'
    ],
    targets: groupedTargets.ownerMixed,
    concreteSourcePathByTarget,
    showLayoutDetails
  });
}

async function readFileIfExists(filePath = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const errorCode = String(error?.code || "").trim().toUpperCase();
    if (READ_FILE_IGNORE_ERROR_CODES.has(errorCode)) {
      return "";
    }
    throw error;
  }
}

async function resolveDescriptorFromLockEntry({ appRoot = "", packageId = "", installedPackageEntry = {} } = {}) {
  const source = ensureObject(installedPackageEntry.source);
  const descriptorRelativePath = String(source.descriptorPath || "").trim();
  if (!descriptorRelativePath) {
    return null;
  }

  const descriptorAbsolutePath = path.resolve(appRoot, descriptorRelativePath);
  const descriptorSource = await readFileIfExists(descriptorAbsolutePath);
  if (!descriptorSource) {
    return null;
  }

  let descriptorModule = null;
  try {
    descriptorModule = await importFreshModuleFromAbsolutePath(descriptorAbsolutePath);
  } catch {
    return null;
  }

  const descriptor = ensureObject(descriptorModule?.default);
  if (Object.keys(descriptor).length < 1) {
    return null;
  }

  const resolvedPackageId = String(descriptor.packageId || packageId || "").trim();
  if (!resolvedPackageId) {
    return null;
  }

  return Object.freeze({
    packageId: resolvedPackageId,
    descriptor
  });
}

async function collectProviderSourceFiles(rootPath = "") {
  const files = [];
  const stack = [path.resolve(String(rootPath || ""))];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    let entries = [];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      const errorCode = String(error?.code || "").trim().toUpperCase();
      if (READ_DIRECTORY_IGNORE_ERROR_CODES.has(errorCode)) {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (PROVIDER_SOURCE_EXTENSIONS.has(extension)) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function createListCommands(ctx = {}) {
  const {
    createCliError,
    createColorFormatter,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    resolveInstalledNodeModulePackageEntry,
    discoverPlacementTopologyFromApp,
    discoverShellOutletTargetsFromApp,
    normalizePlacementContributions,
    resolvePackageKind
  } = ctx;

  async function commandList({ positional, options, cwd, stdout }) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();

    const appRoot = await resolveAppRootFromCwd(cwd);
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const { lock } = await loadLockFile(appRoot);
    const installedPackageEntries = ensureObject(lock.installedPackages);
    const installedPackages = new Set(Object.keys(installedPackageEntries));
    const installedUnknownPackageIds = sortStrings(
      [...installedPackages].filter((packageId) => !packageRegistry.has(packageId))
    );
    const installedLocalPackageIds = sortStrings(
      installedUnknownPackageIds.filter((packageId) => {
        const lockEntry = ensureObject(installedPackageEntries[packageId]);
        const sourceType = String(ensureObject(lockEntry.source).type || "").trim();
        return sourceType === "local-package" || sourceType === "app-local-package" || appLocalRegistry.has(packageId);
      })
    );
    const installedExternalPackageIds = sortStrings(
      installedUnknownPackageIds.filter((packageId) => !installedLocalPackageIds.includes(packageId))
    );
    const availableLocalPackageIds = sortStrings(
      [...appLocalRegistry.keys()].filter((packageId) => !installedPackages.has(packageId))
    );

    const mode = String(positional[0] || "").trim();
    const shouldListBundles = !mode || mode === "bundles";
    const shouldListPackages = !mode || mode === "packages";
    const shouldListGenerators = !mode || mode === "generators";
    if (mode === "placements") {
      throw createCliError('list mode "placements" moved to a dedicated command: jskit list-placements.');
    }
    if (mode === "placement-component-tokens") {
      throw createCliError(
        'list mode "placement-component-tokens" moved to a dedicated command: jskit list-component-tokens.'
      );
    }

    if (!shouldListBundles && !shouldListPackages && !shouldListGenerators) {
      throw createCliError(`Unknown list mode: ${mode}`, { showUsage: true });
    }

    const color = createColorFormatter(stdout);
    const lines = [];
    if (shouldListBundles) {
      lines.push(color.heading("Available bundles:"));
      const bundleIds = sortStrings([...bundleRegistry.keys()]);
      for (const bundleId of bundleIds) {
        const bundle = bundleRegistry.get(bundleId);
        const packageIds = ensureArray(bundle.packages).map((value) => String(value));
        const isInstalled = packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId));
        const providerLabel = Number(bundle.provider) === 1 ? " [provider]" : "";
        const installedLabel = isInstalled ? " (installed)" : "";
        lines.push(
          `- ${color.item(bundle.bundleId)} ${color.version(`(${bundle.version})`)}${isInstalled ? color.installed(installedLabel) : installedLabel}${providerLabel ? color.provider(providerLabel) : providerLabel}: ${String(bundle.description || "")}`
        );
        if (options.full || options.expanded) {
          for (const packageId of packageIds) {
            lines.push(`  - ${color.dim(packageId)}`);
          }
        }
      }
    }

    if (shouldListPackages) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(color.heading("Available runtime packages:"));
      const packageIds = sortStrings([...packageRegistry.keys()].filter((packageId) => {
        const packageEntry = packageRegistry.get(packageId);
        return resolvePackageKind(packageEntry) === "runtime";
      }));
      for (const packageId of packageIds) {
        const packageEntry = packageRegistry.get(packageId);
        const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
        lines.push(
          `- ${color.item(packageId)} ${color.version(`(${packageEntry.version})`)}${installedLabel ? color.installed(installedLabel) : ""}`
        );
      }

      if (installedLocalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Installed local packages:"));
        for (const packageId of installedLocalPackageIds) {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          const version = String(lockEntry.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
        }
      }

      if (installedExternalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Installed external packages:"));
        for (const packageId of installedExternalPackageIds) {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          const version = String(lockEntry.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
        }
      }

      if (availableLocalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Available local packages (not installed):"));
        for (const packageId of availableLocalPackageIds) {
          const packageEntry = appLocalRegistry.get(packageId);
          const version = String(packageEntry?.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}`);
        }
      }
    }

    if (shouldListGenerators) {
      if (lines.length > 0) {
        lines.push("");
      }
      const featureServerEntry = packageRegistry.get(FEATURE_SERVER_GENERATOR_PACKAGE_ID);
      const recommendedQuickStarts = resolveGeneratorQuickStartRows(featureServerEntry, { limit: 3 });
      if (recommendedQuickStarts.length > 0) {
        lines.push(color.heading(`Recommended non-CRUD server starts (${recommendedQuickStarts.length}):`));
        for (const example of recommendedQuickStarts) {
          const label = String(example.label || "").trim();
          if (label) {
            lines.push(`- ${color.item(label)}`);
          }
          for (const commandLine of ensureArray(example.lines)) {
            lines.push(`  ${commandLine}`);
          }
        }
        lines.push("");
      }
      lines.push(color.heading("Available generators:"));
      const packageIds = sortStrings([...packageRegistry.keys()].filter((packageId) => {
        const packageEntry = packageRegistry.get(packageId);
        return resolvePackageKind(packageEntry) === "generator";
      }));
      for (const packageId of packageIds) {
        const packageEntry = packageRegistry.get(packageId);
        const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
        const shortId = toShortPackageId(packageId);
        const shortIdPrefix = shortId && shortId !== packageId ? `${color.item(shortId)} ` : "";
        const primarySubcommand = resolveGeneratorPrimarySubcommand(packageEntry);
        const primarySuffix = primarySubcommand ? ` ${color.dim(`[primary:${primarySubcommand}]`)}` : "";
        const description = resolveGeneratorDescription(packageEntry);
        const descriptionSuffix = description ? `: ${description}` : "";
        lines.push(
          `- ${shortIdPrefix}${color.item(packageId)} ${color.version(`(${packageEntry.version})`)}${primarySuffix}${installedLabel ? color.installed(installedLabel) : ""}${descriptionSuffix}`.trim()
        );
      }
    }

    if (options.json) {
      const payload = {
        bundles: shouldListBundles
          ? sortStrings([...bundleRegistry.keys()]).map((bundleId) => {
            const bundle = bundleRegistry.get(bundleId);
            const packageIds = ensureArray(bundle.packages).map((value) => String(value));
            return {
              bundleId: bundle.bundleId,
              version: bundle.version,
              description: bundle.description || "",
              provider: Number(bundle.provider) === 1,
              installed: packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId)),
              packages: packageIds
            };
          })
          : [],
        packages: shouldListPackages
          ? sortStrings([...packageRegistry.keys()])
            .filter((packageId) => resolvePackageKind(packageRegistry.get(packageId)) === "runtime")
            .map((packageId) => {
              const packageEntry = packageRegistry.get(packageId);
              return {
                packageId,
                version: packageEntry.version,
                installed: installedPackages.has(packageId)
              };
            })
          : [],
        runtimePackages: shouldListPackages
          ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
            const packageEntry = packageRegistry.get(packageId);
            if (resolvePackageKind(packageEntry) !== "runtime") {
              return null;
            }
            return {
              packageId,
              version: packageEntry.version,
              installed: installedPackages.has(packageId)
            };
          }).filter(Boolean)
          : [],
        generators: shouldListGenerators
          ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
            const packageEntry = packageRegistry.get(packageId);
            if (resolvePackageKind(packageEntry) !== "generator") {
              return null;
            }
            return {
              packageId,
              shortId: toShortPackageId(packageId),
              version: packageEntry.version,
              installed: installedPackages.has(packageId),
              description: resolveGeneratorDescription(packageEntry),
              primarySubcommand: resolveGeneratorPrimarySubcommand(packageEntry),
              quickStarts: resolveGeneratorQuickStartRows(packageEntry, { limit: 3 })
            };
          }).filter(Boolean)
          : [],
        installedLocalPackages: shouldListPackages
          ? installedLocalPackageIds.map((packageId) => {
            const lockEntry = ensureObject(installedPackageEntries[packageId]);
            return {
              packageId,
              version: String(lockEntry.version || "").trim()
            };
          })
          : [],
        installedExternalPackages: shouldListPackages
          ? installedExternalPackageIds.map((packageId) => {
            const lockEntry = ensureObject(installedPackageEntries[packageId]);
            return {
              packageId,
              version: String(lockEntry.version || "").trim(),
              source: ensureObject(lockEntry.source)
            };
          })
          : [],
        availableLocalPackages: shouldListPackages
          ? availableLocalPackageIds.map((packageId) => {
            const packageEntry = appLocalRegistry.get(packageId);
            return {
              packageId,
              version: String(packageEntry?.version || "").trim(),
              packagePath: normalizeRelativePosixPath(String(packageEntry?.relativeDir || ""))
            };
          })
          : []
      };
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`${lines.join("\n")}\n`);
    }

    return 0;
  }

  async function commandListPlacements({ options, cwd, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const showConcreteOnly = options.concrete === true && options.all !== true;
    const showConcrete = options.concrete === true || options.all === true;
    const showSemantic = showConcreteOnly !== true;
    const showLayoutDetails = options.details === true;
    const shouldLookupHostPaths = showSemantic && options.json !== true;
    const discoveredTopology = await discoverPlacementTopologyFromApp({ appRoot });
    const semanticPlacements = ensureArray(discoveredTopology.placements)
      .map((entry) => ensureObject(entry))
      .filter((entry) => String(entry.id || "").trim())
      .sort((left, right) => {
        const idCompare = String(left.id || "").localeCompare(String(right.id || ""));
        if (idCompare !== 0) {
          return idCompare;
        }
        return String(left.owner || "").localeCompare(String(right.owner || ""));
      });
    let hostPathLookupError = null;
    let discoveredConcrete = { targets: [] };
    if (showConcrete || shouldLookupHostPaths) {
      try {
        discoveredConcrete = await discoverShellOutletTargetsFromApp({
          appRoot,
          sourceRoot: "src"
        });
      } catch (error) {
        if (showConcrete) {
          throw error;
        }
        hostPathLookupError = error;
      }
    }
    const concreteTargets = ensureArray(discoveredConcrete.targets)
      .map((entry) => ensureObject(entry))
      .filter((entry) => String(entry.id || "").trim())
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));

    if (options.json) {
      const payload = {
        placements: showSemantic
          ? semanticPlacements.map((placementTarget) => ({
            target: String(placementTarget.id || "").trim(),
            owner: String(placementTarget.owner || "").trim(),
            default: placementTarget.default === true,
            description: String(placementTarget.description || "").trim(),
            surfaces: ensureArray(placementTarget.surfaces).map((entry) => String(entry || "").trim()).filter(Boolean),
            variants: ensureObject(placementTarget.variants),
            sourcePath: String(placementTarget.sourcePath || "").trim()
          }))
          : [],
        concretePlacements: showConcrete
          ? concreteTargets.map((placementTarget) => ({
            target: String(placementTarget.id || "").trim(),
            default: placementTarget.default === true,
            sourcePath: String(placementTarget.sourcePath || "").trim()
          }))
          : []
      };
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    const color = createColorFormatter(stdout);
    const lines = [];
    if (showSemantic) {
      lines.push(color.heading("Available placements:"));
      lines.push("Semantic placement targets are the stable IDs you should author against. Use --concrete only for low-level ShellOutlet recipients.");
      if (semanticPlacements.length < 1) {
        lines.push("- none");
      } else {
        appendSemanticPlacementGroups(lines, {
          color,
          semanticPlacements,
          concreteTargets,
          hostPathLookupError,
          showLayoutDetails
        });
      }
    }

    if (showConcrete) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(color.heading("Available concrete outlets:"));
      if (concreteTargets.length < 1) {
        lines.push("- none");
      } else {
        for (const placementTarget of concreteTargets) {
          const placementId = String(placementTarget.id || "").trim();
          const sourcePath = String(placementTarget.sourcePath || "").trim();
          const isDefault = placementTarget.default === true;
          const defaultLabel = isDefault ? color.installed(" (default)") : "";
          const sourceLabel = sourcePath ? ` ${color.dim(`[${sourcePath}]`)}` : "";
          lines.push(`- ${color.item(placementId)}${defaultLabel}${sourceLabel}`);
        }
      }
    }

    stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  async function commandListLinkItems({ options, cwd, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const tokenPrefixFilter = String(options?.inlineOptions?.prefix || "").trim();
    const includeAllClientContainerTokens = options?.all === true;
    const onlyLinkItemTokens = !includeAllClientContainerTokens;
    const { lock } = await loadLockFile(appRoot);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const installedPackageEntries = ensureObject(lock.installedPackages);
    const installedPackageIds = sortStrings(Object.keys(installedPackageEntries));

    const packageEntryById = new Map();
    for (const [packageId, packageEntry] of packageRegistry.entries()) {
      packageEntryById.set(packageId, packageEntry);
    }
    for (const [packageId, packageEntry] of appLocalRegistry.entries()) {
      packageEntryById.set(packageId, packageEntry);
    }
    for (const packageId of installedPackageIds) {
      if (packageEntryById.has(packageId)) {
        continue;
      }
      const installedPackageEntry = ensureObject(installedPackageEntries[packageId]);
      const descriptorFromLockEntry = await resolveDescriptorFromLockEntry({
        appRoot,
        packageId,
        installedPackageEntry
      });
      if (descriptorFromLockEntry) {
        packageEntryById.set(packageId, descriptorFromLockEntry);
        packageEntryById.set(descriptorFromLockEntry.packageId, descriptorFromLockEntry);
        continue;
      }
      if (typeof resolveInstalledNodeModulePackageEntry !== "function") {
        continue;
      }
      const resolvedNodeModuleEntry = await resolveInstalledNodeModulePackageEntry({
        appRoot,
        packageId
      });
      if (resolvedNodeModuleEntry) {
        packageEntryById.set(resolvedNodeModuleEntry.packageId, resolvedNodeModuleEntry);
      }
    }

    const tokenSourceByToken = new Map();
    for (const packageId of installedPackageIds) {
      const packageEntry = packageEntryById.get(packageId) || null;
      if (!packageEntry) {
        continue;
      }
      const descriptor = ensureObject(packageEntry.descriptor);
      const metadata = ensureObject(descriptor.metadata);
      const ui = ensureObject(metadata.ui);
      const placements = ensureObject(ui.placements);
      const contributions = normalizePlacementContributions(placements.contributions);
      for (const contribution of contributions) {
        const componentToken = String(contribution.componentToken || "").trim();
        if (!componentToken) {
          continue;
        }
        const contributionSource = String(contribution.source || "").trim();
        const sourceLabel = contributionSource
          ? `package:${packageId}:${contributionSource}`
          : `package:${packageId}:metadata.ui.placements.contributions`;
        appendTokenSource(tokenSourceByToken, componentToken, sourceLabel);
      }

      if (includeAllClientContainerTokens) {
        const apiSummary = ensureObject(metadata.apiSummary);
        const containerTokens = ensureObject(apiSummary.containerTokens);
        const clientTokens = ensureArray(containerTokens.client).map((value) => String(value || "").trim()).filter(Boolean);
        for (const clientToken of clientTokens) {
          appendTokenSource(tokenSourceByToken, clientToken, `package:${packageId}:metadata.apiSummary.containerTokens.client`);
        }
      }
    }

    const placementSourcePath = path.join(appRoot, PLACEMENT_FILE_RELATIVE_PATH);
    const placementSource = await readFileIfExists(placementSourcePath);
    for (const token of collectTokenMatches(placementSource, COMPONENT_TOKEN_PATTERN)) {
      appendTokenSource(tokenSourceByToken, token, `app:${normalizeRelativePosixPath(PLACEMENT_FILE_RELATIVE_PATH)}`);
    }

    const providersRootPath = path.join(appRoot, MAIN_CLIENT_PROVIDERS_RELATIVE_PATH);
    const providerSourceFiles = await collectProviderSourceFiles(providersRootPath);
    for (const providerSourceFile of providerSourceFiles) {
      const providerSource = await readFileIfExists(providerSourceFile);
      if (!providerSource) {
        continue;
      }
      const providerRelativePath = normalizeRelativePosixPath(path.relative(appRoot, providerSourceFile));
      for (const token of collectTokenMatches(providerSource, REGISTER_MAIN_CLIENT_COMPONENT_PATTERN)) {
        appendTokenSource(tokenSourceByToken, token, `app:${providerRelativePath}`);
      }
    }

    const tokens = sortStrings([...tokenSourceByToken.keys()])
      .filter((token) => !tokenPrefixFilter || token.startsWith(tokenPrefixFilter))
      .filter((token) => !onlyLinkItemTokens || isLinkItemToken(token))
      .map((token) => ({
        token,
        sources: sortStrings([...(tokenSourceByToken.get(token) || new Set())])
      }));

    if (options.json) {
      stdout.write(`${JSON.stringify({ placementComponentTokens: tokens }, null, 2)}\n`);
      return 0;
    }

    const color = createColorFormatter(stdout);
    const lines = [color.heading("Available placement component tokens:")];
    lines.push(
      color.dim(
        includeAllClientContainerTokens
          ? "Showing all discovered tokens (--all), including non-link-item/container/runtime tokens."
          : 'Showing link-item tokens only (token must end with "link-item"). Tip: use --all for full token list.'
      )
    );
    if (tokens.length < 1) {
      lines.push("- none");
    } else {
      for (const entry of tokens) {
        const token = String(entry.token || "").trim();
        const sources = ensureArray(entry.sources).map((value) => String(value || "").trim()).filter(Boolean);
        const sourceLabel = sources.length > 0 ? ` ${color.dim(`[${sources.join(", ")}]`)}` : "";
        lines.push(`- ${color.item(token)}${sourceLabel}`);
      }
    }

    stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  return {
    commandList,
    commandListPlacements,
    commandListLinkItems
  };
}

export { createListCommands };
