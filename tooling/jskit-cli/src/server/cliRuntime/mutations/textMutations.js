import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import {
  appendTextSnippet,
  interpolateOptionValue,
  normalizeSkipChecks
} from "../../shared/optionInterpolation.js";
import {
  normalizeFileMutationRecord,
  normalizeMutationWhen,
  shouldApplyMutationWhen
} from "../mutationWhen.js";
import {
  loadMutationWhenConfigContext,
  normalizeRelativePath,
  readFileBufferIfExists
} from "../ioAndMigrations.js";
import { upsertEnvValue } from "../appState.js";
import {
  applyTemplateContextReplacements,
  resolveTemplateContextReplacementsForMutation
} from "./templateContext.js";
import { normalizeMutationRelativeFilePath } from "./mutationPathUtils.js";

const SETTINGS_FIELDS_CONTRACT_TARGETS = Object.freeze({
  "packages/main/src/shared/resources/consoleSettingsFields.js": Object.freeze({
    contractId: "console.settings-fields.v1",
    marker: "@jskit-contract console.settings-fields.v1",
    requiredSnippets: Object.freeze([
      "defineField",
      "resetConsoleSettingsFields"
    ])
  }),
  "packages/main/src/shared/resources/workspaceSettingsFields.js": Object.freeze({
    contractId: "users.settings-fields.workspace.v1",
    marker: "@jskit-contract users.settings-fields.workspace.v1",
    requiredSnippets: Object.freeze([
      "defineField",
      "resetWorkspaceSettingsFields"
    ])
  })
});
const PRE_FILE_CONFIG_MUTATION_TARGETS = new Set([
  "config/public.js",
  "config/server.js"
]);

function resolveSettingsFieldsContractTarget(relativeFile = "") {
  const normalizedRelativeFile = normalizeMutationRelativeFilePath(relativeFile);
  if (!normalizedRelativeFile) {
    return null;
  }
  const target = SETTINGS_FIELDS_CONTRACT_TARGETS[normalizedRelativeFile];
  if (!target) {
    return null;
  }
  return {
    normalizedRelativeFile,
    target
  };
}

async function validateSettingsFieldsContractMutationTarget({
  appRoot,
  relativeFile,
  packageId
} = {}) {
  const contractTarget = resolveSettingsFieldsContractTarget(relativeFile);
  if (!contractTarget) {
    return;
  }

  const { normalizedRelativeFile, target } = contractTarget;
  const absoluteFile = path.join(appRoot, normalizedRelativeFile);
  const existing = await readFileBufferIfExists(absoluteFile);
  if (!existing.exists) {
    throw createCliError(
      `Invalid append-text mutation in ${packageId}: ${normalizedRelativeFile} is missing. ` +
      `Install @jskit-ai/console-core to scaffold ${target.contractId}.`
    );
  }

  const source = existing.buffer.toString("utf8");
  if (!source.includes(target.marker)) {
    throw createCliError(
      `Invalid append-text mutation in ${packageId}: ${normalizedRelativeFile} is missing contract marker "${target.marker}".`
    );
  }
  for (const snippet of target.requiredSnippets) {
    if (source.includes(snippet)) {
      continue;
    }
    throw createCliError(
      `Invalid append-text mutation in ${packageId}: ${normalizedRelativeFile} must include "${snippet}" for ${target.contractId}.`
    );
  }
}

async function applyTextMutations(packageEntry, appRoot, textMutations, options, managedText, touchedFiles) {
  for (const mutation of textMutations) {
    const when = normalizeMutationWhen(mutation?.when);
    const configContext = when?.config ? await loadMutationWhenConfigContext(appRoot) : {};
    if (
      !shouldApplyMutationWhen(when, {
        options,
        configContext,
        packageId: packageEntry.packageId,
        mutationContext: "text mutation"
      })
    ) {
      continue;
    }

    const operation = String(mutation?.op || "").trim();
    if (operation === "upsert-env") {
      const relativeFile = String(mutation?.file || "").trim();
      const rawKey = String(mutation?.key || "").trim();
      if (!relativeFile || !rawKey) {
        throw createCliError(`Invalid upsert-env mutation in ${packageEntry.packageId}: "file" and "key" are required.`);
      }

      const resolvedKey = interpolateOptionValue(rawKey, options, packageEntry.packageId, `${rawKey}.key`).trim();
      if (!resolvedKey) {
        throw createCliError(`Invalid upsert-env mutation in ${packageEntry.packageId}: resolved key is empty.`);
      }

      const absoluteFile = path.join(appRoot, relativeFile);
      const previous = await readFileBufferIfExists(absoluteFile);
      const previousContent = previous.exists ? previous.buffer.toString("utf8") : "";
      const resolvedValue = interpolateOptionValue(mutation?.value || "", options, packageEntry.packageId, resolvedKey);
      const upserted = upsertEnvValue(previousContent, resolvedKey, resolvedValue);

      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, upserted.content, "utf8");

      const recordKey = `${relativeFile}::${String(mutation?.id || resolvedKey)}`;
      managedText[recordKey] = {
        file: relativeFile,
        op: "upsert-env",
        key: resolvedKey,
        value: resolvedValue,
        hadPrevious: upserted.hadPrevious,
        previousValue: upserted.previousValue,
        reason: String(mutation?.reason || ""),
        category: String(mutation?.category || ""),
        id: String(mutation?.id || "")
      };
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
      continue;
    }

    if (operation === "append-text") {
      const relativeFile = String(mutation?.file || "").trim();
      const snippet = String(mutation?.value || "");
      const position = String(mutation?.position || "bottom").trim().toLowerCase();
      if (!relativeFile) {
        throw createCliError(`Invalid append-text mutation in ${packageEntry.packageId}: "file" is required.`);
      }
      if (position !== "top" && position !== "bottom") {
        throw createCliError(`Invalid append-text mutation in ${packageEntry.packageId}: "position" must be "top" or "bottom".`);
      }
      await validateSettingsFieldsContractMutationTarget({
        appRoot,
        relativeFile,
        packageId: packageEntry.packageId
      });

      const absoluteFile = path.join(appRoot, relativeFile);
      const previous = await readFileBufferIfExists(absoluteFile);
      const previousContent = previous.exists ? previous.buffer.toString("utf8") : "";
      const mutationId = String(mutation?.id || "").trim() || "append-text";
      const resolvedSnippet = interpolateOptionValue(snippet, options, packageEntry.packageId, mutationId);
      const templateContextReplacements = await resolveTemplateContextReplacementsForMutation({
        packageEntry,
        mutation,
        options,
        appRoot,
        sourcePath: absoluteFile,
        targetPaths: [absoluteFile],
        mutationContext: "text mutation"
      });
      const renderedSnippet = templateContextReplacements
        ? applyTemplateContextReplacements(resolvedSnippet, templateContextReplacements)
        : resolvedSnippet;
      const skipChecks = normalizeSkipChecks(mutation?.skipIfContains)
        .map((entry) => interpolateOptionValue(entry, options, packageEntry.packageId, `${mutationId}.skipIfContains`))
        .map((entry) => {
          if (!templateContextReplacements) {
            return entry;
          }
          return applyTemplateContextReplacements(entry, templateContextReplacements);
        })
        .filter((entry) => String(entry || "").trim().length > 0);

      const shouldSkip = skipChecks.some((pattern) => previousContent.includes(String(pattern)));
      if (shouldSkip) {
        continue;
      }

      const appended = appendTextSnippet(previousContent, renderedSnippet, position);
      if (!appended.changed) {
        continue;
      }

      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, appended.content, "utf8");

      const recordKey = `${relativeFile}::${mutationId}`;
      managedText[recordKey] = {
        file: relativeFile,
        op: "append-text",
        value: renderedSnippet,
        position,
        reason: String(mutation?.reason || ""),
        category: String(mutation?.category || ""),
        id: String(mutation?.id || "")
      };
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
      continue;
    }

    throw createCliError(`Unsupported text mutation op "${operation}" in ${packageEntry.packageId}.`);
  }
}

function isPositioningTextMutation(value = {}) {
  const mutation = ensureObject(value);
  const operation = String(mutation.op || "").trim();
  if (operation !== "append-text") {
    return false;
  }
  return normalizeMutationRelativeFilePath(mutation.file) === "src/placement.js";
}

function isPreFileConfigTextMutation(value = {}) {
  const mutation = ensureObject(value);
  const operation = String(mutation.op || "").trim();
  if (operation !== "append-text") {
    return false;
  }
  return PRE_FILE_CONFIG_MUTATION_TARGETS.has(normalizeMutationRelativeFilePath(mutation.file));
}

function partitionPreFileConfigTextMutations(textMutations = []) {
  const preFileTextMutations = [];
  const postFileTextMutations = [];

  for (const mutation of ensureArray(textMutations)) {
    if (isPreFileConfigTextMutation(mutation)) {
      preFileTextMutations.push(mutation);
      continue;
    }
    postFileTextMutations.push(mutation);
  }

  return {
    preFileTextMutations,
    postFileTextMutations
  };
}

function resolvePositioningMutations(descriptorMutations = {}) {
  const mutations = ensureObject(descriptorMutations);
  const files = ensureArray(mutations.files).filter((mutationValue) => {
    const normalized = normalizeFileMutationRecord(mutationValue);
    return Boolean(normalized.toSurface);
  });
  const text = ensureArray(mutations.text).filter((mutationValue) => isPositioningTextMutation(mutationValue));
  return {
    files,
    text
  };
}

export {
  applyTextMutations,
  partitionPreFileConfigTextMutations,
  resolvePositioningMutations
};
