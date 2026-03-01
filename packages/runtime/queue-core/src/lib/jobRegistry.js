import { ensureNonEmptyText, normalizeObject } from "@jskit-ai/support-core/normalize";
import { sortById } from "@jskit-ai/support-core/sorting";
import { JobRegistrationError } from "./errors.js";

class JobRegistry {
  constructor() {
    this.jobs = new Map();
  }

  register(definition = {}) {
    const source = normalizeObject(definition);
    const id = ensureNonEmptyText(source.id, "job id");

    if (this.jobs.has(id)) {
      throw new JobRegistrationError(`Job \"${id}\" is already registered.`);
    }
    if (typeof source.run !== "function") {
      throw new JobRegistrationError(`Job \"${id}\" run must be a function.`);
    }

    this.jobs.set(
      id,
      Object.freeze({
        id,
        run: source.run
      })
    );

    return this;
  }

  get(id) {
    return this.jobs.get(String(id || "").trim()) || null;
  }

  has(id) {
    return this.jobs.has(String(id || "").trim());
  }

  list() {
    return Object.freeze(sortById([...this.jobs.values()]));
  }
}

function createJobRegistry() {
  return new JobRegistry();
}

export { JobRegistry, createJobRegistry };
