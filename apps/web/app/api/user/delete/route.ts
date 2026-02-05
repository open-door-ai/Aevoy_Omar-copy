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

    // Delete in dependency order (children before parents).
    // FK constraints that are NO ACTION (not CASCADE) require explicit deletion.

    // 1. Get task IDs first — needed for task_logs (FK NO ACTION)
    const { data: userTasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("user_id", userId);
    const taskIds = (userTasks || []).map(t => t.id);

    // 2. Task logs (FK to tasks is NO ACTION — must delete before tasks)
    if (taskIds.length > 0) {
      await supabase.from("task_logs").delete().in("task_id", taskIds);
    }

    // 3. Action history (FK to tasks is CASCADE, but delete explicitly for completeness)
    await supabase.from("action_history").delete().eq("user_id", userId);

    // 4. Workflow steps (FK to workflows is NO ACTION — must delete before workflows)
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id")
      .eq("user_id", userId);
    if (workflows && workflows.length > 0) {
      const workflowIds = workflows.map(w => w.id);
      await supabase.from("workflow_steps").delete().in("workflow_id", workflowIds);
    }

    // 5. Workflows
    await supabase.from("workflows").delete().eq("user_id", userId);

    // 6. Execution plans (Session 7)
    await supabase.from("execution_plans").delete().eq("user_id", userId);

    // 7. Task queue (Session 7)
    await supabase.from("task_queue").delete().eq("user_id", userId);

    // 8. AI cost log (Session 7)
    await supabase.from("ai_cost_log").delete().eq("user_id", userId);

    // 9. TFA codes (Session 7)
    await supabase.from("tfa_codes").delete().eq("user_id", userId);

    // 10. OAuth connections (Session 7)
    await supabase.from("oauth_connections").delete().eq("user_id", userId);

    // 11. Credential vault (Session 7)
    await supabase.from("credential_vault").delete().eq("user_id", userId);

    // 12. Tasks
    await supabase.from("tasks").delete().eq("user_id", userId);

    // 13. Scheduled tasks
    await supabase.from("scheduled_tasks").delete().eq("user_id", userId);

    // 14. User memory
    await supabase.from("user_memory").delete().eq("user_id", userId);

    // 15. Usage records
    await supabase.from("usage").delete().eq("user_id", userId);

    // 16. User settings
    await supabase.from("user_settings").delete().eq("user_id", userId);

    // 17. Agent cards
    await supabase.from("agent_cards").delete().eq("user_id", userId);

    // 18. User credentials
    await supabase.from("user_credentials").delete().eq("user_id", userId);

    // 19. Profile (last — other tables reference it)
    await supabase.from("profiles").delete().eq("id", userId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
