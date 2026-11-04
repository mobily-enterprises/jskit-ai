// The values connectors-web's client hands out and receives across files.

/**
 * The configuration the fields edit: integrations and registrations by id.
 * @typedef {object} IntegrationConfiguration
 * @property {Record<string, Record<string, any>>} integrations
 * @property {Record<string, Record<string, any>>} registrations
 */

/**
 * What `useIntegrationConfiguration()` reads from the fields component's props.
 * @typedef {object} IntegrationConfigurationProps
 * @property {IntegrationConfiguration} modelValue
 * @property {string} integrationId
 * @property {Record<string, any>} provider The provider's public definition.
 */

/** @typedef {ReturnType<typeof import("./useIntegrationConfiguration.js").useIntegrationConfiguration>} IntegrationConfigurationEditor */

export {};
