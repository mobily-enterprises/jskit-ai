# JSKIT Manual: Server Real Applications (From Monolith Route to Layered Architecture)

This chapter picks up directly from Chapter 1 and Chapter 2.

By the end, you will have a complete server feature with:

- shared schemas
- routes
- controller
- actions
- service
- repository
- provider wiring

The important part is not just the final code. The important part is understanding why each layer exists.

So this chapter is intentionally written as a staged refactor:

- Stage 1: *** COMPLETE WHEN CHAPTER IS FINISHED ***
- Stage 2: 
- Stage 3: 
- Stage 4: 
- Stage 5: 
- Stage 6: 
- Stage 7: 
- Stage 8: 
- Stage 9: 
- Stage 10:


Each stage works. Each stage improves something. Each stage still has pain that motivates the next one.

## Where We Pick Up

From earlier chapters, you already have:

- a `manual-app`
- `@local/main` module
- provider lifecycle basics from Chapter 1
- container/provider mental model

Now we move from "first route" to "real feature architecture."

## The Feature We Will Build

We will build a `contacts` feature with three routes:

- `POST /api/v1/contacts/intake`
- `POST /api/v1/contacts/preview-followup`
- `GET /api/v1/contacts/:contactId`

The two `POST` routes are business-logic-heavy on purpose:

- normalize input
- run business rules
- compute lead score
- derive segment
- build follow-up plan
- check duplicates

The `GET` route is intentionally simple so we can demonstrate `params` contracts without bloating each stage.

This is exactly the kind of logic that becomes painful when all code lives in one handler.

Now let us intentionally start with the bad version.

## Stage 1: Provider-Only Monolith (Works, But Hurts)

This stage is intentionally "too much in one place." We want you to feel the pain clearly.

### What this stage shows

- Yes, you can do everything in `Stage1MonolithProvider`.
- Yes, it can ship quickly for tiny demos.
- No, it does not stay maintainable once logic grows.

This provider imports shared route contracts from `contactSchemas.js`; right after this block, we inspect that file in detail.

### Code

Use `docs/examples/03.real-app/src/server/providers/Stage1MonolithProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage1MonolithProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class Stage1MonolithProvider {
  static id = "docs.examples.03.stage1";

  register() {}

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const contacts = [];

    const validateContact = (normalized) => {
      const details = [];
      if (normalized.name.length < 2) details.push("name must have at least 2 characters.");
      if (!normalized.email.includes("@")) details.push("email must include @.");
      if (normalized.plan === "starter" && normalized.employees > 200) {
        details.push("starter plan supports up to 200 employees");
      }

      return details;
    };

    const scoreContact = (normalized) => {
      const planScore =
        normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
      const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
      return Math.max(0, Math.min(100, planScore + employeeScore));
    };

    const segmentFromScore = (score) => {
      if (score >= 70) return "enterprise_hot";
      if (score >= 40) return "growth_warm";
      return "starter_cold";
    };

    const buildFollowupPlan = ({ segment, source }) => {
      const plan = [];

      if (segment === "enterprise_hot") {
        plan.push("assign account executive in 15 minutes");
        plan.push("send solution outline today");
      } else if (segment === "growth_warm") {
        plan.push("send product-fit email in 2 hours");
        plan.push("schedule follow-up in 2 days");
      } else {
        plan.push("send starter onboarding guide");
        plan.push("review intent in 7 days");
      }

      if (source === "webinar") {
        plan.push("include webinar recap");
      }

      return plan;
    };

    const qualifyContact = (raw) => {
      const normalized = normalizeContactBody(raw);
      const details = validateContact(normalized);

      if (details.length > 0) {
        return {
          ok: false,
          code: "domain_validation_failed",
          details,
          normalized
        };
      }

      const score = scoreContact(normalized);
      const segment = segmentFromScore(score);
      const followupPlan = buildFollowupPlan({
        segment,
        source: normalized.source
      });

      return {
        ok: true,
        normalized,
        score,
        segment,
        followupPlan
      };
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-1/contacts/intake",
      contactIntakePostRouteContract,
      async (request, reply) => {
        const qualified = qualifyContact(request.body);

        if (!qualified.ok) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: qualified.code,
            details: qualified.details
          });
          return;
        }

        const duplicate = contacts.find((entry) => entry.email === qualified.normalized.email);
        if (duplicate) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: "duplicate_contact",
            details: ["a contact with this email already exists"]
          });
          return;
        }

        const created = {
          id: `contact-${Date.now().toString(36)}`,
          ...qualified.normalized,
          score: qualified.score,
          segment: qualified.segment
        };

        contacts.push(created);

        reply.code(200).send({
          ok: true,
          mode: "intake",
          email: created.email,
          score: created.score,
          segment: created.segment,
          followupPlan: qualified.followupPlan,
          duplicateDetected: false,
          persisted: true
        });
      }
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-1/contacts/preview-followup",
      contactPreviewFollowupPostRouteContract,
      async (request, reply) => {
        const qualified = qualifyContact(request.body);

        if (!qualified.ok) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: qualified.code,
            details: qualified.details
          });
          return;
        }

        const duplicate = contacts.find((entry) => entry.email === qualified.normalized.email);

        reply.code(200).send({
          ok: true,
          mode: "preview",
          email: qualified.normalized.email,
          score: qualified.score,
          segment: qualified.segment,
          followupPlan: qualified.followupPlan,
          duplicateDetected: Boolean(duplicate),
          persisted: false
        });
      }
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-1/contacts/:contactId",
      contactByIdGetRouteContract,
      async (request, reply) => {
        const contactId = String(request.params?.contactId || "").trim();
        const found = contacts.find((entry) => entry.id === contactId) || null;

        if (!found) {
          reply.code(404).send({
            error: "Contact not found.",
            code: "contact_not_found",
            details: [`No contact found for id ${contactId || "<empty>"}.`]
          });
          return;
        }

        reply.code(200).send({
          ok: true,
          contact: found
        });
      }
    );
  }
}

export { Stage1MonolithProvider };
```
<!-- /DOCS:EXAMPLE -->

The routing contracts are stored in an external file. They are self explanatory.

Use `docs/examples/03.real-app/src/shared/schemas/contactSchemas.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/shared/schemas/contactSchemas.js" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";

/**
 * Chapter 3 baseline route contracts (Stages 1-6).
 *
 * How this maps to controller flow:
 * - POST routes: controller/action reads body (+ query when needed).
 * - GET by id route: controller/action reads params.contactId.
 * - These route contracts validate incoming request data before controller code runs.
 * - Controller/action responses are expected to match the response maps below.
 *
 * Stage 7 adds normalization in a separate file:
 * - ./contactSchemasStage7.js
 */

// 1) Incoming request schemas (transport validation).
const contactIntakePreviewBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ minLength: 5, maxLength: 200 }),
    company: Type.String({ minLength: 1, maxLength: 160 }),
    employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactIntakePreviewQuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const contactByIdParamsSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

// 2) Contact read model schema (what a stored/retrieved contact record looks like).
const contactStoredRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    company: Type.String({ minLength: 1 }),
    employees: Type.Integer({ minimum: 1 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean(),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

// 3) Success response schemas.
const contactIntakePreviewSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
    email: Type.String({ minLength: 1 }),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 }),
    followupPlan: Type.Array(Type.String({ minLength: 1 })),
    duplicateDetected: Type.Boolean(),
    persisted: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactByIdSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    contact: contactStoredRecordSchema
  },
  { additionalProperties: false }
);

// 4) Error response schemas.
const contactIntakePreviewDomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const contactGenericErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(Type.Record(Type.String(), Type.String())),
    statusCode: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

// 5) Response maps by route family.
const contactByIdResponseSchema = Object.freeze({
  200: contactByIdSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactGenericErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

const contactIntakePreviewResponseSchema = Object.freeze({
  200: contactIntakePreviewSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactIntakePreviewDomainErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

// 6) Route contracts consumed by router.register(...).
const contactIntakePostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactPreviewFollowupPostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactByIdGetRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: {
    schema: contactByIdParamsSchema
  },
  response: contactByIdResponseSchema
});

export {
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract,
  contactByIdGetRouteContract
};
```
<!-- /DOCS:EXAMPLE -->

Practical consequence in `router.register(...)`:

- You pass the contract object directly as the route options argument.
- Fastify validation and response schema expectations are applied from that object.

Finally, the functions to nornmalize fields are placed in a file in the package's `shared` folder:

Use `docs/examples/03.real-app/src/shared/input/contactInputNormalization.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/shared/input/contactInputNormalization.js" lang="js" -->
<!-- /DOCS:EXAMPLE -->

### Run and test

```bash
npm run dev
```

```bash
curl -i -X POST "http://localhost:3000/api/v1/contacts/intake" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Alice Jones",
    "email":"alice@acme.com",
    "company":"Acme",
    "employees":240,
    "plan":"growth",
    "source":"referral",
    "country":"US",
    "consentMarketing":true
  }'
```

```bash
curl -i -X POST "http://localhost:3000/api/v1/contacts/preview-followup" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Alice Jones",
    "email":"alice@acme.com",
    "company":"Acme",
    "employees":240,
    "plan":"growth",
    "source":"referral",
    "country":"US",
    "consentMarketing":true
  }'
```

```bash
curl -i "http://localhost:3000/api/v1/docs/ch03/stage-1/contacts/contact-does-not-exist"
```

### Why this hurts

- provider still owns transport + domain + persistence logic in one place
- business logic is mixed with HTTP handling
- data storage policy is hidden in route code
- testing one rule requires booting route runtime

This is exactly when teams start introducing layers.

## Stage 2: Extract a Controller (Better, But Not Enough)

Now we move handler logic out of provider and into a controller.

This already helps because routes become wiring only. But the controller still owns domain logic and persistence details, so it is still overloaded.

### The new simplified provider

The goal of creating controllers is to have much simplified providers.

This is what the provider will look like.

Use `docs/examples/03.real-app/src/server/providers/Stage2ControllerProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage2ControllerProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage2 } from "../controllers/ContactControllerStage2.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const STAGE_2_CONTROLLER = "docs.examples.03.stage2.controller";

class Stage2ControllerProvider {
  static id = "docs.examples.03.stage2";

  register(app) {
    app.singleton(STAGE_2_CONTROLLER, () => new ContactControllerStage2());
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_2_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-2/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage2ControllerProvider };
```
<!-- /DOCS:EXAMPLE -->


### Create the controllers

For the controllers, we effectively use the code we just pulled out.

Transport normalization is extracted to shared input utilities immediately, so it does not need to hop from controller to service later.

Use `docs/examples/03.real-app/src/shared/input/contactInputNormalization.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/shared/input/contactInputNormalization.js" lang="js" -->
```js
function normalizeContactBody(rawBody) {
  return {
    name: String(rawBody?.name || "").trim(),
    email: String(rawBody?.email || "").trim().toLowerCase(),
    company: String(rawBody?.company || "").trim(),
    employees: Number(rawBody?.employees || 0),
    plan: String(rawBody?.plan || "").trim().toLowerCase(),
    source: String(rawBody?.source || "").trim().toLowerCase(),
    country: String(rawBody?.country || "").trim().toUpperCase(),
    consentMarketing: Boolean(rawBody?.consentMarketing)
  };
}

function normalizeContactQuery(rawQuery) {
  return {
    dryRun: rawQuery?.dryRun === true || rawQuery?.dryRun === "true"
  };
}

function normalizeContactParams(rawParams) {
  return {
    contactId: String(rawParams?.contactId || "").trim()
  };
}

export {
  normalizeContactBody,
  normalizeContactQuery,
  normalizeContactParams
};
```
<!-- /DOCS:EXAMPLE -->

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage2.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage2" lang="js" -->
```js
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class ContactControllerStage2 {
  constructor() {
    this.contacts = [];
  }

  validateContact(normalized) {
    const details = [];
    if (normalized.name.length < 2) details.push("name must have at least 2 characters.");
    if (!normalized.email.includes("@")) details.push("email must include @.");
    if (normalized.plan === "starter" && normalized.employees > 200) {
      details.push("starter plan supports up to 200 employees");
    }

    return details;
  }

  scoreContact(normalized) {
    const planScore =
      normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
    const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
    return Math.max(0, Math.min(100, planScore + employeeScore));
  }

  segmentFromScore(score) {
    if (score >= 70) return "enterprise_hot";
    if (score >= 40) return "growth_warm";
    return "starter_cold";
  }

  buildFollowupPlan({ segment, source }) {
    const plan = [];

    if (segment === "enterprise_hot") {
      plan.push("assign account executive in 15 minutes");
      plan.push("send solution outline today");
    } else if (segment === "growth_warm") {
      plan.push("send product-fit email in 2 hours");
      plan.push("schedule follow-up in 2 days");
    } else {
      plan.push("send starter onboarding guide");
      plan.push("review intent in 7 days");
    }

    if (source === "webinar") {
      plan.push("include webinar recap");
    }

    return plan;
  }

  qualify(raw) {
    const normalized = normalizeContactBody(raw);
    const details = this.validateContact(normalized);

    if (details.length > 0) {
      return {
        ok: false,
        code: "domain_validation_failed",
        details,
        normalized
      };
    }

    const score = this.scoreContact(normalized);
    const segment = this.segmentFromScore(score);
    const followupPlan = this.buildFollowupPlan({
      segment,
      source: normalized.source
    });

    return {
      ok: true,
      normalized,
      score,
      segment,
      followupPlan
    };
  }

  async intake(request, reply) {
    const qualified = this.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);
    if (duplicate) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      });
      return;
    }

    const created = {
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    };

    this.contacts.push(created);

    reply.code(200).send({
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: false,
      persisted: true
    });
  }

  async previewFollowup(request, reply) {
    const qualified = this.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);

    reply.code(200).send({
      ok: true,
      mode: "preview",
      email: qualified.normalized.email,
      score: qualified.score,
      segment: qualified.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    });
  }

  async show(request, reply) {
    const contactId = String(request.params?.contactId || "").trim();
    const found = this.contacts.find((entry) => entry.id === contactId) || null;

    if (!found) {
      reply.code(404).send({
        error: "Contact not found.",
        code: "contact_not_found",
        details: [`No contact found for id ${contactId || "<empty>"}.`]
      });
      return;
    }

    reply.code(200).send({
      ok: true,
      contact: found
    });
  }
}

export { ContactControllerStage2 };
```
<!-- /DOCS:EXAMPLE -->


Routes are now thin delegates, but the controller still carries too much responsibility.

### What improved

- provider now focuses on assembly and route mapping
- request handlers now delegate to controller methods instead of embedding domain logic in provider

### What still hurts

- controller is still the domain engine (`validate`, `score`, `segment`, `followupPlan`, `qualify`)
- controller still mixes orchestration + domain rules + storage access

## Stage 3: Extract a Service (Domain Logic in One Place)

Now we isolate business rules into one class.

### Create the new updated provider for Stage 3

To do this, the provider first registers the service as a singleton:

```js
    app.singleton(STAGE_3_QUALIFICATION_SERVICE, () => new ContactQualificationService());
```

Then, when creating the controller, it will pass the service as a parameter:

```js
    app.singleton(
      STAGE_3_CONTROLLER,
      () =>
        new ContactControllerStage3({
          qualificationService: app.make(STAGE_3_QUALIFICATION_SERVICE)
        })
    );
```

One question may arise: why create the singleton, if the service is then passed as a parameter in the controller's constructor? It's a way for the provider to wire dependencies, and the controller just uses them. That is good because:

- dependencies are explicit (you can read constructor and know what it needs)
- easier tests (pass a fake service directly, no container boot needed)
- controller stays framework/container-agnostic
- failures happen earlier (bad wiring shows up at composition time, not deep at runtime)
- cleaner architecture: provider = wiring, controller = behavior

If controller did this internally:

```js
  // Note: NOT best practice!
  this.app.make(STAGE_3_QUALIFICATION_SERVICE)
```

It becomes a Service Locator pattern. Problems:

- hidden dependencies (not visible in constructor)
- harder tests (must mock container/app)
- controller now depends on container API
- more runtime surprises (token not found) during request handling
- mixing composition concerns into business code

While `make()` exists, but it should mostly live in providers (composition root), not in controller methods.

This is the final code of the provider.

Use `docs/examples/03.real-app/src/server/providers/Stage3ServiceProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage3ServiceProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage3 } from "../controllers/ContactControllerStage3.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const STAGE_3_QUALIFICATION_SERVICE = "docs.examples.03.stage3.service.qualification";
const STAGE_3_CONTROLLER = "docs.examples.03.stage3.controller";

class Stage3ServiceProvider {
  static id = "docs.examples.03.stage3";

  register(app) {
    app.singleton(STAGE_3_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_3_CONTROLLER,
      () =>
        new ContactControllerStage3({
          qualificationService: app.make(STAGE_3_QUALIFICATION_SERVICE)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_3_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-3/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-3/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-3/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage3ServiceProvider };
```
<!-- /DOCS:EXAMPLE -->


### Update controller to delegate to service

In Stage 2, the controller still owned domain methods (`validateContact`, `scoreContact`, `segmentFromScore`, `buildFollowupPlan`, `qualify`).

In Stage 3, the controller delegates that domain work to `ContactQualificationService`.  
This keeps controller responsibilities focused on:

- reading transport input (`request.body`)
- calling domain logic
- mapping result to HTTP response

In the new controller, the business specific functions are moved out (`validateContact)`, `scoreContact()`, `segmentFromScore()`, `buildFollowupPlan()`, `qualify()`) and the service passed into the constructor is saved onto `this.` and used:

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage3.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage3" lang="js" -->
```js
class ContactControllerStage3 {
  constructor({ qualificationService }) {
    this.qualificationService = qualificationService;
    this.contacts = [];
  }

  async intake(request, reply) {
    const qualified = this.qualificationService.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);
    if (duplicate) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      });
      return;
    }

    const created = {
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    };

    this.contacts.push(created);

    reply.code(200).send({
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: false,
      persisted: true
    });
  }

  async previewFollowup(request, reply) {
    const qualified = this.qualificationService.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);

    reply.code(200).send({
      ok: true,
      mode: "preview",
      email: qualified.normalized.email,
      score: qualified.score,
      segment: qualified.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    });
  }

  async show(request, reply) {
    const contactId = String(request.params?.contactId || "").trim();
    const found = this.contacts.find((entry) => entry.id === contactId) || null;

    if (!found) {
      reply.code(404).send({
        error: "Contact not found.",
        code: "contact_not_found",
        details: [`No contact found for id ${contactId || "<empty>"}.`]
      });
      return;
    }

    reply.code(200).send({
      ok: true,
      contact: found
    });
  }
}

export { ContactControllerStage3 };
```
<!-- /DOCS:EXAMPLE -->

### Create service

Now create the service that holds domain logic in one place.

Philosophy:

- service owns business rules
- controller should not reimplement those rules
- this makes domain behavior easy to test without booting HTTP routes

Use `docs/examples/03.real-app/src/server/services/ContactQualificationService.js`:

<!-- DOCS:EXAMPLE package="03.real-app" service="ContactQualificationService" lang="js" -->
```js
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class ContactQualificationService {
  validate(normalized) {
    const details = [];
    if (normalized.name.length < 2) details.push("name must have at least 2 characters.");
    if (!normalized.email.includes("@")) details.push("email must include @.");
    if (normalized.plan === "starter" && normalized.employees > 200) {
      details.push("starter plan supports up to 200 employees");
    }

    return details;
  }

  score(normalized) {
    const planScore =
      normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
    const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
    return Math.max(0, Math.min(100, planScore + employeeScore));
  }

  segment(score) {
    if (score >= 70) return "enterprise_hot";
    if (score >= 40) return "growth_warm";
    return "starter_cold";
  }

  followupPlan({ segment, source }) {
    const plan = [];
    if (segment === "enterprise_hot") {
      plan.push("assign account executive in 15 minutes");
      plan.push("send solution outline today");
    } else if (segment === "growth_warm") {
      plan.push("send product-fit email in 2 hours");
      plan.push("schedule follow-up in 2 days");
    } else {
      plan.push("send starter onboarding guide");
      plan.push("review intent in 7 days");
    }

    if (source === "webinar") {
      plan.push("include webinar recap");
    }

    return plan;
  }

  qualify(raw) {
    const normalized = normalizeContactBody(raw);
    const details = this.validate(normalized);

    if (details.length > 0) {
      return {
        ok: false,
        code: "domain_validation_failed",
        details,
        normalized
      };
    }

    const score = this.score(normalized);
    const segment = this.segment(score);
    const followupPlan = this.followupPlan({ segment, source: normalized.source });

    return {
      ok: true,
      normalized,
      score,
      segment,
      followupPlan
    };
  }
}

export { ContactQualificationService };
```
<!-- /DOCS:EXAMPLE -->

### Service contract (`qualify(raw)`)

`qualify(raw)` returns one of two shapes:

- success:
```js
{
  ok: true,
  normalized,
  score,
  segment,
  followupPlan
}
```

- failure:
```js
{
  ok: false,
  code: "domain_validation_failed",
  details,
  normalized
}
```

This keeps response handling explicit in the controller while centralizing business rules in the service.

### End-to-end flow for intake in Stage 3

1. Route validates input shape through `contactIntakePostRouteContract`.
2. Controller receives `request.body`.
3. Controller calls `qualificationService.qualify(request.body)`.
4. Service returns either domain failure (`ok: false`) or qualified result (`ok: true`).
5. Controller maps that result to HTTP response payload and status code.
6. Controller still stores/retrieves contacts locally (`this.contacts`) for now.

### Why Stage 4 is still needed

Stage 3 removed duplicated domain logic, but persistence is still in the controller:

- duplicate checks read from `this.contacts` in controller methods
- writes (`push`) happen in controller code
- `show` route lookup also lives in controller

That means storage policy is still mixed into HTTP orchestration. Stage 4 fixes this by moving data access behind a repository contract.

### What improved

- one place for business logic
- easier unit tests for domain behavior
- controller becomes smaller

### What still hurts

- controller still orchestrates data access details
- persistence strategy is still not isolated behind a contract

## Stage 4: Extract Repository (Data Access Contract)

Now we isolate persistence concerns from controller code.

We are not introducing the official DB module yet. That is deliberate.

For now, we use an in-memory repository implementation behind a repository token. This keeps architecture correct while staying dependency-light.

### Full provider code for Stage 4

With the new repository as a module, the providers becomes much cleaner:

(CODEX: Summarise the changes, as I did in Stage 3)

Use `docs/examples/03.real-app/src/server/providers/Stage4RepositoryProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage4RepositoryProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage4 } from "../controllers/ContactControllerStage4.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const STAGE_4_QUALIFICATION_SERVICE = "docs.examples.03.stage4.service.qualification";
const STAGE_4_REPOSITORY = "docs.examples.03.stage4.repository";
const STAGE_4_CONTROLLER = "docs.examples.03.stage4.controller";

class Stage4RepositoryProvider {
  static id = "docs.examples.03.stage4";

  register(app) {
    app.singleton(STAGE_4_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(STAGE_4_REPOSITORY, () => new InMemoryContactRepository());

    app.singleton(
      STAGE_4_CONTROLLER,
      () =>
        new ContactControllerStage4({
          qualificationService: app.make(STAGE_4_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_4_REPOSITORY)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_4_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-4/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-4/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-4/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage4RepositoryProvider };
```
<!-- /DOCS:EXAMPLE -->



### Create repository and token

We now need the code that actually implements the repository.

(CODEX: Explain why you create the token AND the repository together)

Use `docs/examples/03.real-app/src/server/repositories/ContactRepository.js`:

<!-- DOCS:EXAMPLE package="03.real-app" repository="ContactRepository" lang="js" -->
```js
const CONTACT_REPOSITORY_TOKEN = "docs.examples.03.contacts.repository";

class ContactRepository {
  findById(_id) {
    throw new Error("ContactRepository.findById must be implemented.");
  }

  findByEmail(_email) {
    throw new Error("ContactRepository.findByEmail must be implemented.");
  }

  save(_contact) {
    throw new Error("ContactRepository.save must be implemented.");
  }

  list() {
    throw new Error("ContactRepository.list must be implemented.");
  }
}

export { CONTACT_REPOSITORY_TOKEN, ContactRepository };
```
<!-- /DOCS:EXAMPLE -->

And the actual implementation:

Use `docs/examples/03.real-app/src/server/repositories/InMemoryContactRepository.js`:

<!-- DOCS:EXAMPLE package="03.real-app" repository="InMemoryContactRepository" lang="js" -->
```js
import { ContactRepository } from "./ContactRepository.js";

class InMemoryContactRepository extends ContactRepository {
  constructor() {
    super();
    this.byId = new Map();
    this.byEmail = new Map();
  }

  findById(id) {
    return this.byId.get(id) || null;
  }

  findByEmail(email) {
    const id = this.byEmail.get(email) || null;
    if (!id) {
      return null;
    }
    return this.byId.get(id) || null;
  }

  save(contact) {
    this.byId.set(contact.id, contact);
    this.byEmail.set(contact.email, contact.id);
    return contact;
  }

  list() {
    return [...this.byId.values()];
  }
}

export { InMemoryContactRepository };
```
<!-- /DOCS:EXAMPLE -->


### What improved

- data access now has a clear contract
- storage backend can change without changing business logic
- repository rules are testable independently

### What still hurts

- controller still contains use-case orchestration logic
- changing workflow means editing controller methods directly

## Stage 5: Extract Actions (Use-Case Orchestration)

Actions model each business use case explicitly.

Create:

- `CreateContactIntakeAction`
- `PreviewContactFollowupAction`

### Create actions

Use `docs/examples/03.real-app/src/server/actions/CreateContactIntakeAction.js`:

<!-- DOCS:EXAMPLE package="03.real-app" action="CreateContactIntakeAction" lang="js" -->
```js
class CreateContactIntakeAction {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
  }

  execute(payload) {
    const qualified = this.qualificationService.qualify(payload);
    if (!qualified.ok) {
      return {
        ok: false,
        status: 422,
        code: qualified.code,
        details: qualified.details
      };
    }

    const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);
    if (duplicate) {
      return {
        ok: false,
        status: 422,
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      };
    }

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    });

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: "intake",
        email: created.email,
        score: created.score,
        segment: created.segment,
        followupPlan: qualified.followupPlan,
        duplicateDetected: false,
        persisted: true
      }
    };
  }
}

export { CreateContactIntakeAction };
```
<!-- /DOCS:EXAMPLE -->

Use `docs/examples/03.real-app/src/server/actions/PreviewContactFollowupAction.js`:

<!-- DOCS:EXAMPLE package="03.real-app" action="PreviewContactFollowupAction" lang="js" -->
```js
class PreviewContactFollowupAction {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
  }

  execute(payload) {
    const qualified = this.qualificationService.qualify(payload);
    if (!qualified.ok) {
      return {
        ok: false,
        status: 422,
        code: qualified.code,
        details: qualified.details
      };
    }

    const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: "preview",
        email: qualified.normalized.email,
        score: qualified.score,
        segment: qualified.segment,
        followupPlan: qualified.followupPlan,
        duplicateDetected: Boolean(duplicate),
        persisted: false
      }
    };
  }
}

export { PreviewContactFollowupAction };
```
<!-- /DOCS:EXAMPLE -->

### Update controller to be thin

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage5.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage5" lang="js" -->
```js
class ContactControllerStage5 {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  async intake(request, reply) {
    const result = this.createContactIntakeAction.execute(request.body);
    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async previewFollowup(request, reply) {
    const result = this.previewContactFollowupAction.execute(request.body);
    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async show(request, reply) {
    const result = this.getContactByIdAction.execute({
      contactId: request.params?.contactId
    });
    if (!result.ok) {
      reply.code(result.status).send({
        error: "Contact not found.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }
}

export { ContactControllerStage5 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 5

Use `docs/examples/03.real-app/src/server/providers/Stage5ActionProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage5ActionProvider" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage5 } from "../controllers/ContactControllerStage5.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import { contactByIdGetRouteContract } from "../../shared/schemas/contactSchemas.js";

const STAGE_5_REPOSITORY = "docs.examples.03.stage5.repository";
const STAGE_5_QUALIFICATION_SERVICE = "docs.examples.03.stage5.service.qualification";
const STAGE_5_CREATE_ACTION = "docs.examples.03.stage5.actions.create";
const STAGE_5_PREVIEW_ACTION = "docs.examples.03.stage5.actions.preview";
const STAGE_5_GET_BY_ID_ACTION = "docs.examples.03.stage5.actions.getById";
const STAGE_5_CONTROLLER = "docs.examples.03.stage5.controller";

const stage5BodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ minLength: 5, maxLength: 200 }),
    company: Type.String({ minLength: 1, maxLength: 160 }),
    employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean()
  },
  { additionalProperties: false }
);

const stage5SuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
    email: Type.String({ minLength: 1 }),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 }),
    followupPlan: Type.Array(Type.String({ minLength: 1 })),
    duplicateDetected: Type.Boolean(),
    persisted: Type.Boolean()
  },
  { additionalProperties: false }
);

const stage5DomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const stage5ErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(Type.Record(Type.String(), Type.String())),
    statusCode: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

class Stage5ActionProvider {
  static id = "docs.examples.03.stage5";

  register(app) {
    app.singleton(STAGE_5_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_5_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_5_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
          contactRepository: app.make(STAGE_5_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_5_CONTROLLER,
      () =>
        new ContactControllerStage5({
          createContactIntakeAction: app.make(STAGE_5_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_5_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_5_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_5_CONTROLLER);

    const response = {
      200: stage5SuccessSchema,
      400: stage5ErrorSchema,
      401: stage5ErrorSchema,
      403: stage5ErrorSchema,
      404: stage5ErrorSchema,
      409: stage5ErrorSchema,
      422: stage5DomainErrorSchema,
      429: stage5ErrorSchema,
      500: stage5ErrorSchema,
      503: stage5ErrorSchema
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/intake",
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: intake"
        },
        body: {
          schema: stage5BodySchema
        },
        response
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
        meta: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: preview"
        },
        body: {
          schema: stage5BodySchema
        },
        response
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-5/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage5ActionProvider };
```
<!-- /DOCS:EXAMPLE -->

### What improved

- controller now maps HTTP only
- use-case orchestration is explicit and testable
- business rules and persistence are isolated from HTTP concerns

## Stage 6: Shared Schemas + Baseline Provider Wiring

Now we compose everything together in a clean baseline structure, before the advanced Stage 7 to Stage 10 refinements.

### Shared schemas

Use `docs/examples/03.real-app/src/shared/schemas/contactSchemas.js`:

<!-- DOCS:EXAMPLE package="03.real-app" schema="contactSchemas" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";

/**
 * Chapter 3 baseline route contracts (Stages 1-6).
 *
 * How this maps to controller flow:
 * - POST routes: controller/action reads body (+ query when needed).
 * - GET by id route: controller/action reads params.contactId.
 * - These route contracts validate incoming request data before controller code runs.
 * - Controller/action responses are expected to match the response maps below.
 *
 * Stage 7 adds normalization in a separate file:
 * - ./contactSchemasStage7.js
 */

// 1) Incoming request schemas (transport validation).
const contactIntakePreviewBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ minLength: 5, maxLength: 200 }),
    company: Type.String({ minLength: 1, maxLength: 160 }),
    employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactIntakePreviewQuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const contactByIdParamsSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

// 2) Contact read model schema (what a stored/retrieved contact record looks like).
const contactStoredRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    company: Type.String({ minLength: 1 }),
    employees: Type.Integer({ minimum: 1 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean(),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

// 3) Success response schemas.
const contactIntakePreviewSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
    email: Type.String({ minLength: 1 }),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 }),
    followupPlan: Type.Array(Type.String({ minLength: 1 })),
    duplicateDetected: Type.Boolean(),
    persisted: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactByIdSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    contact: contactStoredRecordSchema
  },
  { additionalProperties: false }
);

// 4) Error response schemas.
const contactIntakePreviewDomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const contactGenericErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(Type.Record(Type.String(), Type.String())),
    statusCode: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

// 5) Response maps by route family.
const contactByIdResponseSchema = Object.freeze({
  200: contactByIdSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactGenericErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

const contactIntakePreviewResponseSchema = Object.freeze({
  200: contactIntakePreviewSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactIntakePreviewDomainErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

// 6) Route contracts consumed by router.register(...).
const contactIntakePostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactPreviewFollowupPostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactByIdGetRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: {
    schema: contactByIdParamsSchema
  },
  response: contactByIdResponseSchema
});

export {
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract,
  contactByIdGetRouteContract
};
```
<!-- /DOCS:EXAMPLE -->

### Provider wiring

Use `docs/examples/03.real-app/src/server/providers/Stage6LayeredProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage6LayeredProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage6 } from "../controllers/ContactControllerStage6.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const STAGE_6_REPOSITORY = "docs.examples.03.stage6.repository";
const STAGE_6_QUALIFICATION_SERVICE = "docs.examples.03.stage6.service.qualification";
const STAGE_6_CREATE_ACTION = "docs.examples.03.stage6.actions.create";
const STAGE_6_PREVIEW_ACTION = "docs.examples.03.stage6.actions.preview";
const STAGE_6_GET_BY_ID_ACTION = "docs.examples.03.stage6.actions.getById";
const STAGE_6_CONTROLLER = "docs.examples.03.stage6.controller";

class Stage6LayeredProvider {
  static id = "docs.examples.03.stage6";

  register(app) {
    app.singleton(STAGE_6_REPOSITORY, () => new InMemoryContactRepository());

    app.singleton(
      STAGE_6_QUALIFICATION_SERVICE,
      () => new ContactQualificationService()
    );

    app.singleton(
      STAGE_6_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_6_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
          contactRepository: app.make(STAGE_6_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_6_CONTROLLER,
      () =>
        new ContactControllerStage6({
          createContactIntakeAction: app.make(STAGE_6_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_6_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_6_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_6_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-6/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage6LayeredProvider };
```
<!-- /DOCS:EXAMPLE -->

At this point, the architecture is clean and practical:

- provider composes dependencies
- controller handles HTTP mapping
- actions represent use cases
- service owns business logic
- repository owns data access
- schemas are shared contracts

However, there are still improvements that are possible.

## Stage 7: Route Contract API and Normalization

Stage 1 already introduced the route contract object in shared code. At that point the contract carries transport schemas, but normalization still happens manually in application code.

In Stage 7 we add a second shared file dedicated to normalized variants. We keep the Stage 1 file unchanged on purpose, so the baseline remains readable and stable while this stage adds one new concept.

### Stage 1 baseline contract shape (no `normalize`)

Use this as the initial shared contract format:

```js
export const contactIntakePostRouteContract = {
  meta: { tags: ["contacts"], summary: "Create contact" },
  body: {
    schema: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        email: Type.String({ minLength: 5, maxLength: 200 }),
        company: Type.String({ minLength: 1, maxLength: 160 }),
        employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
        plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
        source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
        country: Type.String({ minLength: 2, maxLength: 2 }),
        consentMarketing: Type.Boolean()
      },
      { additionalProperties: false }
    )
  },
  query: {
    schema: Type.Object(
      {
        dryRun: Type.Optional(Type.Boolean())
      },
      { additionalProperties: false }
    )
  },
  response: {
    200: Type.Object(
      {
        ok: Type.Boolean(),
        mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
        email: Type.String({ minLength: 1 }),
        score: Type.Integer({ minimum: 0, maximum: 100 }),
        segment: Type.String({ minLength: 1 }),
        followupPlan: Type.Array(Type.String({ minLength: 1 })),
        duplicateDetected: Type.Boolean(),
        persisted: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    400: Type.Object({ error: Type.String({ minLength: 1 }) }),
    401: Type.Object({ error: Type.String({ minLength: 1 }) }),
    403: Type.Object({ error: Type.String({ minLength: 1 }) }),
    404: Type.Object({ error: Type.String({ minLength: 1 }) }),
    409: Type.Object({ error: Type.String({ minLength: 1 }) }),
    422: Type.Object(
      {
        error: Type.String({ minLength: 1 }),
        code: Type.String({ minLength: 1 }),
        details: Type.Array(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    ),
    429: Type.Object({ error: Type.String({ minLength: 1 }) }),
    500: Type.Object({ error: Type.String({ minLength: 1 }) }),
    503: Type.Object({ error: Type.String({ minLength: 1 }) })
  }
};
```

In this baseline form, controllers/actions still normalize manually from `request.body` and `request.query`.

### Stage 7 upgraded contract shape (normalization moved to the contract)

Now add `normalize` in `body` and `query`:

```js
export const contactIntakePostRouteContractStage7 = {
  meta: { tags: ["contacts"], summary: "Create contact" },
  body: {
    schema: /* same schema as above */,
    normalize: (body) => ({
      name: String(body?.name || "").trim(),
      email: String(body?.email || "").trim().toLowerCase(),
      company: String(body?.company || "").trim(),
      employees: Number(body?.employees || 0),
      plan: String(body?.plan || "").trim().toLowerCase(),
      source: String(body?.source || "").trim().toLowerCase(),
      country: String(body?.country || "").trim().toUpperCase(),
      consentMarketing: Boolean(body?.consentMarketing)
    })
  },
  query: {
    schema: /* same schema as above */,
    normalize: (query) => ({
      dryRun: query?.dryRun === "true" || query?.dryRun === true
    })
  },
  response: /* same response schema map as above */
};
```

### What each contract field means

- `meta`: documentation metadata for the route (`tags`, `summary`).
- `body.schema`: transport validation for request body.
- `query.schema`: transport validation for request query.
- `params.schema`: transport validation for route params (optional, when route has params).
- `response`: response schema map by HTTP status.
- `body.normalize` / `query.normalize` / `params.normalize`: deterministic input shaping after schema validation.

`query.schema` maps to Fastify `querystring` internally, while normalized query is available as `request.input.query`.

### Route registration with contract object

`router.register(...)` now accepts this contract-shaped options object directly:

```js
router.register(
  "POST",
  "/api/v1/docs/ch03/stage-7/contacts/intake",
  contactIntakePostRouteContractStage7,
  (request, reply) => controller.intake(request, reply)
);
```

This is the third argument (route options object). There is no separate legacy `schema` + `input` authoring path in this style.

### Execution order

1. `*.schema` validates incoming data.
2. `*.normalize` transforms validated data.
3. runtime exposes normalized values as `request.input`.
4. controller/action reads `request.input.body`, `request.input.query`, `request.input.params`.

### Full shared contract code

Use `docs/examples/03.real-app/src/shared/schemas/contactSchemasStage7.js`:

<!-- DOCS:EXAMPLE package="03.real-app" schema="contactSchemasStage7" lang="js" -->
```js
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "./contactSchemas.js";
import {
  normalizeContactBody,
  normalizeContactQuery,
  normalizeContactParams
} from "../input/contactInputNormalization.js";

const contactIntakePostRouteContractStage7 = Object.freeze({
  ...contactIntakePostRouteContract,
  body: Object.freeze({
    ...contactIntakePostRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactIntakePostRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactPreviewFollowupPostRouteContractStage7 = Object.freeze({
  ...contactPreviewFollowupPostRouteContract,
  body: Object.freeze({
    ...contactPreviewFollowupPostRouteContract.body,
    normalize: normalizeContactBody
  }),
  query: Object.freeze({
    ...contactPreviewFollowupPostRouteContract.query,
    normalize: normalizeContactQuery
  })
});

const contactByIdGetRouteContractStage7 = Object.freeze({
  ...contactByIdGetRouteContract,
  params: Object.freeze({
    ...contactByIdGetRouteContract.params,
    normalize: normalizeContactParams
  })
});

export {
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7,
  contactByIdGetRouteContractStage7
};
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 7

Use `docs/examples/03.real-app/src/server/providers/Stage7RequestPipelineProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage7RequestPipelineProvider" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage7 } from "../controllers/ContactControllerStage7.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { GetContactByIdAction } from "../actions/GetContactByIdAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import {
  contactByIdGetRouteContractStage7,
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7
} from "../../shared/schemas/contactSchemasStage7.js";

const STAGE_7_REPOSITORY = "docs.examples.03.stage7.repository";
const STAGE_7_QUALIFICATION_SERVICE = "docs.examples.03.stage7.service.qualification";
const STAGE_7_CREATE_ACTION = "docs.examples.03.stage7.actions.create";
const STAGE_7_PREVIEW_ACTION = "docs.examples.03.stage7.actions.preview";
const STAGE_7_GET_BY_ID_ACTION = "docs.examples.03.stage7.actions.getById";
const STAGE_7_CONTROLLER = "docs.examples.03.stage7.controller";

class Stage7RequestPipelineProvider {
  static id = "docs.examples.03.stage7";

  register(app) {
    app.singleton(STAGE_7_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_7_QUALIFICATION_SERVICE, () => new ContactQualificationService());

    app.singleton(
      STAGE_7_CREATE_ACTION,
      () =>
        new CreateContactIntakeAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupAction({
          qualificationService: app.make(STAGE_7_QUALIFICATION_SERVICE),
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdAction({
          contactRepository: app.make(STAGE_7_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_7_CONTROLLER,
      () =>
        new ContactControllerStage7({
          createContactIntakeAction: app.make(STAGE_7_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_7_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_7_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_7_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/intake",
      contactIntakePostRouteContractStage7,
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
      contactPreviewFollowupPostRouteContractStage7,
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-7/contacts/:contactId",
      contactByIdGetRouteContractStage7,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage7RequestPipelineProvider };
```
<!-- /DOCS:EXAMPLE -->

### Controller consumption pattern in Stage 7

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage7.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage7" lang="js" -->
```js
class ContactControllerStage7 {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  async intake(request, reply) {
    const payload = request.input.body;
    const query = request.input.query;

    const result = query.dryRun
      ? this.previewContactFollowupAction.execute(payload)
      : this.createContactIntakeAction.execute(payload);

    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async previewFollowup(request, reply) {
    const payload = request.input.body;
    const result = this.previewContactFollowupAction.execute(payload);

    if (!result.ok) {
      reply.code(result.status).send({
        error: "Domain validation failed.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }

  async show(request, reply) {
    const result = this.getContactByIdAction.execute({
      contactId: request.input?.params?.contactId || request.params?.contactId
    });
    if (!result.ok) {
      reply.code(result.status).send({
        error: "Contact not found.",
        code: result.code,
        details: result.details
      });
      return;
    }

    reply.code(200).send(result.data);
  }
}

export { ContactControllerStage7 };
```
<!-- /DOCS:EXAMPLE -->

### What improved

- Stage 1 and Stage 7 share the same contract API shape, but Stage 7 adds normalization where it belongs.
- provider stays wiring-only and reads shared route contracts directly.
- transport validation and normalization are both visible in one shared object.
- controllers/actions consume stable normalized input via `request.input`.

## Stage 8: Domain Validation and Error Ergonomics

Stage 8 changes domain-failure handling from manual per-controller branching to one centralized thrown-error flow.

Before (manual result mapping in each controller method):

```js
const result = this.createContactIntakeAction.execute(request.body);
if (!result.ok) {
  reply.code(result.status).send({
    error: "Domain validation failed.",
    code: result.code,
    details: result.details
  });
  return;
}
reply.code(200).send(result.data);
```

After (controller handles success path only, and errors are mapped globally):

```js
import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage8 extends BaseController {
  async intake(request, reply) {
    const payload = request?.input?.body || request?.body || {};
    const created = await this.createContactIntakeAction.execute(payload);
    return this.ok(reply, created);
  }
}

import { assertNoDomainRuleFailures } from "../support/domainRuleValidation.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class CreateContactIntakeActionStage8 {
  async execute(payload) {
    const normalized = normalizeContactBody(payload);
    assertNoDomainRuleFailures(this.domainRulesService.buildRules(normalized));
    // ... domain conflict checks, persistence, return success payload
  }
}
```

What changed in this stage:

- controller extends `BaseController`, and stays focused on happy-path responses (`ok(...)`)
- actions throw domain errors (`DomainValidationError`, `ConflictError`) instead of returning `ok: false` objects
- provider installs `registerApiErrorHandler(...)` once, so thrown app/domain errors are mapped consistently
- domain-rule evaluation is centralized in `domainRuleValidation.js` (no duplicated rule-loop logic in each action)

### Full provider code for Stage 8

Use `docs/examples/03.real-app/src/server/providers/Stage8ErrorErgonomicsProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage8ErrorErgonomicsProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage8 } from "../controllers/ContactControllerStage8.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { GetContactByIdActionStage8 } from "../actions/GetContactByIdActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

const STAGE_8_REPOSITORY = "docs.examples.03.stage8.repository";
const STAGE_8_QUALIFICATION_SERVICE = "docs.examples.03.stage8.service.qualification";
const STAGE_8_DOMAIN_RULES_SERVICE = "docs.examples.03.stage8.service.domainRules";
const STAGE_8_CREATE_ACTION = "docs.examples.03.stage8.actions.create";
const STAGE_8_PREVIEW_ACTION = "docs.examples.03.stage8.actions.preview";
const STAGE_8_GET_BY_ID_ACTION = "docs.examples.03.stage8.actions.getById";
const STAGE_8_CONTROLLER = "docs.examples.03.stage8.controller";
const STAGE_8_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";
const STAGE_8_RESPONSE_SCHEMA = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactIntakePostRouteContract.response[200]
    },
    {
      includeValidation400: true
    }
  )
);

class Stage8ErrorErgonomicsProvider {
  static id = "docs.examples.03.stage8";

  register(app) {
    app.singleton(STAGE_8_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_8_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(STAGE_8_DOMAIN_RULES_SERVICE, () => new ContactDomainRulesServiceStage8());

    app.singleton(
      STAGE_8_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_8_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_8_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_8_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_8_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage8({
          contactRepository: app.make(STAGE_8_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_8_CONTROLLER,
      () =>
        new ContactControllerStage8({
          createContactIntakeAction: app.make(STAGE_8_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_8_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_8_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_8_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_8_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_8_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/intake",
      {
        ...contactIntakePostRouteContract,
        meta: {
          tags: ["docs-stage-8"],
          summary: "Stage 8 domain errors + BaseController: intake"
        },
        response: STAGE_8_RESPONSE_SCHEMA
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/preview-followup",
      {
        ...contactPreviewFollowupPostRouteContract,
        meta: {
          tags: ["docs-stage-8"],
          summary: "Stage 8 domain errors + BaseController: preview"
        },
        response: STAGE_8_RESPONSE_SCHEMA
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-8/contacts/:contactId",
      contactByIdGetRouteContract,
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage8ErrorErgonomicsProvider };
```
<!-- /DOCS:EXAMPLE -->

### Full controller code for Stage 8

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage8" lang="js" -->
```js
import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage8 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  async intake(request, reply) {
    const payload = this.resolveInputBody(request);
    const created = await this.createContactIntakeAction.execute(payload);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = this.resolveInputBody(request);
    const preview = await this.previewContactFollowupAction.execute(payload);
    return this.ok(reply, preview);
  }

  async show(request, reply) {
    const contact = await this.getContactByIdAction.execute({
      contactId: request.params?.contactId
    });
    return this.ok(reply, contact);
  }
}

export { ContactControllerStage8 };
```
<!-- /DOCS:EXAMPLE -->

### Full domain-rule helper for Stage 8

Use `docs/examples/03.real-app/src/server/support/domainRuleValidation.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/server/support/domainRuleValidation.js" lang="js" -->
```js
import { DomainValidationError } from "@jskit-ai/kernel/server/runtime";

function collectDomainFieldErrors(rules) {
  const fieldErrors = {};

  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.when && !rule.when()) {
      continue;
    }

    const outcome = rule?.check ? rule.check() : null;
    if (!outcome) {
      continue;
    }

    if (typeof outcome === "string") {
      fieldErrors[rule.field] = outcome;
      continue;
    }

    if (typeof outcome === "object") {
      fieldErrors[rule.field] = outcome?.message || "domain rule failed";
    }
  }

  return fieldErrors;
}

function assertNoDomainRuleFailures(
  rules,
  {
    message = "Domain validation failed.",
    code = "domain_validation_failed"
  } = {}
) {
  const fieldErrors = collectDomainFieldErrors(rules);
  if (Object.keys(fieldErrors).length > 0) {
    throw new DomainValidationError(
      {
        fieldErrors
      },
      {
        message,
        code
      }
    );
  }
}

export { collectDomainFieldErrors, assertNoDomainRuleFailures };
```
<!-- /DOCS:EXAMPLE -->

### Full domain-rules service for Stage 8

Use `docs/examples/03.real-app/src/server/services/ContactDomainRulesServiceStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" service="ContactDomainRulesServiceStage8" lang="js" -->
```js
class ContactDomainRulesServiceStage8 {
  buildRules(normalized) {
    return [
      {
        field: "name",
        check: () =>
          normalized.name.length < 2 ? "name must have at least 2 characters." : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @." : null
      },
      {
        field: "plan",
        check: () =>
          normalized.plan === "starter" && normalized.employees > 200
            ? "starter plan supports up to 200 employees"
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage8 };
```
<!-- /DOCS:EXAMPLE -->

### Full actions for Stage 8

Use `docs/examples/03.real-app/src/server/actions/CreateContactIntakeActionStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" action="CreateContactIntakeActionStage8" lang="js" -->
```js
import {
  ConflictError
} from "@jskit-ai/kernel/server/runtime";
import { assertNoDomainRuleFailures } from "../support/domainRuleValidation.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class CreateContactIntakeActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = normalizeContactBody(payload);
    assertNoDomainRuleFailures(this.domainRulesService.buildRules(normalized));

    const duplicate = this.contactRepository.findByEmail(normalized.email);
    if (duplicate) {
      throw new ConflictError("A contact with this email already exists.", {
        code: "duplicate_contact",
        details: {
          fieldErrors: {
            email: "a contact with this email already exists"
          }
        }
      });
    }

    const score = this.qualificationService.score(normalized);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalized.source
    });

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...normalized,
      score,
      segment
    });

    return {
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan,
      duplicateDetected: false,
      persisted: true
    };
  }
}

export { CreateContactIntakeActionStage8 };
```
<!-- /DOCS:EXAMPLE -->

Use `docs/examples/03.real-app/src/server/actions/PreviewContactFollowupActionStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" action="PreviewContactFollowupActionStage8" lang="js" -->
```js
import { assertNoDomainRuleFailures } from "../support/domainRuleValidation.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

class PreviewContactFollowupActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = normalizeContactBody(payload);
    assertNoDomainRuleFailures(this.domainRulesService.buildRules(normalized));

    const duplicate = this.contactRepository.findByEmail(normalized.email);
    const score = this.qualificationService.score(normalized);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalized.source
    });

    return {
      ok: true,
      mode: "preview",
      email: normalized.email,
      score,
      segment,
      followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    };
  }
}

export { PreviewContactFollowupActionStage8 };
```
<!-- /DOCS:EXAMPLE -->

### What improved

- domain validation is centralized and reusable
- actions fail fast with domain-meaningful error classes
- provider installs one API error handler integration point (`registerApiErrorHandler(...)`)
- controller is now success-only for core happy paths

### Result vs throw in domain validation

Use throw-style `DomainError` as first-class when:

- you have deep call chains where bubbling failures via return objects is noisy
- you want transaction-like flows that abort immediately on first domain violation
- cross-cutting middleware/hooks need one uniform thrown-error contract
- modules already use exception semantics heavily

Keep result-style as default when:

- onboarding/new teams need explicit flow
- most failures are expected business outcomes
- you want very predictable unit tests without `try/catch` branches

Recommendation:

- keep result-style + `BaseController` as the standard baseline
- support `DomainError` throw-style as an approved advanced alternative
- enforce one style per module to avoid mixed patterns

## Stage 9: Runtime Context and Middleware Reuse

Stage 9 focuses on request-scoped context and reusable middleware stacks.

In this stage:

- each request automatically has a request scope (`request.scope`)
- middleware reads/writes scoped request context
- providers reuse one middleware stack across related routes
- controller reads scope context to enrich response headers

### Create reusable middleware stack

Use `docs/examples/03.real-app/src/server/support/stage9Middleware.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/server/support/stage9Middleware.js" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

const STAGE_9_REQUEST_CONTEXT_TOKEN = "docs.examples.03.stage9.requestContext";

async function requireRequestScopeMiddleware(request, reply) {
  if (!request?.scope || typeof request.scope.make !== "function") {
    reply.code(500).send({
      error: "Request scope is unavailable.",
      code: "missing_request_scope"
    });
  }
}

async function attachRequestContextMiddleware(request) {
  const scope = request?.scope;
  if (!scope || typeof scope.instance !== "function" || typeof scope.make !== "function") {
    return;
  }

  const requestId = scope.make(KERNEL_TOKENS.RequestId);
  scope.instance(STAGE_9_REQUEST_CONTEXT_TOKEN, {
    requestId,
    receivedAt: new Date().toISOString()
  });
}

async function requirePartnerConsentMiddleware(request, reply) {
  const payload = request?.input?.body || request?.body || {};
  const source = String(payload?.source || "").trim().toLowerCase();
  const hasMarketingConsent = payload?.consentMarketing === true;

  if (source === "partner" && !hasMarketingConsent) {
    reply.code(422).send({
      error: "Domain validation failed.",
      code: "partner_consent_required",
      details: {
        fieldErrors: {
          consentMarketing: "partner leads require marketing consent"
        }
      }
    });
  }
}

const stage9ContactsMiddleware = Object.freeze([
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware
]);

export {
  STAGE_9_REQUEST_CONTEXT_TOKEN,
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware,
  stage9ContactsMiddleware
};
```
<!-- /DOCS:EXAMPLE -->

### Create controller that consumes request-scope context

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage9.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage9" lang="js" -->
```js
import { BaseController } from "@jskit-ai/kernel/server/http";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { STAGE_9_REQUEST_CONTEXT_TOKEN } from "../support/stage9Middleware.js";

class ContactControllerStage9 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  attachRequestScopeHeaders(request, reply) {
    const scope = request?.scope;
    if (!scope || typeof scope.make !== "function") {
      return;
    }

    const requestId = scope.make(KERNEL_TOKENS.RequestId);
    if (requestId) {
      reply.header("x-request-id", requestId);
    }

    const context = scope.has(STAGE_9_REQUEST_CONTEXT_TOKEN)
      ? scope.make(STAGE_9_REQUEST_CONTEXT_TOKEN)
      : null;

    if (context?.receivedAt) {
      reply.header("x-request-received-at", context.receivedAt);
    }
  }

  async intake(request, reply) {
    const payload = this.resolveInputBody(request);
    const created = await this.createContactIntakeAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = this.resolveInputBody(request);
    const preview = await this.previewContactFollowupAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, preview);
  }

  async show(request, reply) {
    const contact = await this.getContactByIdAction.execute({
      contactId: request.input?.params?.contactId || request.params?.contactId
    });
    this.attachRequestScopeHeaders(request, reply);
    return this.ok(reply, contact);
  }
}

export { ContactControllerStage9 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 9

Use `docs/examples/03.real-app/src/server/providers/Stage9RuntimeContextProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage9RuntimeContextProvider" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage9 } from "../controllers/ContactControllerStage9.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { GetContactByIdActionStage8 } from "../actions/GetContactByIdActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { stage9ContactsMiddleware } from "../support/stage9Middleware.js";
import { contactByIdGetRouteContractStage7 } from "../../shared/schemas/contactSchemasStage7.js";
import {
  contactIntakePostRouteContract
} from "../../shared/schemas/contactSchemas.js";
import {
  normalizeContactBody,
  normalizeContactQuery
} from "../../shared/input/contactInputNormalization.js";

const STAGE_9_REPOSITORY = "docs.examples.03.stage9.repository";
const STAGE_9_QUALIFICATION_SERVICE = "docs.examples.03.stage9.service.qualification";
const STAGE_9_DOMAIN_RULES_SERVICE = "docs.examples.03.stage9.service.domainRules";
const STAGE_9_CREATE_ACTION = "docs.examples.03.stage9.actions.create";
const STAGE_9_PREVIEW_ACTION = "docs.examples.03.stage9.actions.preview";
const STAGE_9_GET_BY_ID_ACTION = "docs.examples.03.stage9.actions.getById";
const STAGE_9_CONTROLLER = "docs.examples.03.stage9.controller";
const STAGE_9_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";
const STAGE_9_RESPONSE_SCHEMA = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactIntakePostRouteContract.response[200]
    },
    {
      includeValidation400: true
    }
  )
);

const stage9QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

class Stage9RuntimeContextProvider {
  static id = "docs.examples.03.stage9";

  register(app) {
    app.singleton(STAGE_9_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_9_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(STAGE_9_DOMAIN_RULES_SERVICE, () => new ContactDomainRulesServiceStage8());

    app.singleton(
      STAGE_9_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_9_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_9_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage8({
          contactRepository: app.make(STAGE_9_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_9_CONTROLLER,
      () =>
        new ContactControllerStage9({
          createContactIntakeAction: app.make(STAGE_9_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_9_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_9_GET_BY_ID_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_9_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_9_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_9_CONTROLLER);

    const sharedOptions = {
      body: {
        schema: contactIntakePostRouteContract.body.schema,
        normalize: normalizeContactBody
      },
      query: {
        schema: stage9QuerySchema,
        normalize: normalizeContactQuery
      },
      response: STAGE_9_RESPONSE_SCHEMA,
      middleware: stage9ContactsMiddleware,
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/intake",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/preview-followup",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-9/contacts/:contactId",
      {
        ...contactByIdGetRouteContractStage7,
        middleware: stage9ContactsMiddleware,
        meta: {
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: show by id"
        }
      },
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage9RuntimeContextProvider };
```
<!-- /DOCS:EXAMPLE -->

### What improved

- request metadata is available from scope anywhere in the route lifecycle
- middleware is reusable without duplicating function lists per route
- context-dependent concerns (trace IDs, guard checks) stay out of actions/services

Note:

- this middleware layer is for route/runtime concerns and scoped checks
- for full authentication strategy and policy composition, see the auth chapter

### Optional runtime alias/group style

Stage 9 uses direct middleware function reuse so the stage provider stays runnable without extra runtime bootstrap config.

When your runtime bootstrap owns route registration centrally, you can also use named aliases/groups:

- before: routes repeat raw middleware function arrays
- after: runtime defines `middleware.aliases` and `middleware.groups`, routes declare names like `middleware: ["api"]`

## Stage 10: Startup Config Contracts

Stage 10 hardens module startup by validating config at boot time.

In this stage:

- module config schema is declared once with TypeBox
- env/raw values are transformed + validated with `defineModuleConfig(...)`
- startup fails fast when config is invalid
- domain rules service receives typed, validated config
- Stage 9 runtime context and middleware reuse remain integrated

### Create module config contract

Use `docs/examples/03.real-app/src/server/support/contactsModuleConfigStage10.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/server/support/contactsModuleConfigStage10.js" lang="js" -->
```js
import { Type } from "typebox";
import { defineModuleConfig } from "@jskit-ai/kernel/server/runtime";

const DEFAULT_ALLOWED_COUNTRIES = Object.freeze(["US", "CA", "GB", "DE", "FR", "ES", "IT"]);

const contactsModuleConfigSchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("standard"), Type.Literal("strict")]),
    allowedCountries: Type.Array(Type.String({ minLength: 2, maxLength: 2 }), {
      minItems: 1
    }),
    maxStarterEmployees: Type.Integer({ minimum: 1 }),
    blockDisposableEmailDomains: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const contactsModuleConfig = defineModuleConfig({
  moduleId: "docs.examples.03.contacts",
  schema: contactsModuleConfigSchema,
  coerce: true,
  load({ env }) {
    return {
      mode: env.CONTACTS_MODE,
      allowedCountries: env.CONTACTS_ALLOWED_COUNTRIES,
      maxStarterEmployees: env.CONTACTS_MAX_STARTER_EMPLOYEES,
      blockDisposableEmailDomains: env.CONTACTS_BLOCK_DISPOSABLE_EMAILS
    };
  },
  transform(raw) {
    const allowedCountriesRaw = String(
      raw?.allowedCountries || DEFAULT_ALLOWED_COUNTRIES.join(",")
    );

    return {
      mode: raw?.mode || "standard",
      allowedCountries: allowedCountriesRaw
        .split(",")
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean),
      maxStarterEmployees: raw?.maxStarterEmployees ?? 2000,
      blockDisposableEmailDomains: raw?.blockDisposableEmailDomains ?? true
    };
  },
  validate(config) {
    if (config.mode === "strict" && config.maxStarterEmployees > 1000) {
      return [
        {
          path: "maxStarterEmployees",
          message: "must be <= 1000 when mode is strict"
        }
      ];
    }

    return true;
  }
});

export {
  DEFAULT_ALLOWED_COUNTRIES,
  contactsModuleConfigSchema,
  contactsModuleConfig
};
```
<!-- /DOCS:EXAMPLE -->

### Create config-driven domain rules service

Use `docs/examples/03.real-app/src/server/services/ContactDomainRulesServiceStage10.js`:

<!-- DOCS:EXAMPLE package="03.real-app" service="ContactDomainRulesServiceStage10" lang="js" -->
```js
class ContactDomainRulesServiceStage10 {
  constructor({ config }) {
    this.config = config;
  }

  buildRules(normalized) {
    const allowedCountries = Array.isArray(this.config?.allowedCountries)
      ? this.config.allowedCountries
      : ["US", "CA", "GB", "DE", "FR", "ES", "IT"];
    const maxStarterEmployees = Number(this.config?.maxStarterEmployees || 2000);
    const blockDisposableEmailDomains = this.config?.blockDisposableEmailDomains !== false;

    return [
      {
        field: "name",
        check: () =>
          normalized.name.length < 2 ? "name must have at least 2 characters." : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @." : null
      },
      {
        field: "email",
        when: () => blockDisposableEmailDomains,
        check: () =>
          normalized.email.endsWith("@mailinator.com")
            ? "disposable emails are not allowed"
            : null
      },
      {
        field: "country",
        check: () =>
          !allowedCountries.includes(normalized.country)
            ? "country is not in allowed market list"
            : null
      },
      {
        field: "plan",
        check: () =>
          normalized.plan === "starter" && normalized.employees > maxStarterEmployees
            ? `starter plan supports up to ${maxStarterEmployees} employees`
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage10 };
```
<!-- /DOCS:EXAMPLE -->

### Create reusable middleware stack for Stage 10

Use `docs/examples/03.real-app/src/server/support/stage10Middleware.js`:

<!-- DOCS:EXAMPLE package="03.real-app" file="src/server/support/stage10Middleware.js" lang="js" -->
```js
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

const STAGE_10_REQUEST_CONTEXT_TOKEN = "docs.examples.03.stage10.requestContext";

async function requireRequestScopeMiddleware(request, reply) {
  if (!request?.scope || typeof request.scope.make !== "function") {
    reply.code(500).send({
      error: "Request scope is unavailable.",
      code: "missing_request_scope"
    });
  }
}

async function attachRequestContextMiddleware(request) {
  const scope = request?.scope;
  if (!scope || typeof scope.instance !== "function" || typeof scope.make !== "function") {
    return;
  }

  const requestId = scope.make(KERNEL_TOKENS.RequestId);
  scope.instance(STAGE_10_REQUEST_CONTEXT_TOKEN, {
    requestId,
    receivedAt: new Date().toISOString()
  });
}

async function requirePartnerConsentMiddleware(request, reply) {
  const payload = request?.input?.body || request?.body || {};
  const source = String(payload?.source || "").trim().toLowerCase();
  const hasMarketingConsent = payload?.consentMarketing === true;

  if (source === "partner" && !hasMarketingConsent) {
    reply.code(422).send({
      error: "Domain validation failed.",
      code: "partner_consent_required",
      details: {
        fieldErrors: {
          consentMarketing: "partner leads require marketing consent"
        }
      }
    });
  }
}

const stage10ContactsMiddleware = Object.freeze([
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware
]);

export {
  STAGE_10_REQUEST_CONTEXT_TOKEN,
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware,
  stage10ContactsMiddleware
};
```
<!-- /DOCS:EXAMPLE -->

### Create Stage 10 controller with config + request-scope headers

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage10.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage10" lang="js" -->
```js
import { BaseController } from "@jskit-ai/kernel/server/http";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { STAGE_10_REQUEST_CONTEXT_TOKEN } from "../support/stage10Middleware.js";

class ContactControllerStage10 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction, getContactByIdAction, contactsConfig }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
    this.getContactByIdAction = getContactByIdAction;
    this.contactsConfig = contactsConfig;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  attachConfigHeaders(reply) {
    reply.header("x-contacts-mode", this.contactsConfig.mode);
    reply.header(
      "x-contacts-max-starter-employees",
      String(this.contactsConfig.maxStarterEmployees)
    );
  }

  attachRequestScopeHeaders(request, reply) {
    const scope = request?.scope;
    if (!scope || typeof scope.make !== "function") {
      return;
    }

    const requestId = scope.make(KERNEL_TOKENS.RequestId);
    if (requestId) {
      reply.header("x-request-id", requestId);
    }

    const context = scope.has(STAGE_10_REQUEST_CONTEXT_TOKEN)
      ? scope.make(STAGE_10_REQUEST_CONTEXT_TOKEN)
      : null;

    if (context?.receivedAt) {
      reply.header("x-request-received-at", context.receivedAt);
    }
  }

  async intake(request, reply) {
    const payload = this.resolveInputBody(request);
    const created = await this.createContactIntakeAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    this.attachConfigHeaders(reply);
    return this.ok(reply, created);
  }

  async previewFollowup(request, reply) {
    const payload = this.resolveInputBody(request);
    const preview = await this.previewContactFollowupAction.execute(payload);
    this.attachRequestScopeHeaders(request, reply);
    this.attachConfigHeaders(reply);
    return this.ok(reply, preview);
  }

  async show(request, reply) {
    const contact = await this.getContactByIdAction.execute({
      contactId: request.input?.params?.contactId || request.params?.contactId
    });
    this.attachRequestScopeHeaders(request, reply);
    this.attachConfigHeaders(reply);
    return this.ok(reply, contact);
  }
}

export { ContactControllerStage10 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 10

Use `docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage10ConfigContractProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage10 } from "../controllers/ContactControllerStage10.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage10 } from "../services/ContactDomainRulesServiceStage10.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage10 } from "../actions/CreateContactIntakeActionStage10.js";
import { GetContactByIdActionStage10 } from "../actions/GetContactByIdActionStage10.js";
import { PreviewContactFollowupActionStage10 } from "../actions/PreviewContactFollowupActionStage10.js";
import { contactsModuleConfig } from "../support/contactsModuleConfigStage10.js";
import { stage10ContactsMiddleware } from "../support/stage10Middleware.js";
import { contactByIdGetRouteContractStage7 } from "../../shared/schemas/contactSchemasStage7.js";
import {
  contactIntakePostRouteContract
} from "../../shared/schemas/contactSchemas.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

const STAGE_10_CONFIG = "docs.examples.03.stage10.config";
const STAGE_10_REPOSITORY = "docs.examples.03.stage10.repository";
const STAGE_10_QUALIFICATION_SERVICE = "docs.examples.03.stage10.service.qualification";
const STAGE_10_DOMAIN_RULES_SERVICE = "docs.examples.03.stage10.service.domainRules";
const STAGE_10_CREATE_ACTION = "docs.examples.03.stage10.actions.create";
const STAGE_10_PREVIEW_ACTION = "docs.examples.03.stage10.actions.preview";
const STAGE_10_GET_BY_ID_ACTION = "docs.examples.03.stage10.actions.getById";
const STAGE_10_CONTROLLER = "docs.examples.03.stage10.controller";
const STAGE_10_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";
const STAGE_10_RESPONSE_SCHEMA = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactIntakePostRouteContract.response[200]
    },
    {
      includeValidation400: true
    }
  )
);

class Stage10ConfigContractProvider {
  static id = "docs.examples.03.stage10";

  register(app) {
    const env = app.has(KERNEL_TOKENS.Env) ? app.make(KERNEL_TOKENS.Env) : process.env;
    const config = contactsModuleConfig.resolve({
      env
    });

    app.instance(STAGE_10_CONFIG, config);
    app.singleton(STAGE_10_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_10_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(
      STAGE_10_DOMAIN_RULES_SERVICE,
      () =>
        new ContactDomainRulesServiceStage10({
          config: app.make(STAGE_10_CONFIG)
        })
    );

    app.singleton(
      STAGE_10_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage10({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage10({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage10({
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_CONTROLLER,
      () =>
        new ContactControllerStage10({
          createContactIntakeAction: app.make(STAGE_10_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_10_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_10_GET_BY_ID_ACTION),
          contactsConfig: app.make(STAGE_10_CONFIG)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_10_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_10_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_10_CONTROLLER);

    const sharedOptions = {
      body: {
        schema: contactIntakePostRouteContract.body.schema,
        normalize: normalizeContactBody
      },
      middleware: stage10ContactsMiddleware,
      response: STAGE_10_RESPONSE_SCHEMA
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/intake",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-10/contacts/:contactId",
      {
        ...contactByIdGetRouteContractStage7,
        middleware: stage10ContactsMiddleware,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config + runtime context: show by id"
        }
      },
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage10ConfigContractProvider };
```
<!-- /DOCS:EXAMPLE -->

### What improved

- config parsing/validation is centralized and testable
- invalid env fails before traffic, not during request handling
- business limits are now policy-driven by config, not hardcoded magic numbers

## Three Validation Levels (The Important Mental Model)

When people are new to layered backend design, this is often the most confusing part.

Use this split:

### Transport validation

- route `schema` checks shape and basic constraints
- this is request-time boundary validation

Example:

- payload missing `email` -> transport validation (`400`)

### Domain validation

- actions/services check business rules
- actions throw domain errors with one consistent failure contract

Example:

- `employees > maxStarterEmployees` with `plan = starter` -> domain validation (`422`)

### Persistence validation

- repository + database constraints enforce storage invariants

Example:

- unique email collision in repository/database -> persistence/domain conflict (`409` by common policy)



## Optional: Swap Repository to Knex + SQLite In-Memory

If you want a repository backed by SQL before the official DB module chapter, use `knex` with SQLite in-memory.

Why this is useful:

- you keep architecture unchanged
- you prove the repository contract is real
- you avoid introducing production DB concerns too early

Sketch:

```js
import knex from "knex";

app.singleton("local.contacts.knex", () =>
  knex({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true
  })
);

app.singleton(CONTACT_REPOSITORY_TOKEN, () =>
  new KnexContactRepository({ db: app.make("local.contacts.knex") })
);
```

The dedicated persistence chapter (to be added later) should cover production patterns in depth:

- migrations
- transactions
- retry strategy
- index design
- data lifecycle policies

## Suggested Tests For This Chapter

- `POST /api/v1/docs/ch03/stage-6/contacts/intake` success
- `POST /api/v1/docs/ch03/stage-8/contacts/intake` duplicate email mapped as domain conflict
- `POST /api/v1/docs/ch03/stage-9/contacts/intake` partner lead without consent fails in middleware
- `POST /api/v1/docs/ch03/stage-7/contacts/intake?dryRun=true` routes through preview behavior
- schema-level validation failure for malformed request payload
- startup config contract failure for Stage 10 invalid env (for example strict mode with too-high starter employee cap)

## What You Should Take Away

- Putting everything in one provider route handler is possible but does not scale.
- Controller extraction improves route organization, but does not solve domain complexity.
- Service extraction centralizes business rules.
- Repository extraction protects you from storage coupling.
- Action extraction makes use cases explicit and testable.
- Provider remains the composition root.

That is the path from "it works" to "it keeps working when the feature grows."

## Final, clean assembly

This is the final provider assembly after all stages (Stage 1 through Stage 10).

Use `docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage10ConfigContractProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage10 } from "../controllers/ContactControllerStage10.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage10 } from "../services/ContactDomainRulesServiceStage10.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage10 } from "../actions/CreateContactIntakeActionStage10.js";
import { GetContactByIdActionStage10 } from "../actions/GetContactByIdActionStage10.js";
import { PreviewContactFollowupActionStage10 } from "../actions/PreviewContactFollowupActionStage10.js";
import { contactsModuleConfig } from "../support/contactsModuleConfigStage10.js";
import { stage10ContactsMiddleware } from "../support/stage10Middleware.js";
import { contactByIdGetRouteContractStage7 } from "../../shared/schemas/contactSchemasStage7.js";
import {
  contactIntakePostRouteContract
} from "../../shared/schemas/contactSchemas.js";
import { normalizeContactBody } from "../../shared/input/contactInputNormalization.js";

const STAGE_10_CONFIG = "docs.examples.03.stage10.config";
const STAGE_10_REPOSITORY = "docs.examples.03.stage10.repository";
const STAGE_10_QUALIFICATION_SERVICE = "docs.examples.03.stage10.service.qualification";
const STAGE_10_DOMAIN_RULES_SERVICE = "docs.examples.03.stage10.service.domainRules";
const STAGE_10_CREATE_ACTION = "docs.examples.03.stage10.actions.create";
const STAGE_10_PREVIEW_ACTION = "docs.examples.03.stage10.actions.preview";
const STAGE_10_GET_BY_ID_ACTION = "docs.examples.03.stage10.actions.getById";
const STAGE_10_CONTROLLER = "docs.examples.03.stage10.controller";
const STAGE_10_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";
const STAGE_10_RESPONSE_SCHEMA = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactIntakePostRouteContract.response[200]
    },
    {
      includeValidation400: true
    }
  )
);

class Stage10ConfigContractProvider {
  static id = "docs.examples.03.stage10";

  register(app) {
    const env = app.has(KERNEL_TOKENS.Env) ? app.make(KERNEL_TOKENS.Env) : process.env;
    const config = contactsModuleConfig.resolve({
      env
    });

    app.instance(STAGE_10_CONFIG, config);
    app.singleton(STAGE_10_REPOSITORY, () => new InMemoryContactRepository());
    app.singleton(STAGE_10_QUALIFICATION_SERVICE, () => new ContactQualificationService());
    app.singleton(
      STAGE_10_DOMAIN_RULES_SERVICE,
      () =>
        new ContactDomainRulesServiceStage10({
          config: app.make(STAGE_10_CONFIG)
        })
    );

    app.singleton(
      STAGE_10_CREATE_ACTION,
      () =>
        new CreateContactIntakeActionStage10({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage10({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_GET_BY_ID_ACTION,
      () =>
        new GetContactByIdActionStage10({
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_CONTROLLER,
      () =>
        new ContactControllerStage10({
          createContactIntakeAction: app.make(STAGE_10_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_10_PREVIEW_ACTION),
          getContactByIdAction: app.make(STAGE_10_GET_BY_ID_ACTION),
          contactsConfig: app.make(STAGE_10_CONFIG)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_10_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(KERNEL_TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_10_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const controller = app.make(STAGE_10_CONTROLLER);

    const sharedOptions = {
      body: {
        schema: contactIntakePostRouteContract.body.schema,
        normalize: normalizeContactBody
      },
      middleware: stage10ContactsMiddleware,
      response: STAGE_10_RESPONSE_SCHEMA
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/intake",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: intake"
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/preview-followup",
        ...sharedOptions,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );

    router.register(
      "GET",
      "/api/v1/docs/ch03/stage-10/contacts/:contactId",
      {
        ...contactByIdGetRouteContractStage7,
        middleware: stage10ContactsMiddleware,
        meta: {
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config + runtime context: show by id"
        }
      },
      (request, reply) => controller.show(request, reply)
    );
  }
}

export { Stage10ConfigContractProvider };
```
<!-- /DOCS:EXAMPLE -->

### Final overview (using the full lingo)

By this point, the module is a proper composition root:

- provider lifecycle wires container bindings (`singleton` + `instance`) with explicit tokens
- transport validation is enforced by route `schema`
- request pipeline ergonomics are handled through `input` normalization into `request.input`
- domain validation is explicit in actions/services, using domain error classes
- global HTTP error mapping is centralized with `registerApiErrorHandler(...)`
- runtime context is request-scoped (`request.scope`, `KERNEL_TOKENS.RequestId`, and scoped context instances)
- middleware reuse is declarative at provider route registration
- startup config contracts are validated once at boot with `defineModuleConfig(...)`
- persistence validation stays in repository/storage invariants

If you had read the next sentence before this tutorial, it would have been almost impossible to parse:

`Stage10ConfigContractProvider` is a config-aware composition root that wires typed startup contracts, transport schema gates, request-input normalization, scoped runtime context, reusable middleware policy, explicit domain validation, centralized domain error mapping, and repository-backed persistence invariants into one predictable provider lifecycle.
