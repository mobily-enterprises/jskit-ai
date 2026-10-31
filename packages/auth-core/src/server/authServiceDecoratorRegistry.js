/**
 * @param {import("./types.js").AuthExtensions} extensions
 * @param {object} decorator
 */
function registerAuthServiceDecorator(extensions, decorator) {
  return extensions.registerServiceDecorator(decorator);
}

/**
 * @param {import("./types.js").AuthExtensions} extensions
 * @param {import("./types.js").AuthService} authService
 */
function applyAuthServiceDecorators(extensions, authService) {
  return extensions.decorateService(authService);
}

export { applyAuthServiceDecorators, registerAuthServiceDecorator };
