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
 * Sends the hub's emails with the owner's own sender: Resend when
 * RESEND_API_KEY is set, otherwise SMTP_URL. Outside production, with neither
 * set, messages are written to the log so the developer can follow the link.
 */
function createMailer({ mail, logger, isProduction, fetchImpl = globalThis.fetch }) {
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
      body: JSON.stringify({ from: mail.from, to: [message.to], subject: message.subject, text: message.text, html: message.html })
    });
    if (!response.ok) {
      throw new Error(`The email service refused the message (${response.status}).`);
    }
  }

  return Object.freeze({
    configured: Boolean(mail.from && (mail.resendApiKey || mail.smtpUrl)),
    async send(message) {
      if (mail.from && mail.resendApiKey) return sendWithResend(message);
      if (mail.from && mail.smtpUrl) return sendWithSmtp(message);
      if (isProduction) throw new Error("The hub has no email sender.");
      logger?.info?.({ to: message.to, subject: message.subject }, `Accounts hub email (not sent: no sender configured)\n${message.text}`);
    }
  });
}

export { composeMessage, createMailer };
