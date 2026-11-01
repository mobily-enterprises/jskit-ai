// The collaborators the call layer's factories hand each other over one
// loaded call program.

/** @typedef {ReturnType<typeof import("./program.js").loadCallProgram>["fileOf"]} FileOf */
/** @typedef {ReturnType<typeof import("./symbols.js").createSymbols>} CallSymbols */
/** @typedef {ReturnType<typeof import("./evaluate.js").createEvaluator>} CallEvaluator */
/** @typedef {ReturnType<typeof import("./features.js").bindFeatures>} FeatureBindings */

export {};
