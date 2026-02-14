import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ProviderConfig {
  name: string;
  imapHost: string;
  imapPort: number;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  gmail: {
    name: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
  },
  outlook: {
    name: "Outlook",
    imapHost: "outlook.office365.com",
    imapPort: 993,
  },
};

/**
 * POST /api/integrations/inbox/test - Test IMAP connection without saving
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

    // Test IMAP connection
    try {
      // Dynamically import imapflow (only when needed)
      const { ImapFlow } = await import("imapflow");

      const client = new ImapFlow({
        host: provider.imapHost,
        port: provider.imapPort,
        secure: true,
        auth: {
          user: email,
          pass: cleanPassword,
        },
        logger: false,
        connectionTimeout: 15000,
        greetingTimeout: 10000,
      });

      // Try to connect
      await client.connect();

      // Try to select INBOX to verify full access
      const lock = await client.getMailboxLock("INBOX");
      lock.release();

      // Close connection
      await client.logout();

      return NextResponse.json({
        success: true,
        message: `Successfully connected to ${provider.name} inbox`,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error("IMAP connection test failed:", err.message);

      // Provide user-friendly error messages
      let errorMessage = "Connection failed. Please check your credentials.";

      if (err.message?.includes("authentication")) {
        errorMessage = "Invalid email or app password. Please check your credentials and try again.";
      } else if (err.message?.includes("AUTHENTICATIONFAILED")) {
        errorMessage = "Authentication failed. Make sure you're using an app password, not your regular password.";
      } else if (err.message?.includes("timeout")) {
        errorMessage = "Connection timeout. Please check your internet connection and try again.";
      } else if (err.message?.includes("ENOTFOUND") || err.message?.includes("ECONNREFUSED")) {
        errorMessage = "Cannot reach email server. Please check your internet connection.";
      }

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("POST /api/integrations/inbox/test error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
