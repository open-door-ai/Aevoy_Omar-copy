import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/scheduled-tasks - List user's scheduled tasks
export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: tasks, error } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching scheduled tasks:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tasks: tasks || [] });
  } catch (error) {
    console.error("Scheduled tasks error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/scheduled-tasks - Create a new scheduled task
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { task_template, frequency, description } = body;

    if (!task_template || !frequency) {
      return NextResponse.json(
        { error: "task_template and frequency are required" },
        { status: 400 }
      );
    }

    // Convert frequency to cron expression
    const cronExpression = frequencyToCron(frequency);
    
    // Calculate next run time
    const nextRunAt = calculateNextRun(cronExpression);

    const { data: task, error } = await supabase
      .from("scheduled_tasks")
      .insert({
        user_id: user.id,
        task_template,
        description: description || task_template.substring(0, 100),
        cron_expression: cronExpression,
        next_run_at: nextRunAt,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating scheduled task:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Create scheduled task error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/scheduled-tasks - Cancel a scheduled task
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("id");

    if (!taskId) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
    }

    // First verify the task belongs to the user
    const { data: existingTask, error: fetchError } = await supabase
      .from("scheduled_tasks")
      .select("id")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Soft delete by setting is_active to false
    const { error } = await supabase
      .from("scheduled_tasks")
      .update({ is_active: false })
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting scheduled task:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete scheduled task error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Convert user-friendly frequency to cron expression
function frequencyToCron(frequency: string): string {
  switch (frequency) {
    case "daily":
      return "0 9 * * *"; // 9 AM every day
    case "weekly":
      return "0 9 * * 1"; // 9 AM every Monday
    case "weekdays":
      return "0 9 * * 1-5"; // 9 AM Mon-Fri
    case "monthly":
      return "0 9 1 * *"; // 9 AM first of month
    case "hourly":
      return "0 * * * *"; // Every hour
    default:
      // If it looks like a cron expression, use it directly
      if (frequency.split(" ").length === 5) {
        return frequency;
      }
      return "0 9 * * *"; // Default to daily
  }
}

// Calculate the next run time based on cron expression
function calculateNextRun(cron: string): string {
  const now = new Date();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(" ");
  
  const next = new Date(now);
  
  // Set time
  if (hour !== "*") {
    next.setHours(parseInt(hour));
  }
  if (minute !== "*") {
    next.setMinutes(parseInt(minute));
  } else {
    next.setMinutes(0);
  }
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  // If the time has passed today, move to next occurrence
  if (next <= now) {
    if (dayOfWeek !== "*") {
      // Weekly schedule
      const targetDay = parseInt(dayOfWeek);
      const daysUntil = (targetDay - now.getDay() + 7) % 7 || 7;
      next.setDate(now.getDate() + daysUntil);
    } else if (dayOfMonth !== "*") {
      // Monthly schedule
      next.setMonth(next.getMonth() + 1);
      next.setDate(parseInt(dayOfMonth));
    } else {
      // Daily or more frequent
      next.setDate(next.getDate() + 1);
    }
  }
  
  return next.toISOString();
}
