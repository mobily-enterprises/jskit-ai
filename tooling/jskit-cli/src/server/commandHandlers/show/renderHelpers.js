import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";

function createShowRenderHelpers({
  stdout,
  color,
  options,
  deriveProviderDisplayName
} = {}) {
  const writeField = (label, value, formatValue = (raw) => raw) => {
    stdout.write(`${color.dim(`${label}:`)} ${formatValue(String(value || ""))}\n`);
  };

  const writeBindingsSection = (side, bindings) => {
    const sectionSide = String(side || "").trim().toLowerCase();
    const bindingEntries = ensureArray(bindings);
    stdout.write(`${color.heading(`Container bindings ${sectionSide} (${bindingEntries.length}):`)}\n`);
    if (bindingEntries.length < 1) {
      stdout.write(`- ${color.dim("none detected")}\n`);
      return;
    }

    for (const bindingRecord of bindingEntries) {
      const binding = ensureObject(bindingRecord);
      const token = String(binding.token || "").trim();
      const tokenExpression = String(binding.tokenExpression || "").trim();
      const tokenLabel = binding.tokenResolved === true
        ? token
        : token || tokenExpression;
      const bindingMethod = String(binding.binding || "").trim();
      const providerName = deriveProviderDisplayName(binding);
      const lifecycle = String(binding.lifecycle || "").trim();
      const lifecycleSuffix = lifecycle && lifecycle !== "unknown" ? ` ${color.dim(`(${lifecycle})`)}` : "";
      const unresolvedSuffix = binding.tokenResolved === true ? "" : color.dim(" [unresolved token]");
      stdout.write(
        `- ${color.item(tokenLabel)} ${color.installed(`[${bindingMethod}]`)} ${color.dim("by")} ${color.item(providerName)}${lifecycleSuffix}${unresolvedSuffix}\n`
      );
      if (options.details) {
        const location = String(binding.location || "").trim();
        if (location) {
          stdout.write(`  ${color.dim(`source: ${location}`)}\n`);
        }
        const providerLabel = String(binding.provider || "").trim();
        if (providerLabel) {
          stdout.write(`  ${color.dim(`provider: ${providerLabel}`)}\n`);
        }
        if (binding.tokenResolved !== true && tokenExpression) {
          stdout.write(`  ${color.dim(`token expression: ${tokenExpression}`)}\n`);
        }
      }
    }
  };

  const writeRuntimeProviders = (side, providers) => {
    const sectionSide = String(side || "").trim().toLowerCase();
    const providerEntries = ensureArray(providers);
    if (providerEntries.length < 1) {
      return;
    }

    stdout.write(`${color.heading(`Runtime ${sectionSide} providers (${providerEntries.length}):`)}\n`);
    for (const provider of providerEntries) {
      const record = ensureObject(provider);
      const entrypoint = String(record.entrypoint || "").trim();
      const exportName = String(record.export || "").trim();
      const label = exportName ? `${entrypoint}#${exportName}` : entrypoint;
      stdout.write(`- ${color.item(label)}\n`);
    }
  };

  return {
    writeBindingsSection,
    writeField,
    writeRuntimeProviders
  };
}

export {
  createShowRenderHelpers
};
