import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCliError } from "../../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import { interpolateOptionValue } from "../../shared/optionInterpolation.js";
import {
  fileExists,
  resolveAppRelativePathWithinRoot
} from "../ioAndMigrations.js";

function interpolateFileMutationRecord(mutation, options, packageId) {
  const mutationKey = String(
    mutation?.id || mutation?.to || mutation?.toSurface || mutation?.from || "files"
  ).trim();
  const interpolate = (value, field) =>
    interpolateOptionValue(String(value || ""), options, packageId, `${mutationKey}.${field}`);

  return {
    ...mutation,
    from: interpolate(mutation.from, "from"),
    to: interpolate(mutation.to, "to"),
    toSurface: interpolate(mutation.toSurface, "toSurface"),
    toSurfacePath: interpolate(mutation.toSurfacePath, "toSurfacePath"),
    toDir: interpolate(mutation.toDir, "toDir"),
    extension: interpolate(mutation.extension, "extension"),
    id: interpolate(mutation.id, "id"),
    category: interpolate(mutation.category, "category"),
    reason: interpolate(mutation.reason, "reason"),
    templateContext: mutation.templateContext
      ? {
          entrypoint: interpolate(mutation.templateContext.entrypoint, "templateContext.entrypoint"),
          export: interpolate(mutation.templateContext.export, "templateContext.export")
        }
      : null
  };
}

function applyTemplateContextReplacements(sourceContent, replacements) {
  let output = String(sourceContent || "");
  for (const [placeholder, value] of Object.entries(ensureObject(replacements))) {
    const normalizedPlaceholder = String(placeholder || "");
    if (!normalizedPlaceholder) {
      continue;
    }
    output = output.split(normalizedPlaceholder).join(String(value == null ? "" : value));
  }
  return output;
}

async function copyTemplateFile(
  sourcePath,
  targetPath,
  options,
  packageId,
  interpolationKey,
  templateContextReplacements = null
) {
  const sourceContent = await readFile(sourcePath, "utf8");
  let renderedContent = sourceContent.includes("${")
    ? interpolateOptionValue(sourceContent, options, packageId, interpolationKey)
    : sourceContent;
  if (templateContextReplacements) {
    renderedContent = applyTemplateContextReplacements(renderedContent, templateContextReplacements);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, renderedContent, "utf8");
}

async function resolveTemplateContextReplacementsForMutation({
  packageEntry,
  mutation,
  options,
  appRoot,
  sourcePath,
  targetPaths,
  mutationContext = "files mutation"
} = {}) {
  const templateContext = ensureObject(mutation?.templateContext);
  const hasTemplateContext = Object.keys(templateContext).length > 0;
  const entrypoint = String(templateContext.entrypoint || "").trim();
  const resolvedMutationContext = String(mutationContext || "files mutation").trim() || "files mutation";
  if (!hasTemplateContext) {
    return null;
  }
  if (!entrypoint) {
    throw createCliError(
      `Invalid ${resolvedMutationContext} in ${packageEntry.packageId}: templateContext.entrypoint is required when templateContext is set.`
    );
  }
  const exportName = String(templateContext.export || "").trim() || "buildTemplateContext";
  const resolvedEntrypointPath = resolveAppRelativePathWithinRoot(
    packageEntry.rootDir,
    entrypoint,
    `${packageEntry.packageId} ${resolvedMutationContext} templateContext.entrypoint`
  );
  const absoluteEntrypointPath = resolvedEntrypointPath.absolutePath;
  if (!(await fileExists(absoluteEntrypointPath))) {
    throw createCliError(
      `Invalid ${resolvedMutationContext} in ${packageEntry.packageId}: templateContext.entrypoint not found at ${entrypoint}.`
    );
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(absoluteEntrypointPath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw createCliError(
      `Unable to load templateContext entrypoint ${entrypoint} for ${packageEntry.packageId}: ${String(error?.message || error || "unknown error")}`
    );
  }

  const resolver = moduleNamespace?.[exportName];
  if (typeof resolver !== "function") {
    throw createCliError(
      `Invalid ${resolvedMutationContext} in ${packageEntry.packageId}: templateContext export "${exportName}" is not a function.`
    );
  }

  let replacements = null;
  try {
    replacements = await resolver({
      packageId: packageEntry.packageId,
      packageRoot: packageEntry.rootDir,
      appRoot,
      options: Object.freeze({ ...ensureObject(options) }),
      mutation: Object.freeze({ ...ensureObject(mutation) }),
      sourcePath,
      targetPaths: Object.freeze([...ensureArray(targetPaths)])
    });
  } catch (error) {
    throw createCliError(
      `templateContext export "${exportName}" failed for ${packageEntry.packageId}: ${String(error?.message || error || "unknown error")}`
    );
  }

  if (replacements == null) {
    return null;
  }
  if (!replacements || typeof replacements !== "object" || Array.isArray(replacements)) {
    throw createCliError(
      `Invalid ${resolvedMutationContext} in ${packageEntry.packageId}: templateContext export "${exportName}" must return an object map of placeholder replacements.`
    );
  }

  const normalizedReplacements = {};
  for (const [placeholder, value] of Object.entries(replacements)) {
    const normalizedPlaceholder = String(placeholder || "").trim();
    if (!normalizedPlaceholder) {
      continue;
    }
    normalizedReplacements[normalizedPlaceholder] = String(value == null ? "" : value);
  }

  return Object.freeze(normalizedReplacements);
}

export {
  applyTemplateContextReplacements,
  copyTemplateFile,
  interpolateFileMutationRecord,
  resolveTemplateContextReplacementsForMutation
};
