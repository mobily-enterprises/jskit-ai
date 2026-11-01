import { jsonSchema } from "ai";
import { toolSchema } from "./schema.js";

// A tool is a plain object: { id, description, inputSchema (zod), execute(input, context) }, or with
// `parameters` (a JSON Schema) in place of `inputSchema` for a tool defined elsewhere, whose own
// `execute` checks its input. Wrappers may replace `execute` later (repeat reminders, messages
// heard mid-reply), so it's read at call time.
export function createTool(definition) {
  return { ...definition };
}

// Tools as the model is offered them, by their key: the schema in the form the model is shown,
// input checked against the original before `execute` runs.
export function modelTools(tools = {}) {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
    description: tool.description,
    inputSchema: tool.parameters ? jsonSchema(tool.parameters) : jsonSchema(toolSchema(tool.inputSchema), {
      validate: (value) => {
        const checked = tool.inputSchema.safeParse(value);
        return checked.success ? { success: true, value: checked.data } : { success: false, error: checked.error };
      }
    }),
    execute: (input, context) => tool.execute(input, context)
  }]));
}
