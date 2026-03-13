/**
 * Shared transport validators/resources live here.
 *
 * Example:
 * import { Type } from "@fastify/type-provider-typebox";
 *
 * export const helloSchema = {
 *   query: Type.Object(
 *     { name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })) },
 *     { additionalProperties: false }
 *   ),
 *   response: {
 *     200: Type.Object(
 *       { ok: Type.Boolean(), message: Type.String({ minLength: 1 }) },
 *       { additionalProperties: false }
 *     )
 *   }
 * };
 */
export {};
