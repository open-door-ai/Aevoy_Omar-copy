import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Simple email connection — user enters email + app password, we auto-detect provider.
 * No OAuth, no Google Cloud Console, no redirect flows.
 *
 * GET  /api/integrations/email          — check connection status
 * GET  /api/integrations/email?email=x  — detect provider for an email address
 * POST /api/integrations/email          — connect (email + app password)
 * DELETE /api/integrations/email        — disconnect
 */

const PROVIDERS: Record<
  string,
  {
    name: string;
    imap_host: string;
    imap_port: number;
    smtp_host: string;
    smtp_port: number;
    smtp_secure: boolean;
    appPasswordUrl: string;
    steps: string;
  }
> = {
  "gmail.com": {
    name: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: "Enable 2-Step Verification, then generate an App Password",
  },
  "googlemail.com": {
    name: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: "Enable 2-Step Verification, then generate an App Password",
  },
  "outlook.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "hotmail.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "live.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "yahoo.com": {
    name: "Yahoo",
    imap_host: "imap.mail.yahoo.com",
    imap_port: 993,
    smtp_host: "smtp.mail.yahoo.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl:
      "https://login.yahoo.com/account/security/app-passwords",
    steps: "Go to Account Security, then generate an App Password",
  },
  "icloud.com": {
    name: "iCloud",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl:
      "https://appleid.apple.com/account/manage/section/security",
    steps:
      "Go to Sign-In and Security, then create an App-Specific Password",
  },
  "me.com": {
    name: "iCloud",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl:
      "https://appleid.apple.com/account/manage/section/security",
    steps:
      "Go to Sign-In and Security, then create an App-Specific Password",
  },
};

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for IMAP credentials
    const { data: imapCred } = await supabase
      .from("user_credentials")
      .select("encrypted_data")
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap")
      .single();

    if (imapCred) {
      try {
        const creds = JSON.parse(imapCred.encrypted_data);
        return NextResponse.json({
          connected: true,
          method: "imap",
          email: creds.email,
          provider: creds.provider,
        });
      } catch {
        /* fall through */
      }
    }

    // Check for Gmail OAuth (legacy)
    const { data: oauthCred } = await supabase
      .from("user_credentials")
      .select("encrypted_data")
      .eq("user_id", user.id)
      .eq("site_domain", "gmail.googleapis.com")
      .single();

    if (oauthCred) {
      try {
        const creds = JSON.parse(oauthCred.encrypted_data);
        return NextResponse.json({
          connected: true,
          method: "oauth",
          email: creds.gmail_address,
          provider: "Gmail",
        });
      } catch {
        /* fall through */
      }
    }

    // Not connected — optionally detect provider from ?email= param
    const url = new URL(request.url);
    const emailParam = url.searchParams.get("email");

    if (emailParam) {
      const domain = emailParam.split("@")[1]?.toLowerCase();
      const provider = domain ? PROVIDERS[domain] : null;
      return NextResponse.json({
        connected: false,
        provider: provider
          ? {
              name: provider.name,
              appPasswordUrl: provider.appPasswordUrl,
              steps: provider.steps,
            }
          : null,
        supported: !!provider,
      });
    }

    return NextResponse.json({ connected: false });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and app password are required" },
        { status: 400 }
      );
    }

    if (!email.includes("@") || !email.includes(".")) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const domain = email.split("@")[1]?.toLowerCase();
    const provider = domain ? PROVIDERS[domain] : null;

    if (!provider) {
      return NextResponse.json(
        {
          error:
            "Email provider not supported yet. Supported: Gmail, Outlook, Yahoo, iCloud",
        },
        { status: 400 }
      );
    }

    const credentialData = {
      email,
      password,
      imap_host: provider.imap_host,
      imap_port: provider.imap_port,
      smtp_host: provider.smtp_host,
      smtp_port: provider.smtp_port,
      smtp_secure: provider.smtp_secure,
      provider: provider.name,
    };

    // Delete existing then insert (avoids upsert constraint issues)
    await supabase
      .from("user_credentials")
      .delete()
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap");

    const { error: insertError } = await supabase
      .from("user_credentials")
      .insert({
        user_id: user.id,
        site_domain: "email_imap",
        encrypted_data: JSON.stringify(credentialData),
      });

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to save credentials" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email,
      provider: provider.name,
      message: `${provider.name} connected successfully`,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Remove IMAP credentials
    await supabase
      .from("user_credentials")
      .delete()
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap");

    // Also remove Gmail OAuth if any
    await supabase
      .from("user_credentials")
      .delete()
      .eq("user_id", user.id)
      .eq("site_domain", "gmail.googleapis.com");

    return NextResponse.json({ success: true, message: "Email disconnected" });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
