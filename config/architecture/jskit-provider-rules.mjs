export const JSKIT_PROVIDER_ARCHITECTURE_RULES = Object.freeze({
  modelId: "jskit-provider-runtime-v1",
  nonNegotiables: Object.freeze([
    "No silent fallbacks for missing providers or bindings.",
    "Route registration must occur in provider boot() only.",
    "Knex access must remain repository-only.",
    "Controllers must not contain business orchestration logic.",
    "No duplicated generic helper logic across packages.",
    "Deterministic provider load and shutdown order is required."
  ]),
  layerBoundaries: Object.freeze({
    controllers: "HTTP request/response adaptation only",
    services: "Use-case orchestration and domain coordination",
    repositories: "All Knex persistence access",
    providers: "Runtime wiring only (register/boot/shutdown)",
    commands: "Governed write/query execution handlers"
  }),
  prohibitedPatterns: Object.freeze([
    "Service locator usage from domain functions",
    "Route registration from non-provider modules",
    "Direct database queries from controllers",
    "Implicit runtime fallbacks that hide contract errors"
  ])
});

export default JSKIT_PROVIDER_ARCHITECTURE_RULES;
