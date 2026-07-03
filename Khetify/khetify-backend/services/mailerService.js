// Thin email helper around nodemailer. Three modes, resolved in order:
//   1. Real SMTP    — when SMTP_HOST/USER/PASS are set (production / real inbox).
//   2. Ethereal test — when MAIL_TEST_MODE=ethereal (no credentials needed; a
//                      free throwaway account is created on the fly and every
//                      message gets a preview URL logged to the console. Mail is
//                      NOT delivered to real inboxes — it's a sandbox for testing).
//   3. Console log  — fallback; the email body (incl. reset link) is logged only.
const nodemailer = require("nodemailer");

let cachedTransport = null;

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const etherealMode = () => !smtpConfigured() && String(process.env.MAIL_TEST_MODE).toLowerCase() === "ethereal";

async function getTransport() {
  if (cachedTransport) return cachedTransport;

  if (smtpConfigured()) {
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE) === "true" || Number(process.env.SMTP_PORT) === 465,
      // Gmail App Passwords are displayed with spaces ("abcd efgh ..."); strip
      // them so a copy-paste with spaces still authenticates.
      auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS.replace(/\s+/g, "") },
    });
  } else if (etherealMode()) {
    // Free, zero-signup test account from nodemailer. Requires internet.
    const testAccount = await nodemailer.createTestAccount();
    cachedTransport = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    // eslint-disable-next-line no-console
    console.log(`[mailer] Ethereal test account ready (user: ${testAccount.user}). Emails are captured, not delivered — a preview URL is logged per message.`);
  } else {
    cachedTransport = nodemailer.createTransport({ jsonTransport: true });
  }
  return cachedTransport;
}

/**
 * Send an email. Returns { delivered, messageId, previewUrl }. Real SMTP errors
 * propagate so the controller can surface them; the console/ethereal fallbacks
 * never throw for a missing-config reason.
 */
async function sendMail({ to, subject, html, text }) {
  const from = process.env.MAIL_FROM || "Khetify <no-reply@khetify.local>";
  const transport = await getTransport();
  const info = await transport.sendMail({ from, to, subject, html, text });

  let previewUrl = null;
  if (etherealMode()) {
    previewUrl = nodemailer.getTestMessageUrl(info) || null;
    // eslint-disable-next-line no-console
    console.log(`[mailer] Email to ${to} captured on Ethereal.\n  Preview: ${previewUrl}`);
  } else if (!smtpConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[mailer] SMTP not configured — email to ${to} was NOT sent.\n  Subject: ${subject}\n  ${text || ""}`);
  }

  return { delivered: smtpConfigured(), messageId: info.messageId, previewUrl };
}

module.exports = { sendMail, smtpConfigured };
