import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { mainHelloSchema } from "../../shared/schemas/mainHelloSchema.js";

class MainHelloProvider {
  static id = "docs.examples.01.main.hello";

  register() {}

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);

    router.get(
      "/api/docs/ch01/hello",
      {
        meta: {
          tags: ["docs-ch01"],
          summary: "Chapter 1 end-state hello route"
        },
        response: mainHelloSchema.response
      },
      async (_request, reply) => {
        reply.code(200).send({
          ok: true,
          message: "Hello from Chapter 1 end-state example."
        });
      }
    );
  }
}

export { MainHelloProvider };
