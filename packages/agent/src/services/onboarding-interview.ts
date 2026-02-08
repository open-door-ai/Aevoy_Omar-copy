import { getSupabaseClient } from "../utils/supabase.js";
import { encryptWithServerKey } from "../security/encryption.js";

// Interview questions
const INTERVIEW_QUESTIONS = [
  {
    id: 0,
    question: "Hi! I'm your AI assistant. Let's get to know each other. First, what should I call you? Your first name is fine.",
    field: "preferred_name",
    type: "text"
  },
  {
    id: 1,
    question: "Great! What are the top 3 things you'll use me for? For example: booking flights, filling out forms, research, emails, shopping.",
    field: "main_uses",
    type: "list"
  },
  {
    id: 2,
    question: "When are you usually most busy? Like, what hours should I avoid interrupting you?",
    field: "busy_hours",
    type: "text"
  },
  {
    id: 3,
    question: "Do you prefer I ask before taking actions, or just go ahead and do things? Say 'ask first' or 'just do it'.",
    field: "autonomy_preference",
    type: "choice"
  },
  {
    id: 4,
    question: "What websites or services do you use most often? Like Gmail, Amazon, LinkedIn, etc.",
    field: "favorite_services",
    type: "list"
  },
  {
    id: 5,
    question: "Last one: would you like a daily morning check-in call where I brief you on your day? Say yes or no.",
    field: "daily_checkin",
    type: "boolean"
  }
];

/**
 * Get speech recognition hints for each interview question
 */
function getHintsForQuestion(index: number): string {
  const hints: Record<number, string> = {
    0: "my name is, call me, I go by",
    1: "booking flights, filling forms, research, emails, shopping, scheduling, reminders",
    2: "morning, afternoon, evening, nine to five, busy all day, weekends",
    3: "ask first, ask me first, just do it, go ahead",
    4: "Gmail, Amazon, LinkedIn, Google, Microsoft, Outlook, Calendar",
    5: "yes, no, sure, yeah, nah, maybe",
  };
  return hints[index] || "";
}

/**
 * Generate TwiML for the first interview question
 */
export async function handleInterviewCall({ userId, from, to, callSid }: { userId: string; from: string; to: string; callSid: string }): Promise<string> {
  console.log(`[ONBOARDING] Starting interview call for user ${userId?.slice(0, 8)}`);

  const firstQuestion = INTERVIEW_QUESTIONS[0];
  const agentUrl = process.env.AGENT_URL || "http://localhost:3001";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">${firstQuestion.question}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${agentUrl}/webhook/interview-call/response/${userId}?question=0" method="POST"
    hints="${getHintsForQuestion(0)}">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't hear anything. Let's try the next question.</Say>
  <Redirect method="POST">${agentUrl}/webhook/interview-call/response/${userId}?question=0</Redirect>
</Response>`;
}

/**
 * Process interview response and return next question or completion
 */
export async function processInterviewResponse(userId: string, questionIndex: number, transcription: string): Promise<string> {
  const question = INTERVIEW_QUESTIONS[questionIndex];

  if (!question) {
    console.error(`[ONBOARDING] Invalid question index: ${questionIndex}`);
    return generateErrorTwiml("Sorry, something went wrong. Let's continue via email instead.");
  }

  // Save the response
  await saveInterviewResponse(userId, question.field, transcription, question.type);

  // Check if there are more questions
  const nextQuestionIndex = questionIndex + 1;
  const nextQuestion = INTERVIEW_QUESTIONS[nextQuestionIndex];

  if (!nextQuestion) {
    // Interview complete
    const supabase = getSupabaseClient();
    await supabase
      .from("profiles")
      .update({ onboarding_interview_status: "phone_call_completed" })
      .eq("id", userId);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Perfect! I've got everything I need. You're all set up. Talk soon!</Say>
  <Hangup/>
</Response>`;
  }

  // Next question
  const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Got it!</Say>
  <Say voice="Google.en-US-Neural2-F">${nextQuestion.question}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${agentUrl}/webhook/interview-call/response/${userId}?question=${nextQuestionIndex}" method="POST"
    hints="${getHintsForQuestion(nextQuestionIndex)}">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't hear anything. Let's move on.</Say>
  <Redirect method="POST">${agentUrl}/webhook/interview-call/response/${userId}?question=${nextQuestionIndex}</Redirect>
</Response>`;
}

/**
 * Save interview response to memory and update profile fields
 */
async function saveInterviewResponse(userId: string, field: string, answer: string, type: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Save to episodic memory (encrypted)
  const memoryContent = {
    field,
    answer,
    timestamp: new Date().toISOString()
  };

  const encrypted = await encryptWithServerKey(JSON.stringify(memoryContent));

  await supabase.from("user_memory").insert({
    user_id: userId,
    memory_type: "episodic",
    encrypted_data: encrypted,
    importance: 0.9, // High importance for onboarding data
  });

  // Also update specific profile fields based on the response
  if (field === "preferred_name") {
    await supabase
      .from("profiles")
      .update({ display_name: answer })
      .eq("id", userId);
  } else if (field === "main_uses") {
    // Parse list of uses
    const uses = answer.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    await supabase
      .from("profiles")
      .update({ main_uses: uses })
      .eq("id", userId);
  } else if (field === "autonomy_preference") {
    // Map response to confirmation_mode
    const lowerAnswer = answer.toLowerCase();
    let confirmationMode = "unclear"; // default

    if (lowerAnswer.includes("ask") || lowerAnswer.includes("first")) {
      confirmationMode = "always";
    } else if (lowerAnswer.includes("just do") || lowerAnswer.includes("go ahead")) {
      confirmationMode = "risky";
    }

    await supabase
      .from("user_settings")
      .update({ confirmation_mode: confirmationMode })
      .eq("user_id", userId);
  } else if (field === "daily_checkin") {
    const lowerAnswer = answer.toLowerCase();
    const enabled = lowerAnswer.includes("yes") || lowerAnswer.includes("sure") || lowerAnswer.includes("yeah");

    await supabase
      .from("profiles")
      .update({
        daily_checkin_enabled: enabled,
        daily_checkin_time: enabled ? "09:00" : null
      })
      .eq("id", userId);
  }

  console.log(`[ONBOARDING] Saved response for ${field}: "${answer.slice(0, 50)}..."`);
}

/**
 * Generate error TwiML
 */
export function generateErrorTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">${message}</Say>
  <Hangup/>
</Response>`;
}
