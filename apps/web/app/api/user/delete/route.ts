import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Delete in dependency order (children before parents)
    // 1. Action history (references tasks)
    await supabase.from("action_history").delete().eq("user_id", userId);

    // 2. Workflow steps (references workflows)
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id")
      .eq("user_id", userId);
    if (workflows && workflows.length > 0) {
      const workflowIds = workflows.map(w => w.id);
      await supabase.from("workflow_steps").delete().in("workflow_id", workflowIds);
    }

    // 3. Workflows
    await supabase.from("workflows").delete().eq("user_id", userId);

    // 4. Tasks
    await supabase.from("tasks").delete().eq("user_id", userId);

    // 5. Scheduled tasks
    await supabase.from("scheduled_tasks").delete().eq("user_id", userId);

    // 6. User memory
    await supabase.from("user_memory").delete().eq("user_id", userId);

    // 7. Usage records
    await supabase.from("usage").delete().eq("user_id", userId);

    // 8. User settings
    await supabase.from("user_settings").delete().eq("user_id", userId);

    // 9. Agent cards
    await supabase.from("agent_cards").delete().eq("user_id", userId);

    // 10. User credentials
    await supabase.from("user_credentials").delete().eq("user_id", userId);

    // 11. Task logs
    await supabase.from("task_logs").delete().eq("user_id", userId);

    // 12. Failure memory (cross-user, but clean user-specific if column exists)
    try {
      await supabase.from("failure_memory").delete().eq("user_id", userId);
    } catch {
      // failure_memory may not have user_id column
    }

    // 13. Profile (last, as other tables may reference it)
    await supabase.from("profiles").delete().eq("id", userId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
