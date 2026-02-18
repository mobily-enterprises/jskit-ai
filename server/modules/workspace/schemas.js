import { schema as sharedSchema } from "./schemas/shared.schemas.js";
import { schema as bootstrapSchema } from "./schemas/bootstrap.schemas.js";
import { schema as selfServiceSchema } from "./schemas/selfService.schemas.js";
import { schema as adminSchema } from "./schemas/admin.schemas.js";

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
  params: {
    ...adminSchema.params
  }
};

export { schema };
