"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, LogOut, Users, Activity, DollarSign, Terminal, Power,
  Search, ChevronRight, ChevronLeft, Clock, CheckCircle, XCircle,
  AlertTriangle, User, Mail, Phone, Calendar, Globe, ArrowUpDown,
  Loader2, Send, Package, RefreshCw, Eye, Ban, Unlock, X,
  BarChart3, TrendingUp,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
interface UserRow {
  id: string; username: string; email: string; display_name: string | null;
  timezone: string; subscription_tier: string; created_at: string;
  last_active_at: string | null; onboarding_completed: boolean;
  messages_used: number; messages_limit: number;
  task_count: number; total_cost_usd: number;
}

interface TaskRow {
  id: string; user_id: string; username: string; status: string;
  type: string | null; email_subject: string | null; input_channel: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
  cost_usd: string | null; error_message: string | null; response_text: string | null;
  tokens_used: number | null;
}

interface UserDetail {
  profile: Record<string, unknown>;
  settings: Record<string, unknown> | null;
  wallet: Record<string, unknown> | null;
  tasks: TaskRow[];
  costs: Array<{ provider: string; model: string; cost_usd: string; created_at: string }>;
  totalCost: number;
  scheduled: Array<Record<string, unknown>>;
  phone: { phone_number: string } | null;
  oauth: Array<{ provider: string; created_at: string }>;
}

interface CostData {
  totalCost: number; totalUsers: number; totalTasks: number; activeToday: number;
  dailyCosts: Array<{ date: string; cost: number }>;
  providerCosts: Array<{ provider: string; cost: number }>;
  topSpenders: Array<{ user_id: string; username: string; cost: number }>;
}

interface CommandResult { type: "success" | "error" | "info" | "data"; message: string; data?: unknown }

type Tab = "overview" | "users" | "tasks" | "costs" | "terminal" | "killswitch";

/* ─────────────────────────── Helpers ─────────────────────────── */
function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60000) return "Just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function statusColor(s: string): string {
  switch (s) {
    case "completed": return "text-emerald-400";
    case "processing": return "text-blue-400";
    case "failed": return "text-red-400";
    case "pending": return "text-amber-400";
    case "needs_review": return "text-purple-400";
    default: return "text-white/40";
  }
}

function tierBadge(tier: string): string {
  switch (tier) {
    case "blocked": return "bg-red-500/20 text-red-400";
    case "pro": return "bg-blue-500/20 text-blue-400";
    case "beta": return "bg-purple-500/20 text-purple-400";
    default: return "bg-white/5 text-white/40";
  }
}

const channelIcon: Record<string, string> = {
  email: "mail", sms: "sms", voice: "phone", web: "globe", chat: "chat",
};

/* ─────────────────────────── Component ─────────────────────────── */
export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);

  // Users state
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersSortBy, setUsersSortBy] = useState("created_at");
  const [usersSortDir, setUsersSortDir] = useState("desc");

  // User detail
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  // Tasks state
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [tasksPage, setTasksPage] = useState(1);
  const [tasksSearch, setTasksSearch] = useState("");
  const [tasksStatus, setTasksStatus] = useState("");
  const [tasksChannel, setTasksChannel] = useState("");
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Costs state
  const [costData, setCostData] = useState<CostData | null>(null);
  const [costDays, setCostDays] = useState(30);

  // Terminal state
  const [termHistory, setTermHistory] = useState<Array<{ input: string; result: CommandResult }>>([]);
  const [termInput, setTermInput] = useState("");
  const [termLoading, setTermLoading] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const termInputRef = useRef<HTMLInputElement>(null);

  // Kill switch state
  const [ksStatus, setKsStatus] = useState<{ active: boolean; since: string | null } | null>(null);
  const [ksStep, setKsStep] = useState(0);
  const [ksPassword, setKsPassword] = useState("");
  const [ksPhrase, setKsPhrase] = useState("");
  const [ksError, setKsError] = useState("");
  const [ksLoading, setKsLoading] = useState(false);

  // Overview stats
  const [overviewStats, setOverviewStats] = useState<CostData | null>(null);

  /* ─── API helper ─── */
  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(path, opts);
    if (res.status === 401) { router.push("/admin"); return null; }
    return res.json();
  }, [router]);

  /* ─── Loaders ─── */
  const loadUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(usersPage), limit: "50",
      sort: usersSortBy, dir: usersSortDir,
      ...(usersSearch && { search: usersSearch }),
    });
    const data = await api(`/api/admin/users?${params}`);
    if (data) { setUsers(data.users); setUsersTotal(data.total); }
    setLoading(false);
  }, [api, usersPage, usersSortBy, usersSortDir, usersSearch]);

  const loadUserDetail = useCallback(async (id: string) => {
    setUserDetailLoading(true);
    setSelectedUserId(id);
    const data = await api(`/api/admin/users/${id}`);
    if (data) setSelectedUser(data);
    setUserDetailLoading(false);
  }, [api]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(tasksPage), limit: "50",
      ...(tasksStatus && { status: tasksStatus }),
      ...(tasksChannel && { channel: tasksChannel }),
      ...(tasksSearch && { search: tasksSearch }),
    });
    const data = await api(`/api/admin/tasks?${params}`);
    if (data) { setTasks(data.tasks); setTasksTotal(data.total); }
    setLoading(false);
  }, [api, tasksPage, tasksStatus, tasksChannel, tasksSearch]);

  const loadCosts = useCallback(async () => {
    setLoading(true);
    const data = await api(`/api/admin/costs?days=${costDays}`);
    if (data) setCostData(data);
    setLoading(false);
  }, [api, costDays]);

  const loadOverview = useCallback(async () => {
    const data = await api(`/api/admin/costs?days=30`);
    if (data) setOverviewStats(data);
  }, [api]);

  const loadKillswitch = useCallback(async () => {
    const data = await api("/api/admin/killswitch");
    if (data) setKsStatus(data);
  }, [api]);

  /* ─── Effects ─── */
  useEffect(() => {
    if (tab === "overview") loadOverview();
    if (tab === "users") loadUsers();
    if (tab === "tasks") loadTasks();
    if (tab === "costs") loadCosts();
    if (tab === "killswitch") loadKillswitch();
    if (tab === "terminal") setTimeout(() => termInputRef.current?.focus(), 100);
  }, [tab, loadUsers, loadTasks, loadCosts, loadOverview, loadKillswitch]);

  useEffect(() => { if (tab === "users") loadUsers(); }, [usersPage, usersSortBy, usersSortDir]);
  useEffect(() => { if (tab === "tasks") loadTasks(); }, [tasksPage, tasksStatus, tasksChannel]);

  /* ─── Terminal ─── */
  const runCommand = async () => {
    if (!termInput.trim() || termLoading) return;
    const cmd = termInput.trim();
    setTermInput("");
    setTermLoading(true);
    const data = await api("/api/admin/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });
    setTermHistory(prev => [...prev, { input: cmd, result: data || { type: "error", message: "Connection failed" } }]);
    setTermLoading(false);
    setTimeout(() => termRef.current?.scrollTo(0, termRef.current.scrollHeight), 50);
  };

  /* ─── Kill Switch ─── */
  const handleKillSwitch = async (action: "activate" | "deactivate") => {
    setKsLoading(true);
    setKsError("");

    if (action === "deactivate") {
      const data = await api("/api/admin/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", password: ksPassword }),
      });
      if (data?.success) { setKsStatus({ active: false, since: null }); setKsStep(0); setKsPassword(""); }
      else setKsError(data?.message || "Failed");
      setKsLoading(false);
      return;
    }

    if (ksStep < 4) {
      setKsStep(prev => prev + 1);
      setKsLoading(false);
      return;
    }

    const data = await api("/api/admin/killswitch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "activate",
        password: ksPassword,
        confirmPhrase: ksPhrase,
        confirmations: ksStep,
      }),
    });

    if (data?.success) {
      setKsStatus({ active: true, since: new Date().toISOString() });
      setKsStep(0); setKsPassword(""); setKsPhrase("");
    } else {
      setKsError(data?.message || "Failed to activate kill switch");
    }
    setKsLoading(false);
  };

  /* ─── Block/Unblock User ─── */
  const toggleBlockUser = async (userId: string, block: boolean) => {
    await api(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked: block }),
    });
    if (selectedUser) {
      setSelectedUser({
        ...selectedUser,
        profile: { ...selectedUser.profile, subscription_tier: block ? "blocked" : "free" },
      });
    }
    loadUsers();
  };

  /* ─── Logout ─── */
  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin");
  };

  /* ─── Sidebar nav items ─── */
  const navItems: Array<{ id: Tab; label: string; icon: typeof Users }> = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "users", label: "Users", icon: Users },
    { id: "tasks", label: "Tasks", icon: Activity },
    { id: "costs", label: "Costs", icon: DollarSign },
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "killswitch", label: "Kill Switch", icon: Power },
  ];

  /* ───────────────────────── RENDER ───────────────────────── */
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex">
      {/* ─── Sidebar ─── */}
      <div className="w-56 border-r border-white/[0.06] flex flex-col">
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-white/40" />
            <span className="font-semibold text-sm">Aevoy Admin</span>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setSelectedUser(null); setSelectedUserId(null); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
                tab === item.id
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.id === "killswitch" && ksStatus?.active && (
                <span className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-2 border-t border-white/[0.06]">
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all">
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          <motion.div key={tab + (selectedUserId || "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="p-6 max-w-6xl">

            {/* ═══════════════ OVERVIEW ═══════════════ */}
            {tab === "overview" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Dashboard</h2>
                {overviewStats && (
                  <>
                    <div className="grid grid-cols-4 gap-4">
                      {[
                        { label: "Total Users", value: overviewStats.totalUsers, icon: Users, color: "text-blue-400" },
                        { label: "Total Tasks", value: overviewStats.totalTasks, icon: Activity, color: "text-emerald-400" },
                        { label: "Active Today", value: overviewStats.activeToday, icon: Clock, color: "text-amber-400" },
                        { label: "Cost (30d)", value: `$${overviewStats.totalCost.toFixed(2)}`, icon: DollarSign, color: "text-purple-400" },
                      ].map(s => (
                        <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <s.icon className={`h-4 w-4 ${s.color}`} />
                            <span className="text-xs text-white/30">{s.label}</span>
                          </div>
                          <p className="text-2xl font-bold">{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Cost chart - simple bar representation */}
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white/60 mb-4">Daily Costs (30d)</h3>
                      <div className="flex items-end gap-1 h-32">
                        {overviewStats.dailyCosts.slice(-30).map((d, i) => {
                          const maxCost = Math.max(...overviewStats.dailyCosts.map(x => x.cost), 0.01);
                          const height = (d.cost / maxCost) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
                              <div className="absolute -top-6 hidden group-hover:block bg-white/10 px-1.5 py-0.5 rounded text-[9px] text-white/60 whitespace-nowrap z-10">
                                {d.date}: ${d.cost.toFixed(4)}
                              </div>
                              <div
                                className="w-full bg-blue-500/40 hover:bg-blue-500/60 rounded-t transition-all"
                                style={{ height: `${Math.max(height, 2)}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Provider breakdown + Top spenders side by side */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-medium text-white/60 mb-3">Cost by Provider</h3>
                        <div className="space-y-2">
                          {overviewStats.providerCosts.sort((a, b) => b.cost - a.cost).map(p => (
                            <div key={p.provider} className="flex items-center justify-between text-sm">
                              <span className="text-white/60">{p.provider}</span>
                              <span className="font-mono">${p.cost.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-medium text-white/60 mb-3">Top Spenders</h3>
                        <div className="space-y-2">
                          {overviewStats.topSpenders.slice(0, 5).map((s, i) => (
                            <div key={s.user_id} className="flex items-center justify-between text-sm">
                              <span className="text-white/60">
                                <span className="text-white/20 mr-2">{i + 1}.</span>
                                {s.username}
                              </span>
                              <span className="font-mono">${s.cost.toFixed(4)}</span>
                            </div>
                          ))}
                          {overviewStats.topSpenders.length === 0 && <p className="text-xs text-white/20">No cost data</p>}
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {!overviewStats && (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-white/20" />
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════ USERS ═══════════════ */}
            {tab === "users" && !selectedUser && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Users <span className="text-white/30 font-normal text-sm ml-2">{usersTotal}</span></h2>
                  <button onClick={loadUsers} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                    <RefreshCw className={`h-4 w-4 text-white/30 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {/* Search + Sort */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input
                      value={usersSearch}
                      onChange={e => setUsersSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && loadUsers()}
                      placeholder="Search by name, email, or username..."
                      className="w-full pl-9 pr-4 py-2.5 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
                    />
                  </div>
                  <select
                    value={usersSortBy}
                    onChange={e => setUsersSortBy(e.target.value)}
                    className="px-3 py-2.5 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white/60 outline-none"
                  >
                    <option value="created_at">Signup Date</option>
                    <option value="last_active_at">Last Active</option>
                    <option value="username">Username</option>
                    <option value="messages_used">Messages</option>
                  </select>
                  <button onClick={() => setUsersSortDir(d => d === "asc" ? "desc" : "asc")} className="px-3 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white/40 hover:text-white/70 transition-colors">
                    <ArrowUpDown className="h-4 w-4" />
                  </button>
                </div>

                {/* Users table */}
                <div className="border border-white/[0.06] rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-xs text-white/30">
                        <th className="text-left px-4 py-3 font-medium">User</th>
                        <th className="text-left px-4 py-3 font-medium">Tier</th>
                        <th className="text-left px-4 py-3 font-medium">Tasks</th>
                        <th className="text-left px-4 py-3 font-medium">Cost</th>
                        <th className="text-left px-4 py-3 font-medium">Last Active</th>
                        <th className="text-left px-4 py-3 font-medium">Signed Up</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr
                          key={u.id}
                          onClick={() => loadUserDetail(u.id)}
                          className="border-b border-white/[0.03] hover:bg-white/[0.03] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{u.display_name || u.username}</p>
                              <p className="text-xs text-white/30">{u.email}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tierBadge(u.subscription_tier)}`}>
                              {u.subscription_tier}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-white/60">{u.task_count}</td>
                          <td className="px-4 py-3 text-sm font-mono text-white/60">${u.total_cost_usd.toFixed(4)}</td>
                          <td className="px-4 py-3 text-xs text-white/30">{timeAgo(u.last_active_at)}</td>
                          <td className="px-4 py-3 text-xs text-white/30">{new Date(u.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3"><ChevronRight className="h-4 w-4 text-white/10" /></td>
                        </tr>
                      ))}
                      {users.length === 0 && !loading && (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-white/20 text-sm">No users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {usersTotal > 50 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/30">Page {usersPage} of {Math.ceil(usersTotal / 50)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setUsersPage(p => Math.max(1, p - 1))} disabled={usersPage <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-20 transition-all">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button onClick={() => setUsersPage(p => p + 1)} disabled={usersPage >= Math.ceil(usersTotal / 50)} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-20 transition-all">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════ USER DETAIL ═══════════════ */}
            {tab === "users" && (selectedUser || userDetailLoading) && (
              <div className="space-y-6">
                <button onClick={() => { setSelectedUser(null); setSelectedUserId(null); }} className="flex items-center gap-1 text-sm text-white/40 hover:text-white/70 transition-colors">
                  <ChevronLeft className="h-4 w-4" /> Back to users
                </button>

                {userDetailLoading && !selectedUser ? (
                  <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-white/20" /></div>
                ) : selectedUser && (
                  <>
                    {/* Profile header */}
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center">
                            <User className="h-7 w-7 text-white/20" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold">{String(selectedUser.profile.display_name || selectedUser.profile.username)}</h3>
                            <p className="text-sm text-white/40">@{String(selectedUser.profile.username)}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-white/30">
                              <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {String(selectedUser.profile.email)}</span>
                              {selectedUser.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selectedUser.phone.phone_number}</span>}
                              <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {String(selectedUser.profile.timezone)}</span>
                              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Joined {new Date(String(selectedUser.profile.created_at)).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tierBadge(String(selectedUser.profile.subscription_tier))}`}>
                            {String(selectedUser.profile.subscription_tier)}
                          </span>
                          {String(selectedUser.profile.subscription_tier) === "blocked" ? (
                            <button onClick={() => toggleBlockUser(String(selectedUser.profile.id), false)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors">
                              <Unlock className="h-3 w-3" /> Unblock
                            </button>
                          ) : (
                            <button onClick={() => toggleBlockUser(String(selectedUser.profile.id), true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors">
                              <Ban className="h-3 w-3" /> Block
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Stats cards */}
                    <div className="grid grid-cols-4 gap-4">
                      {[
                        { label: "Total Tasks", value: selectedUser.tasks.length, icon: Activity },
                        { label: "Total Cost", value: `$${selectedUser.totalCost.toFixed(4)}`, icon: DollarSign },
                        { label: "Scheduled", value: selectedUser.scheduled.length, icon: Clock },
                        { label: "OAuth", value: selectedUser.oauth.length, icon: Globe },
                      ].map(s => (
                        <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                          <p className="text-xs text-white/30 mb-1">{s.label}</p>
                          <p className="text-xl font-bold">{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Settings + Wallet */}
                    <div className="grid grid-cols-2 gap-4">
                      {selectedUser.settings && (
                        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                          <h4 className="text-sm font-medium text-white/60 mb-3">Settings</h4>
                          <div className="space-y-1.5 text-xs">
                            {Object.entries(selectedUser.settings).filter(([k]) => !["user_id", "created_at", "updated_at"].includes(k)).map(([k, v]) => (
                              <div key={k} className="flex justify-between">
                                <span className="text-white/30">{k.replace(/_/g, " ")}</span>
                                <span className="text-white/60 font-mono">{String(v ?? "—")}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedUser.wallet && (
                        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                          <h4 className="text-sm font-medium text-white/60 mb-3">Credit Wallet</h4>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between"><span className="text-white/30">Balance</span><span className="font-mono">${((selectedUser.wallet.balance_cents as number || 0) / 100).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-white/30">Lifetime Top-up</span><span className="font-mono">${((selectedUser.wallet.lifetime_topup_cents as number || 0) / 100).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-white/30">Lifetime Spent</span><span className="font-mono">${((selectedUser.wallet.lifetime_spent_cents as number || 0) / 100).toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-white/30">Auto Reload</span><span>{selectedUser.wallet.auto_reload_enabled ? "On" : "Off"}</span></div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Recent Tasks */}
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                      <h4 className="text-sm font-medium text-white/60 mb-3">Recent Tasks</h4>
                      <div className="space-y-1">
                        {selectedUser.tasks.slice(0, 20).map(t => (
                          <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer" onClick={() => setExpandedTask(expandedTask === t.id ? null : t.id)}>
                            <span className={`text-xs font-medium ${statusColor(t.status)}`}>{t.status}</span>
                            <span className="text-sm text-white/70 flex-1 truncate">{t.email_subject || "(no subject)"}</span>
                            <span className="text-xs text-white/20">{t.input_channel}</span>
                            <span className="text-xs text-white/20 font-mono">${parseFloat(t.cost_usd || "0").toFixed(4)}</span>
                            <span className="text-xs text-white/20">{timeAgo(t.created_at)}</span>
                          </div>
                        ))}
                        {selectedUser.tasks.length === 0 && <p className="text-xs text-white/20 text-center py-4">No tasks yet</p>}
                      </div>
                    </div>

                    {/* OAuth connections */}
                    {selectedUser.oauth.length > 0 && (
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                        <h4 className="text-sm font-medium text-white/60 mb-3">Connected Accounts</h4>
                        <div className="flex gap-2">
                          {selectedUser.oauth.map(o => (
                            <span key={o.provider} className="text-xs bg-white/5 px-3 py-1.5 rounded-lg text-white/50">
                              {o.provider}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ═══════════════ TASKS ═══════════════ */}
            {tab === "tasks" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Tasks <span className="text-white/30 font-normal text-sm ml-2">{tasksTotal}</span></h2>
                  <button onClick={loadTasks} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                    <RefreshCw className={`h-4 w-4 text-white/30 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {/* Filters */}
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                    <input
                      value={tasksSearch}
                      onChange={e => setTasksSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && loadTasks()}
                      placeholder="Search tasks..."
                      className="w-full pl-9 pr-4 py-2.5 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
                    />
                  </div>
                  <select value={tasksStatus} onChange={e => setTasksStatus(e.target.value)} className="px-3 py-2.5 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white/60 outline-none">
                    <option value="">All Status</option>
                    <option value="completed">Completed</option>
                    <option value="processing">Processing</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="needs_review">Needs Review</option>
                  </select>
                  <select value={tasksChannel} onChange={e => setTasksChannel(e.target.value)} className="px-3 py-2.5 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white/60 outline-none">
                    <option value="">All Channels</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="voice">Voice</option>
                    <option value="web">Web</option>
                    <option value="chat">Chat</option>
                  </select>
                </div>

                {/* Tasks list */}
                <div className="space-y-2">
                  {tasks.map(t => (
                    <div key={t.id}>
                      <div
                        onClick={() => setExpandedTask(expandedTask === t.id ? null : t.id)}
                        className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.05] cursor-pointer transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium w-20 ${statusColor(t.status)}`}>{t.status}</span>
                          <span className="text-sm text-white/70 flex-1 truncate">{t.email_subject || "(no subject)"}</span>
                          <span className="text-xs text-white/30 bg-white/[0.04] px-2 py-0.5 rounded">{t.username}</span>
                          <span className="text-xs text-white/20">{t.input_channel}</span>
                          <span className="text-xs text-white/20 font-mono">${parseFloat(t.cost_usd || "0").toFixed(4)}</span>
                          <span className="text-xs text-white/20">{timeAgo(t.created_at)}</span>
                          <ChevronRight className={`h-4 w-4 text-white/10 transition-transform ${expandedTask === t.id ? "rotate-90" : ""}`} />
                        </div>
                      </div>
                      <AnimatePresence>
                        {expandedTask === t.id && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="mx-4 mt-1 mb-2 p-4 bg-white/[0.02] border border-white/[0.04] rounded-lg space-y-3">
                              <div className="grid grid-cols-3 gap-3 text-xs">
                                <div><span className="text-white/30">Created:</span> <span className="text-white/60">{new Date(t.created_at).toLocaleString()}</span></div>
                                <div><span className="text-white/30">Completed:</span> <span className="text-white/60">{t.completed_at ? new Date(t.completed_at).toLocaleString() : "—"}</span></div>
                                <div><span className="text-white/30">Tokens:</span> <span className="text-white/60 font-mono">{t.tokens_used || 0}</span></div>
                              </div>
                              {t.response_text && (
                                <div>
                                  <p className="text-xs text-white/30 mb-1">Response:</p>
                                  <p className="text-xs text-white/50 bg-white/[0.02] rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap">{t.response_text}</p>
                                </div>
                              )}
                              {t.error_message && (
                                <div>
                                  <p className="text-xs text-red-400/50 mb-1">Error:</p>
                                  <p className="text-xs text-red-400/70 bg-red-500/5 rounded-lg p-3">{t.error_message}</p>
                                </div>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setTab("users"); loadUserDetail(t.user_id); }}
                                className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors"
                              >
                                View user profile
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                  {tasks.length === 0 && !loading && (
                    <div className="text-center py-12 text-white/20">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No tasks found</p>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {tasksTotal > 50 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/30">Page {tasksPage} of {Math.ceil(tasksTotal / 50)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setTasksPage(p => Math.max(1, p - 1))} disabled={tasksPage <= 1} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-20 transition-all">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button onClick={() => setTasksPage(p => p + 1)} disabled={tasksPage >= Math.ceil(tasksTotal / 50)} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-20 transition-all">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════ COSTS ═══════════════ */}
            {tab === "costs" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Cost Analytics</h2>
                  <div className="flex gap-2">
                    {[7, 14, 30, 60, 90].map(d => (
                      <button key={d} onClick={() => setCostDays(d)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${costDays === d ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"}`}>
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>

                {costData ? (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                        <p className="text-xs text-white/30 mb-1">Total Cost ({costDays}d)</p>
                        <p className="text-2xl font-bold">${costData.totalCost.toFixed(4)}</p>
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                        <p className="text-xs text-white/30 mb-1">Avg Daily</p>
                        <p className="text-2xl font-bold">${(costData.totalCost / Math.max(costDays, 1)).toFixed(4)}</p>
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                        <p className="text-xs text-white/30 mb-1">Active Today</p>
                        <p className="text-2xl font-bold">{costData.activeToday}</p>
                      </div>
                    </div>

                    {/* Cost chart */}
                    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white/60 mb-4">Daily Costs</h3>
                      <div className="flex items-end gap-1 h-40">
                        {costData.dailyCosts.map((d, i) => {
                          const maxCost = Math.max(...costData.dailyCosts.map(x => x.cost), 0.01);
                          const height = (d.cost / maxCost) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
                              <div className="absolute -top-8 hidden group-hover:block bg-white/10 backdrop-blur px-2 py-1 rounded text-[9px] text-white/70 whitespace-nowrap z-10">
                                {d.date}<br/>${d.cost.toFixed(4)}
                              </div>
                              <div className="w-full bg-emerald-500/30 hover:bg-emerald-500/50 rounded-t transition-all" style={{ height: `${Math.max(height, 2)}%` }} />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-medium text-white/60 mb-3">By Provider</h3>
                        {costData.providerCosts.sort((a, b) => b.cost - a.cost).map(p => {
                          const pct = (p.cost / Math.max(costData.totalCost, 0.01)) * 100;
                          return (
                            <div key={p.provider} className="mb-3">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-white/50">{p.provider}</span>
                                <span className="font-mono text-white/70">${p.cost.toFixed(4)} ({pct.toFixed(1)}%)</span>
                              </div>
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500/50 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-medium text-white/60 mb-3">Top Spenders</h3>
                        <div className="space-y-2.5">
                          {costData.topSpenders.map((s, i) => (
                            <div key={s.user_id} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-white/20 w-5">{i + 1}.</span>
                                <button onClick={() => { setTab("users"); loadUserDetail(s.user_id); }} className="text-sm text-white/60 hover:text-white transition-colors">
                                  {s.username}
                                </button>
                              </div>
                              <span className="text-sm font-mono text-white/50">${s.cost.toFixed(4)}</span>
                            </div>
                          ))}
                          {costData.topSpenders.length === 0 && <p className="text-xs text-white/20">No cost data</p>}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-white/20" /></div>
                )}
              </div>
            )}

            {/* ═══════════════ TERMINAL ═══════════════ */}
            {tab === "terminal" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Command Terminal</h2>
                  <button onClick={() => setTermHistory([])} className="text-xs text-white/30 hover:text-white/50 transition-colors">Clear</button>
                </div>

                <div className="bg-[#111] border border-white/[0.06] rounded-xl overflow-hidden" style={{ height: "calc(100vh - 200px)" }}>
                  {/* Output */}
                  <div ref={termRef} className="p-4 overflow-auto font-mono text-xs" style={{ height: "calc(100% - 48px)" }}>
                    <p className="text-white/20 mb-2">Aevoy Admin Terminal v1.0 — Type &quot;help&quot; for commands</p>
                    {termHistory.map((entry, i) => (
                      <div key={i} className="mb-3">
                        <p className="text-emerald-400/70"><span className="text-white/20">$ </span>{entry.input}</p>
                        <pre className={`mt-1 whitespace-pre-wrap ${
                          entry.result.type === "error" ? "text-red-400/70" :
                          entry.result.type === "success" ? "text-emerald-400/60" :
                          entry.result.type === "info" ? "text-blue-400/60" :
                          "text-white/50"
                        }`}>{entry.result.message}</pre>
                      </div>
                    ))}
                    {termLoading && (
                      <div className="flex items-center gap-2 text-white/20">
                        <Loader2 className="h-3 w-3 animate-spin" /> Running...
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="border-t border-white/[0.06] px-4 py-2 flex items-center gap-2">
                    <span className="text-emerald-400/50 font-mono text-xs">$</span>
                    <input
                      ref={termInputRef}
                      value={termInput}
                      onChange={e => setTermInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") runCommand(); }}
                      placeholder="Type a command..."
                      className="flex-1 bg-transparent text-xs font-mono text-white placeholder:text-white/15 outline-none"
                      disabled={termLoading}
                    />
                    <button onClick={runCommand} disabled={termLoading || !termInput.trim()} className="text-white/20 hover:text-white/50 disabled:opacity-20 transition-colors">
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════ KILL SWITCH ═══════════════ */}
            {tab === "killswitch" && (
              <div className="space-y-6 max-w-lg mx-auto mt-8">
                <div className="text-center">
                  <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all ${ksStatus?.active ? "bg-red-500/20 border-2 border-red-500/30" : "bg-white/5 border border-white/10"}`}>
                    <Power className={`h-10 w-10 ${ksStatus?.active ? "text-red-400" : "text-white/20"}`} />
                  </div>
                  <h2 className="text-lg font-semibold">API Kill Switch</h2>
                  <p className="text-xs text-white/30 mt-1">
                    {ksStatus?.active
                      ? `Active since ${new Date(ksStatus.since!).toLocaleString()}`
                      : "Shuts down all API task processing instantly"
                    }
                  </p>
                </div>

                {ksStatus?.active ? (
                  /* Deactivate */
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 space-y-4">
                    <p className="text-sm text-center text-red-400/70">API is currently OFFLINE. Enter password to restore.</p>
                    <input
                      type="password"
                      value={ksPassword}
                      onChange={e => setKsPassword(e.target.value)}
                      placeholder="Enter admin password"
                      className="w-full px-4 py-3 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
                    />
                    {ksError && <p className="text-xs text-red-400">{ksError}</p>}
                    <button
                      onClick={() => handleKillSwitch("deactivate")}
                      disabled={!ksPassword || ksLoading}
                      className="w-full py-3 rounded-xl bg-emerald-500/20 text-emerald-400 font-medium text-sm hover:bg-emerald-500/30 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
                    >
                      {ksLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                      Restore API
                    </button>
                  </div>
                ) : (
                  /* Activate — multi-step confirmation */
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 space-y-4">
                    {/* Step indicators */}
                    <div className="flex items-center justify-center gap-2 mb-4">
                      {[1, 2, 3, 4].map(s => (
                        <div key={s} className={`w-8 h-1 rounded-full transition-all ${ksStep >= s ? "bg-red-400" : "bg-white/10"}`} />
                      ))}
                    </div>

                    {ksStep === 0 && (
                      <>
                        <p className="text-sm text-center text-white/50">This will immediately halt ALL task processing for ALL users.</p>
                        <button onClick={() => setKsStep(1)} className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-all">
                          I understand, proceed
                        </button>
                      </>
                    )}

                    {ksStep === 1 && (
                      <>
                        <p className="text-sm text-center text-amber-400/70">Step 1/4: Are you absolutely sure? Active tasks will be interrupted.</p>
                        <button onClick={() => handleKillSwitch("activate")} className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-all">
                          Yes, continue
                        </button>
                      </>
                    )}

                    {ksStep === 2 && (
                      <>
                        <p className="text-sm text-center text-amber-400/70">Step 2/4: This cannot be undone quickly. All users will be affected.</p>
                        <button onClick={() => handleKillSwitch("activate")} className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-all">
                          I accept the consequences
                        </button>
                      </>
                    )}

                    {ksStep === 3 && (
                      <>
                        <p className="text-sm text-center text-amber-400/70">Step 3/4: Enter your admin password</p>
                        <input
                          type="password"
                          value={ksPassword}
                          onChange={e => setKsPassword(e.target.value)}
                          placeholder="Admin password"
                          className="w-full px-4 py-3 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
                        />
                        <button onClick={() => { if (ksPassword) handleKillSwitch("activate"); }} disabled={!ksPassword} className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 font-medium text-sm hover:bg-red-500/20 disabled:opacity-30 transition-all">
                          Verify & continue
                        </button>
                      </>
                    )}

                    {ksStep === 4 && (
                      <>
                        <p className="text-sm text-center text-red-400/70">Step 4/4: Type &quot;SHUTDOWN API&quot; to confirm</p>
                        <input
                          value={ksPhrase}
                          onChange={e => setKsPhrase(e.target.value)}
                          placeholder='Type "SHUTDOWN API"'
                          className="w-full px-4 py-3 text-sm bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 outline-none focus:border-red-500/30 transition-all"
                        />
                        {ksError && <p className="text-xs text-red-400">{ksError}</p>}
                        <button
                          onClick={() => handleKillSwitch("activate")}
                          disabled={ksPhrase !== "SHUTDOWN API" || ksLoading}
                          className="w-full py-3 rounded-xl bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
                        >
                          {ksLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                          ACTIVATE KILL SWITCH
                        </button>
                      </>
                    )}

                    {ksStep > 0 && (
                      <button onClick={() => { setKsStep(0); setKsPassword(""); setKsPhrase(""); setKsError(""); }} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors">
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
