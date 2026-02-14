import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

interface ProviderConfig {
  name: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  gmail: {
    name: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  outlook: {
    name: "Outlook",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpSecure: false,
  },
};

/**
 * GET /api/integrations/inbox - Check inbox connection status
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for inbox credentials in oauth_connections (new standard location)
    const { data: oauthConn } = await supabase
      .from("oauth_connections")
      .select("id, provider, account_email, created_at, status")
      .eq("user_id", user.id)
      .eq("provider", "inbox_imap")
      .eq("status", "active")
      .single();

    if (oauthConn) {
      return NextResponse.json({
        connected: true,
        method: "imap",
        email: oauthConn.account_email,
        connectedAt: oauthConn.created_at,
      });
    }

    // Legacy fallback: check user_credentials table
    const { data: legacyCred } = await supabase
      .from("user_credentials")
      .select("encrypted_data, created_at")
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap")
      .single();

    if (legacyCred) {
      try {
        const creds = JSON.parse(legacyCred.encrypted_data);
        return NextResponse.json({
          connected: true,
          method: "imap",
          email: creds.email,
          provider: creds.provider,
          connectedAt: legacyCred.created_at,
        });
      } catch {
        // Invalid data, fall through
      }
    }

    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error("GET /api/integrations/inbox error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/inbox - Connect inbox with app password
 */
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

    const body = await request.json();
    const { email, password, provider: providerKey } = body;

    // Validation
    if (!email || !password || !providerKey) {
      return NextResponse.json(
        { error: "Email, password, and provider are required" },
        { status: 400 }
      );
    }

    if (!email.includes("@") || !email.includes(".")) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const provider = PROVIDERS[providerKey];
    if (!provider) {
      return NextResponse.json(
        { error: "Unsupported email provider" },
        { status: 400 }
      );
    }

    // Clean password (remove spaces)
    const cleanPassword = password.replace(/\s/g, "");

    if (cleanPassword.length < 8) {
      return NextResponse.json(
        { error: "App password is too short" },
        { status: 400 }
      );
    }

    // Prepare credential data
    const credentialData = {
      email,
      password: cleanPassword,
      imap_host: provider.imapHost,
      imap_port: provider.imapPort,
      smtp_host: provider.smtpHost,
      smtp_port: provider.smtpPort,
      smtp_secure: provider.smtpSecure,
      provider: provider.name,
    };

    // Encrypt the credentials
    const encryptedPassword = await encrypt(cleanPassword);
    const encryptedData = await encrypt(JSON.stringify(credentialData));

    // Store in oauth_connections (new standard location)
    // First, revoke any existing inbox connections
    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "inbox_imap");

    const { error: insertError } = await supabase
      .from("oauth_connections")
      .insert({
        user_id: user.id,
        provider: "inbox_imap",
        account_email: email,
        access_token_encrypted: encryptedPassword,
        refresh_token_encrypted: encryptedData,
        expires_at: null, // IMAP credentials don't expire
        status: "active",
        scopes: ["imap", "smtp"],
      });

    if (insertError) {
      console.error("Failed to store credentials:", insertError);
      return NextResponse.json(
        { error: "Failed to save credentials" },
        { status: 500 }
      );
    }

    // Also store in user_credentials for backward compatibility
    await supabase
      .from("user_credentials")
      .delete()
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap");

    await supabase
      .from("user_credentials")
      .insert({
        user_id: user.id,
        site_domain: "email_imap",
        encrypted_data: JSON.stringify(credentialData),
      });

    return NextResponse.json({
      success: true,
      email,
      provider: provider.name,
      message: `${provider.name} inbox connected successfully`,
    });
  } catch (error) {
    console.error("POST /api/integrations/inbox error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/inbox - Disconnect inbox
 */
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

    // Revoke in oauth_connections
    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "inbox_imap");

    // Remove from legacy user_credentials
    await supabase
      .from("user_credentials")
      .delete()
      .eq("user_id", user.id)
      .eq("site_domain", "email_imap");

    return NextResponse.json({
      success: true,
      message: "Inbox disconnected successfully",
    });
  } catch (error) {
    console.error("DELETE /api/integrations/inbox error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
