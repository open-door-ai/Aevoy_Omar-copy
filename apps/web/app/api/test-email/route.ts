import { NextRequest, NextResponse } from 'next/server';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import ConfirmEmail from '@/emails/confirm-email';
import ResetPassword from '@/emails/reset-password';
import MagicLink from '@/emails/magic-link';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { type, email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    let html: string;
    let subject: string;

    if (type === 'confirm') {
      html = await render(ConfirmEmail({
        confirmationUrl: 'https://aevoy.com/auth/confirm?token=test-token-12345',
        userEmail: email,
      }));
      subject = 'Test: Confirm your Aevoy account';
    } else if (type === 'reset') {
      html = await render(ResetPassword({
        resetUrl: 'https://aevoy.com/auth/reset?token=test-token-12345',
        userEmail: email,
      }));
      subject = 'Test: Reset your Aevoy password';
    } else if (type === 'magic') {
      html = await render(MagicLink({
        magicLinkUrl: 'https://aevoy.com/auth/magic?token=test-token-12345',
        userEmail: email,
      }));
      subject = 'Test: Your Aevoy sign-in link';
    } else {
      return NextResponse.json({ error: 'Invalid type. Use: confirm, reset, or magic' }, { status: 400 });
    }

    const result = await resend.emails.send({
      from: 'Aevoy <noreply@aevoy.com>',
      to: email,
      subject,
      html,
    });

    return NextResponse.json({
      success: true,
      messageId: result.data?.id,
      message: `Test email sent to ${email}`,
    });
  } catch (error: any) {
    console.error('Error sending test email:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send test email' },
      { status: 500 }
    );
  }
}
