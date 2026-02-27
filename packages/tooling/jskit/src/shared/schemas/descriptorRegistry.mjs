import path from "node:path";
import { createCliError } from "./validationHelpers.mjs";

export function ensureUniqueDescriptor(existingEntry, descriptorId, descriptorPath, label) {
  if (!existingEntry) {
    return;
  }

  const existingPath = path.resolve(existingEntry.descriptorPath);
  const currentPath = path.resolve(descriptorPath);
  if (existingPath !== currentPath) {
    throw createCliError(
      `Duplicate ${label} discovered: ${descriptorId}\n- ${existingEntry.descriptorPath}\n- ${descriptorPath}`
    );
  }
}
