import { ensureNonEmptyText, normalizeObject } from "@jskit-ai/support-core/normalize";
import { sortById } from "@jskit-ai/support-core/sorting";
import { CommandExecutionError, CommandRegistrationError } from "./errors.js";

class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(definition = {}) {
    const source = normalizeObject(definition);
    const id = ensureNonEmptyText(source.id, "command id");

    if (this.commands.has(id)) {
      throw new CommandRegistrationError(`Command \"${id}\" is already registered.`);
    }
    if (typeof source.execute !== "function") {
      throw new CommandRegistrationError(`Command \"${id}\" execute must be a function.`);
    }

    this.commands.set(
      id,
      Object.freeze({
        id,
        description: String(source.description || "").trim(),
        execute: source.execute
      })
    );

    return this;
  }

  has(id) {
    return this.commands.has(String(id || "").trim());
  }

  list() {
    return Object.freeze(sortById([...this.commands.values()]));
  }

  async execute(id, payload = {}, context = {}) {
    const normalizedId = ensureNonEmptyText(id, "command id");
    const definition = this.commands.get(normalizedId);
    if (!definition) {
      throw new CommandExecutionError(`Command \"${normalizedId}\" is not registered.`);
    }

    try {
      return await definition.execute(payload, context);
    } catch (error) {
      throw new CommandExecutionError(`Command \"${normalizedId}\" failed.`, {
        commandId: normalizedId,
        cause: error
      });
    }
  }
}

function createCommandRegistry() {
  return new CommandRegistry();
}

export { CommandRegistry, createCommandRegistry };
