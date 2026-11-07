import { DATA_ACCESS_GUIDE_URL, keyName, ruleMeta } from "../support.js";
import { isAssignmentTarget } from "../dataAccess.js";

// A system context skips every ownership predicate, and a context's scopeValues say which workspace and user its calls
// reach. Both come from the resource runtime only: a feature's systemScope gives its setup systemContext(reason), and
// a system context derives scoped ones with forWorkspace(id), forUser(id) and forWorkspaceUser(workspaceId, userId).
// Made by hand, either one reaches rows its caller never named a reason for.
const SYSTEM_CONTEXT = "createSystemContext";

const noHandContext = Object.freeze({
  meta: ruleMeta("Disallow making a system context or a context's scope by hand.", {
    systemContext: "createSystemContext makes a system context by hand, which reads and writes every workspace's rows. Declare systemScope on the feature instead: its setup receives systemContext(reason), and every call names why it skips the ownership scope.",
    handScope: "scopeValues sets a context's workspace or user by hand, so its calls reach whichever rows it names. Pass the call's options; background work derives a scoped context from its system context with forWorkspace(id), forUser(id) or forWorkspaceUser(workspaceId, userId)."
  }, "background-work", DATA_ACCESS_GUIDE_URL),
  create(context) {
    const reportSystemContext = (node) => context.report({ node, messageId: "systemContext" });
    return {
      ImportSpecifier(node) {
        if (node.imported.name === SYSTEM_CONTEXT || node.imported.value === SYSTEM_CONTEXT) {
          reportSystemContext(node);
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.name === SYSTEM_CONTEXT) {
          reportSystemContext(node.property);
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
        if (node.parent.type === "ObjectPattern" && keyName(node) === SYSTEM_CONTEXT) {
          reportSystemContext(node.key);
        }
        if (node.parent.type === "ObjectExpression" && keyName(node) === "scopeValues") {
          context.report({ node: node.key, messageId: "handScope" });
        }
      }
    };
  }
});

export { noHandContext };
