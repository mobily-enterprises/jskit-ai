import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  contactByIdGetRouteContract,
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract
} from "../../shared/schemas/contactSchemas.js";

class Stage1MonolithProvider {
  static id = "docs.examples.03.stage1";

  register() {}

  boot(app) {
    const router = app.make(KERNEL_TOKENS.HttpRouter);
    const contacts = [];

    const normalizeContact = (raw) => ({
      name: String(raw?.name || "").trim(),
      email: String(raw?.email || "").trim().toLowerCase(),
      company: String(raw?.company || "").trim(),
      employees: Number(raw?.employees || 0),
      plan: String(raw?.plan || "").trim().toLowerCase(),
      source: String(raw?.source || "").trim().toLowerCase(),
      country: String(raw?.country || "").trim().toUpperCase(),
      consentMarketing: Boolean(raw?.consentMarketing)
    });

    const validateContact = (normalized) => {
      const details = [];
      if (normalized.name.length < 2) details.push("name must have at least 2 characters.");
      if (!normalized.email.includes("@")) details.push("email must include @.");
      if (![
        "US",
        "CA",
        "GB",
        "DE",
        "FR",
        "ES",
        "IT"
      ].includes(normalized.country)) {
        details.push("country is not in allowed market list");
      }
      if (normalized.plan === "starter" && normalized.employees > 200) {
        details.push("starter plan supports up to 200 employees");
      }

      return details;
    };

    const scoreContact = (normalized) => {
      const planScore =
        normalized.plan === "enterprise" ? 50 : normalized.plan === "growth" ? 30 : 10;
      const employeeScore = Math.min(30, Math.floor(normalized.employees / 50) * 5);
      const sourceScore =
        normalized.source === "referral" ? 12 : normalized.source === "webinar" ? 8 : 0;
      const consentScore = normalized.consentMarketing ? 4 : 0;

      return Math.max(
        0,
        Math.min(100, planScore + employeeScore + sourceScore + consentScore)
      );
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
      const normalized = normalizeContact(raw);
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
