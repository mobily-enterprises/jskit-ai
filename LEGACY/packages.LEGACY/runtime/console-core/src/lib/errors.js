class ConsoleKernelError extends Error {
  constructor(message, details = {}) {
    super(String(message || "Console kernel error."));
    this.name = this.constructor.name;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

class CommandRegistrationError extends ConsoleKernelError {}
class CommandExecutionError extends ConsoleKernelError {}
class ScheduleRegistrationError extends ConsoleKernelError {}

export {
  ConsoleKernelError,
  CommandRegistrationError,
  CommandExecutionError,
  ScheduleRegistrationError
};
