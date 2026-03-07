import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, logAdminAction, sanitizeSearch, secureResponse, secureError } from "@/lib/admin-auth";

interface CommandResult {
  type: "success" | "error" | "info" | "data" | "confirm";
  message: string;
  data?: unknown;
  confirmAction?: string;
}

async function executeCommand(command: string, sessionId: string): Promise<CommandResult> {
  const supabase = getAdminClient();
  const cmd = command.trim().toLowerCase();
  const parts = cmd.split(/\s+/);
  const action = parts[0];

  if (action === "help") {
    return {
      type: "info",
      message: [
        "Available commands:",
        "",
        "  users                    - List all users (count)",
        "  user <username|email>    - Look up a user",
        "  tasks <username>         - Show user's recent tasks",
        "  block <username>         - Block a user (requires exact match)",
        "  unblock <username>       - Unblock a user (requires exact match)",
        "  cost <username>          - Show user's cost breakdown",
        "  cost total               - Show total platform costs",
        "  search <query>           - Search tasks by content",
        "  active                   - Show active tasks right now",
        "  stats                    - Platform statistics",
        "  sessions                 - Active admin sessions",
        "  audit [n]                - Last N audit log entries (default 20)",
        "  killswitch status        - Check API kill switch status",
      ].join("\n"),
    };
  }

  if (action === "stats") {
    const [
      { count: userCount },
      { count: taskCount },
      { count: activeTaskCount },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("tasks").select("*", { count: "exact", head: true }),
      supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "processing"),
    ]);

    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: costs } = await supabase
      .from("ai_cost_log")
      .select("cost_usd")
      .gte("created_at", since30d)
      .limit(5000);
    const totalCost30d = (costs || []).reduce((s: number, c: { cost_usd: string }) => s + parseFloat(c.cost_usd || "0"), 0);

    return {
      type: "data",
      message: [
        `Total users: ${userCount || 0}`,
        `Total tasks: ${taskCount || 0}`,
        `Currently processing: ${activeTaskCount || 0}`,
        `Cost (30d): $${totalCost30d.toFixed(4)}`,
      ].join("\n"),
    };
  }

  if (action === "users" && parts.length === 1) {
    const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
    const { data: recent } = await supabase
      .from("profiles")
      .select("username, email, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    const lines = (recent || []).map((u: { username: string; email: string; created_at: string }) =>
      `  ${u.username || u.email} — ${new Date(u.created_at).toLocaleDateString()}`
    );

    return {
      type: "data",
      message: `Total users: ${count}\n\nRecent signups:\n${lines.join("\n")}`,
      data: recent,
    };
  }

  if (action === "user" && parts.length >= 2) {
    const query = sanitizeSearch(parts.slice(1).join(" ")); // V01 fix
    if (!query) return { type: "error", message: "Invalid search query" };

    const { data: user } = await supabase
      .from("profiles")
      .select("id, username, email, display_name, timezone, subscription_tier, created_at, last_active_at, onboarding_completed, messages_used")
      .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(1)
      .single();

    if (!user) return { type: "error", message: `No user found matching "${query}"` };

    const { count: taskCount } = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", user.id);

    return {
      type: "data",
      message: [
        `Username: ${user.username}`,
        `Email: ${user.email}`,
        `Name: ${user.display_name || "—"}`,
        `Tier: ${user.subscription_tier}`,
        `Timezone: ${user.timezone}`,
        `Tasks: ${taskCount || 0}`,
        `Messages used: ${user.messages_used}`,
        `Onboarded: ${user.onboarding_completed ? "Yes" : "No"}`,
        `Signed up: ${new Date(user.created_at).toLocaleString()}`,
        `Last active: ${user.last_active_at ? new Date(user.last_active_at).toLocaleString() : "Never"}`,
      ].join("\n"),
      data: user,
    };
  }

  if (action === "tasks" && parts.length >= 2) {
    const query = sanitizeSearch(parts.slice(1).join(" "));
    if (!query) return { type: "error", message: "Invalid search query" };

    const { data: user } = await supabase
      .from("profiles")
      .select("id, username")
      .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(1)
      .single();

    if (!user) return { type: "error", message: `No user found matching "${query}"` };

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, status, email_subject, input_channel, created_at, cost_usd")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(15);

    if (!tasks?.length) return { type: "info", message: `No tasks found for ${user.username}` };

    const lines = tasks.map(
      (t: { status: string; email_subject: string; input_channel: string; cost_usd: string; created_at: string }) =>
        `  [${t.status}] ${t.email_subject || "(no subject)"} via ${t.input_channel || "?"} — $${parseFloat(t.cost_usd || "0").toFixed(4)} — ${new Date(t.created_at).toLocaleString()}`,
    );

    return {
      type: "data",
      message: `Recent tasks for ${user.username}:\n${lines.join("\n")}`,
      data: tasks,
    };
  }

  // V22 fix: Block/unblock require EXACT username match
  if (action === "block" && parts.length >= 2) {
    const query = sanitizeSearch(parts.slice(1).join(" "));
    if (!query) return { type: "error", message: "Invalid username" };

    // Exact match only for destructive actions
    const { data: user } = await supabase
      .from("profiles")
      .select("id, username, subscription_tier")
      .eq("username", query)
      .single();

    if (!user) {
      // Try email exact match
      const { data: emailUser } = await supabase
        .from("profiles")
        .select("id, username, subscription_tier")
        .eq("email", query)
        .single();

      if (!emailUser) return { type: "error", message: `No user found with exact username/email "${query}". Use exact match for block.` };

      await supabase.from("profiles").update({ subscription_tier: "blocked", updated_at: new Date().toISOString() }).eq("id", emailUser.id);
      await logAdminAction(sessionId, "block_user", "user", emailUser.id, `Blocked via command`);
      return { type: "success", message: `Blocked user ${emailUser.username} (was: ${emailUser.subscription_tier})` };
    }

    await supabase.from("profiles").update({ subscription_tier: "blocked", updated_at: new Date().toISOString() }).eq("id", user.id);
    await logAdminAction(sessionId, "block_user", "user", user.id, `Blocked via command`);
    return { type: "success", message: `Blocked user ${user.username} (was: ${user.subscription_tier})` };
  }

  if (action === "unblock" && parts.length >= 2) {
    const query = sanitizeSearch(parts.slice(1).join(" "));
    if (!query) return { type: "error", message: "Invalid username" };

    const { data: user } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", query)
      .single();

    if (!user) return { type: "error", message: `No user found with exact username "${query}"` };

    await supabase.from("profiles").update({ subscription_tier: "free", updated_at: new Date().toISOString() }).eq("id", user.id);
    await logAdminAction(sessionId, "unblock_user", "user", user.id);
    return { type: "success", message: `Unblocked user ${user.username}` };
  }

  if (action === "cost") {
    if (parts[1] === "total" || parts.length === 1) {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: costs } = await supabase
        .from("ai_cost_log")
        .select("cost_usd, provider")
        .gte("created_at", since)
        .limit(5000);

      const total = (costs || []).reduce((s: number, c: { cost_usd: string }) => s + parseFloat(c.cost_usd || "0"), 0);
      const byProvider: Record<string, number> = {};
      for (const c of costs || []) {
        byProvider[c.provider] = (byProvider[c.provider] || 0) + parseFloat(c.cost_usd || "0");
      }

      return {
        type: "data",
        message: `Total cost (30d): $${total.toFixed(4)}\n\nBy provider:\n${Object.entries(byProvider).map(([p, c]) => `  ${p}: $${c.toFixed(4)}`).join("\n")}`,
      };
    }

    const query = sanitizeSearch(parts.slice(1).join(" "));
    if (!query) return { type: "error", message: "Invalid search query" };

    const { data: user } = await supabase
      .from("profiles")
      .select("id, username")
      .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(1)
      .single();

    if (!user) return { type: "error", message: `No user found matching "${query}"` };

    const { data: costs } = await supabase
      .from("ai_cost_log")
      .select("cost_usd, provider, model")
      .eq("user_id", user.id)
      .limit(5000);

    const total = (costs || []).reduce((s: number, c: { cost_usd: string }) => s + parseFloat(c.cost_usd || "0"), 0);

    return {
      type: "data",
      message: `Total cost for ${user.username}: $${total.toFixed(4)} across ${costs?.length || 0} API calls`,
    };
  }

  if (action === "search" && parts.length >= 2) {
    const query = sanitizeSearch(parts.slice(1).join(" "));
    if (!query) return { type: "error", message: "Invalid search query" };

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, user_id, status, email_subject, input_channel, created_at, cost_usd")
      .or(`email_subject.ilike.%${query}%,response_text.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(15);

    if (!tasks?.length) return { type: "info", message: `No tasks matching "${query}"` };

    const ids = [...new Set(tasks.map((t: { user_id: string }) => t.user_id).filter(Boolean))];
    const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids);
    const nameMap: Record<string, string> = {};
    for (const p of profiles || []) nameMap[p.id] = p.username;

    const lines = tasks.map(
      (t: { status: string; user_id: string; email_subject: string; created_at: string }) =>
        `  [${t.status}] ${nameMap[t.user_id] || "?"}: ${t.email_subject || "(no subject)"} — ${new Date(t.created_at).toLocaleString()}`,
    );

    return { type: "data", message: `Found ${tasks.length} tasks:\n${lines.join("\n")}` };
  }

  if (action === "active") {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, user_id, email_subject, input_channel, created_at")
      .eq("status", "processing")
      .order("created_at", { ascending: false });

    if (!tasks?.length) return { type: "info", message: "No tasks currently processing" };

    const ids = [...new Set(tasks.map((t: { user_id: string }) => t.user_id).filter(Boolean))];
    const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids);
    const nameMap: Record<string, string> = {};
    for (const p of profiles || []) nameMap[p.id] = p.username;

    const lines = tasks.map(
      (t: { user_id: string; email_subject: string; input_channel: string; created_at: string }) =>
        `  ${nameMap[t.user_id] || "?"}: ${t.email_subject || "(no subject)"} via ${t.input_channel} — started ${new Date(t.created_at).toLocaleString()}`,
    );

    return { type: "data", message: `${tasks.length} active task(s):\n${lines.join("\n")}` };
  }

  if (action === "sessions") {
    const { data: sessions } = await supabase
      .from("admin_sessions")
      .select("ip_address, created_at, last_activity_at, expires_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (!sessions?.length) return { type: "info", message: "No active admin sessions" };

    const lines = sessions.map(
      (s: { ip_address: string; last_activity_at: string; expires_at: string }) =>
        `  IP: ${s.ip_address} — active: ${new Date(s.last_activity_at).toLocaleString()} — expires: ${new Date(s.expires_at).toLocaleString()}`,
    );

    return { type: "data", message: `${sessions.length} active session(s):\n${lines.join("\n")}` };
  }

  if (action === "audit") {
    const n = Math.min(50, parseInt(parts[1] || "20") || 20);
    const { data: logs } = await supabase
      .from("admin_audit_log")
      .select("action, target_type, target_id, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(n);

    if (!logs?.length) return { type: "info", message: "No audit log entries" };

    const lines = logs.map(
      (l: { created_at: string; action: string; target_type: string; notes: string }) =>
        `  [${new Date(l.created_at).toLocaleString()}] ${l.action}${l.target_type ? ` -> ${l.target_type}` : ""}${l.notes ? ` (${l.notes})` : ""}`,
    );

    return { type: "data", message: `Last ${logs.length} audit entries:\n${lines.join("\n")}` };
  }

  if (action === "killswitch") {
    if (parts[1] === "status") {
      // V20 fix: Use distributed_locks as source of truth
      const { data: lock } = await supabase
        .from("distributed_locks")
        .select("locked_at")
        .eq("lock_name", "api_killswitch")
        .single();

      return {
        type: "info",
        message: lock
          ? `Kill switch is ON (activated ${new Date(lock.locked_at).toLocaleString()})`
          : "Kill switch is OFF — API is running normally",
      };
    }
  }

  return {
    type: "error",
    message: `Unknown command: "${action}". Type "help" for available commands.`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    let body: { command?: string };
    try {
      body = await request.json();
    } catch {
      return secureError("bad_request", 400);
    }

    const { command } = body;
    if (!command || typeof command !== "string" || command.length > 500) {
      return secureError("invalid_command", 400);
    }

    await logAdminAction(auth.session.id, "command", undefined, undefined, command);

    const result = await executeCommand(command, auth.session.id);
    return secureResponse(result);
  } catch (err) {
    console.error("Admin command error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
