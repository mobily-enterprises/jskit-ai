// The types of the HTTP client this package's client hands out.

/** @typedef {Parameters<typeof import("../shared/clientRuntime/client.js").createHttpClient>[0]} HttpClientOptions What createHttpClient and createTransientRetryHttpClient receive. */
/** @typedef {ReturnType<typeof import("./transientRetryHttpClient.js").createTransientRetryHttpClient>} TransientRetryHttpClient The client whose requests retry transient failures. */

export {};
