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

<!-- docs:tooling-references
docs/examples/03.real-app
docs/examples/03.real-app/src/server/providers/ContactProviderStage1.js
docs/examples/03.real-app/src/server/providers/ContactProviderStage2.js
docs/examples/03.real-app/src/server/providers/ContactProviderStage3.js
docs/examples/03.real-app/src/server/providers/ContactProviderStage4.js
docs/examples/03.real-app/src/server/providers/ContactProviderStage5.js
docs/examples/03.real-app/src/server/providers/ContactProviderStage6.js
-->

## Where We Pick Up

From earlier chapters, you already have:

- a `manual-app`
- `@local/main` module
- provider lifecycle basics from Chapter 1
- container/provider mental model

Now we move from "first route" to "real feature architecture."


## Stage 1: Provider-Only Monolith (Works, But Hurts)

We will build a `contacts` feature with three routes.

This stage is intentionally "too much in one place." We want you to feel the pain clearly.

Files:

* src/server/providers/ContactProviderStage1.js (created)
* src/shared/schemas/contactSchemasStage1.js (created)
* src/shared/input/contactInputNormalizationStage1.js (created)

## What was added

The project includes a Provider that uses `router.register()` to add the specific routes. It uses an external schema file and a set of normalisation functions in the shared folder.

The fully working server exposes these endpoints:

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

Testing it:

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

### The verdict

- provider owns transport + domain + persistence logic in one place
- business logic is mixed with HTTP handling
- data storage policy is hidden in route code
- testing one rule requires booting route runtime

This is exactly why you need layers.

## Stage 2: Extract a Controller (Better, But Not Enough)

the first step is to move handler logic out of provider and into a controller.

This already helps because routes become wiring only. But the controller still owns domain logic and persistence details, so it is still overloaded.

Files:

* src/server/providers/ContactProviderStage2.js (modified)
* src/shared/schemas/contactSchemasStage2.js (unchanged)
* src/shared/input/contactInputNormalizationStage1.js (unchanged)

### The differences

#### The provider

* src/server/providers/ContactProviderStage2.js (modified)

In the main body of the module, the provider file now has:

```js
import { ContactControllerStage2 } from "../controllers/ContactControllerStage2.js";
(...)
const STAGE_2_CONTROLLER = "docs.examples.03.stage2.controller";
```

In the `boot()` function, it does:

```js
    const controller = app.make(STAGE_2_CONTROLLER);
```

As well as simply calling `router.register()` using the newly created controller function.
The code that used to be in the main function is now in the controller.

### The verdict

The good:
- provider now focuses on assembly and route mapping
- request handlers now delegate to controller methods instead of embedding domain logic in provider

The bad:
- controller is still the domain engine (`validate`, `score`, `segment`, `followupPlan`, `qualify`)
- controller still mixes orchestration + domain rules + storage access

## Stage 3: Extract a Service (Domain Logic in One Place) (REWRITE)

The next step is to move domain logic out of the controller and into a service.

Files:

* src/server/providers/ContactProviderStage3.js (modified)
* src/server/controllers/ContactControllerStage3.js (modified)
* src/server/services/ContactQualificationServiceStage3.js (new)
* src/shared/schemas/contactSchemasStage3.js (unchanged)
* src/shared/input/contactInputNormalizationStage1.js (unchanged)

### The differences


#### The provider

* src/server/providers/ContactProviderStage3.js (modified)

The provider first registers the newly created service as a singleton:

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


In the previous stage, the controller still owned domain methods (`validateContact`, `scoreContact`, `segmentFromScore`, `buildFollowupPlan`, `qualify`).
Now, the controller delegates that domain work to `ContactQualificationService`.  
This keeps controller responsibilities focused on:

- reading transport input (`request.body`)
- calling domain logic
- mapping result to HTTP response

#### The service

* src/server/services/ContactQualificationServiceStage3.js (new)

The service file holds domain logic in one place.

The service contract is simple; `qualify(raw)` returns one of two shapes:

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

Internal service helpers are `_`-prefixed (`_validate`, `_score`, `_segment`, `_followupPlan`) and are not part of the public service API.

### Notes

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

While `make()` exists, it should mostly live in providers (composition root), not in controller methods.


### The verdict

The good:

- business rules are centralized in one reusable class
- controller code is smaller and easier to scan
- provider wiring makes dependencies explicit

The bad:

- controller still mixes HTTP flow with storage policy
- duplicate checks and writes are still done against controller-local state
- persistence is still not isolated behind a repository contract


## Stage 4: Extract Repository (Data Access Contract)

Now we isolate persistence concerns from controller code.

We are not introducing the official DB module yet. That is deliberate.

For now, we use an in-memory repository implementation behind a repository token. This keeps architecture correct while staying dependency-light.

Files:

* src/server/providers/ContactProviderStage4.js (modified)
* src/server/controllers/ContactControllerStage4.js (modified)
* src/server/repositories/ContactRepositoryStage4.js (new)
* src/server/repositories/InMemoryContactRepositoryStage4.js (new)
* src/server/services/ContactQualificationServiceStage4.js (unchanged)
* src/shared/schemas/contactSchemasStage4.js (unchanged)
* src/shared/input/contactInputNormalizationStage1.js (unchanged)

### The differences

#### The provider

* src/server/providers/ContactProviderStage4.js (modified)

With the repository extracted, provider wiring gets cleaner and responsibilities are more explicit.

What changed from Stage 3:

- provider now registers a repository dependency (`STAGE_4_REPOSITORY`)
- controller receives `contactRepository` via constructor injection
- route wiring stays thin and unchanged
- persistence no longer lives in controller-owned state internals

The main change is that the repository is now imported, and added to the controller's constructor 9along with the service).

```js
// Stage 4: provider wires service + repository
app.singleton(STAGE_4_REPOSITORY, () => new InMemoryContactRepositoryStage4());
app.singleton(
  STAGE_4_CONTROLLER,
  () =>
    new ContactControllerStage4({
      qualificationService: app.make(STAGE_4_QUALIFICATION_SERVICE),
      contactRepository: app.make(STAGE_4_REPOSITORY)
    })
);
```

#### The controller

* src/server/controllers/ContactControllerStage4.js (modified)

This is the key behavior change in this stage:

- Stage 3 controller used local storage state (`this.contacts`)
- Stage 4 controller uses repository calls (`findByEmail`, `save`, `findById`)

Quick snippet summary of what changed.

Instead of using straight array searching function:

```js
// Stage 3 (local controller state)
const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);
this.contacts.push(created);
const found = this.contacts.find((entry) => entry.id === contactId) || null;
```

It now uses a data layer:

```js
// Stage 4 (repository boundary)
const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);
this.contactRepository.save(created);
const found = this.contactRepository.findById(contactId);
```

#### The repository contract

* src/server/repositories/ContactRepositoryStage4.js (new)

We now need the code that actually implements the repository.

Why define both a token and a repository contract?

- token (`CONTACT_REPOSITORY_TOKEN`) is the container key used by app wiring
- contract class (`ContactRepositoryStage4`) is the code-level interface that defines required methods
- together they decouple usage from implementation, so you can swap implementations without touching controller/action code
- tests can bind fakes/stubs to the same token, while production can bind database-backed implementations

#### The in-memory repository implementation

* src/server/repositories/InMemoryContactRepositoryStage4.js (new)

This is the basic implementation of the repository.


### The verdict

The good:

- data access now has a clear contract
- storage backend can change without changing business logic
- repository rules are testable independently

The bad:

- controller still contains use-case orchestration logic
- changing workflow means editing controller methods directly

## Stage 5: Extract Actions (Use-Case Orchestration)

At this point, we are getting close to the shape most production backends use every day.

Files:

* src/server/providers/ContactProviderStage5.js (modified)
* src/server/controllers/ContactControllerStage5.js (modified)
* src/server/actions/CreateContactIntakeActionStage5.js (new)
* src/server/actions/PreviewContactFollowupActionStage5.js (new)
* src/server/actions/GetContactByIdActionStage5.js (new)
* src/server/services/ContactQualificationServiceStage5.js (unchanged)
* src/server/repositories/InMemoryContactRepositoryStage5.js (unchanged)
* src/shared/schemas/contactSchemasStage5.js (unchanged)
* src/shared/input/contactInputNormalizationStage1.js (unchanged)

### The differences

In real modules, controller methods are usually very small:

- read transport input
- call one action (the use case)
- map action result to HTTP response

That is the normal target shape. A controller can do more when needed, but "controller delegates to action" is the common baseline.

Before we write code, it helps to make one distinction very explicit:

- a `service` usually provides reusable business capabilities
- an `action` usually executes one concrete use case end to end

A good rule of thumb:

- if code is reusable domain behavior across multiple workflows, it belongs in a service
- if code describes one business operation from start to finish, it belongs in an action

In Stage 5, each workflow becomes an explicit action class, and the controller delegates to those actions.

Here is how the codebase will change.

#### The provider

* src/server/providers/ContactProviderStage5.js (modified)

This is the most important thing to understand in this stage:

Stage 4 and Stage 5 use the same provider wiring pattern; what changes is only the dependency graph: this is not a different DI style.
The same pattern is used:

- `app.singleton(...)` for each dependency
- `app.singleton(STAGE_X_CONTROLLER, () => new Controller({ ...deps }))` for constructor injection
- `boot(app)` resolves router + controller and registers routes

What changed from Stage 4 to Stage 5:

- before (Stage 4): controller depends on service + repository directly
- after (Stage 5): controller depends on actions
- those actions then depend on service + repository

This is why the injected dependencies in new ContactControllerStage4() are very different:

```js
// Stage 5: controller receives explicit actions
app.singleton(
  STAGE_5_CREATE_ACTION,
  () =>
    // The action depeneds on the repository
    new CreateContactIntakeActionStage5({
      qualificationService: app.make(STAGE_5_QUALIFICATION_SERVICE),
      contactRepository: app.make(STAGE_5_REPOSITORY)
    })
);

// Repeat for actions STAGE_5_PREVIEW_ACTION and STAGE_5_GET_BY_ID_ACTION

// (...)

app.singleton(
  // The controller depends on the actions
  STAGE_5_CONTROLLER,
  () =>
    new ContactControllerStage5({
      createContactIntakeAction: app.make(STAGE_5_CREATE_ACTION),
      previewContactFollowupAction: app.make(STAGE_5_PREVIEW_ACTION),
      getContactByIdAction: app.make(STAGE_5_GET_BY_ID_ACTION)
    })
);

```

#### The controller

* src/server/controllers/ContactControllerStage5.js (modified)

What changed:

- controller no longer coordinates qualification + repository calls directly
- each route handler calls exactly one action
- controller keeps HTTP responsibilities only (status code + payload mapping)

Quick snippet summary:

```js
// Stage 4 controller (orchestration inside controller)
const qualified = this.qualificationService.qualify(request.body);
const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);
const created = this.contactRepository.save({ ...qualified.normalized, ... });
reply.code(200).send({ ... });

// Stage 5 controller (delegation to action)
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

#### The actions: create intake, preview follow-up, get by id

* src/server/actions/CreateContactIntakeActionStage5.js (new)
* src/server/actions/PreviewContactFollowupActionStage5.js (new)
* src/server/actions/GetContactByIdActionStage5.js (new)

What changed from Stage 4:

- orchestration moved from controller methods into `execute(...)` on actions
- each use case has its own class
- each action returns a standardized result object consumed by controller mapping logic

Quick snippet summary:

```js
// Each action owns one workflow and returns a transport-ready result envelope.

execute(payload) {
  const qualified = this.qualificationService.qualify(payload);
  if (!qualified.ok) return { ok: false, status: 422, code: "...", details: [...] };
  // use-case specific orchestration...
  return { ok: true, status: 200, data: { ... } };
}
```

### The verdict

The good:

- controller now maps HTTP only
- use-case orchestration is explicit and testable
- business rules and persistence are isolated from HTTP concerns

The bad:

- controller still manually maps `{ ok, status, code, details, data }` envelopes
- domain failures are still result-object based and not yet using the Stage 8 ergonomics

## Stage 6: DOESN'T ACTUALLY DO ANYTHING

TO BE DELETED

## Stage 7: Route Contract API and Normalization

Stage 6 gave us clean layering. Stage 7 keeps that layering, and upgrades transport input handling so it is explicit, centralized, and deterministic.

Files:

* src/server/providers/ContactProviderStage7.js (modified)
* src/server/controllers/ContactControllerStage7.js (modified)
* src/server/services/ContactQualificationServiceStage7.js (modified)
* src/server/actions/CreateContactIntakeActionStage7.js (unchanged)
* src/server/actions/PreviewContactFollowupActionStage7.js (unchanged)
* src/server/actions/GetContactByIdActionStage7.js (unchanged)
* src/shared/schemas/contactSchemasStage7.js (modified)
* src/shared/input/contactInputNormalizationStage7.js (modified)

### The differences

#### The provider

* src/server/providers/ContactProviderStage7.js (modified)

```js
// Stage 6 style
router.register(
  "POST",
  "/.../intake",
  { ...contactIntakePostRouteContract, meta: { ... } },
  handler
);
```

```js
// Stage 7 style
router.register(
  "POST",
  "/.../intake",
  contactIntakePostRouteContractStage7,
  handler
);
```

Provider now passes route contracts directly (instead of spreading and overriding `meta` inline):

```js
router.register(
  "POST",
  "/api/v1/docs/ch03/stage-7/contacts/intake",
  contactIntakePostRouteContractStage7,
  (request, reply) => controller.intake(request, reply)
);
```

What this means at runtime:

- request is validated first (`body.schema`, `params.schema`)
- matching normalizers then run (`body.normalize`, `params.normalize`)
- normalized values are exposed in `request.input`
- controller/actions consume normalized values instead of raw transport values

#### The controller

* src/server/controllers/ContactControllerStage7.js (modified)

```js
// Stage 6
const result = this.createContactIntakeAction.execute(request.body);
const contactId = request.params?.contactId;

// Stage 7
const payload = request.input.body;
const result = this.createContactIntakeAction.execute(payload);
const contactId = request.input.params.contactId;
```

What changed from Stage 6:

- controller now reads normalized payload/params from `request.input`
- route-param fallback to `request.params` is removed
- transport-shape parsing concerns are out of controller code


#### The shared route contracts

- Stage 7 contracts are declared as full standalone contracts (not wrappers around Stage 6 contracts)
- each route section (`body`, `params`) includes both `schema` and `normalize` where relevant
- response maps stay in the same contract object

For example:

```js
const contactIntakePostRouteContractStage7 = {
  meta: { tags: ["contacts"], summary: "Create contact" },
  body: { 
    schema: contactIntakePreviewBodySchema, 
    normalize: normalizeContactBody // New normalization funcition
  },
  response: contactIntakePreviewResponseSchema
};
```

This is a strong shift: schema validation and normalization happens once only, and it's centralised in the contract definition.
They are all pure functions, which means that both client and server can access them.

#### The service

* src/server/services/ContactQualificationServiceStage7.js (modified)

```js
  // Stage 6
  qualify(rawPayload) {
    const normalized = normalizeContactBody(rawPayload);
    // ...qualification logic
  }

  // Stage 7
  qualify(payload) { // already normalized by route contract
    // ...same qualification logic, no normalization step
  }
```

#### The shared input normalization

* src/shared/input/contactInputNormalizationStage7.js (modified)

```js
// Stage 7 input module
export {
  normalizeContactBody,
  normalizeContactParams
} from "./contactInputNormalizationStage1.js";
```

Normalization functions now live in shared input modules and are referenced by route contracts.
That keeps transport-shaping logic reusable and out of provider/controller code.

### The verdict

The good:

- Stage 7 contracts are now production-shaped: full schema + normalization in one shared contract module
- transport normalization is done once in the request pipeline, not repeated inside service/action flow
- controller stays transport-thin and consumes normalized input only
- provider remains wiring-focused while using explicit Stage 7 contracts and the same action classes as Stage 6

The bad:

- domain error ergonomics are still in transition until Stage 8
- request-scope context and middleware reuse are still not applied
- startup config contracts are still not enforced

## Stage 8: Domain Validation and Error Ergonomics

Before this stage, actions returned error objects (`{ ok: false, status, code, details }`;  controllers had to branch on `if (!result.ok)` and map errors manually

After these changes, actions throw typed errors (`DomainValidationError`, `ConflictError`, `NotFoundError`); controller stays success-path only, using `BaseController`, and runtime error handling will map thrown app errors to JSON responses.

Files changed from Stage 7:

* src/server/providers/ContactProviderStage8.js (unchanged)
* src/server/controllers/ContactControllerStage8.js (modified)
* src/server/actions/CreateContactIntakeActionStage8.js (modified)
* src/server/actions/PreviewContactFollowupActionStage8.js (modified)
* src/server/actions/GetContactByIdActionStage8.js (modified)
* src/server/services/ContactQualificationServiceStage8.js (modified)

### The differences


#### The controller

* src/server/controllers/ContactControllerStage8.js (modified)

Before this change, the controller would branch off in case the result was not OK:

```js
const result = this.createContactIntakeAction.execute(request.input.body);
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

After (success-only controller):

```js
import { BaseController } from "@jskit-ai/kernel/server/http";

const created = await this.createContactIntakeAction.execute(request.input.body);
return this.ok(reply, created);
```

#### The create action

* src/server/actions/CreateContactIntakeActionStage8.js (modified)

Before:

```js
const qualified = this.qualificationService.qualify(payload);
if (!qualified.ok) {
  return {
    ok: false,
    status: 422,
    code: qualified.code,
    details: qualified.details
  };
}
```

After:

```js
import { DomainValidationError, ConflictError } from "@jskit-ai/kernel/server/runtime";

const fieldErrors = this.qualificationService.validate(payload);
if (Object.keys(fieldErrors).length > 0) {
  throw new DomainValidationError(
    { fieldErrors },
    { message: "Contact domain validation failed.", code: "contact_domain_invalid" }
  );
}

const duplicate = this.contactRepository.findByEmail(payload.email);
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
```

#### The preview action

* src/server/actions/PreviewContactFollowupActionStage8.js (modified)

Before:

```js
const qualified = this.qualificationService.qualify(payload);
if (!qualified.ok) {
  return {
    ok: false,
    status: 422,
    code: qualified.code,
    details: qualified.details
  };
}
```

After:

```js
import { DomainValidationError } from "@jskit-ai/kernel/server/runtime";

const fieldErrors = this.qualificationService.validate(payload);
if (Object.keys(fieldErrors).length > 0) {
  throw new DomainValidationError(
    { fieldErrors },
    { message: "Contact domain validation failed.", code: "contact_domain_invalid" }
  );
}
```

#### The get-by-id action

* src/server/actions/GetContactByIdActionStage8.js (modified)

Before:

```js
if (!contact) {
  return {
    ok: false,
    status: 404,
    code: "contact_not_found",
    details: [`No contact found for id ${normalizedId || "<empty>"}.`]
  };
}
```

After:

```js
import { NotFoundError } from "@jskit-ai/kernel/server/runtime";

if (!contact) {
  throw new NotFoundError("Contact not found.", {
    code: "contact_not_found",
    details: {
      contactId: normalizedId
    }
  });
}
```

#### The qualification service

* src/server/services/ContactQualificationServiceStage8.js (modified)

Before (Stage 7 style):

```js
qualify(payload) {
  const details = this._validate(payload);
  if (details.length > 0) {
    return {
      ok: false,
      code: "domain_validation_failed",
      details,
      normalized: payload
    };
  }

  const score = this._score(payload);
  const segment = this._segment(score);
  const followupPlan = this._followupPlan({
    segment,
    source: payload.source
  });

  return {
    ok: true,
    normalized: payload,
    score,
    segment,
    followupPlan
  };
}
```

After (Stage 8 style):

```js
validate(payload) {
  const fieldErrors = {};
  if (payload.name.length < 2) fieldErrors.name = "name must have at least 2 characters.";
  if (!payload.email.includes("@")) fieldErrors.email = "email must include @.";
  if (payload.plan === "starter" && payload.employees > 200) {
    fieldErrors.plan = "starter plan supports up to 200 employees";
  }
  return fieldErrors;
}

qualify(payload) {
  const score = this._score(payload);
  const segment = this._segment(score);
  const followupPlan = this._followupPlan({
    segment,
    source: payload.source
  });

  return {
    normalized: payload,
    score,
    segment,
    followupPlan
  };
}
```

Difference in responsibility:

- `validate(payload)` handles domain validation only
- `qualify(payload)` handles scoring/segmentation/follow-up only

This is why Stage 8 actions can now throw directly on validation errors and then call `qualify(...)` for success-path domain output.

### The verdict

The good:
- Stage 8 is now a clean, shippable domain-error ergonomics step
- each layer has one clear responsibility

The bad:
- Not much left!
## Stage 9: Runtime Context and Middleware Reuse

Stage 9 adds runtime context and middleware reuse.

What this means in plain terms:

- every request has `request.scope` (request-local container)
- middleware can read/write request-local values in that scope
- provider can reuse one middleware stack across all related routes

Files:

* src/server/providers/ContactProviderStage9.js (modified)
* src/server/controllers/ContactControllerStage9.js (modified)
* src/server/support/contactsMiddlewareStage9.js (new)
* src/shared/input/contactInputNormalizationStage9.js (modified)
* src/shared/schemas/contactSchemasStage9.js (modified)
* src/server/actions/CreateContactIntakeActionStage9.js (unchanged)
* src/server/actions/PreviewContactFollowupActionStage9.js (unchanged)
* src/server/actions/GetContactByIdActionStage9.js (unchanged)

### The differences

#### The middleware stack

* src/server/support/contactsMiddlewareStage9.js (new)

Stage 9 introduces one reusable middleware array:

```js
const contactsMiddlewareStage9 = Object.freeze([
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware
]);
```

Each middleware does one thing:

- `requireRequestScopeMiddleware` ensures `request.scope` exists
- `attachRequestContextMiddleware` stores request context in scope
- `requirePartnerConsentMiddleware` enforces route-level business precondition

#### The provider

* src/server/providers/ContactProviderStage9.js (modified)

Before (Stage 8): each route used a direct contract object only.

```js
router.register(
  "POST",
  "/api/v1/docs/ch03/stage-8/contacts/intake",
  contactIntakePostRouteContractStage8,
  handler
);
router.register(
  "POST",
  "/api/v1/docs/ch03/stage-8/contacts/preview-followup",
  contactPreviewFollowupPostRouteContractStage8,
  handler
);
```

After (Stage 9): provider defines shared route options once and reuses them.

```js
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
  middleware: contactsMiddlewareStage9
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
```

This is the key Stage 9 win: one middleware stack, reused across related routes.

#### The controller

* src/server/controllers/ContactControllerStage9.js (modified)

Controller now reads context from request scope and adds response headers:

```js
const requestId = scope.make(KERNEL_TOKENS.RequestId);
const context = scope.has(STAGE_9_REQUEST_CONTEXT_TOKEN)
  ? scope.make(STAGE_9_REQUEST_CONTEXT_TOKEN)
  : null;

if (requestId) reply.header("x-request-id", requestId);
if (context?.receivedAt) reply.header("x-request-received-at", context.receivedAt);
```

Controller input handling is also made defensive:

```js
resolveInputBody(request) {
  return request?.input?.body || request?.body || {};
}
```

#### Shared contracts and input

* src/shared/schemas/contactSchemasStage9.js (modified)
* src/shared/input/contactInputNormalizationStage9.js (modified)

These remain thin stage-scoped exports. The practical behavior change in Stage 9 comes from:

- provider middleware wiring
- middleware implementation
- controller use of request scope context

### What improved

- request metadata is available in one request-local place (`request.scope`)
- middleware is reusable without duplicating route-level function arrays
- runtime concerns stay in middleware/controller, not in actions/services

### The verdict

The good:

- Stage 9 introduces a clear runtime-context pattern
- middleware reuse reduces repeated route boilerplate

The bad:

- startup config still is not validated yet (next stage)
- alias/group middleware declarations are still optional at this stage

## Stage 10: Startup Config Contracts

Stage 10 hardens module startup by validating config at boot time.

Files:

* src/server/providers/ContactProviderStage10.js (modified)
* src/server/controllers/ContactControllerStage10.js (modified)
* src/server/support/contactsModuleConfigStage10.js (new)
* src/server/support/contactsMiddlewareStage10.js (new)
* src/server/services/ContactDomainRulesServiceStage10.js (modified)
* src/server/actions/CreateContactIntakeActionStage10.js (modified)
* src/server/actions/PreviewContactFollowupActionStage10.js (modified)
* src/server/actions/GetContactByIdActionStage10.js (modified)
* src/shared/schemas/contactSchemasStage10.js (modified)
* src/shared/input/contactInputNormalizationStage10.js (modified)

### The differences

#### The module config contract

* src/server/support/contactsModuleConfigStage10.js (new)

- declares module config schema once with TypeBox
- transforms + validates raw/env values with `defineModuleConfig(...)`

#### The domain rules service

* src/server/services/ContactDomainRulesServiceStage10.js (modified)

- receives typed, validated config instead of unchecked runtime values

#### The middleware stack

* src/server/support/contactsMiddlewareStage10.js (new)

- keeps Stage 9 middleware reuse integrated in the config-hardened stage

#### The controller

* src/server/controllers/ContactControllerStage10.js (modified)

- remains thin; behavior now runs on validated module policy

#### The provider

* src/server/providers/ContactProviderStage10.js (modified)

- fails fast at startup when config is invalid

#### Kernel domain rule helper

* `@jskit-ai/kernel/server/runtime` `assertNoDomainRuleFailures(...)`

- optional advanced helper to reduce repeated rule-failure plumbing in larger modules

#### The action: create intake

* src/server/actions/CreateContactIntakeActionStage10.js (modified)

- consumes validated config limits/policies during orchestration

#### The action: preview follow-up

* src/server/actions/PreviewContactFollowupActionStage10.js (modified)

- consumes the same validated policy contract as intake

#### The action: get by id

* src/server/actions/GetContactByIdActionStage10.js (modified)

- aligned to the Stage 10 typed-config error flow

#### The shared route contracts

* src/shared/schemas/contactSchemasStage10.js (modified)

- transport contract remains explicit and versioned for Stage 10

#### The shared input normalization

* src/shared/input/contactInputNormalizationStage10.js (modified)

- normalization remains deterministic and tied to Stage 10 contracts

### The verdict

The good:

- config parsing/validation is centralized and testable
- invalid env fails before traffic, not during request handling
- business limits are now policy-driven by config, not hardcoded magic numbers

The bad:

- this chapter still uses an in-memory repository (production DB strategy is deferred)
- advanced test harnessing is still deferred to a dedicated testing chapter

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
- `POST /api/v1/docs/ch03/stage-7/contacts/intake` success (input normalized through Stage 7 route contract)
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

* src/server/providers/ContactProviderStage10.js



### Final overview (using the full lingo)

By this point, the module is a proper composition root:

- provider lifecycle wires container bindings (`singleton` + `instance`) with explicit tokens
- transport validation is enforced by route `schema`
- request pipeline ergonomics are handled through `input` normalization into `request.input`
- domain validation is explicit in actions/services, using domain error classes
- global HTTP error mapping is centralized by runtime bootstrap defaults
- runtime context is request-scoped (`request.scope`, `KERNEL_TOKENS.RequestId`, and scoped context instances)
- middleware reuse is declarative at provider route registration
- startup config contracts are validated once at boot with `defineModuleConfig(...)`
- persistence validation stays in repository/storage invariants

If you had read the next sentence before this tutorial, it would have been almost impossible to parse:

`ContactProviderStage10` is a config-aware composition root that wires typed startup contracts, transport schema gates, request-input normalization, scoped runtime context, reusable middleware policy, explicit domain validation, centralized domain error mapping, and repository-backed persistence invariants into one predictable provider lifecycle.
