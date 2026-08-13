import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeBoolean, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  buildGeneratedUiNavigationKey,
  buildGeneratedUiNavigationScope,
  inferGeneratedUiDestinationBehavior,
  inferGeneratedUiNavigationRole,
  normalizeGeneratedUiNavigationKey,
  resolveGeneratedUiNavigationFallback
} from "@jskit-ai/kernel/shared/support/generatedUiContract";
import {
  buildUiPageTemplateContext,
  resolveNavigationInferenceRoutePath,
  shouldCreateNavigationLink
} from "../buildTemplateContext.js";
import {
  PLACEMENT_FILE,
  requireSinglePositionalTargetFile,
  rejectUnexpectedOptions,
  resolvePathWithinApp,
  appendBlockIfMarkerMissing
} from "./support.js";
import {
  resolvePageTargetDetails,
  renderPlainPageSource
} from "./pageSupport.js";

function resolveGeneratedPageNavigation({ options = {}, pageTarget = {}, routePath = "" } = {}) {
  const behavior = inferGeneratedUiDestinationBehavior(options, { routePath });
  const explicitDestinationKey = normalizeText(options?.["destination-key"]);
  const explicitMachineryKey = normalizeText(options?.["machinery-key"]);
  if (behavior !== "destination" && explicitDestinationKey) {
    throw new Error("--destination-key requires --destination-behavior destination.");
  }
  if (behavior !== "preserve" && explicitMachineryKey) {
    throw new Error("--machinery-key requires --destination-behavior preserve.");
  }

  const generatedKey = buildGeneratedUiNavigationKey({
    surfaceId: pageTarget.surfaceId,
    routePath
  });
  const fallback = resolveGeneratedUiNavigationFallback(options?.["navigation-fallback"]);
  const scope = buildGeneratedUiNavigationScope({
    surfaceRequiresAuth: pageTarget.surfaceRequiresAuth,
    surfacePagesRoot: pageTarget.surfacePagesRoot,
    routePath
  });
  return Object.freeze({
    behavior,
    ...(behavior === "destination"
      ? {
        destinationKey: explicitDestinationKey
          ? normalizeGeneratedUiNavigationKey(explicitDestinationKey, "destination-key")
          : generatedKey
      }
      : {}),
    ...(behavior === "preserve"
      ? {
        machineryKey: explicitMachineryKey
          ? normalizeGeneratedUiNavigationKey(explicitMachineryKey, "machinery-key")
          : generatedKey
      }
      : {}),
    ...(fallback ? { fallback } : {}),
    scope,
    persistence: {
      mode: behavior === "destination" ? "snapshot" : behavior === "preserve" ? "url-only" : "none"
    }
  });
}

function renderPageLinkPlacementBlock({
  marker = "",
  context = {},
  label = "",
  surface = ""
} = {}) {
  const componentTokenLine = context.__JSKIT_UI_LINK_COMPONENT_TOKEN__
    ? `    componentToken: "${context.__JSKIT_UI_LINK_COMPONENT_TOKEN__}",\n`
    : "";
  return (
    `// ${marker}\n` +
    "{\n" +
    "  addPlacement({\n" +
    `    id: "${context.__JSKIT_UI_LINK_PLACEMENT_ID__}",\n` +
    `    target: "${context.__JSKIT_UI_LINK_PLACEMENT_TARGET__}",\n` +
    `${context.__JSKIT_UI_LINK_OWNER_LINE__}` +
    `    kind: "link",\n` +
    `    surfaces: ["${surface}"],\n` +
    "    order: 155,\n" +
    componentTokenLine +
    "    props: {\n" +
    `      label: "${label}",\n` +
    `      icon: "${context.__JSKIT_UI_LINK_ICON__}",\n` +
    `      surface: "${surface}",\n` +
    `      scopedSuffix: "${context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__}",\n` +
    `      unscopedSuffix: "${context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__}",\n` +
    `${context.__JSKIT_UI_LINK_TO_PROP_LINE__}    },\n` +
    `${String(context.__JSKIT_UI_LINK_WHEN_LINE__ || "")}` +
    "  });\n" +
    "}\n"
  );
}

async function runGeneratorSubcommand({
  appRoot,
  subcommand = "",
  args = [],
  options = {},
  dryRun = false
} = {}) {
  const normalizedSubcommand = normalizeText(subcommand).toLowerCase();
  if (normalizedSubcommand !== "page") {
    throw new Error(`Unsupported ui-generator subcommand: ${normalizedSubcommand || "<empty>"}.`);
  }
  const targetFile = requireSinglePositionalTargetFile(args, { context: "ui-generator page" });
  rejectUnexpectedOptions(
    options,
    [
      "name",
      "navigation-role",
      "destination-behavior",
      "destination-key",
      "machinery-key",
      "navigation-fallback",
      "link-placement",
      "link-to",
      "force"
    ],
    { context: "ui-generator page" }
  );

  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator page"
  });
  const pageLabel = normalizeText(options?.name) || pageTarget.defaultName;
  const forceOverwrite = Object.prototype.hasOwnProperty.call(options, "force")
    ? normalizeBoolean(options.force)
    : false;
  const pageFilePath = pageTarget.targetFilePath.absolutePath;
  const pageRelativePath = pageTarget.targetFilePath.relativePath;
  const navigationInferenceRoutePath = resolveNavigationInferenceRoutePath(pageTarget);
  const navigation = resolveGeneratedPageNavigation({
    options,
    pageTarget,
    routePath: navigationInferenceRoutePath
  });
  const navigationRole = inferGeneratedUiNavigationRole(options, {
    routePath: navigationInferenceRoutePath
  });

  const touchedFiles = new Set();
  let pageAlreadyExisted = true;
  try {
    await readFile(pageFilePath, "utf8");
  } catch {
    pageAlreadyExisted = false;
  }

  if (pageAlreadyExisted && !forceOverwrite) {
    throw new Error(
      `ui-generator page will not overwrite existing page ${pageRelativePath}. Re-run with --force to overwrite it.`
    );
  }

  const shouldCreateLink = shouldCreateNavigationLink(options, {
    routePath: navigationInferenceRoutePath
  });
  const placementContext = shouldCreateLink
    ? await buildUiPageTemplateContext({
      appRoot: pageTarget.appRoot,
      targetFile,
      options
    })
    : null;
  const placementPath = shouldCreateLink
    ? resolvePathWithinApp(pageTarget.appRoot, PLACEMENT_FILE, {
      context: "ui-generator page"
    })
    : null;
  const placementSource = placementPath ? await readFile(placementPath.absolutePath, "utf8") : "";
  const placementMarker = `jskit:ui-generator.page.link:${pageTarget.surfaceId}:${pageTarget.routeUrlSuffix}`;
  const placementApplied = placementContext
    ? appendBlockIfMarkerMissing(
      placementSource,
      placementMarker,
      renderPageLinkPlacementBlock({
        marker: placementMarker,
        context: placementContext,
        label: pageLabel,
        surface: pageTarget.surfaceId
      })
    )
    : { changed: false, content: placementSource };

  if (!pageAlreadyExisted || forceOverwrite) {
    if (dryRun !== true) {
      await mkdir(path.dirname(pageFilePath), { recursive: true });
      await writeFile(
        pageFilePath,
        renderPlainPageSource(pageLabel, {
          surfaceId: pageTarget.surfaceId,
          routePath: navigationInferenceRoutePath,
          navigationRole,
          navigation
        }),
        "utf8"
      );
    }
    touchedFiles.add(pageRelativePath);
  }

  if (placementApplied.changed) {
    if (dryRun !== true) {
      await writeFile(placementPath.absolutePath, placementApplied.content, "utf8");
    }
    touchedFiles.add(placementPath.relativePath);
  }

  const touchedFileList = [...touchedFiles].sort((left, right) => left.localeCompare(right));
  const generationVerb = pageAlreadyExisted ? "Regenerated" : "Generated";
  return {
    placementComponentTokens: [String(placementContext?.__JSKIT_UI_LINK_COMPONENT_TOKEN__ || "").trim()].filter(Boolean),
    navigation,
    navigationRole,
    touchedFiles: touchedFileList,
    summary: `${generationVerb} UI page "${pageTarget.routeUrlSuffix}" at ${pageRelativePath} with ${navigation.behavior} navigation (${navigation.destinationKey || navigation.machineryKey || "ownerless"}).`
  };
}

export { runGeneratorSubcommand };
