const policies = Object.freeze({
  // Codex's deletion transaction locks writers and rejects rollout references
  // outside the deletion family, including another live fork.
  codex: Object.freeze({ requiresWriterExclusion: false }),
  claude: Object.freeze({
    requiresWriterExclusion: true,
    allowsManagedServer: false,
    matchesProcess: ({ executable, commandLine }) =>
      /(?:^|[\0/])claude(?:\0|$)|@anthropic-ai\/claude-code\//u.test(`${executable || ""}\0${commandLine}`)
  }),
  opencode: Object.freeze({
    requiresWriterExclusion: true,
    allowsManagedServer: true,
    matchesProcess: ({ executable, commandLine }) =>
      /(?:^|[\0/])opencode(?:\0|$)/u.test(`${executable || ""}\0${commandLine}`)
  })
});

/** The host owns process inventory, identity proof and the exclusion lock. */
export function nativeConversationStoragePolicy(engineId) {
  if (!Object.hasOwn(policies, engineId)) throw new TypeError("Unsupported native storage writer owner.");
  return policies[engineId];
}
