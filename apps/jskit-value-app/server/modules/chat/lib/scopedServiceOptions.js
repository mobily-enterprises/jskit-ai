function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveScopedServiceOptions(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const { chatServiceOptions = source, chatRealtimeServiceOptions = source } = source;

  return {
    source,
    chatServiceOptions: isPlainObject(chatServiceOptions) ? chatServiceOptions : source,
    chatRealtimeServiceOptions: isPlainObject(chatRealtimeServiceOptions) ? chatRealtimeServiceOptions : source
  };
}

export { resolveScopedServiceOptions };
