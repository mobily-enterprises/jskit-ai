import { schema as sharedSchema } from "./schemas/shared.schema.js";
import { schema as bootstrapSchema } from "./schemas/bootstrap.schema.js";
import { schema as selfServiceSchema } from "./schemas/selfService.schema.js";
import { schema as adminSchema } from "./schemas/admin.schema.js";

const schema = {
  ...sharedSchema,
  response: {
    ...adminSchema.response,
    ...selfServiceSchema.response,
    ...bootstrapSchema.response
  },
  body: {
    ...adminSchema.body,
    ...selfServiceSchema.body
  },
  query: {
    ...(adminSchema.query || {})
  },
  params: {
    ...adminSchema.params
  }
};

export { schema };
