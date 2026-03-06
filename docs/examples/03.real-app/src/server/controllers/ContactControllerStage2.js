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
