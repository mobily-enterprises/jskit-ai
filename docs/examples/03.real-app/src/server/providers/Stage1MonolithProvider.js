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
