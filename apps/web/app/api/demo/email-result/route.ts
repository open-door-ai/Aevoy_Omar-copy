import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '../_rate-limit';

const DAY_MS = 86_400_000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/demo/email-result — Email a demo result to the user
 * Body: { email: string, result: string, query: string }
 * Rate limit: 5 emails/day per IP
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    if (!checkRateLimit('demo-email', ip, 5, DAY_MS)) {
      return NextResponse.json(
        { error: 'Email limit reached. You can try again tomorrow.' },
        { status: 429 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email is not configured on this instance.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const email = String(body.email || '').trim();
    const result = String(body.result || '').trim();
    const query = String(body.query || '').trim();

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    if (!result || result.length > 5000) {
      return NextResponse.json(
        { error: 'Invalid result content.' },
        { status: 400 }
      );
    }

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1c1917; margin-bottom: 8px;">Your Aevoy Demo Result</h2>
        <p style="color: #78716c; font-size: 14px; margin-bottom: 24px;">Here's what we found for your query.</p>

        <div style="background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <p style="color: #78716c; font-size: 13px; margin: 0 0 4px 0;">Your question:</p>
          <p style="color: #1c1917; font-weight: 500; margin: 0;">${escapeHtml(query)}</p>
        </div>

        <div style="background: #ffffff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 20px; margin-bottom: 32px;">
          <p style="color: #1c1917; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escapeHtml(result)}</p>
        </div>

        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px; margin: 0;">
          This was a demo from <a href="https://aevoy.com" style="color: #78716c;">Aevoy</a>.
          Sign up to get an AI employee that actually does things.
        </p>
      </div>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Aevoy Demo <demo@aevoy.com>',
        to: [email],
        subject: 'Your Aevoy Demo Result',
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[DEMO/EMAIL] Resend error:', err);
      return NextResponse.json(
        { error: 'Failed to send email. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DEMO/EMAIL] Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
