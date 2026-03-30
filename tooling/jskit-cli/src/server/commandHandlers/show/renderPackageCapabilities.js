import { ensureArray } from "../../shared/collectionUtils.js";

function writeCapabilitiesSections({
  payload,
  provides,
  requires,
  capabilityDetails,
  stdout,
  color,
  wrapWidth,
  writeWrappedItems
} = {}) {
  if (provides.length > 0 || requires.length > 0) {
    stdout.write(`${color.heading("Capabilities:")}\n`);
    if (provides.length > 0) {
      const providesText = provides.map((capabilityId) => color.item(capabilityId)).join(" ");
      stdout.write(`${color.installed("Provides:")} ${providesText}\n`);
    }
    if (requires.length > 0) {
      const requiresText = requires.map((capabilityId) => color.item(capabilityId)).join(" ");
      stdout.write(`${color.installed("Requires:")} ${requiresText}\n`);
    }
  }

  if (!capabilityDetails || (capabilityDetails.provides.length < 1 && capabilityDetails.requires.length < 1)) {
    return;
  }

  stdout.write(`${color.heading("Capability details:")}\n`);
  writeCapabilityRecord({
    heading: `Provides detail (${capabilityDetails.provides.length}):`,
    records: capabilityDetails.provides,
    includeDependsOnProviders: false,
    stdout,
    color,
    wrapWidth,
    writeWrappedItems
  });
  writeCapabilityRecord({
    heading: `Requires detail (${capabilityDetails.requires.length}):`,
    records: capabilityDetails.requires,
    includeDependsOnProviders: true,
    stdout,
    color,
    wrapWidth,
    writeWrappedItems
  });
}

function writeCapabilityRecord({
  heading,
  records,
  includeDependsOnProviders = false,
  stdout,
  color,
  wrapWidth,
  writeWrappedItems
} = {}) {
  if (records.length < 1) {
    return;
  }
  stdout.write(`${color.heading(heading)}\n`);
  for (const record of records) {
    const capabilityId = String(record.capabilityId || "").trim();
    stdout.write(`- ${color.item(capabilityId)}\n`);

    const providerItems = ensureArray(record.providerDetails).map((detail) => ({
      text: formatPackageSummary(detail),
      rendered: color.item(formatPackageSummary(detail))
    }));
    if (providerItems.length > 0) {
      writeWrappedItems({
        stdout,
        heading: `  ${color.installed(`providers (${providerItems.length}):`)}`,
        lineIndent: "    ",
        wrapWidth,
        items: providerItems
      });
    }

    if (includeDependsOnProviders) {
      const providersInDependsOn = ensureArray(record.providersInDependsOn).map((packageId) => ({
        text: String(packageId),
        rendered: color.item(String(packageId))
      }));
      if (providersInDependsOn.length > 0) {
        writeWrappedItems({
          stdout,
          heading: `  ${color.installed(`providers in dependsOn (${providersInDependsOn.length}):`)}`,
          lineIndent: "    ",
          wrapWidth,
          items: providersInDependsOn
        });
      }
    }

    const requirerItems = ensureArray(record.requirerDetails).map((detail) => ({
      text: formatPackageSummary(detail),
      rendered: color.item(formatPackageSummary(detail))
    }));
    if (requirerItems.length > 0) {
      writeWrappedItems({
        stdout,
        heading: `  ${color.installed(`required by (${requirerItems.length}):`)}`,
        lineIndent: "    ",
        wrapWidth,
        items: requirerItems
      });
    }
  }
}

function formatPackageSummary(detail) {
  const packageId = String(detail?.packageId || "").trim();
  const version = String(detail?.version || "").trim();
  const descriptorPath = String(detail?.descriptorPath || "").trim();
  const versionSuffix = version ? `@${version}` : "";
  const pathSuffix = descriptorPath ? ` [${descriptorPath}]` : "";
  return `${packageId}${versionSuffix}${pathSuffix}`;
}

export {
  writeCapabilitiesSections
};
