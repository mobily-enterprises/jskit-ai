function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveScopedServiceOptions(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const { aiServiceOptions = source, aiTranscriptsServiceOptions = source } = source;

  return {
    source,
    aiServiceOptions: isPlainObject(aiServiceOptions) ? aiServiceOptions : source,
    aiTranscriptsServiceOptions: isPlainObject(aiTranscriptsServiceOptions) ? aiTranscriptsServiceOptions : source
  };
}

export { resolveScopedServiceOptions };
