import { schema as adminSchema } from "./admin.schema.js";
import { schema as bootstrapSchema } from "./bootstrap.schema.js";
import { schema as selfServiceSchema } from "./selfService.schema.js";
import { schema as sharedSchema } from "./shared.schema.js";

const schema = Object.freeze({
  admin: adminSchema,
  bootstrap: bootstrapSchema,
  selfService: selfServiceSchema,
  shared: sharedSchema
});

export { schema, adminSchema, bootstrapSchema, selfServiceSchema, sharedSchema };
