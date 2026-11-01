/**
 * The action policy of an application that supplies none: each action is
 * registered with the input it declares and runs its own execute, unchanged.
 * @type {import("../types.js").ActionPolicy}
 */
const noActionPolicy = Object.freeze({
  input(definition) {
    return definition.input;
  },
  execute({ input, context, run }) {
    return run(input, context);
  }
});

export { noActionPolicy };
