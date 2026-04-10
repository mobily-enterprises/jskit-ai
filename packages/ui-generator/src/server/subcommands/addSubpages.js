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
  resolveOutletTargetId,
  rejectUnexpectedOptions
} from "./support.js";

function resolveSubpagesOutletTarget(options = {}, pageTarget = {}) {
  const rawTarget = normalizeText(options?.target);
  return resolveOutletTargetId(rawTarget || deriveDefaultSubpagesHost(pageTarget), {
    context: "ui-generator add-subpages",
    optionName: "target",
    defaultPosition: DEFAULT_SUBPAGES_POSITION
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
