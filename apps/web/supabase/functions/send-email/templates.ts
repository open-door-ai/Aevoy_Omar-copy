// Email HTML templates matching our React Email designs

interface TemplateData {
  confirmationUrl: string;
  userEmail: string;
}

function emailLayout(content: string, previewText: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
</head>
<body style="background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0;">
  <!-- Preview text -->
  <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0; overflow: hidden;">
    ${previewText}
  </div>

  <!-- Main container -->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function emailHeader(): string {
  return `
<tr>
  <td style="background: linear-gradient(135deg, #8e5ef2 0%, #8f63f5 50%, #7f5ef0 100%); padding: 32px 40px; text-align: center;">
    <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0 0 4px 0; letter-spacing: -0.02em; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
      Aevoy
    </h1>
    <div style="color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 400; margin: 0;">
      Your AI Employee
    </div>
  </td>
</tr>
  `;
}

function emailFooter(): string {
  return `
<tr>
  <td style="border-top: 1px solid #e7e5e4; padding: 0;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="background-color: #fafaf9; padding: 32px 40px; text-align: center;">
          <p style="font-size: 14px; color: #57534e; margin: 0 0 8px 0;">
            Sent by your AI assistant at <a href="https://aevoy.com" style="color: #8e5ef2; text-decoration: none;">Aevoy</a>
          </p>
          <p style="font-size: 14px; color: #78716c; margin: 0 0 16px 0;">
            <a href="https://aevoy.com/dashboard" style="color: #8e5ef2; text-decoration: none;">Dashboard</a>
            ·
            <a href="https://aevoy.com/dashboard/settings" style="color: #8e5ef2; text-decoration: none;">Settings</a>
            ·
            <a href="https://aevoy.com/help" style="color: #8e5ef2; text-decoration: none;">Help</a>
          </p>
          <p style="font-size: 12px; color: #a8a29e; margin: 0;">
            © 2026 Aevoy. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
  `;
}

function confirmEmailTemplate(data: TemplateData): string {
  const content = `
${emailHeader()}
<tr>
  <td style="padding: 40px;">
    <h2 style="font-size: 24px; font-weight: 700; color: #1c1917; margin: 0 0 16px 0; line-height: 1.3;">
      Welcome to Aevoy!
    </h2>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      Thanks for signing up for Aevoy, your AI employee that never fails. We're excited to have you on board.
    </p>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      To get started, please confirm your email address by clicking the button below:
    </p>

    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding: 32px 0;">
          <a href="${data.confirmationUrl}" style="background-color: #8e5ef2; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            Confirm Email Address
          </a>
        </td>
      </tr>
    </table>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      Once confirmed, you'll be able to access your dashboard and start delegating tasks to your AI assistant via email, SMS, or voice calls.
    </p>

    <p style="font-size: 14px; color: #78716c; margin: 16px 0 0 0; line-height: 1.5;">
      If you didn't create an account with Aevoy, you can safely ignore this email.
    </p>

    <p style="font-size: 14px; color: #78716c; margin: 16px 0 0 0; line-height: 1.5;">
      This link will expire in 24 hours. If the button doesn't work, copy and paste this link into your browser:<br>
      <span style="color: #8e5ef2; word-break: break-all; font-size: 12px;">${data.confirmationUrl}</span>
    </p>
  </td>
</tr>
${emailFooter()}
  `;

  return emailLayout(content, 'Confirm your Aevoy account');
}

function resetPasswordTemplate(data: TemplateData): string {
  const content = `
${emailHeader()}
<tr>
  <td style="padding: 40px;">
    <h2 style="font-size: 24px; font-weight: 700; color: #1c1917; margin: 0 0 16px 0; line-height: 1.3;">
      Reset Your Password
    </h2>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      We received a request to reset the password for your Aevoy account (${data.userEmail}).
    </p>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      Click the button below to create a new password:
    </p>

    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding: 32px 0;">
          <a href="${data.confirmationUrl}" style="background-color: #8e5ef2; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            Reset Password
          </a>
        </td>
      </tr>
    </table>

    <div style="font-size: 14px; color: #dc2626; background-color: #fef2f2; padding: 12px 16px; border-radius: 8px; margin: 24px 0 16px 0; line-height: 1.5;">
      ⚠️ If you didn't request a password reset, please ignore this email or contact support if you have concerns about your account security.
    </div>

    <p style="font-size: 14px; color: #78716c; margin: 16px 0 0 0; line-height: 1.5;">
      This link will expire in 1 hour for security reasons. If the button doesn't work, copy and paste this link into your browser:<br>
      <span style="color: #8e5ef2; word-break: break-all; font-size: 12px;">${data.confirmationUrl}</span>
    </p>
  </td>
</tr>
${emailFooter()}
  `;

  return emailLayout(content, 'Reset your Aevoy password');
}

function magicLinkTemplate(data: TemplateData): string {
  const content = `
${emailHeader()}
<tr>
  <td style="padding: 40px;">
    <h2 style="font-size: 24px; font-weight: 700; color: #1c1917; margin: 0 0 16px 0; line-height: 1.3;">
      Sign In to Aevoy
    </h2>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      Click the button below to securely sign in to your Aevoy account:
    </p>

    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding: 32px 0;">
          <a href="${data.confirmationUrl}" style="background-color: #8e5ef2; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            Sign In
          </a>
        </td>
      </tr>
    </table>

    <p style="font-size: 16px; color: #44403c; margin: 0 0 16px 0; line-height: 1.6;">
      This link will sign you in automatically without requiring a password.
    </p>

    <p style="font-size: 14px; color: #78716c; margin: 16px 0 0 0; line-height: 1.5;">
      If you didn't request this sign-in link, you can safely ignore this email.
    </p>

    <p style="font-size: 14px; color: #78716c; margin: 16px 0 0 0; line-height: 1.5;">
      This link will expire in 1 hour. If the button doesn't work, copy and paste this link into your browser:<br>
      <span style="color: #8e5ef2; word-break: break-all; font-size: 12px;">${data.confirmationUrl}</span>
    </p>
  </td>
</tr>
${emailFooter()}
  `;

  return emailLayout(content, 'Your Aevoy sign-in link');
}

export function renderTemplate(
  type: 'signup' | 'recovery' | 'magic_link' | 'email_change',
  data: TemplateData
): { subject: string; html: string } {
  let subject: string;
  let html: string;

  switch (type) {
    case 'signup':
      subject = 'Confirm your Aevoy account';
      html = confirmEmailTemplate(data);
      break;

    case 'recovery':
      subject = 'Reset your Aevoy password';
      html = resetPasswordTemplate(data);
      break;

    case 'magic_link':
      subject = 'Your Aevoy sign-in link';
      html = magicLinkTemplate(data);
      break;

    case 'email_change':
      subject = 'Confirm your new email address';
      html = confirmEmailTemplate(data); // Reuse confirm template
      break;

    default:
      throw new Error(`Unknown email action type: ${type}`);
  }

  return { subject, html };
}
