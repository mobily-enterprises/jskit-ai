import { ensureNonEmptyText, normalizeArray, normalizeObject } from "@jskit-ai/support-core/normalize";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createCommandRegistry } from "./commandRegistry.js";
import { createScheduleRegistry } from "./scheduleRegistry.js";
import { CommandExecutionError } from "./errors.js";

class ConsoleKernel {
  constructor({ commandRegistry = null, scheduleRegistry = null } = {}) {
    this.commandRegistry = commandRegistry || createCommandRegistry();
    this.scheduleRegistry = scheduleRegistry || createScheduleRegistry();
  }

  registerCommand(definition) {
    this.commandRegistry.register(definition);
    return this;
  }

  registerSchedule(definition) {
    this.scheduleRegistry.register(definition);
    return this;
  }

  listCommands() {
    return this.commandRegistry.list();
  }

  listSchedules() {
    return this.scheduleRegistry.list();
  }

  async run(commandId, payload = {}, context = {}) {
    const id = ensureNonEmptyText(commandId, "command id");
    return this.commandRegistry.execute(id, payload, context);
  }

  async runArgv(argv = [], context = {}) {
    const source = normalizeArray(argv);
    const commandId = ensureNonEmptyText(source[0], "command id");
    const args = source.slice(1);
    return this.run(commandId, { args }, context);
  }
}

function createConsoleKernel(options = {}) {
  return new ConsoleKernel(options);
}

function registerConsoleRuntime(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.make !== "function") {
    throw new CommandExecutionError("registerConsoleRuntime requires application container methods.");
  }

  app.singleton(TOKENS.CommandRegistry, () => createCommandRegistry());
  app.singleton(TOKENS.ConsoleKernel, (scope) => {
    const commandRegistry = scope.make(TOKENS.CommandRegistry);
    return createConsoleKernel({ commandRegistry });
  });

  return app.make(TOKENS.ConsoleKernel);
}

export { ConsoleKernel, createConsoleKernel, registerConsoleRuntime };
