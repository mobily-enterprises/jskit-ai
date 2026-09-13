import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { asanaDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const gid = { type: "string", minLength: 1, maxLength: 100, pattern: "^[0-9]+$" };
const requiredGid = { ...gid, required: true };
const page = { limit: { type: "integer", min: 1, max: 100, defaultTo: 50 }, offset: { type: "string", maxLength: 4096 } };
const date = { type: "string", nullable: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  validator: value => { if (value === null) return true; const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value || "Enter a real YYYY-MM-DD date."; } };
const common = { name: { type: "string", minLength: 1, maxLength: 1000 },
  notes: { type: "string", maxLength: 50000 }, due_on: date, start_on: date };
const task = { ...common, completed: { type: "boolean" }, assignee: { ...gid, nullable: true },
  parent: { ...gid, nullable: true } };
const project = { ...common, archived: { type: "boolean" }, owner: { ...gid, nullable: true },
  privacy_setting: { type: "string", enum: ["private", "public_to_workspace"] } };
const taskFields = "gid,name,notes,completed,assignee.gid,assignee.name,due_on,start_on,projects.gid,parent.gid";
const projectFields = "gid,name,notes,archived,owner.gid,privacy_setting,due_on,start_on,workspace.gid";
const record = result => typeof result?.data?.gid === "string";
const list = result => Array.isArray(result?.data);
function read(endpoint, input = {}, fields) {
  const url = new URL(`https://app.asana.com/api/1.0/${endpoint}`);
  for (const [key, value] of Object.entries(input)) url.searchParams.set(key, String(value));
  if (fields) url.searchParams.set("opt_fields", fields);
  return { method: "GET", url: url.href };
}
function write(method, endpoint, fields, resultFields) {
  return validatedOperation({ ...(method === "PUT" ? { gid: requiredGid } : {}), ...fields }, ({ gid: resource, ...data }) => {
    if (!Object.keys(data).length) throw new ConnectorError("connector_input_invalid", "Supply at least one change.", { statusCode: 422 });
    if (Object.hasOwn(data, "start_on") && !Object.hasOwn(data, "due_on")) throw new ConnectorError("connector_input_invalid", "Include due_on when setting or clearing start_on.", { statusCode: 422 });
    if (data.start_on && data.due_on && (data.start_on > data.due_on || endpoint === "projects" && data.start_on === data.due_on)) {
      throw new ConnectorError("connector_input_invalid", "The start date must precede the project due date, or be no later than the task due date.", { statusCode: 422 });
    }
    const request = read(`${endpoint}${resource ? `/${resource}` : ""}`, {}, resultFields);
    return { ...request, method, body: { data } };
  }, record);
}
const asanaProvider = Object.freeze({
  ...asanaDefinition, apiOrigins: ["https://app.asana.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "workspaces.list",
  operations: {
    "workspaces.list": jsonOperation("https://app.asana.com/api/1.0/workspaces", page, list),
    "projects.list": validatedOperation({ workspace: requiredGid, ...page, archived: { type: "boolean" } },
      input => read("projects", input, projectFields), list),
    "projects.get": validatedOperation({ gid: requiredGid }, ({ gid }) => read(`projects/${gid}`, {}, projectFields), record),
    "projects.create": write("POST", "projects", { ...project, name: { ...common.name, required: true },
      workspace: requiredGid, privacy_setting: { ...project.privacy_setting, required: true } }, projectFields),
    "projects.update": write("PUT", "projects", project, projectFields),
    "tasks.list": validatedOperation({ project: requiredGid, ...page, completed_since: { type: "string", maxLength: 100 } },
      ({ project, ...input }) => read(`projects/${project}/tasks`, input, taskFields), list),
    "tasks.get": validatedOperation({ gid: requiredGid }, ({ gid }) => read(`tasks/${gid}`, {}, taskFields), record),
    "tasks.create": write("POST", "tasks", { ...task, name: { ...common.name, required: true }, workspace: requiredGid,
      projects: { type: "array", items: gid, validator: values => values.length <= 100 || "Choose at most 100 projects." } }, taskFields),
    "tasks.update": write("PUT", "tasks", task, taskFields),
    "users.list": validatedOperation({ workspace: requiredGid, ...page }, ({ workspace, ...input }) => read(`workspaces/${workspace}/users`, input), list),
    "teams.list": validatedOperation({ workspace: requiredGid, ...page }, ({ workspace, ...input }) => read(`workspaces/${workspace}/teams`, input), list),
    "projectMembers.add": validatedOperation({ project: requiredGid, member: requiredGid,
      access_level: { type: "string", required: true, enum: ["admin", "editor", "commenter"] } },
      ({ project, member, access_level }) => ({ method: "POST", url: "https://app.asana.com/api/1.0/memberships",
        body: { data: { parent: project, member, access_level } } }), record)
  }
});
export { asanaProvider };
