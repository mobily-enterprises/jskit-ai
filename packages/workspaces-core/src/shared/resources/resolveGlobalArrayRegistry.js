function resolveGlobalArrayRegistry(symbolKey) {
  globalThis[symbolKey] = Array.isArray(globalThis[symbolKey]) ? globalThis[symbolKey] : [];
  return globalThis[symbolKey];
}

export { resolveGlobalArrayRegistry };
