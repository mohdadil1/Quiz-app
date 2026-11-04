const nodemailer = require('nodemailer');

/**
 * Outgoing email via SMTP. Configure in .env:
 *   SMTP_HOST, SMTP_PORT (587 or 465), SMTP_USER, SMTP_PASS, MAIL_FROM
 * For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465 and an App Password as SMTP_PASS.
 *
 * Without SMTP_HOST (local dev), emails are printed to the server console instead of sent.
 */
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

const transporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    })
  : null;

async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`[mail] SMTP not configured — would send to ${to}: "${subject}"\n${text}`);
    return;
  }
  await transporter.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, text, html });
}

module.exports = { sendMail };
