import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { fixedResultShape } from "../plugin/rules/fixedResultShape.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/fixed-result-shape", fixedResultShape, {
  valid: [
    "const form = useForm();\nform.loading = true;\nform.title = `${form.title}!`;",
    "const visible = useToggle();\nvisible.value = true;",
    "const draft = buildDraft();\ndraft.send = () => {};",
    "function useConversation({ send }) {\n  const application = createApplication({ send });\n  return { send, application };\n}",
    "const state = useState();\nObject.assign(state, { loading: false, error: \"\" });",
    "function retain() {}\nfunction retainConversation(app, readers) {\n  return app.runWithContext(() => createRuntime(readers, retain));\n}"
  ],
  invalid: [
    {
      code: "function useConversation(options) {\n  const runtime = createConversation(options);\n  runtime.application = createApplication(runtime);\n  return runtime;\n}",
      errors: [{ messageId: "patchedResult", data: { member: "runtime.application", owner: "createConversation()'s result" } }]
    },
    {
      code: "function retain() {}\nconst runtime = useRuntime();\nruntime.retain = retain;",
      errors: [{ messageId: "patchedResult", data: { member: "runtime.retain", owner: "useRuntime()'s result" } }]
    },
    {
      code: "function createQueue() {\n  const queue = { items: [] };\n  queue.add = (item) => queue.items.push(item);\n  return queue;\n}",
      errors: [{ messageId: "patchedResult", data: { member: "queue.add", owner: "createQueue()'s result" } }]
    },
    {
      code: "function retain() {}\nfunction retainConversation(app, readers) {\n  const runtime = app.runWithContext(() => createRuntime(readers));\n  runtime.retain = retain;\n  return runtime;\n}",
      errors: [{ messageId: "patchedResult", data: { member: "runtime.retain", owner: "createRuntime()'s result" } }]
    },
    {
      code: "async function openConversation(loader) {\n  const runtime = await loader.run(async () => {\n    await loader.ready();\n    return useConversation();\n  });\n  runtime.close = () => {};\n}",
      errors: [{ messageId: "patchedResult", data: { member: "runtime.close", owner: "useConversation()'s result" } }]
    },
    {
      code: "const api = createApi();\nObject.assign(api, { reload() { return api.list(); } });",
      errors: [{ messageId: "patchedResult", data: { member: "api.reload", owner: "createApi()'s result" } }]
    }
  ]
});
