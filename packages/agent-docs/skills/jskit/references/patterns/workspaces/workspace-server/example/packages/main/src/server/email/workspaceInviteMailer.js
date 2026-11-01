import nodemailer from "nodemailer";

/**
 * The application's `workspaces.invite-mailer`: sends each rendered
 * invitation through the SMTP server `SMTP_URL` names, from `MAIL_FROM`.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @returns {import("@jskit-ai/workspaces-core/server/types").WorkspaceInviteMailer}
 */
function createWorkspaceInviteMailer({ env }) {
  const transport = nodemailer.createTransport(env.SMTP_URL);

  async function sendWorkspaceInvite({ email, message }) {
    const sent = await transport.sendMail({
      from: env.MAIL_FROM,
      to: email,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {})
    });
    return { status: "sent", providerMessageId: sent.messageId };
  }

  return Object.freeze({ sendWorkspaceInvite });
}

export { createWorkspaceInviteMailer };
