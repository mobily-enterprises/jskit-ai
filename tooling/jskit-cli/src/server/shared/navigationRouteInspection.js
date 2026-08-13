import { parse as parseVueSfc } from "@vue/compiler-sfc";
import { Node, Project, SyntaxKind } from "ts-morph";

const UNSUPPORTED_VALUE = Symbol("unsupported-static-value");
const routeSourceProject = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStaticValue(node) {
  if (!node) {
    return UNSUPPORTED_VALUE;
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node)) {
    return Number(node.getText());
  }
  if (node.isKind(SyntaxKind.TrueKeyword)) {
    return true;
  }
  if (node.isKind(SyntaxKind.FalseKeyword)) {
    return false;
  }
  if (node.isKind(SyntaxKind.NullKeyword)) {
    return null;
  }
  if (Node.isPrefixUnaryExpression(node)) {
    const operand = readStaticValue(node.getOperand());
    return typeof operand === "number" && node.getOperatorToken() === SyntaxKind.MinusToken
      ? -operand
      : UNSUPPORTED_VALUE;
  }
  if (Node.isArrayLiteralExpression(node)) {
    const values = [];
    for (const element of node.getElements()) {
      const value = readStaticValue(element);
      if (value === UNSUPPORTED_VALUE) {
        return UNSUPPORTED_VALUE;
      }
      values.push(value);
    }
    return values;
  }
  if (Node.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        continue;
      }
      const propertyValue = readStaticValue(property.getInitializer());
      if (propertyValue !== UNSUPPORTED_VALUE) {
        value[property.getName()] = propertyValue;
      } else if (property.getName() === "redirect") {
        // Inspection needs only redirect presence and must not execute app helpers.
        value.redirect = true;
      }
    }
    return value;
  }
  return UNSUPPORTED_VALUE;
}

function parseDefinePage(scriptSource = "") {
  if (!String(scriptSource || "").includes("definePage")) {
    return null;
  }
  const sourceFile = routeSourceProject.createSourceFile("/route-page.ts", String(scriptSource || ""), {
    overwrite: true
  });
  const call = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((candidate) => candidate.getExpression().getText() === "definePage");
  const value = readStaticValue(call?.getArguments()?.[0]);
  return isRecord(value) ? value : null;
}

function parseVueRouteDefinition(sourceText = "", filename = "route.vue") {
  const parsed = parseVueSfc(String(sourceText || ""), { filename });
  const routeBlock = parsed.descriptor.customBlocks.find(
    (block) => block.type === "route" && String(block.attrs?.lang || "").toLowerCase() === "json"
  );
  if (routeBlock) {
    try {
      return Object.freeze({
        descriptor: parsed.descriptor,
        definition: JSON.parse(routeBlock.content),
        source: "route-block"
      });
    } catch {
      return Object.freeze({
        descriptor: parsed.descriptor,
        definition: null,
        source: "invalid-route-block"
      });
    }
  }
  const scriptSource = [parsed.descriptor.script?.content, parsed.descriptor.scriptSetup?.content]
    .filter(Boolean)
    .join("\n");
  return Object.freeze({
    descriptor: parsed.descriptor,
    definition: parseDefinePage(scriptSource),
    source: "define-page"
  });
}

function normalizeRouteFilePath(relativePath = "") {
  return String(relativePath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
}

function routePathFromFile(relativePath = "") {
  const normalizedPath = normalizeRouteFilePath(relativePath);
  const pagesMarker = "/src/pages/";
  const routeRelativePath = normalizedPath.startsWith("src/pages/")
    ? normalizedPath.slice("src/pages/".length)
    : normalizedPath.includes(pagesMarker)
      ? normalizedPath.slice(normalizedPath.indexOf(pagesMarker) + pagesMarker.length)
      : normalizedPath;
  const routeStem = routeRelativePath.replace(/\.vue$/u, "");
  const withoutIndex = routeStem === "index" ? "" : routeStem.replace(/\/index$/u, "");
  return `/${withoutIndex}`.replace(/\/{2,}/gu, "/");
}

function inspectVueNavigationRoute(sourceText = "", relativePath = "") {
  const source = String(sourceText || "");
  const parsed = parseVueRouteDefinition(source, relativePath || "route.vue");
  const definition = isRecord(parsed.definition) ? parsed.definition : {};
  const meta = isRecord(definition.meta) ? definition.meta : {};
  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  const navigation = isRecord(jskitMeta.navigation) ? jskitMeta.navigation : null;
  const persistence = isRecord(navigation?.persistence) ? navigation.persistence : {};
  const normalizedPath = normalizeRouteFilePath(relativePath);
  return Object.freeze({
    file: normalizedPath,
    routePath: routePathFromFile(normalizedPath) || "/",
    routeName: String(definition.name || "").trim(),
    redirectOnly: !parsed.descriptor.template && Object.hasOwn(definition, "redirect"),
    metadataSource: parsed.source,
    surface: String(jskitMeta.surface || "").trim(),
    navigationRole: String(jskitMeta.navigationRole || "").trim(),
    behavior: String(navigation?.behavior || "").trim(),
    destinationKey: String(navigation?.destinationKey || "").trim(),
    machineryKey: String(navigation?.machineryKey || "").trim(),
    fallback: navigation?.fallback || null,
    restore: Array.isArray(navigation?.restore)
      ? navigation.restore.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
    persistence: String(persistence.mode || "").trim(),
    hasNavigationMetadata: Boolean(navigation)
  });
}

export {
  inspectVueNavigationRoute,
  parseVueRouteDefinition,
  routePathFromFile
};
