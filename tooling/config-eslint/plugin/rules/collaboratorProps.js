import { ABSENT_DEFAULT, CLIENT_GUIDE_URL, compactText, createReporter, keyName, ruleMeta } from "../support.js";

// Prop types whose values are data: a call on one (`items.map()`) is not a call on a collaborator.
const DATA_TYPES = new Set(["Array", "String", "Number", "Boolean", "Date", "RegExp", "Symbol", "BigInt"]);
const PROP_TYPE_CAST = /@type\s*\{[^}]*PropType\s*</u;
// A default that names its value (`ignoreReload`, `() => NO_ADAPTER`) is a named default, not an absent one.
const NAMED_DEFAULT = /^(?:\(\)\s*=>\s*)?[A-Za-z_$][\w$]*$/u;

// The props object a component declares: defineProps({ … }) with the name its result is bound to, or an options
// component's `props: { … }`.
function declaredProps(node) {
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "defineProps" &&
    node.arguments[0]?.type === "ObjectExpression") {
    const binding = node.parent?.type === "VariableDeclarator" && node.parent.id.type === "Identifier" ? node.parent.id.name : "";
    return { object: node.arguments[0], binding };
  }
  if (node.type === "Property" && keyName(node) === "props" && node.value.type === "ObjectExpression" &&
    node.parent.properties.some((property) => ["setup", "emits", "components", "template", "render", "name"].includes(keyName(property)))) {
    return { object: node.value, binding: "props" };
  }
  return null;
}

function unchain(node) {
  return node?.type === "ChainExpression" ? node.expression : node;
}

// The prop a call reaches through, or "": `props.x()`, `props.x.y()` or `props.x?.y()` in the script, `x()` or
// `x.y()` in the template.
function calledProp(callee, propsBinding, inTemplate) {
  const target = unchain(callee);
  if (inTemplate) {
    const root = target.type === "MemberExpression" ? unchain(target.object) : target;
    return root.type === "Identifier" ? root.name : "";
  }
  if (target.type !== "MemberExpression") {
    return "";
  }
  const owner = unchain(target.object);
  if (owner.type === "Identifier" && owner.name === propsBinding) {
    return target.computed ? "" : target.property.name;
  }
  const root = owner.type === "MemberExpression" && !owner.computed ? unchain(owner.object) : null;
  return root?.type === "Identifier" && root.name === propsBinding ? owner.property.name : "";
}

// The text of a prop option, or "" when the prop leaves it out.
function optionText(sourceCode, prop, name) {
  const option = prop.value.properties.find((property) => property.type === "Property" && keyName(property) === name);
  return option ? compactText(sourceCode, option.value) : "";
}

// A prop the component calls is a collaborator: an adapter, a state object
// with methods, a callback. It is required, with no default that makes it
// absent, so no use of it probes; and a collaborator object names its
// contract with a PropType cast. A callback may default to a named no-op.
const collaboratorProps = Object.freeze({
  meta: ruleMeta("Require props a component calls to be required, never defaulted to nothing, and typed by their contract.", {
    optionalCollaborator: "The component calls {{name}}, but the prop is optional{{fallback}}. Make it required: true, or give a callback a named no-op default.",
    untypedCollaborator: "The component calls {{name}}, typed only {{type}}. Name its contract: type: /** @type {import(\"vue\").PropType<X>} */ (Object)."
  }, "collaborator-props", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "collaborator-props");
    let props = null;
    const called = new Set();
    function noteCall(node, inTemplate) {
      if (props) {
        const name = calledProp(node.callee, props.binding, inTemplate);
        if (name) {
          called.add(name);
        }
      }
    }
    function checkProps() {
      for (const prop of props?.object.properties || []) {
        const name = keyName(prop);
        if (prop.type !== "Property" || !called.has(name)) {
          continue;
        }
        // `adapter: Object` declares only a type: an optional prop with no default.
        const shorthand = prop.value.type !== "ObjectExpression";
        const type = shorthand ? compactText(sourceCode, prop.value) : optionText(sourceCode, prop, "type");
        const types = type.replace(/[[\]\s]/gu, "").split(",").filter(Boolean);
        if (types.length && types.every((entry) => DATA_TYPES.has(entry))) {
          continue;
        }
        const required = !shorthand && optionText(sourceCode, prop, "required") === "true";
        const fallback = shorthand ? "" : optionText(sourceCode, prop, "default");
        const absent = !fallback || ABSENT_DEFAULT.test(fallback) || /^\(\)\s*=>\s*\(\{\s*\}\)$/u.test(fallback) || !NAMED_DEFAULT.test(fallback);
        if (!required && absent) {
          report(prop, "collaborator-prop", "optionalCollaborator", { name, fallback: fallback ? ` and defaults to ${fallback.slice(0, 30)}` : "" });
        }
        const callback = types.length > 0 && types.every((entry) => entry === "Function");
        if (!callback && !PROP_TYPE_CAST.test(sourceCode.getText(prop)) && !sourceCode.getCommentsBefore(prop).some((comment) => PROP_TYPE_CAST.test(comment.value))) {
          report(prop, "collaborator-prop", "untypedCollaborator", { name, type: type || "untyped" });
        }
      }
    }
    const templateBody = sourceCode.ast.templateBody;
    const scriptVisitor = {
      Property(node) {
        props ||= declaredProps(node);
      },
      CallExpression(node) {
        props ||= declaredProps(node);
        noteCall(node, false);
      },
      // A component with a template is checked once its template has been read too.
      "Program:exit"() {
        if (!templateBody) {
          checkProps();
        }
      }
    };
    if (!templateBody) {
      return scriptVisitor;
    }
    return sourceCode.parserServices.defineTemplateBodyVisitor({
      CallExpression: (node) => noteCall(node, true),
      "VElement:exit"(node) {
        if (node === templateBody) {
          checkProps();
        }
      }
    }, scriptVisitor);
  }
});

export { collaboratorProps };
