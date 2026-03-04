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
- Stage 6: final clean assembly

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

## Final Architecture Preview

This is where we are going.

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

Final request flow:

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

## Stage 6: Final Clean Assembly (Schemas + Provider Wiring)

Now we compose everything together in a clean, production-shaped structure.

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


## TO BE ADDED TO THIS CHAPTER

This chapter standardizes one error-handling style for everyday modules:

- actions return explicit result objects (`ok: true` / `ok: false`)
- controllers map those results to HTTP responses

Advanced variants to cover in this chapter:

- `BaseController.sendActionResult(...)` convenience mapping.
- Route `input` transforms with explicit lifecycle order: route `schema` validates first, then `input` normalizes into `request.input`, then controllers/actions consume `request.input`.
- Request-scope context APIs: `request.scope`, `TOKENS.Request`, `TOKENS.Reply`, `TOKENS.RequestId`, `TOKENS.RequestScope`.
- Domain-error class model: `DomainValidationError`, `ConflictError`, `NotFoundError`.
- Global HTTP mapping integration point: `registerApiErrorHandler(...)`.
- Canonical mapped payload shape: `{ error, code, details }` (with `fieldErrors` when applicable).

Chapter 3 intentionally stays manual up to this point, Now is where we apply these kernel niceties and compare before/after.

Best-practice note for this codebase:

- Default path: action result objects + `BaseController.sendActionResult(...)`.
- Why: explicit domain failures (`ok: false`, `code`, `details`), easy testing, less controller boilerplate.
- Use throw-style (`AppError` / domain subclasses) for truly exceptional or cross-cutting failures.


## Three Validation Levels (The Important Mental Model)

When people are new to layered backend design, this is often the most confusing part.

Use this rule:

- transport validation: route `schema` checks shape and basic constraints
- domain validation: service and action checks business rules
- persistence validation: repository enforces data constraints and storage invariants

These are not duplicates. They are different responsibilities.

Example:

- payload missing `email` -> transport validation (400)
- `employees > 2000` with `plan = starter` -> domain validation (422)
- unique email collision in repository -> persistence/domain conflict (422 or 409, by policy)

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

- `POST /api/v1/contacts/intake` success
- `POST /api/v1/contacts/intake` duplicate email
- `POST /api/v1/contacts/preview-followup` success with `persisted: false`
- schema-level validation failure for malformed request

## What You Should Take Away

- Putting everything in one provider route handler is possible but does not scale.
- Controller extraction improves route organization, but does not solve domain complexity.
- Service extraction centralizes business rules.
- Repository extraction protects you from storage coupling.
- Action extraction makes use cases explicit and testable.
- Provider remains the composition root.

That is the path from "it works" to "it keeps working when the feature grows."
