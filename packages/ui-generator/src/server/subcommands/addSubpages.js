import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_COMPONENT_DIRECTORY,
  DEFAULT_SUBPAGES_POSITION,
  deriveDefaultSubpagesHost,
  resolvePageTargetDetails,
  upgradePageFileToSubpages
} from "./pageSupport.js";
import {
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions
} from "./support.js";

function normalizeExplicitOutletTargetId(value = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  const separatorIndex = normalizedValue.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= normalizedValue.length - 1) {
    return "";
  }

  const host = normalizeText(normalizedValue.slice(0, separatorIndex));
  const position = normalizeText(normalizedValue.slice(separatorIndex + 1));
  if (!host || !position) {
    return "";
  }

  return `${host}:${position}`;
}

function resolveSubpagesOutletTarget(options = {}, pageTarget = {}) {
  const rawTarget = normalizeText(options?.target);
  const targetInput = rawTarget || deriveDefaultSubpagesHost(pageTarget);
  const normalizedTargetId = targetInput.includes(":")
    ? normalizeExplicitOutletTargetId(targetInput)
    : normalizeExplicitOutletTargetId(`${targetInput}:${DEFAULT_SUBPAGES_POSITION}`);
  if (!normalizedTargetId) {
    throw new Error('ui-generator add-subpages option "target" must be "host" or "host:position".');
  }

  const separatorIndex = normalizedTargetId.indexOf(":");
  return Object.freeze({
    id: normalizedTargetId,
    host: normalizedTargetId.slice(0, separatorIndex),
    position: normalizedTargetId.slice(separatorIndex + 1)
  });
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "add-subpages") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator add-subpages" });
  rejectUnexpectedOptions(
    options,
    ["target", "path", "title", "subtitle"],
    { context: "ui-generator add-subpages" }
  );

  const componentDirectory = normalizeText(options?.path) || DEFAULT_COMPONENT_DIRECTORY;
  const title = normalizeText(options?.title);
  const subtitle = normalizeText(options?.subtitle);
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator add-subpages"
  });
  const outletTarget = resolveSubpagesOutletTarget(options, pageTarget);

  const result = await upgradePageFileToSubpages({
    appRoot,
    targetFile,
    host: outletTarget.host,
    position: outletTarget.position,
    title,
    subtitle,
    componentDirectory,
    preserveExistingContent: true,
    dryRun
  });

  return {
    touchedFiles: result.touchedFiles,
    summary:
      result.touchedFiles.length > 0
        ? `Enabled subpages in ${result.targetFile} for "${pageTarget.routeUrlSuffix}" using outlet target "${outletTarget.id}".`
        : `Subpages are already enabled in ${result.targetFile}.`
  };
}

export { runGeneratorSubcommand };
