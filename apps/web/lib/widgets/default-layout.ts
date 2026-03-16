export interface WidgetLayoutItem {
  id: string;        // unique instance UUID
  widgetId: string;  // from registry
  w: number;         // columns (1–4)
  h: number;         // rows (1–2)
  visible: boolean;
  config?: Record<string, unknown>;
}

// Default layout given to all new users
// Minimal by default — users can add more via Customize
export const DEFAULT_LAYOUT: Omit<WidgetLayoutItem, "id">[] = [
  { widgetId: "send-task",        w: 4, h: 1, visible: true },
  { widgetId: "task-stats",       w: 4, h: 1, visible: true },
  { widgetId: "recent-activity",  w: 4, h: 2, visible: true },
  { widgetId: "ai-contact",       w: 4, h: 1, visible: true },
];
