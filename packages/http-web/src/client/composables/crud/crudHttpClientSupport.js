import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { getHttpWebClient } from "../../lib/httpClient.js";

const CRUD_API_ACCESS_AUTHENTICATED = "authenticated";
const CRUD_API_ACCESS_PUBLIC = "public";
const CRUD_API_ACCESS_VALUES = Object.freeze([
  CRUD_API_ACCESS_AUTHENTICATED,
  CRUD_API_ACCESS_PUBLIC
]);
const publicCrudClients = new WeakSet();

function normalizeCrudApiAccess(value = "") {
  const normalized = normalizeText(value).toLowerCase() || CRUD_API_ACCESS_AUTHENTICATED;
  if (CRUD_API_ACCESS_VALUES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `CRUD resource apiAccess must be one of: ${CRUD_API_ACCESS_VALUES.join(", ")}. ` +
      `Received: ${String(value || "") || "(empty)"}`
  );
}

function resolveCrudHttpClient(resource = null, { client = null } = {}) {
  const activeClient = client || getHttpWebClient();
  if (!activeClient || typeof activeClient.request !== "function") {
    throw new TypeError("resolveCrudHttpClient requires a client with request().");
  }

  if (normalizeCrudApiAccess(resource?.apiAccess) !== CRUD_API_ACCESS_PUBLIC) {
    return activeClient;
  }
  if (publicCrudClients.has(activeClient)) {
    return activeClient;
  }

  const publicClient = Object.freeze({
    request(url, options = {}) {
      const requestOptions = options && typeof options === "object" && !Array.isArray(options)
        ? options
        : {};
      return activeClient.request(url, {
        ...requestOptions,
        csrf: false
      });
    }
  });
  publicCrudClients.add(publicClient);
  return publicClient;
}

export {
  CRUD_API_ACCESS_AUTHENTICATED,
  CRUD_API_ACCESS_PUBLIC,
  normalizeCrudApiAccess,
  resolveCrudHttpClient
};
