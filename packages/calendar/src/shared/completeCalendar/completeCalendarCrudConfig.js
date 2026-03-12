import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudConfigsFromModules } from "@jskit-ai/crud/shared/crud/crudModuleConfig";

function resolveCalendarContactsCrudConfig(appConfig = {}) {
  const source = appConfig && typeof appConfig === "object" && !Array.isArray(appConfig) ? appConfig : {};
  const explicitNamespace = normalizeText(source?.calendar?.contactsNamespace).toLowerCase();
  const crudConfigs = resolveCrudConfigsFromModules(source.modules);

  if (crudConfigs.length < 1) {
    throw new Error('calendar requires at least one config.modules entry with module: "crud".');
  }

  if (explicitNamespace) {
    const explicitConfig = crudConfigs.find((entry) => entry.namespace === explicitNamespace);
    if (!explicitConfig) {
      throw new Error(`calendar could not resolve crud namespace "${explicitNamespace}" from config.modules.`);
    }
    return explicitConfig;
  }

  const defaultCrudConfig = crudConfigs.find((entry) => entry.namespace === "");
  if (defaultCrudConfig) {
    return defaultCrudConfig;
  }

  return [...crudConfigs].sort((left, right) => left.namespace.localeCompare(right.namespace))[0];
}

export { resolveCalendarContactsCrudConfig };
