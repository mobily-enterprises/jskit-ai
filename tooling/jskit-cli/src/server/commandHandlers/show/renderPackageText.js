import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import { createShowRenderHelpers } from "./renderHelpers.js";
import { writePackageExportsSection } from "./renderPackageExports.js";
import { writeCapabilitiesSections } from "./renderPackageCapabilities.js";

function resolveGeneratorSubcommandRows(payload = {}) {
  const metadata = ensureObject(payload.metadata);
  const generatorSubcommands = ensureObject(metadata.generatorSubcommands);
  const primarySubcommand = String(metadata.generatorPrimarySubcommand || "").trim();
  return Object.keys(generatorSubcommands)
    .sort((left, right) => left.localeCompare(right))
    .map((subcommandName) => {
      const definition = ensureObject(generatorSubcommands[subcommandName]);
      return {
        name: subcommandName,
        primary: primarySubcommand === subcommandName,
        description: String(definition.description || "").trim(),
        examples: ensureArray(definition.examples)
          .map((example) => {
            const record = ensureObject(example);
            return {
              label: String(record.label || "").trim(),
              lines: ensureArray(record.lines).map((value) => String(value || "").trim()).filter(Boolean)
            };
          })
          .filter((example) => example.lines.length > 0)
      };
    });
}

function resolveOwnershipGuidance(payload = {}) {
  return ensureObject(ensureObject(ensureObject(payload.metadata).jskit).ownershipGuidance);
}

function renderPackagePayloadText({
  payload,
  provides,
  requires,
  capabilityDetails,
  options,
  stdout,
  color,
  resolveWrapWidth,
  writeWrappedItems,
  normalizeRelativePosixPath,
  formatPackageSubpathImport,
  normalizePlacementOutlets,
  normalizePlacementContributions,
  shouldShowPackageExportTarget,
  classifyExportedSymbols,
  deriveProviderDisplayName
} = {}) {
  const wrapWidth = resolveWrapWidth(stdout, 80);
  const {
    writeBindingsSection,
    writeField,
    writeRuntimeProviders
  } = createShowRenderHelpers({
    stdout,
    color,
    options,
    deriveProviderDisplayName
  });

  const runtimeMutations = ensureObject(ensureObject(payload.mutations).dependencies).runtime || {};
  const devMutations = ensureObject(ensureObject(payload.mutations).dependencies).dev || {};
  const scriptMutations = ensureObject(ensureObject(payload.mutations).packageJson).scripts || {};
  const textMutations = ensureArray(ensureObject(payload.mutations).text);
  const runtimeMutationEntries = Object.entries(ensureObject(runtimeMutations));
  const devMutationEntries = Object.entries(ensureObject(devMutations));
  const scriptMutationEntries = Object.entries(ensureObject(scriptMutations));

  const introspection = ensureObject(payload.introspection);
  const introspectionAvailable = introspection.available === true;
  const introspectionNotes = ensureArray(introspection.notes)
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const metadataApiSummary = ensureObject(ensureObject(payload.metadata).apiSummary);
  const metadataUi = ensureObject(ensureObject(payload.metadata).ui);
  const summarySurfaces = ensureArray(metadataApiSummary.surfaces)
    .map((entry) => {
      const record = ensureObject(entry);
      return {
        subpath: String(record.subpath || "").trim(),
        summary: String(record.summary || "").trim()
      };
    })
    .filter((entry) => entry.subpath && entry.summary);
  const containerTokenSummary = ensureObject(metadataApiSummary.containerTokens);
  const quickServerTokens = ensureArray(containerTokenSummary.server).map((value) => String(value || "").trim()).filter(Boolean);
  const quickClientTokens = ensureArray(containerTokenSummary.client).map((value) => String(value || "").trim()).filter(Boolean);
  const metadataUiPlacements = ensureObject(metadataUi.placements);
  const placementOutlets = normalizePlacementOutlets(metadataUiPlacements.outlets);
  const placementContributions = normalizePlacementContributions(metadataUiPlacements.contributions);
  const bindingSections = ensureObject(payload.containerBindings);
  const serverBindings = ensureArray(bindingSections.server);
  const clientBindings = ensureArray(bindingSections.client);
  const generatorSubcommands = resolveGeneratorSubcommandRows(payload);
  const ownershipGuidance = resolveOwnershipGuidance(payload);

  stdout.write(`${color.heading("Information")}\n`);
  writeField("Package", payload.packageId, color.item);
  writeField("Version", payload.version, color.installed);
  if (payload.description) {
    writeField("Description", payload.description);
  }
  writeField("Descriptor", payload.descriptorPath, color.dim);

  if (summarySurfaces.length > 0) {
    stdout.write(`${color.heading("Summary:")}\n`);
    for (const summaryEntry of summarySurfaces) {
      const importPath = formatPackageSubpathImport(payload.packageId, summaryEntry.subpath);
      stdout.write(`- ${color.item(`${importPath}:`)}\n`);
      stdout.write(`  ${summaryEntry.summary}\n`);
    }
  }

  if (quickServerTokens.length > 0 || quickClientTokens.length > 0) {
    stdout.write(`${color.heading("Container tokens")} ${color.dim("-- app.make('...'):")}\n`);
    if (quickServerTokens.length > 0) {
      stdout.write(`- ${color.installed("server")}: ${quickServerTokens.map((token) => color.item(token)).join(", ")}\n`);
    }
    if (quickClientTokens.length > 0) {
      stdout.write(`- ${color.installed("client")}: ${quickClientTokens.map((token) => color.item(token)).join(", ")}\n`);
    }
  }

  if (generatorSubcommands.length > 0) {
    stdout.write(`${color.heading(`Generator commands (${generatorSubcommands.length}):`)}\n`);
    for (const subcommand of generatorSubcommands) {
      const primarySuffix = subcommand.primary ? ` ${color.installed("[primary]")}` : "";
      const descriptionSuffix = subcommand.description ? `: ${subcommand.description}` : "";
      stdout.write(`- ${color.item(subcommand.name)}${primarySuffix}${descriptionSuffix}\n`);
      if (options.details && subcommand.examples.length > 0) {
        for (const example of subcommand.examples.slice(0, 2)) {
          const exampleLabel = String(example.label || "").trim();
          if (exampleLabel) {
            stdout.write(`  ${color.dim(`example: ${exampleLabel}`)}\n`);
          }
          for (const commandLine of ensureArray(example.lines)) {
            stdout.write(`  ${commandLine}\n`);
          }
        }
      }
    }
  }

  if (options.details && Object.keys(ownershipGuidance).length > 0) {
    const title = String(ownershipGuidance.title || "Ownership guidance").trim() || "Ownership guidance";
    const summary = String(ownershipGuidance.summary || "").trim();
    const responsibilities = ensureArray(ownershipGuidance.responsibilities)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const examples = ensureArray(ownershipGuidance.examples)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    stdout.write(`${color.heading(title)}\n`);
    if (summary) {
      stdout.write(`- ${summary}\n`);
    }
    for (const responsibility of responsibilities) {
      stdout.write(`- ${responsibility}\n`);
    }
    if (examples.length > 0) {
      stdout.write(`- ${color.dim("quick starts:")}\n`);
      for (const example of examples) {
        stdout.write(`  ${example}\n`);
      }
    }
  }

  if (placementOutlets.length > 0) {
    stdout.write(`${color.heading(`Placement outlets (${placementOutlets.length}):`)}\n`);
    for (const outlet of placementOutlets) {
      const surfaces = ensureArray(outlet.surfaces).map((value) => String(value || "").trim()).filter(Boolean);
      const surfacesLabel = surfaces.length > 0 ? ` ${color.installed(`[surfaces:${surfaces.join(", ")}]`)}` : "";
      const description = String(outlet.description || "").trim();
      const descriptionSuffix = description ? `: ${description}` : "";
      stdout.write(`- ${color.item(outlet.target)}${surfacesLabel}${descriptionSuffix}\n`);
      if (options.details) {
        const sourceLabel = String(outlet.source || "").trim();
        if (sourceLabel) {
          stdout.write(`  ${color.dim(`source: ${sourceLabel}`)}\n`);
        }
      }
    }
  }

  if (placementContributions.length > 0) {
    stdout.write(`${color.heading(`Placement contributions (default entries) (${placementContributions.length}):`)}\n`);
    for (const contribution of placementContributions) {
      const surfaces = ensureArray(contribution.surfaces).map((value) => String(value || "").trim()).filter(Boolean);
      const surfacesLabel = surfaces.length > 0 ? surfaces.join(", ") : "*";
      const orderSuffix = Number.isFinite(contribution.order) ? ` ${color.installed(`[order:${contribution.order}]`)}` : "";
      const componentToken = String(contribution.componentToken || "").trim();
      const componentSuffix = componentToken ? ` ${color.dim(`component:${componentToken}`)}` : "";
      const description = String(contribution.description || "").trim();
      const descriptionSuffix = description ? `: ${description}` : "";
      stdout.write(
        `- ${color.item(contribution.id)} ${color.dim("->")} ${color.item(contribution.target)} ${color.installed(`[surfaces:${surfacesLabel}]`)}${orderSuffix}${componentSuffix}${descriptionSuffix}\n`
      );
      if (options.details) {
        const when = String(contribution.when || "").trim();
        if (when) {
          stdout.write(`  ${color.dim(`when: ${when}`)}\n`);
        }
        const sourceLabel = String(contribution.source || "").trim();
        if (sourceLabel) {
          stdout.write(`  ${color.dim(`source: ${sourceLabel}`)}\n`);
        }
      }
    }
  }

  if (introspectionAvailable) {
    writeBindingsSection("server", serverBindings);
    writeBindingsSection("client", clientBindings);
  }

  writePackageExportsSection({
    payload,
    options,
    stdout,
    color,
    wrapWidth,
    normalizeRelativePosixPath,
    shouldShowPackageExportTarget,
    classifyExportedSymbols,
    writeWrappedItems
  });

  if (payload.dependsOn.length > 0) {
    writeWrappedItems({
      stdout,
      heading: `${color.heading("Depends on")} ${color.installed(`(${payload.dependsOn.length})`)}:`,
      wrapWidth,
      items: payload.dependsOn.map((dependencyId) => {
        const text = String(dependencyId);
        return {
          text,
          rendered: color.item(text)
        };
      })
    });
  }

  if (runtimeMutationEntries.length > 0) {
    writeWrappedItems({
      stdout,
      heading: color.heading(`Dependency mutations runtime (${runtimeMutationEntries.length}):`),
      wrapWidth,
      items: runtimeMutationEntries.map(([dependencyId, versionSpec]) => {
        const dependencyText = String(dependencyId);
        const versionText = String(versionSpec);
        return {
          text: `${dependencyText} ${versionText}`,
          rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
        };
      })
    });
  }

  writeCapabilitiesSections({
    payload,
    provides,
    requires,
    capabilityDetails,
    stdout,
    color,
    wrapWidth,
    writeWrappedItems
  });

  const uiRoutes = ensureArray(ensureObject(payload.metadata.ui).routes);
  if (uiRoutes.length > 0) {
    stdout.write(`${color.heading(`UI routes (${uiRoutes.length}):`)}\n`);
    for (const route of uiRoutes) {
      const record = ensureObject(route);
      const routePath = String(record.path || "").trim();
      const scope = String(record.scope || "").trim();
      const routeId = String(record.id || record.name || "").trim();
      const purpose = String(record.purpose || "").trim();
      const modeLabel = record.autoRegister === false ? "advisory" : "auto";
      const scopeLabel = scope ? ` (${scope})` : "";
      const modePart = ` ${color.installed(`[${modeLabel}]`)}`;
      const purposePart = purpose ? ` ${purpose}` : "";
      const idPart = routeId ? ` ${color.installed(`(id:${routeId})`)}` : "";
      stdout.write(`- ${color.item(routePath)}${color.installed(scopeLabel)}${modePart}${purposePart}${idPart}\n`);
    }
  }

  const serverRoutes = ensureArray(ensureObject(payload.metadata.server).routes);
  if (serverRoutes.length > 0) {
    stdout.write(`${color.heading(`Server routes (${serverRoutes.length}):`)}\n`);
    for (const route of serverRoutes) {
      const record = ensureObject(route);
      const method = String(record.method || "").trim().toUpperCase();
      const routePath = String(record.path || "").trim();
      const summary = String(record.summary || "").trim();
      const routeLabel = `${method} ${routePath}`.trim();
      const summarySuffix = summary ? `: ${summary}` : "";
      stdout.write(`- ${color.item(routeLabel)}${summarySuffix}\n`);
    }
  }

  const optionNames = Object.keys(ensureObject(payload.options));
  if (optionNames.length > 0) {
    stdout.write(`${color.heading(`Options (${optionNames.length}):`)}\n`);
    for (const optionName of optionNames) {
      const schema = ensureObject(payload.options[optionName]);
      const required = schema.required ? "required" : "optional";
      const defaultSuffix = schema.defaultValue ? ` (default: ${schema.defaultValue})` : "";
      stdout.write(`- ${color.item(optionName)} ${color.installed(`[${required}]`)}${color.dim(defaultSuffix)}\n`);
    }
  }

  if (devMutationEntries.length > 0) {
    writeWrappedItems({
      stdout,
      heading: color.heading(`Dependency mutations dev (${devMutationEntries.length}):`),
      wrapWidth,
      items: devMutationEntries.map(([dependencyId, versionSpec]) => {
        const dependencyText = String(dependencyId);
        const versionText = String(versionSpec);
        return {
          text: `${dependencyText} ${versionText}`,
          rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
        };
      })
    });
  }

  if (scriptMutationEntries.length > 0) {
    stdout.write(`${color.heading(`Script mutations (${scriptMutationEntries.length}):`)}\n`);
    for (const [scriptName, scriptValue] of scriptMutationEntries) {
      stdout.write(`- ${color.item(scriptName)}: ${String(scriptValue)}\n`);
    }
  }

  if (textMutations.length > 0) {
    stdout.write(`${color.heading(`Text mutations (${textMutations.length}):`)}\n`);
    for (const mutation of textMutations) {
      const record = ensureObject(mutation);
      const op = String(record.op || "").trim();
      const file = String(record.file || "").trim();
      const key = String(record.key || "").trim();
      const position = String(record.position || "").trim();
      const reason = String(record.reason || "").trim();
      const reasonSuffix = reason ? `: ${reason}` : "";
      let mutationLabel = `${op} ${file} ${key}`.trim();
      if (op === "append-text") {
        mutationLabel = `${op} ${file}`;
        if (position) {
          mutationLabel = `${mutationLabel} [${position}]`;
        }
      }
      stdout.write(`- ${color.item(mutationLabel)}${reasonSuffix}\n`);
    }
  }

  if (payload.fileWritePlan.fileCount > 0) {
    stdout.write(`${color.heading(`File writes (${payload.fileWritePlan.fileCount}):`)}\n`);
    for (const group of payload.fileWritePlan.groups) {
      const groupId = String(group.id || "").trim();
      const category = String(group.category || "").trim();
      const reason = String(group.reason || "").trim();
      const files = ensureArray(group.files);
      let marker = "";
      if (groupId) {
        marker = `id:${groupId}`;
      } else if (category) {
        marker = `category:${category}`;
      }
      const markerSuffix = marker ? ` (${marker})` : "";
      for (const file of files) {
        const targetPath = String(ensureObject(file).to || "").trim();
        if (!targetPath) {
          continue;
        }
        stdout.write(`- ${color.item(targetPath)}${color.installed(markerSuffix)}:\n`);
        if (reason) {
          stdout.write(`  ${reason}\n`);
        }
      }
    }
  }

  const serverProviders = ensureArray(ensureObject(payload.runtime.server).providers);
  const clientProviders = ensureArray(ensureObject(payload.runtime.client).providers);
  writeRuntimeProviders("server", serverProviders);
  writeRuntimeProviders("client", clientProviders);

  if (introspectionNotes.length > 0) {
    stdout.write(`${color.heading(`Introspection notes (${introspectionNotes.length}):`)}\n`);
    for (const note of introspectionNotes) {
      stdout.write(`- ${color.dim(note)}\n`);
    }
  }
}

export {
  renderPackagePayloadText
};
