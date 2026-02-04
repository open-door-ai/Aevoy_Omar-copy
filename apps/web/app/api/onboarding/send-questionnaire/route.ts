import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userEmail = user.email;
  if (!userEmail) {
    return NextResponse.json(
      { error: "No email address found for your account" },
      { status: 400 }
    );
  }

  // Get user profile for name
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username")
    .eq("id", user.id)
    .single();

  const name = profile?.full_name || profile?.username || "there";
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    // Mark as requested even without email service
    await supabase
      .from("profiles")
      .update({ onboarding_interview_status: "questionnaire_sent" })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      status: "queued",
      message: "Questionnaire will be sent when the email service is configured.",
    });
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Aevoy AI <hello@aevoy.com>",
        to: [userEmail],
        subject: "Help your AI get to know you",
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
            <h1 style="font-size: 24px; color: #1a1a1a;">Hey ${name}!</h1>

            <p style="color: #444; line-height: 1.6;">
              To help your Aevoy AI assistant work better for you, we'd love to learn a bit about you.
              Just reply to this email with answers to the questions below.
            </p>

            <div style="background: #f5f5f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <h2 style="font-size: 18px; color: #1a1a1a; margin-top: 0;">Quick Questions</h2>

              <ol style="color: #444; line-height: 2;">
                <li><strong>What's your name and where are you based?</strong></li>
                <li><strong>What timezone are you in?</strong></li>
                <li><strong>What do you do for work?</strong></li>
                <li><strong>What are the top 3 things you'd like AI help with?</strong>
                  <br><em style="color: #888;">(e.g., booking restaurants, research, managing emails, scheduling)</em></li>
                <li><strong>Any accounts you'd like Aevoy to help manage?</strong>
                  <br><em style="color: #888;">(e.g., OpenTable, Uber, Amazon — you'll send login details separately)</em></li>
                <li><strong>Any preferences or habits we should know about?</strong>
                  <br><em style="color: #888;">(e.g., "I prefer window seats", "I'm vegetarian", "I like early flights")</em></li>
                <li><strong>Would you like a daily check-in call from your AI?</strong>
                  <br><em style="color: #888;">(If yes, what time works best?)</em></li>
              </ol>
            </div>

            <p style="color: #444; line-height: 1.6;">
              Just reply to this email with your answers. The more detail you give, the better your AI will work for you.
            </p>

            <p style="color: #888; font-size: 14px; margin-top: 32px;">
              — The Aevoy Team
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      console.error("[ONBOARDING] Resend error:", await emailRes.text());
      return NextResponse.json(
        { error: "Failed to send questionnaire email" },
        { status: 502 }
      );
    }

    // Update interview status
    await supabase
      .from("profiles")
      .update({ onboarding_interview_status: "questionnaire_sent" })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      status: "sent",
      message: "Questionnaire sent! Check your inbox and reply when you're ready.",
    });
  } catch (error) {
    console.error("[ONBOARDING] Send questionnaire error:", error);
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
