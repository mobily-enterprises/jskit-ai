import { buildDefaultRoutes } from "../modules/api/routes.js";

const API_CONTRACTS_START_MARKER = "<!-- API_CONTRACTS_START -->";
const API_CONTRACTS_END_MARKER = "<!-- API_CONTRACTS_END -->";

function createControllerProxy() {
  const noop = () => {};
  return new Proxy(noop, {
    get() {
      return createControllerProxy();
    },
    apply() {
      return undefined;
    }
  });
}

function listApiContractEndpoints() {
  const routes = buildDefaultRoutes(createControllerProxy());
  const seen = new Set();
  const endpoints = [];

  for (const route of routes) {
    const method = String(route?.method || "")
      .trim()
      .toUpperCase();
    const path = String(route?.path || "").trim();
    if (!method || !path) {
      continue;
    }

    const endpoint = `${method} ${path}`;
    if (!seen.has(endpoint)) {
      seen.add(endpoint);
      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function renderApiContractsBlock(endpoints = listApiContractEndpoints()) {
  return [
    API_CONTRACTS_START_MARKER,
    ...endpoints.map((endpoint) => `- \`${endpoint}\``),
    API_CONTRACTS_END_MARKER
  ].join("\n");
}

function updateReadmeApiContracts(readmeContent, endpoints = listApiContractEndpoints()) {
  const source = String(readmeContent || "");
  const startIndex = source.indexOf(API_CONTRACTS_START_MARKER);
  const endIndex = source.indexOf(API_CONTRACTS_END_MARKER);

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error("README API contracts markers not found.");
  }

  const replacement = renderApiContractsBlock(endpoints);
  const afterEndIndex = endIndex + API_CONTRACTS_END_MARKER.length;
  return `${source.slice(0, startIndex)}${replacement}${source.slice(afterEndIndex)}`;
}

export {
  API_CONTRACTS_START_MARKER,
  API_CONTRACTS_END_MARKER,
  listApiContractEndpoints,
  renderApiContractsBlock,
  updateReadmeApiContracts
};
