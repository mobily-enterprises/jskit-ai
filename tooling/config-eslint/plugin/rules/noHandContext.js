import { DATA_ACCESS_GUIDE_URL, keyName, ruleMeta } from "../support.js";
import { isAssignmentTarget } from "../dataAccess.js";

// A system context skips every ownership predicate, and a context's scopeValues say which workspace and user its calls
// reach. Both come from the resource runtime only: a feature's systemScope gives its setup systemContext(reason), and
// a system context derives scoped ones with forWorkspace(id), forUser(id) and forWorkspaceUser(workspaceId, userId).
// Made by hand, either one reaches rows its caller never named a reason for. The resource runtime's
// declareSystemScope(featureId, reason) is how the kernel gives a feature with a systemScope its factory: called from
// anywhere else, it mints a system context for a feature that never declared one. Only the framework calls it (and tests,
// which these rules leave alone).
const SYSTEM_CONTEXT_MAKERS = new Set(["createSystemContext", "declareSystemScope"]);

const noHandContext = Object.freeze({
  meta: ruleMeta("Disallow making a system context or a context's scope by hand.", {
    systemContext: "{{name}} makes a system context by hand, which reads and writes every workspace's rows. Declare systemScope on the feature instead: its setup receives systemContext(reason), and every call names why it skips the ownership scope.",
    handScope: "scopeValues sets a context's workspace or user by hand, so its calls reach whichever rows it names. Pass the call's options; background work derives a scoped context from its system context with forWorkspace(id), forUser(id) or forWorkspaceUser(workspaceId, userId)."
  }, "background-work", DATA_ACCESS_GUIDE_URL),
  create(context) {
    const reportSystemContext = (node, name) => context.report({ node, messageId: "systemContext", data: { name } });
    return {
      ImportSpecifier(node) {
        const name = node.imported.name ?? node.imported.value;
        if (SYSTEM_CONTEXT_MAKERS.has(name)) {
          reportSystemContext(node, name);
        }
      },
      MemberExpression(node) {
        if (!node.computed && SYSTEM_CONTEXT_MAKERS.has(node.property.name)) {
          reportSystemContext(node.property, node.property.name);
        }
        const written = isAssignmentTarget(node) || (node.parent.type === "MemberExpression" && node.parent.object === node && isAssignmentTarget(node.parent));
        if (!node.computed && node.property.name === "scopeValues" && written) {
          context.report({ node: node.property, messageId: "handScope" });
        }
      },
      Property(node) {
        if (node.computed) {
          return;
        }
        if (node.parent.type === "ObjectPattern" && SYSTEM_CONTEXT_MAKERS.has(keyName(node))) {
          reportSystemContext(node.key, keyName(node));
        }
        if (node.parent.type === "ObjectExpression" && keyName(node) === "scopeValues") {
          context.report({ node: node.key, messageId: "handScope" });
        }
      }
    };
  }
});

export { noHandContext };
