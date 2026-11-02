// The types of the `feature.availability-engine` and `feature.invoice-rollup`
// capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./orchestratorService.js").createAvailabilityEngine>} AvailabilityEngine */
/** @typedef {ReturnType<typeof import("./customKnexRepository.js").createInvoiceRollup>} InvoiceRollup */

export {};
