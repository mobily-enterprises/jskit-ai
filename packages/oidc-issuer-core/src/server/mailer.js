import { deliverMessage, markStagingEmail } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { escapeHtml } from "./http.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** One plain message with one button, readable in any mail client. */
function composeMessage({ heading, body, actionLabel, actionUrl, footer }) {
  const text = [heading, "", body, "", `${actionLabel}: ${actionUrl}`, "", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1c22">
<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;padding:32px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>
<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#315da8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${escapeHtml(actionLabel)}</a>
<p style="font-size:13px;color:#5d5f6a;line-height:1.5;margin:24px 0 0">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { text, html };
}

/**
 * Sends the hub's emails with the owner's own sender, as APP_ENV says (`deliverMessage`): Resend when
 * RESEND_API_KEY is set, otherwise SMTP_URL. Production sends each to its recipient; staging only to
 * STAGING_EMAIL_TO, saying who it was for, or logs it when that is unset; development and test log each message,
 * link included. `send` answers `{ simulated: true }` when the message was logged instead of sent.
 * @param {object} dependencies
 * @param {import("./types.js").HubConfig["mail"]} dependencies.mail
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {typeof fetch} dependencies.fetchImpl
 */
function createMailer({ mail, env, logger, fetchImpl }) {
  let smtpTransport = null;

  async function sendWithSmtp(message) {
    if (!smtpTransport) {
      const { default: nodemailer } = await import("nodemailer");
      smtpTransport = nodemailer.createTransport(mail.smtpUrl);
    }
    await smtpTransport.sendMail({ from: mail.from, ...message });
  }

  async function sendWithResend(message) {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${mail.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: mail.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers
      })
    });
    if (!response.ok) {
      throw new Error(`The email service refused the message (${response.status}).`);
    }
  }

  // Staging and production start only with a sender (resolveHubConfig), and only they send.
  async function sendNow(message) {
    if (mail.from && mail.resendApiKey) {
      await sendWithResend(message);
    } else if (mail.from && mail.smtpUrl) {
      await sendWithSmtp(message);
    } else {
      throw new Error("The hub has no email sender.");
    }
  }

  /** @returns {Promise<{ simulated: boolean }>} */
  async function send(message) {
    const delivery = await deliverMessage({
      env,
      logger,
      channel: "email",
      to: message.to,
      summary: `the accounts hub email "${message.subject}" to ${message.to}`,
      details: { subject: message.subject, text: message.text },
      send: (to, { originalTo }) => sendNow(markStagingEmail({ ...message, to }, originalTo))
    });
    return { simulated: !delivery.sent };
  }

  return Object.freeze({
    configured: Boolean(mail.from && (mail.resendApiKey || mail.smtpUrl)),
    send
  });
}

export { composeMessage, createMailer };
