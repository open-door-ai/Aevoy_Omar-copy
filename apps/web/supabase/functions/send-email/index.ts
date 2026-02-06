import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { renderTemplate } from './templates.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

interface AuthHookPayload {
  email: string;
  token_hash: string;
  token: string;
  redirect_to: string;
  email_action_type: 'signup' | 'recovery' | 'magic_link' | 'email_change';
  site_url: string;
  user: {
    id: string;
    email: string;
    email_confirmed_at?: string;
  };
}

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Aevoy <noreply@aevoy.com>',
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return await response.json();
}

serve(async (req: Request) => {
  try {
    const payload: AuthHookPayload = await req.json();

    console.log('Auth hook received:', {
      email: payload.email,
      type: payload.email_action_type,
      timestamp: new Date().toISOString(),
    });

    // Build confirmation URL
    const confirmationUrl = `${payload.site_url}/auth/confirm?token_hash=${payload.token_hash}&type=${payload.email_action_type}&redirect_to=${encodeURIComponent(payload.redirect_to || '/dashboard')}`;

    console.log('Confirmation URL:', confirmationUrl);

    // Render appropriate template
    const { subject, html } = renderTemplate(
      payload.email_action_type,
      {
        confirmationUrl,
        userEmail: payload.email,
      }
    );

    // Send email via Resend
    const result = await sendEmail(payload.email, subject, html);

    console.log('Email sent successfully:', {
      messageId: result.id,
      email: payload.email,
      type: payload.email_action_type,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.id,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in send-email hook:', error);

    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
