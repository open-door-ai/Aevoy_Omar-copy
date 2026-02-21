export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultW: number;  // columns (max 4)
  defaultH: number;  // rows (1 or 2)
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  category: string;
  isBuiltin: true;
  isPremium: boolean;
  permissions: string[];
  tags: string[];
}

export const BUILTIN_WIDGETS: WidgetDefinition[] = [
  {
    id: "send-task",
    name: "Send Task",
    description: "Your main command input — tell your AI what to do.",
    icon: "⚡",
    defaultW: 4, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 1,
    category: "productivity",
    isBuiltin: true, isPremium: false,
    permissions: [], tags: ["core", "tasks"],
  },
  {
    id: "quick-stats",
    name: "Quick Stats",
    description: "Your email, phone, active tasks, and monthly cost at a glance.",
    icon: "📊",
    defaultW: 4, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 1,
    category: "analytics",
    isBuiltin: true, isPremium: false,
    permissions: ["profile", "usage"], tags: ["core", "stats"],
  },
  {
    id: "task-stats",
    name: "Task Statistics",
    description: "Tasks today, this week, 7-day success rate, and budget.",
    icon: "📈",
    defaultW: 4, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 1,
    category: "analytics",
    isBuiltin: true, isPremium: false,
    permissions: ["tasks", "usage"], tags: ["core", "stats"],
  },
  {
    id: "recent-activity",
    name: "Recent Activity",
    description: "Live feed of your AI's latest actions.",
    icon: "📋",
    defaultW: 2, defaultH: 2, minW: 2, minH: 1, maxW: 4, maxH: 2,
    category: "productivity",
    isBuiltin: true, isPremium: false,
    permissions: ["tasks"], tags: ["core", "activity"],
  },
  {
    id: "scheduled-tasks",
    name: "Scheduled Tasks",
    description: "Manage recurring tasks your AI runs automatically.",
    icon: "🗓️",
    defaultW: 2, defaultH: 2, minW: 2, minH: 1, maxW: 4, maxH: 2,
    category: "productivity",
    isBuiltin: true, isPremium: false,
    permissions: ["tasks"], tags: ["core", "automation"],
  },
  {
    id: "ai-contact",
    name: "AI Contact Info",
    description: "Your AI email and phone number for sending tasks.",
    icon: "📱",
    defaultW: 2, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 1,
    category: "communication",
    isBuiltin: true, isPremium: false,
    permissions: ["profile"], tags: ["core", "email", "phone"],
  },
  {
    id: "usage",
    name: "Usage & Plan",
    description: "Messages used this month and your current plan.",
    icon: "💬",
    defaultW: 2, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 1,
    category: "analytics",
    isBuiltin: true, isPremium: false,
    permissions: ["profile", "usage"], tags: ["core", "billing"],
  },
  {
    id: "health-summary",
    name: "Health Summary",
    description: "Your latest health metrics and AI insights.",
    icon: "❤️",
    defaultW: 2, defaultH: 1, minW: 2, minH: 1, maxW: 4, maxH: 2,
    category: "health",
    isBuiltin: true, isPremium: false,
    permissions: ["health"], tags: ["health", "fitness"],
  },
  {
    id: "inbox-preview",
    name: "Inbox Preview",
    description: "Latest emails and AI-managed inbox queue.",
    icon: "📬",
    defaultW: 2, defaultH: 2, minW: 2, minH: 1, maxW: 4, maxH: 2,
    category: "communication",
    isBuiltin: true, isPremium: false,
    permissions: ["inbox"], tags: ["email", "inbox"],
  },
];

export const WIDGET_BY_ID = new Map(BUILTIN_WIDGETS.map(w => [w.id, w]));

export const CATEGORY_LABELS: Record<string, string> = {
  productivity: "Productivity",
  analytics: "Analytics",
  communication: "Communication",
  health: "Health",
  finance: "Finance",
  "ai-tools": "AI Tools",
};
