import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { kebab } from "./material3-source.mjs";

// How app code uses components, for the Material 3 check (material3.mjs).
// - ui/removed-prop: a prop a JSKIT component no longer has, which Vue would otherwise pass on as an HTML attribute
//   that does nothing. Each package lists the props its releases removed from its exported components in
//   package.json, as `jskit.metadata.ui.removedProps: { "<Component>": { "<prop>": "<what to do instead>" } }`, read
//   from the installed package, so an app is judged against the release it runs.
// - ui/vuetify-by-name: a Vuetify component named as a string for Vue to resolve at run time (resolveComponent("v-dialog"),
//   resolveDynamicComponent, h("v-dialog"), <component is="v-dialog">). A JSKIT app registers no Vuetify component
//   globally: vite-plugin-vuetify imports each one where a template writes its tag, so the name finds nothing and Vue
//   renders an unknown element.

const PACKAGE_DIRECTORY = path.join("node_modules", "@jskit-ai");
// `import CrudViewScreen from "@jskit-ai/http-web/client/components/CrudViewScreen"`.
const COMPONENT_IMPORT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*["']@jskit-ai\/([\w-]+)\/client\/components\/([\w-]+?)(?:\.vue)?["']/gu;
// `import { CrudViewScreen, CrudListScreen as List } from "@jskit-ai/http-web/client"`.
const CLIENT_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["']@jskit-ai\/([\w-]+)\/client["']/gu;

// A Vuetify component's name: kebab-case with its v- prefix, or PascalCase with its V.
const VUETIFY_NAME = String.raw`v-[a-z][a-z0-9-]*|V[A-Z][A-Za-z0-9]*`;
const VUETIFY_BY_NAME_CALL = new RegExp(String.raw`\b(resolveComponent|resolveDynamicComponent|h)\s*\(\s*(["'\x60])(${VUETIFY_NAME})\2`, "gu");
const QUOTED_VUETIFY_NAME = new RegExp(String.raw`(["'\x60])(${VUETIFY_NAME})\1`, "gu");
const RESOLVING_CALL = /\b(?:resolveComponent|resolveDynamicComponent|h)\s*\(\s*$/u;

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

function reportByName(report, offset, name, how) {
  const component = name.startsWith("v-") ? name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("") : name;
  report("ui/vuetify-by-name", offset, `${how} names Vuetify's ${component} for Vue to resolve at run time, which finds nothing ` +
    `in a JSKIT app: Vuetify components are imported where a template writes their tag, never registered by name, so Vue ` +
    `renders an unknown element. Import it, import { ${component} } from "vuetify/components", and pass the component itself.`);
}

// Reports each Vuetify component that code (a script, or a template's bound expression) names for Vue to resolve.
function checkVuetifyByNameCode(code, offset, report) {
  for (const match of code.matchAll(VUETIFY_BY_NAME_CALL)) reportByName(report, offset + match.index, match[3], `${match[1]}("${match[3]}")`);
}

// Reports a <component> whose `is` names a Vuetify component: written as it is, or as a string in a bound expression.
function checkVuetifyByNameAttribute(tag, entry, report) {
  if (tag.name !== "component" || entry.name !== "is") return;
  if (!entry.bound) {
    const name = entry.value.trim();
    if (new RegExp(`^(?:${VUETIFY_NAME})$`, "u").test(name)) reportByName(report, entry.offset, name, `is="${name}"`);
    return;
  }
  for (const match of entry.value.matchAll(QUOTED_VUETIFY_NAME)) {
    // A call's argument is checkVuetifyByNameCode's.
    if (!RESOLVING_CALL.test(entry.value.slice(0, match.index))) reportByName(report, entry.valueOffset + match.index, match[2], `:is="${match[0]}"`);
  }
}

export { checkRemovedProps, checkVuetifyByNameAttribute, checkVuetifyByNameCode, readRemovedProps };
