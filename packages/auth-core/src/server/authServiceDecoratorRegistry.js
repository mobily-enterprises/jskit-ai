function registerAuthServiceDecorator(extensions, decorator) {
  if (!extensions || typeof extensions.registerServiceDecorator !== "function") {
    throw new TypeError("registerAuthServiceDecorator requires auth.extensions.");
  }
  return extensions.registerServiceDecorator(decorator);
}

function applyAuthServiceDecorators(extensions, authService) {
  if (!extensions || typeof extensions.decorateService !== "function") {
    throw new TypeError("applyAuthServiceDecorators requires auth.extensions.");
  }
  return extensions.decorateService(authService);
}

export { applyAuthServiceDecorators, registerAuthServiceDecorator };
