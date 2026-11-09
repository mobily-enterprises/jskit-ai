import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { kebab } from "./material3-source.mjs";

// How app templates use components, for the Material 3 check (material3.mjs). ui/removed-prop: a prop a JSKIT
// component no longer has, which Vue would otherwise pass on as an HTML attribute that does nothing. Each package
// lists the props its releases removed from its exported components in package.json, as
// `jskit.metadata.ui.removedProps: { "<Component>": { "<prop>": "<what to do instead>" } }`, read from the installed
// package, so an app is judged against the release it runs.

const PACKAGE_DIRECTORY = path.join("node_modules", "@jskit-ai");
// `import CrudViewScreen from "@jskit-ai/http-web/client/components/CrudViewScreen"`.
const COMPONENT_IMPORT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*["']@jskit-ai\/([\w-]+)\/client\/components\/([\w-]+?)(?:\.vue)?["']/gu;
// `import { CrudViewScreen, CrudListScreen as List } from "@jskit-ai/http-web/client"`.
const CLIENT_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["']@jskit-ai\/([\w-]+)\/client["']/gu;

/**
 * The props each installed @jskit-ai package lists as removed from its components, by package name:
 * Map<"@jskit-ai/<name>", Record<component, Record<prop, hint>>>.
 * @param {string} root
 */
async function readRemovedProps(root) {
  const removed = new Map();
  let entries;
  try {
    entries = await readdir(path.join(root, PACKAGE_DIRECTORY));
  } catch (error) {
    if (error?.code === "ENOENT") return removed;
    throw error;
  }
  for (const entry of entries) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, PACKAGE_DIRECTORY, entry, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const props = manifest?.jskit?.metadata?.ui?.removedProps;
    if (props && typeof props === "object") removed.set(`@jskit-ai/${entry}`, props);
  }
  return removed;
}

// The JSKIT components a script imports, by the tag a template writes them as (kebab-case): { name, packageName, local }.
function readComponentImports(script) {
  const components = new Map();
  const add = (local, packageName, name) => components.set(kebab(local), { name, packageName: `@jskit-ai/${packageName}`, local });
  for (const [, local, packageName, name] of script.matchAll(COMPONENT_IMPORT)) add(local, packageName, name);
  for (const [, names, packageName] of script.matchAll(CLIENT_IMPORT)) {
    for (const specifier of names.split(",")) {
      const [name, local = name] = specifier.trim().split(/\s+as\s+/u);
      if (/^[A-Z]\w*$/u.test(name)) add(local, packageName, name);
    }
  }
  return components;
}

// Reports each prop a template passes to a JSKIT component that the installed package lists as removed, written in
// camelCase or kebab-case, static or bound.
function checkRemovedProps(tags, script, removedProps, report) {
  const components = readComponentImports(script);
  for (const tag of tags) {
    const component = components.get(tag.name);
    const removed = component && removedProps.get(component.packageName)?.[component.name];
    if (!removed) continue;
    for (const entry of tag.attributes) {
      const prop = Object.keys(removed).find((name) => [kebab(name), name.toLowerCase()].includes(entry.name));
      if (prop) {
        report("ui/removed-prop", entry.offset, `${component.local} (${component.packageName}) no longer has the prop ${prop}, so Vue ` +
          `passes it on as an HTML attribute that does nothing. ${removed[prop]}`);
      }
    }
  }
}

export { checkRemovedProps, readRemovedProps };
