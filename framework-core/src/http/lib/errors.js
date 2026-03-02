class HttpKernelError extends Error {
  constructor(message, details = {}) {
    super(String(message || "HTTP kernel error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class RouteDefinitionError extends HttpKernelError {}
class RouteRegistrationError extends HttpKernelError {}

export { HttpKernelError, RouteDefinitionError, RouteRegistrationError };
