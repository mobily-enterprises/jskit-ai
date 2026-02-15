import { Type } from "@fastify/type-provider-typebox";
import { HistoryEntrySchema } from "../lib/schemas/historyEntrySchema.js";
import { createPaginationQuerySchema } from "../lib/schemas/paginationQuerySchema.js";
import { safeRequestUrl } from "../lib/requestUrl.js";

const emailPattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
const decimalStringPattern = "^-?\\d+(?:\\.\\d+)?$";
const nonNegativeDecimalStringPattern = "^(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

const registerCredentialsSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320, pattern: emailPattern }),
    password: Type.String({ minLength: 8, maxLength: 128 })
  },
  {
    additionalProperties: false
  }
);

const loginCredentialsSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320, pattern: emailPattern }),
    password: Type.String({ minLength: 1, maxLength: 1024 })
  },
  {
    additionalProperties: false
  }
);

const emailOnlySchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320, pattern: emailPattern })
  },
  {
    additionalProperties: false
  }
);

const passwordOnlySchema = Type.Object(
  {
    password: Type.String({ minLength: 8, maxLength: 128 })
  },
  {
    additionalProperties: false
  }
);

const passwordRecoverySchema = Type.Object(
  {
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    tokenHash: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
    type: Type.Optional(Type.Literal("recovery"))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const okResponseSchema = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const okMessageResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const registerResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    requiresEmailConfirmation: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  {
    additionalProperties: false
  }
);

const loginResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const logoutResponseSchema = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const sessionResponseSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    csrfToken: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const sessionErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    csrfToken: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const annuityAssumptionsSchema = Type.Object(
  {
    rateConversion: Type.String({ minLength: 1 }),
    timing: Type.String({ minLength: 1 }),
    growingAnnuity: Type.String({ minLength: 1 }),
    perpetuity: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const annuityResponseSchema = Type.Object(
  {
    historyId: Type.String({ format: "uuid" }),
    mode: Type.Union([Type.Literal("fv"), Type.Literal("pv")]),
    timing: Type.Union([Type.Literal("ordinary"), Type.Literal("due")]),
    payment: Type.String({ pattern: decimalStringPattern }),
    annualRate: Type.String({ pattern: decimalStringPattern }),
    annualGrowthRate: Type.String({ pattern: decimalStringPattern }),
    years: Type.Union([Type.String({ pattern: nonNegativeDecimalStringPattern }), Type.Null()]),
    paymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    periodicRate: Type.String({ pattern: decimalStringPattern }),
    periodicGrowthRate: Type.String({ pattern: decimalStringPattern }),
    totalPeriods: Type.Union([Type.String({ pattern: nonNegativeDecimalStringPattern }), Type.Null()]),
    isPerpetual: Type.Boolean(),
    value: Type.String({ pattern: decimalStringPattern }),
    warnings: Type.Array(Type.String({ minLength: 1 })),
    assumptions: annuityAssumptionsSchema
  },
  {
    additionalProperties: false
  }
);

const historyQuerySchema = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const annuityBodySchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("fv"), Type.Literal("pv")]),
    timing: Type.Union([Type.Literal("ordinary"), Type.Literal("due")]),
    payment: Type.Number({ exclusiveMinimum: 0 }),
    annualRate: Type.Number({ exclusiveMinimum: -100 }),
    annualGrowthRate: Type.Optional(Type.Number({ exclusiveMinimum: -100, default: 0 })),
    years: Type.Optional(Type.Number({ minimum: 0 })),
    paymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    isPerpetual: Type.Optional(Type.Boolean({ default: false })),
    perpetual: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

const historyEntryWithUsernameSchema = Type.Object(
  {
    ...HistoryEntrySchema.properties,
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const historyListResponseSchema = Type.Object(
  {
    entries: Type.Array(historyEntryWithUsernameSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

function buildDefaultRoutes(controllers) {
  return [
    {
      path: "/api/register",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Register a new user",
        body: registerCredentialsSchema,
        response: {
          201: registerResponseSchema
        }
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.register
    },
    {
      path: "/api/login",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Log in with Supabase credentials",
        body: loginCredentialsSchema,
        response: {
          200: loginResponseSchema
        }
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.login
    },
    {
      path: "/api/password/forgot",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Request a password reset email",
        body: emailOnlySchema,
        response: {
          200: okMessageResponseSchema
        }
      },
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.requestPasswordReset
    },
    {
      path: "/api/password/recovery",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete password recovery link exchange",
        body: passwordRecoverySchema,
        response: {
          200: okResponseSchema
        }
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.completePasswordRecovery
    },
    {
      path: "/api/password/reset",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Set a new password for authenticated recovery session",
        body: passwordOnlySchema,
        response: {
          200: okMessageResponseSchema
        }
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.resetPassword
    },
    {
      path: "/api/logout",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Log out and clear session cookies",
        response: {
          200: logoutResponseSchema
        }
      },
      handler: controllers.auth.logout
    },
    {
      path: "/api/session",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Get current session status and CSRF token",
        response: {
          200: sessionResponseSchema,
          503: sessionErrorResponseSchema
        }
      },
      handler: controllers.auth.session
    },
    {
      path: "/api/history",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["history"],
        summary: "List authenticated user's calculation history",
        querystring: historyQuerySchema,
        response: {
          200: historyListResponseSchema
        }
      },
      handler: controllers.history.list
    },
    {
      path: "/api/annuity",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["annuity"],
        summary: "Calculate annuity value and append history",
        body: annuityBodySchema,
        response: {
          200: annuityResponseSchema
        }
      },
      handler: controllers.annuity.calculate
    }
  ];
}

function registerApiRoutes(fastify, { controllers, routes }) {
  const routeList = Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers);

  for (const route of routeList) {
    fastify.route({
      method: route.method,
      url: route.path,
      ...(route.schema ? { schema: route.schema } : {}),
      config: {
        authPolicy: route.auth || "public",
        ownerParam: route.ownerParam || null,
        userField: route.userField || "id",
        ownerResolver: typeof route.ownerResolver === "function" ? route.ownerResolver : null,
        csrfProtection: route.csrfProtection !== false,
        ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
      },
      handler: async (request, reply) => {
        await route.handler(request, reply, safeRequestUrl(request));
      }
    });
  }
}

export { buildDefaultRoutes, registerApiRoutes };
