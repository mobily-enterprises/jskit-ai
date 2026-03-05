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

- Stage 1: everything in one provider route handler
- Stage 2: extract controller
- Stage 3: extract service
- Stage 4: extract repository
- Stage 5: extract actions
- Stage 6: shared schemas + baseline provider wiring
- Stage 7: request pipeline and transport validation
- Stage 8: domain validation and error ergonomics
- Stage 9: runtime context and middleware reuse
- Stage 10: startup config contracts

Each stage works. Each stage improves something. Each stage still has pain that motivates the next one.

## Where We Pick Up

From earlier chapters, you already have:

- a `manual-app`
- `@local/main` module
- provider lifecycle basics from Chapter 1
- TypeBox validation pattern
- container/provider mental model

Now we move from "first route" to "real feature architecture."

## The Feature We Will Build

We will build a `contacts` intake feature with two routes:

- `POST /api/v1/contacts/intake`
- `POST /api/v1/contacts/preview-followup`

Both routes are business-logic-heavy on purpose:

- normalize input
- run business rules
- compute lead score
- derive segment
- build follow-up plan
- check duplicates

This is exactly the kind of logic that becomes painful when all code lives in one handler.

## Core Architecture Preview (Stage 6 Baseline)

This is the baseline architecture we reach at Stage 6 before extension stages.

```txt
docs/examples/03.real-app/src/
  shared/schemas/contactSchemas.js
  server/controllers/ContactControllerStage6.js
  server/actions/CreateContactIntakeAction.js
  server/actions/PreviewContactFollowupAction.js
  server/services/ContactQualificationService.js
  server/repositories/ContactRepository.js
  server/repositories/InMemoryContactRepository.js
  server/providers/Stage6LayeredProvider.js
```

Baseline request flow:

- route -> controller -> action -> service + repository -> response

Runnable chapter module:

- `docs/examples/03.real-app`

The app includes one functional provider per stage:
- `Stage1MonolithProvider` (`docs/examples/03.real-app/src/server/providers/Stage1MonolithProvider.js`)
- `Stage2ControllerProvider` (`docs/examples/03.real-app/src/server/providers/Stage2ControllerProvider.js`)
- `Stage3ServiceProvider` (`docs/examples/03.real-app/src/server/providers/Stage3ServiceProvider.js`)
- `Stage4RepositoryProvider` (`docs/examples/03.real-app/src/server/providers/Stage4RepositoryProvider.js`)
- `Stage5ActionProvider` (`docs/examples/03.real-app/src/server/providers/Stage5ActionProvider.js`)
- `Stage6LayeredProvider` (`docs/examples/03.real-app/src/server/providers/Stage6LayeredProvider.js`)
- `Stage7RequestPipelineProvider` (`docs/examples/03.real-app/src/server/providers/Stage7RequestPipelineProvider.js`)
- `Stage8ErrorErgonomicsProvider` (`docs/examples/03.real-app/src/server/providers/Stage8ErrorErgonomicsProvider.js`)
- `Stage9RuntimeContextProvider` (`docs/examples/03.real-app/src/server/providers/Stage9RuntimeContextProvider.js`)
- `Stage10ConfigContractProvider` (`docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`)

Progressive path for this chapter:

- Start: `docs/examples/03.real-app/src/server/providers/Stage1MonolithProvider.js`
- End: `docs/examples/03.real-app/src/server/providers/Stage6LayeredProvider.js`

Now let us intentionally start with the bad version.

## Stage 1: Provider-Only Monolith (Works, But Hurts)

This stage is intentionally "too much in one place." We want you to feel the pain clearly.

### What this stage shows

- Yes, you can do everything in `Stage1MonolithProvider`.
- Yes, it can ship quickly for tiny demos.
- No, it does not stay maintainable once logic grows.

### Code

Use `docs/examples/03.real-app/src/server/providers/Stage1MonolithProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage1MonolithProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

class Stage1MonolithProvider {
  static id = "docs.examples.03.stage1";

  register() {}

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const contacts = [];

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-1/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-1/contacts/intake",
        schema: {
          tags: ["docs-stage-1"],
          summary: "Stage 1 monolith: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      async (request, reply) => {
        const name = String(request.body?.name || "").trim();
        const email = String(request.body?.email || "").trim().toLowerCase();
        const company = String(request.body?.company || "").trim();
        const employees = Number(request.body?.employees || 0);
        const plan = String(request.body?.plan || "").trim().toLowerCase();
        const source = String(request.body?.source || "").trim().toLowerCase();
        const country = String(request.body?.country || "").trim().toUpperCase();
        const consentMarketing = Boolean(request.body?.consentMarketing);

        const details = [];
        if (name.length < 2) details.push("name must have at least 2 characters");
        if (!email.includes("@")) details.push("email must include @");
        if (email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
        if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(country)) details.push("country is not in allowed market list");
        if (employees > 2000 && plan !== "enterprise") details.push("large companies must use enterprise plan");
        if (source === "partner" && !consentMarketing) details.push("partner leads require marketing consent");

        if (details.length > 0) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: "domain_validation_failed",
            details
          });
          return;
        }

        const duplicate = contacts.find((entry) => entry.email === email);
        if (duplicate) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: "duplicate_contact",
            details: ["a contact with this email already exists"]
          });
          return;
        }

        let score = 0;
        if (plan === "enterprise") score += 35;
        if (plan === "growth") score += 20;
        if (employees >= 500) score += 30;
        else if (employees >= 100) score += 20;
        else if (employees >= 20) score += 10;
        if (source === "referral") score += 20;
        if (source === "webinar") score += 15;
        if (country === "US") score += 5;
        if (consentMarketing) score += 5;
        score = Math.max(0, Math.min(100, score));

        const segment = score >= 80 ? "enterprise_hot" : score >= 50 ? "growth_warm" : "starter_cold";

        const followupPlan = [];
        if (segment === "enterprise_hot") {
          followupPlan.push("assign account executive within 15 minutes");
          followupPlan.push("book discovery call in first business day");
        } else if (segment === "growth_warm") {
          followupPlan.push("send product fit email within 2 hours");
          followupPlan.push("schedule SDR outreach within 24 hours");
        } else {
          followupPlan.push("send educational drip campaign");
          followupPlan.push("review intent again in 7 days");
        }

        if (source === "webinar") {
          followupPlan.push("attach webinar recording and slides");
        }

        const created = {
          id: `contact-${Date.now().toString(36)}`,
          name,
          email,
          company,
          employees,
          plan,
          source,
          country,
          consentMarketing,
          score,
          segment
        };
        contacts.push(created);

        reply.code(200).send({
          ok: true,
          mode: "intake",
          email,
          score,
          segment,
          followupPlan,
          duplicateDetected: false,
          persisted: true
        });
      }
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-1/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-1/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-1"],
          summary: "Stage 1 monolith: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      async (request, reply) => {
        const name = String(request.body?.name || "").trim();
        const email = String(request.body?.email || "").trim().toLowerCase();
        const employees = Number(request.body?.employees || 0);
        const plan = String(request.body?.plan || "").trim().toLowerCase();
        const source = String(request.body?.source || "").trim().toLowerCase();
        const country = String(request.body?.country || "").trim().toUpperCase();
        const consentMarketing = Boolean(request.body?.consentMarketing);

        const details = [];
        if (name.length < 2) details.push("name must have at least 2 characters");
        if (!email.includes("@")) details.push("email must include @");
        if (email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
        if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(country)) details.push("country is not in allowed market list");
        if (employees > 2000 && plan !== "enterprise") details.push("large companies must use enterprise plan");
        if (source === "partner" && !consentMarketing) details.push("partner leads require marketing consent");

        if (details.length > 0) {
          reply.code(422).send({
            error: "Domain validation failed.",
            code: "domain_validation_failed",
            details
          });
          return;
        }

        const duplicate = contacts.find((entry) => entry.email === email);

        let score = 0;
        if (plan === "enterprise") score += 35;
        if (plan === "growth") score += 20;
        if (employees >= 500) score += 30;
        else if (employees >= 100) score += 20;
        else if (employees >= 20) score += 10;
        if (source === "referral") score += 20;
        if (source === "webinar") score += 15;
        if (country === "US") score += 5;
        if (consentMarketing) score += 5;
        score = Math.max(0, Math.min(100, score));

        const segment = score >= 80 ? "enterprise_hot" : score >= 50 ? "growth_warm" : "starter_cold";

        const followupPlan = [];
        if (segment === "enterprise_hot") {
          followupPlan.push("assign account executive within 15 minutes");
          followupPlan.push("book discovery call in first business day");
        } else if (segment === "growth_warm") {
          followupPlan.push("send product fit email within 2 hours");
          followupPlan.push("schedule SDR outreach within 24 hours");
        } else {
          followupPlan.push("send educational drip campaign");
          followupPlan.push("review intent again in 7 days");
        }

        if (source === "webinar") {
          followupPlan.push("attach webinar recording and slides");
        }

        reply.code(200).send({
          ok: true,
          mode: "preview",
          email,
          score,
          segment,
          followupPlan,
          duplicateDetected: Boolean(duplicate),
          persisted: false
        });
      }
    );
  }
}

export { Stage1MonolithProvider };
```
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

### Why this hurts

- both handlers duplicate large logic blocks
- business logic is mixed with HTTP handling
- data storage policy is hidden in route code
- testing one rule requires booting route runtime

This is exactly when teams start introducing layers.

## Stage 2: Extract a Controller (Better, But Not Enough)

Now we move handler logic out of provider and into a controller.

This already helps because routes become wiring only. But we still keep business logic duplicated in controller methods so you can see what pain remains.

### Create controller

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage2.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage2" lang="js" -->
```js
class ContactControllerStage2 {
  constructor() {
    this.contacts = [];
  }

  async intake(request, reply) {
    const name = String(request.body?.name || "").trim();
    const email = String(request.body?.email || "").trim().toLowerCase();
    const company = String(request.body?.company || "").trim();
    const employees = Number(request.body?.employees || 0);
    const plan = String(request.body?.plan || "").trim().toLowerCase();
    const source = String(request.body?.source || "").trim().toLowerCase();
    const country = String(request.body?.country || "").trim().toUpperCase();
    const consentMarketing = Boolean(request.body?.consentMarketing);

    const details = [];
    if (name.length < 2) details.push("name must have at least 2 characters");
    if (!email.includes("@")) details.push("email must include @");
    if (email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
    if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(country)) details.push("country is not in allowed market list");
    if (employees > 2000 && plan !== "enterprise") details.push("large companies must use enterprise plan");
    if (source === "partner" && !consentMarketing) details.push("partner leads require marketing consent");

    if (details.length > 0) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "domain_validation_failed",
        details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === email);
    if (duplicate) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      });
      return;
    }

    let score = 0;
    if (plan === "enterprise") score += 35;
    if (plan === "growth") score += 20;
    if (employees >= 500) score += 30;
    else if (employees >= 100) score += 20;
    else if (employees >= 20) score += 10;
    if (source === "referral") score += 20;
    if (source === "webinar") score += 15;
    if (country === "US") score += 5;
    if (consentMarketing) score += 5;
    score = Math.max(0, Math.min(100, score));

    const segment = score >= 80 ? "enterprise_hot" : score >= 50 ? "growth_warm" : "starter_cold";

    const followupPlan = [];
    if (segment === "enterprise_hot") {
      followupPlan.push("assign account executive within 15 minutes");
      followupPlan.push("book discovery call in first business day");
    } else if (segment === "growth_warm") {
      followupPlan.push("send product fit email within 2 hours");
      followupPlan.push("schedule SDR outreach within 24 hours");
    } else {
      followupPlan.push("send educational drip campaign");
      followupPlan.push("review intent again in 7 days");
    }

    if (source === "webinar") {
      followupPlan.push("attach webinar recording and slides");
    }

    this.contacts.push({
      id: `contact-${Date.now().toString(36)}`,
      name,
      email,
      company,
      employees,
      plan,
      source,
      country,
      consentMarketing,
      score,
      segment
    });

    reply.code(200).send({
      ok: true,
      mode: "intake",
      email,
      score,
      segment,
      followupPlan,
      duplicateDetected: false,
      persisted: true
    });
  }

  async previewFollowup(request, reply) {
    const name = String(request.body?.name || "").trim();
    const email = String(request.body?.email || "").trim().toLowerCase();
    const employees = Number(request.body?.employees || 0);
    const plan = String(request.body?.plan || "").trim().toLowerCase();
    const source = String(request.body?.source || "").trim().toLowerCase();
    const country = String(request.body?.country || "").trim().toUpperCase();
    const consentMarketing = Boolean(request.body?.consentMarketing);

    const details = [];
    if (name.length < 2) details.push("name must have at least 2 characters");
    if (!email.includes("@")) details.push("email must include @");
    if (email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
    if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(country)) details.push("country is not in allowed market list");
    if (employees > 2000 && plan !== "enterprise") details.push("large companies must use enterprise plan");
    if (source === "partner" && !consentMarketing) details.push("partner leads require marketing consent");

    if (details.length > 0) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "domain_validation_failed",
        details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === email);

    let score = 0;
    if (plan === "enterprise") score += 35;
    if (plan === "growth") score += 20;
    if (employees >= 500) score += 30;
    else if (employees >= 100) score += 20;
    else if (employees >= 20) score += 10;
    if (source === "referral") score += 20;
    if (source === "webinar") score += 15;
    if (country === "US") score += 5;
    if (consentMarketing) score += 5;
    score = Math.max(0, Math.min(100, score));

    const segment = score >= 80 ? "enterprise_hot" : score >= 50 ? "growth_warm" : "starter_cold";

    const followupPlan = [];
    if (segment === "enterprise_hot") {
      followupPlan.push("assign account executive within 15 minutes");
      followupPlan.push("book discovery call in first business day");
    } else if (segment === "growth_warm") {
      followupPlan.push("send product fit email within 2 hours");
      followupPlan.push("schedule SDR outreach within 24 hours");
    } else {
      followupPlan.push("send educational drip campaign");
      followupPlan.push("review intent again in 7 days");
    }

    if (source === "webinar") {
      followupPlan.push("attach webinar recording and slides");
    }

    reply.code(200).send({
      ok: true,
      mode: "preview",
      email,
      score,
      segment,
      followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    });
  }
}

export { ContactControllerStage2 };
```
<!-- /DOCS:EXAMPLE -->

### Update provider to delegate

Use `docs/examples/03.real-app/src/server/providers/Stage2ControllerProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage2ControllerProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage2 } from "../controllers/ContactControllerStage2.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_2_CONTROLLER = "docs.examples.03.stage2.controller";

class Stage2ControllerProvider {
  static id = "docs.examples.03.stage2";

  register(app) {
    app.singleton(STAGE_2_CONTROLLER, () => new ContactControllerStage2());
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_2_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/intake",
        schema: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-2/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-2"],
          summary: "Stage 2 controller extraction: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage2ControllerProvider };
```
<!-- /DOCS:EXAMPLE -->

Routes are now thin delegates, but the controller still carries too much responsibility.

### What improved

- provider now focuses on assembly and route mapping
- request handlers are not inline anonymous functions anymore

### What still hurts

- controller still duplicates business logic
- controller still mixes orchestration + domain rules + storage access

## Stage 3: Extract a Service (Domain Logic in One Place)

Now we isolate business rules into one class.

### Create service

Use `docs/examples/03.real-app/src/server/services/ContactQualificationService.js`:

<!-- DOCS:EXAMPLE package="03.real-app" service="ContactQualificationService" lang="js" -->
```js
class ContactQualificationService {
  normalize(raw) {
    return {
      name: String(raw?.name || "").trim(),
      email: String(raw?.email || "").trim().toLowerCase(),
      company: String(raw?.company || "").trim(),
      employees: Number(raw?.employees || 0),
      plan: String(raw?.plan || "").trim().toLowerCase(),
      source: String(raw?.source || "").trim().toLowerCase(),
      country: String(raw?.country || "").trim().toUpperCase(),
      consentMarketing: Boolean(raw?.consentMarketing)
    };
  }

  validate(normalized) {
    const details = [];
    if (normalized.name.length < 2) details.push("name must have at least 2 characters");
    if (!normalized.email.includes("@")) details.push("email must include @");
    if (normalized.email.endsWith("@mailinator.com")) details.push("disposable emails are not allowed");
    if (!["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(normalized.country)) {
      details.push("country is not in allowed market list");
    }
    if (normalized.employees > 2000 && normalized.plan !== "enterprise") {
      details.push("large companies must use enterprise plan");
    }
    if (normalized.source === "partner" && !normalized.consentMarketing) {
      details.push("partner leads require marketing consent");
    }
    return details;
  }

  score(normalized) {
    let score = 0;
    if (normalized.plan === "enterprise") score += 35;
    if (normalized.plan === "growth") score += 20;
    if (normalized.employees >= 500) score += 30;
    else if (normalized.employees >= 100) score += 20;
    else if (normalized.employees >= 20) score += 10;
    if (normalized.source === "referral") score += 20;
    if (normalized.source === "webinar") score += 15;
    if (normalized.country === "US") score += 5;
    if (normalized.consentMarketing) score += 5;
    return Math.max(0, Math.min(100, score));
  }

  segment(score) {
    if (score >= 80) return "enterprise_hot";
    if (score >= 50) return "growth_warm";
    return "starter_cold";
  }

  followupPlan({ segment, source }) {
    const plan = [];
    if (segment === "enterprise_hot") {
      plan.push("assign account executive within 15 minutes");
      plan.push("book discovery call in first business day");
    } else if (segment === "growth_warm") {
      plan.push("send product fit email within 2 hours");
      plan.push("schedule SDR outreach within 24 hours");
    } else {
      plan.push("send educational drip campaign");
      plan.push("review intent again in 7 days");
    }

    if (source === "webinar") {
      plan.push("attach webinar recording and slides");
    }

    return plan;
  }

  qualify(raw) {
    const normalized = this.normalize(raw);
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

### Update controller to use service

Now the controller can call one service to run domain rules. This removes duplication in business logic.

### Full provider code for Stage 3

Use `docs/examples/03.real-app/src/server/providers/Stage3ServiceProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage3ServiceProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage3 } from "../controllers/ContactControllerStage3.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

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
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_3_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-3/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-3/contacts/intake",
        schema: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-3/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-3/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-3"],
          summary: "Stage 3 service extraction: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage3ServiceProvider };
```
<!-- /DOCS:EXAMPLE -->

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

### Create repository contract token

Use `docs/examples/03.real-app/src/server/repositories/ContactRepository.js`:

<!-- DOCS:EXAMPLE package="03.real-app" repository="ContactRepository" lang="js" -->
```js
const CONTACT_REPOSITORY_TOKEN = "docs.examples.03.contacts.repository";

class ContactRepository {
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

### Create in-memory implementation

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

### Full provider code for Stage 4

Use `docs/examples/03.real-app/src/server/providers/Stage4RepositoryProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage4RepositoryProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage4 } from "../controllers/ContactControllerStage4.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

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
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_4_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-4/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-4/contacts/intake",
        schema: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-4/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-4/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-4"],
          summary: "Stage 4 repository extraction: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage4RepositoryProvider };
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
  constructor({ createContactIntakeAction, previewContactFollowupAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
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
}

export { ContactControllerStage5 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 5

Use `docs/examples/03.real-app/src/server/providers/Stage5ActionProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage5ActionProvider" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage5 } from "../controllers/ContactControllerStage5.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";

const STAGE_5_REPOSITORY = "docs.examples.03.stage5.repository";
const STAGE_5_QUALIFICATION_SERVICE = "docs.examples.03.stage5.service.qualification";
const STAGE_5_CREATE_ACTION = "docs.examples.03.stage5.actions.create";
const STAGE_5_PREVIEW_ACTION = "docs.examples.03.stage5.actions.preview";
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
      STAGE_5_CONTROLLER,
      () =>
        new ContactControllerStage5({
          createContactIntakeAction: app.make(STAGE_5_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_5_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_5_CONTROLLER);

    const response = withStandardErrorResponses(
      {
        200: stage5SuccessSchema,
        422: stage5DomainErrorSchema
      },
      { includeValidation400: true }
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/intake",
        schema: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: intake",
          body: stage5BodySchema,
          response
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-5/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-5"],
          summary: "Stage 5 actions extraction: preview",
          body: stage5BodySchema,
          response
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
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

const contactPayloadSchema = Type.Object(
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

const contactSuccessSchema = Type.Object(
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

const contactDomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const contactRouteSchema = Object.freeze({
  body: contactPayloadSchema,
  response: {
    200: contactSuccessSchema,
    422: contactDomainErrorSchema
  }
});

export { contactRouteSchema };
```
<!-- /DOCS:EXAMPLE -->

### Provider wiring

Use `docs/examples/03.real-app/src/server/providers/Stage6LayeredProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage6LayeredProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage6 } from "../controllers/ContactControllerStage6.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_6_REPOSITORY = "docs.examples.03.stage6.repository";
const STAGE_6_QUALIFICATION_SERVICE = "docs.examples.03.stage6.service.qualification";
const STAGE_6_CREATE_ACTION = "docs.examples.03.stage6.actions.create";
const STAGE_6_PREVIEW_ACTION = "docs.examples.03.stage6.actions.preview";
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
      STAGE_6_CONTROLLER,
      () =>
        new ContactControllerStage6({
          createContactIntakeAction: app.make(STAGE_6_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_6_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_6_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-6/contacts/intake",
        schema: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-6/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-6"],
          summary: "Stage 6 final assembly: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, { includeValidation400: true })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
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

## Stage 7: Request Pipeline and Transport Validation

Stage 6 gave us a clean architecture. Stage 7 improves how request data flows from transport shape to domain-ready input.

In `router.register(...)`, route options include:

- `schema`: Fastify validation schema (built with TypeBox in this chapter)
- `input`: JSKIT normalization transforms that build `request.input`

`input` is a JSKIT route option (not native Fastify).

### What changed in Stage 7

- provider adds normalizer helpers (`normalizeContactBody`, `normalizeContactQuery`)
- route options add `input: { body, query }`
- controller reads `request.input.body` and `request.input.query`

At the top of `Stage7RequestPipelineProvider.js` (module-level helpers), add:

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
```

Inside `boot(app)` in `Stage7RequestPipelineProvider.js`, route registration adds `input`:

```js
router.register(
  "POST",
  "/api/v1/docs/ch03/stage-7/contacts/intake",
  {
    method: "POST",
    path: "/api/v1/docs/ch03/stage-7/contacts/intake",
    schema: {
      tags: ["docs-stage-7"],
      summary: "Stage 7 request pipeline: intake",
      body: contactRouteSchema.body,
      querystring: stage7QuerySchema,
      response: withStandardErrorResponses(contactRouteSchema.response, {
        includeValidation400: true
      })
    },
    input: {
      body: normalizeContactBody,
      query: normalizeContactQuery
    }
  },
  (request, reply) => controller.intake(request, reply)
);
```

In `ContactControllerStage7.js`, read normalized input:

```js
async intake(request, reply) {
  const payload = request.input.body;
  const query = request.input.query;
  ...
}
```

Execution order:

- route `schema` validates first
- route `input` transforms run next
- normalized values are exposed as `request.input`
- controllers/actions consume `request.input`, not raw request internals

`request.input` exists on routes that define `input`.

This keeps controllers cleaner and avoids repeating normalization boilerplate.

### Full provider code for Stage 7

Use `docs/examples/03.real-app/src/server/providers/Stage7RequestPipelineProvider.js`:

This is the complete provider file for Stage 7 (full code, not a partial snippet).

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage7RequestPipelineProvider" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { ContactControllerStage7 } from "../controllers/ContactControllerStage7.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeAction } from "../actions/CreateContactIntakeAction.js";
import { PreviewContactFollowupAction } from "../actions/PreviewContactFollowupAction.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_7_REPOSITORY = "docs.examples.03.stage7.repository";
const STAGE_7_QUALIFICATION_SERVICE = "docs.examples.03.stage7.service.qualification";
const STAGE_7_CREATE_ACTION = "docs.examples.03.stage7.actions.create";
const STAGE_7_PREVIEW_ACTION = "docs.examples.03.stage7.actions.preview";
const STAGE_7_CONTROLLER = "docs.examples.03.stage7.controller";

const stage7QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

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
      STAGE_7_CONTROLLER,
      () =>
        new ContactControllerStage7({
          createContactIntakeAction: app.make(STAGE_7_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_7_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_7_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-7/contacts/intake",
        schema: {
          tags: ["docs-stage-7"],
          summary: "Stage 7 request pipeline: intake",
          body: contactRouteSchema.body,
          querystring: stage7QuerySchema,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        },
        input: {
          body: normalizeContactBody,
          query: normalizeContactQuery
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-7/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-7"],
          summary: "Stage 7 request pipeline: preview",
          body: contactRouteSchema.body,
          querystring: stage7QuerySchema,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        },
        input: {
          body: normalizeContactBody,
          query: normalizeContactQuery
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage7RequestPipelineProvider };
```
<!-- /DOCS:EXAMPLE -->

### Full controller that reads `request.input`

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage7.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage7" lang="js" -->
```js
class ContactControllerStage7 {
  constructor({ createContactIntakeAction, previewContactFollowupAction }) {
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
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
}

export { ContactControllerStage7 };
```
<!-- /DOCS:EXAMPLE -->


### What improved

- transport validation and normalization now have explicit lifecycle order
- controller code consumes stable input shape (`request.input`)
- `dryRun` behavior can be routed without branching on raw query parsing code in multiple places




## Stage 8: Domain Validation and Error Ergonomics

Stage 7 fixed transport input flow. Stage 8 fixes domain failure handling flow.

In this stage:

- domain rules are represented explicitly as rule definitions
- `runDomainRules(...)` executes those rules and throws a consistent `DomainValidationError` when needed
- actions throw domain errors (`DomainValidationError`, `ConflictError`) instead of returning ad-hoc error objects
- controller uses `BaseController` for success response ergonomics

### Create domain rules service

Use `docs/examples/03.real-app/src/server/services/ContactDomainRulesServiceStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" service="ContactDomainRulesServiceStage8" lang="js" -->
```js
class ContactDomainRulesServiceStage8 {
  buildRules(normalized) {
    return [
      {
        field: "name",
        check: () =>
          normalized.name.length < 2 ? "name must have at least 2 characters" : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @" : null
      },
      {
        field: "email",
        check: () =>
          normalized.email.endsWith("@mailinator.com")
            ? "disposable emails are not allowed"
            : null
      },
      {
        field: "country",
        check: () =>
          !["US", "CA", "GB", "DE", "FR", "ES", "IT"].includes(normalized.country)
            ? "country is not in allowed market list"
            : null
      },
      {
        field: "plan",
        check: () =>
          normalized.employees > 2000 && normalized.plan !== "enterprise"
            ? "large companies must use enterprise plan"
            : null
      },
      {
        field: "consentMarketing",
        check: () =>
          normalized.source === "partner" && !normalized.consentMarketing
            ? "partner leads require marketing consent"
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage8 };
```
<!-- /DOCS:EXAMPLE -->

### Create throw-style actions with `runDomainRules(...)`

Use `docs/examples/03.real-app/src/server/actions/CreateContactIntakeActionStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" action="CreateContactIntakeActionStage8" lang="js" -->
```js
import { ConflictError, runDomainRules } from "@jskit-ai/kernel/server/runtime";

class CreateContactIntakeActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = this.qualificationService.normalize(payload);

    await runDomainRules(this.domainRulesService.buildRules(normalized), {
      message: "Domain validation failed."
    });

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
import { runDomainRules } from "@jskit-ai/kernel/server/runtime";

class PreviewContactFollowupActionStage8 {
  constructor({ qualificationService, domainRulesService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.domainRulesService = domainRulesService;
    this.contactRepository = contactRepository;
  }

  async execute(payload) {
    const normalized = this.qualificationService.normalize(payload);

    await runDomainRules(this.domainRulesService.buildRules(normalized), {
      message: "Domain validation failed."
    });

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

### Create BaseController-based controller

Use `docs/examples/03.real-app/src/server/controllers/ContactControllerStage8.js`:

<!-- DOCS:EXAMPLE package="03.real-app" controller="ContactControllerStage8" lang="js" -->
```js
import { BaseController } from "@jskit-ai/kernel/server/http";

class ContactControllerStage8 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
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
}

export { ContactControllerStage8 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 8

Use `docs/examples/03.real-app/src/server/providers/Stage8ErrorErgonomicsProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage8ErrorErgonomicsProvider" lang="js" -->
```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage8 } from "../controllers/ContactControllerStage8.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_8_REPOSITORY = "docs.examples.03.stage8.repository";
const STAGE_8_QUALIFICATION_SERVICE = "docs.examples.03.stage8.service.qualification";
const STAGE_8_DOMAIN_RULES_SERVICE = "docs.examples.03.stage8.service.domainRules";
const STAGE_8_CREATE_ACTION = "docs.examples.03.stage8.actions.create";
const STAGE_8_PREVIEW_ACTION = "docs.examples.03.stage8.actions.preview";
const STAGE_8_CONTROLLER = "docs.examples.03.stage8.controller";
const STAGE_8_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

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
      STAGE_8_CONTROLLER,
      () =>
        new ContactControllerStage8({
          createContactIntakeAction: app.make(STAGE_8_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_8_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_8_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_8_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_8_CONTROLLER);

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-8/contacts/intake",
        schema: {
          tags: ["docs-stage-8"],
          summary: "Stage 8 domain errors + BaseController: intake",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        }
      },
      (request, reply) => controller.intake(request, reply)
    );

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-8/contacts/preview-followup",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-8/contacts/preview-followup",
        schema: {
          tags: ["docs-stage-8"],
          summary: "Stage 8 domain errors + BaseController: preview",
          body: contactRouteSchema.body,
          response: withStandardErrorResponses(contactRouteSchema.response, {
            includeValidation400: true
          })
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
    );
  }
}

export { Stage8ErrorErgonomicsProvider };
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
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

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

  const requestId = scope.make(TOKENS.RequestId);
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
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { STAGE_9_REQUEST_CONTEXT_TOKEN } from "../support/stage9Middleware.js";

class ContactControllerStage9 extends BaseController {
  constructor({ createContactIntakeAction, previewContactFollowupAction }) {
    super();
    this.createContactIntakeAction = createContactIntakeAction;
    this.previewContactFollowupAction = previewContactFollowupAction;
  }

  resolveInputBody(request) {
    return request?.input?.body || request?.body || {};
  }

  attachRequestScopeHeaders(request, reply) {
    const scope = request?.scope;
    if (!scope || typeof scope.make !== "function") {
      return;
    }

    const requestId = scope.make(TOKENS.RequestId);
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
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage9 } from "../controllers/ContactControllerStage9.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage8 } from "../services/ContactDomainRulesServiceStage8.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { stage9ContactsMiddleware } from "../support/stage9Middleware.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_9_REPOSITORY = "docs.examples.03.stage9.repository";
const STAGE_9_QUALIFICATION_SERVICE = "docs.examples.03.stage9.service.qualification";
const STAGE_9_DOMAIN_RULES_SERVICE = "docs.examples.03.stage9.service.domainRules";
const STAGE_9_CREATE_ACTION = "docs.examples.03.stage9.actions.create";
const STAGE_9_PREVIEW_ACTION = "docs.examples.03.stage9.actions.preview";
const STAGE_9_CONTROLLER = "docs.examples.03.stage9.controller";
const STAGE_9_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

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
      STAGE_9_CONTROLLER,
      () =>
        new ContactControllerStage9({
          createContactIntakeAction: app.make(STAGE_9_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_9_PREVIEW_ACTION)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_9_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_9_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_9_CONTROLLER);

    const sharedOptions = {
      schema: {
        body: contactRouteSchema.body,
        querystring: stage9QuerySchema,
        response: withStandardErrorResponses(contactRouteSchema.response, {
          includeValidation400: true
        })
      },
      middleware: stage9ContactsMiddleware,
      input: {
        body: (body) => ({
          ...body,
          name: String(body?.name || "").trim(),
          email: String(body?.email || "").trim().toLowerCase(),
          company: String(body?.company || "").trim(),
          employees: Number(body?.employees || 0),
          plan: String(body?.plan || "").trim().toLowerCase(),
          source: String(body?.source || "").trim().toLowerCase(),
          country: String(body?.country || "").trim().toUpperCase(),
          consentMarketing: Boolean(body?.consentMarketing)
        }),
        query: (query) => ({
          dryRun: query?.dryRun === true || query?.dryRun === "true"
        })
      }
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-9/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-9/contacts/intake",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
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
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-9"],
          summary: "Stage 9 request scope + middleware reuse: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
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
          normalized.name.length < 2 ? "name must have at least 2 characters" : null
      },
      {
        field: "email",
        check: () =>
          !normalized.email.includes("@") ? "email must include @" : null
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
      },
      {
        field: "consentMarketing",
        check: () =>
          normalized.source === "partner" && !normalized.consentMarketing
            ? "partner leads require marketing consent"
            : null
      }
    ];
  }
}

export { ContactDomainRulesServiceStage10 };
```
<!-- /DOCS:EXAMPLE -->

### Full provider code for Stage 10

Use `docs/examples/03.real-app/src/server/providers/Stage10ConfigContractProvider.js`:

<!-- DOCS:EXAMPLE package="03.real-app" provider="Stage10ConfigContractProvider" lang="js" -->
```js
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage10 } from "../controllers/ContactControllerStage10.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage10 } from "../services/ContactDomainRulesServiceStage10.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { contactsModuleConfig } from "../support/contactsModuleConfigStage10.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_10_CONFIG = "docs.examples.03.stage10.config";
const STAGE_10_REPOSITORY = "docs.examples.03.stage10.repository";
const STAGE_10_QUALIFICATION_SERVICE = "docs.examples.03.stage10.service.qualification";
const STAGE_10_DOMAIN_RULES_SERVICE = "docs.examples.03.stage10.service.domainRules";
const STAGE_10_CREATE_ACTION = "docs.examples.03.stage10.actions.create";
const STAGE_10_PREVIEW_ACTION = "docs.examples.03.stage10.actions.preview";
const STAGE_10_CONTROLLER = "docs.examples.03.stage10.controller";
const STAGE_10_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

const stage10QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

class Stage10ConfigContractProvider {
  static id = "docs.examples.03.stage10";

  register(app) {
    const env = app.has(TOKENS.Env) ? app.make(TOKENS.Env) : process.env;
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
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_CONTROLLER,
      () =>
        new ContactControllerStage10({
          createContactIntakeAction: app.make(STAGE_10_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_10_PREVIEW_ACTION),
          contactsConfig: app.make(STAGE_10_CONFIG)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_10_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_10_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_10_CONTROLLER);

    const sharedOptions = {
      schema: {
        body: contactRouteSchema.body,
        querystring: stage10QuerySchema,
        response: withStandardErrorResponses(contactRouteSchema.response, {
          includeValidation400: true
        })
      },
      input: {
        body: (body) => ({
          ...body,
          name: String(body?.name || "").trim(),
          email: String(body?.email || "").trim().toLowerCase(),
          company: String(body?.company || "").trim(),
          employees: Number(body?.employees || 0),
          plan: String(body?.plan || "").trim().toLowerCase(),
          source: String(body?.source || "").trim().toLowerCase(),
          country: String(body?.country || "").trim().toUpperCase(),
          consentMarketing: Boolean(body?.consentMarketing)
        }),
        query: (query) => ({
          dryRun: query?.dryRun === true || query?.dryRun === "true"
        })
      }
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/intake",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
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
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
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
- `runDomainRules(...)` + domain error classes can enforce one consistent domain-failure contract

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
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  isAppError,
  registerApiErrorHandler
} from "@jskit-ai/kernel/server/runtime";
import { ContactControllerStage10 } from "../controllers/ContactControllerStage10.js";
import { ContactQualificationService } from "../services/ContactQualificationService.js";
import { ContactDomainRulesServiceStage10 } from "../services/ContactDomainRulesServiceStage10.js";
import { InMemoryContactRepository } from "../repositories/InMemoryContactRepository.js";
import { CreateContactIntakeActionStage8 } from "../actions/CreateContactIntakeActionStage8.js";
import { PreviewContactFollowupActionStage8 } from "../actions/PreviewContactFollowupActionStage8.js";
import { contactsModuleConfig } from "../support/contactsModuleConfigStage10.js";
import { contactRouteSchema } from "../../shared/schemas/contactSchemas.js";

const STAGE_10_CONFIG = "docs.examples.03.stage10.config";
const STAGE_10_REPOSITORY = "docs.examples.03.stage10.repository";
const STAGE_10_QUALIFICATION_SERVICE = "docs.examples.03.stage10.service.qualification";
const STAGE_10_DOMAIN_RULES_SERVICE = "docs.examples.03.stage10.service.domainRules";
const STAGE_10_CREATE_ACTION = "docs.examples.03.stage10.actions.create";
const STAGE_10_PREVIEW_ACTION = "docs.examples.03.stage10.actions.preview";
const STAGE_10_CONTROLLER = "docs.examples.03.stage10.controller";
const STAGE_10_ERROR_HANDLER_MARKER = "docs.examples.03.errorHandlerRegistered";

const stage10QuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false
  }
);

class Stage10ConfigContractProvider {
  static id = "docs.examples.03.stage10";

  register(app) {
    const env = app.has(TOKENS.Env) ? app.make(TOKENS.Env) : process.env;
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
        new CreateContactIntakeActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_PREVIEW_ACTION,
      () =>
        new PreviewContactFollowupActionStage8({
          qualificationService: app.make(STAGE_10_QUALIFICATION_SERVICE),
          domainRulesService: app.make(STAGE_10_DOMAIN_RULES_SERVICE),
          contactRepository: app.make(STAGE_10_REPOSITORY)
        })
    );

    app.singleton(
      STAGE_10_CONTROLLER,
      () =>
        new ContactControllerStage10({
          createContactIntakeAction: app.make(STAGE_10_CREATE_ACTION),
          previewContactFollowupAction: app.make(STAGE_10_PREVIEW_ACTION),
          contactsConfig: app.make(STAGE_10_CONFIG)
        })
    );
  }

  boot(app) {
    if (!app.has(STAGE_10_ERROR_HANDLER_MARKER)) {
      registerApiErrorHandler(app.make(TOKENS.Fastify), {
        isAppError
      });
      app.instance(STAGE_10_ERROR_HANDLER_MARKER, true);
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = app.make(STAGE_10_CONTROLLER);

    const sharedOptions = {
      schema: {
        body: contactRouteSchema.body,
        querystring: stage10QuerySchema,
        response: withStandardErrorResponses(contactRouteSchema.response, {
          includeValidation400: true
        })
      },
      input: {
        body: (body) => ({
          ...body,
          name: String(body?.name || "").trim(),
          email: String(body?.email || "").trim().toLowerCase(),
          company: String(body?.company || "").trim(),
          employees: Number(body?.employees || 0),
          plan: String(body?.plan || "").trim().toLowerCase(),
          source: String(body?.source || "").trim().toLowerCase(),
          country: String(body?.country || "").trim().toUpperCase(),
          consentMarketing: Boolean(body?.consentMarketing)
        }),
        query: (query) => ({
          dryRun: query?.dryRun === true || query?.dryRun === "true"
        })
      }
    };

    router.register(
      "POST",
      "/api/v1/docs/ch03/stage-10/contacts/intake",
      {
        method: "POST",
        path: "/api/v1/docs/ch03/stage-10/contacts/intake",
        ...sharedOptions,
        schema: {
          ...sharedOptions.schema,
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
        schema: {
          ...sharedOptions.schema,
          tags: ["docs-stage-10"],
          summary: "Stage 10 startup config contract: preview"
        }
      },
      (request, reply) => controller.previewFollowup(request, reply)
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
- domain validation is explicit in actions/services, using `runDomainRules(...)` + domain error classes
- global HTTP error mapping is centralized with `registerApiErrorHandler(...)`
- runtime context is request-scoped (`request.scope`, `TOKENS.RequestId`, and scoped context instances)
- middleware reuse is declarative at provider route registration
- startup config contracts are validated once at boot with `defineModuleConfig(...)`
- persistence validation stays in repository/storage invariants

If you had read the next sentence before this tutorial, it would have been almost impossible to parse:

`Stage10ConfigContractProvider` is a config-aware composition root that wires typed startup contracts, transport schema gates, request-input normalization, scoped runtime context, reusable middleware policy, explicit domain-rule execution, centralized domain error mapping, and repository-backed persistence invariants into one predictable provider lifecycle.
