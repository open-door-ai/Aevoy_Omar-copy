"use client";
import { useState, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Check } from "lucide-react";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { WidgetContainer } from "./widget-container";
import { WidgetPicker } from "./widget-picker";

// Dynamic widget renderer
import { QuickStatsWidget } from "@/components/widgets/quick-stats-widget";
import { TaskStatsWidget } from "@/components/widgets/task-stats-widget";
import { SendTaskWidget } from "@/components/widgets/send-task-widget";
import { RecentActivityWidget } from "@/components/widgets/recent-activity-widget";
import { ScheduledTasksWidget } from "@/components/widgets/scheduled-tasks-widget";
import { AiContactWidget } from "@/components/widgets/ai-contact-widget";
import { UsageWidget } from "@/components/widgets/usage-widget";
import { InboxPreviewWidget } from "@/components/widgets/inbox-preview-widget";
import { QueueWidget } from "@/components/widgets/queue-widget";
import { ConnectedAppsWidget } from "@/components/widgets/connected-apps-widget";
import { SkillsWidget } from "@/components/widgets/skills-widget";
import { CostChartWidget } from "@/components/widgets/cost-chart-widget";
import { StoreWidget } from "@/components/widgets/store-widget";

const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  "quick-stats": QuickStatsWidget,
  "task-stats": TaskStatsWidget,
  "send-task": SendTaskWidget,
  "recent-activity": RecentActivityWidget,
  "scheduled-tasks": ScheduledTasksWidget,
  "ai-contact": AiContactWidget,
  "usage": UsageWidget,
  "inbox-preview": InboxPreviewWidget,
  "queue": QueueWidget,
  "connected-apps": ConnectedAppsWidget,
  "skills": SkillsWidget,
  "cost-chart": CostChartWidget,
  "store": StoreWidget,
};

interface WidgetGridProps {
  initialLayout: WidgetLayoutItem[];
}

// Enumerate all Tailwind col-span classes so JIT won't purge them
const MD_SPAN: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2" };
const LG_SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };
function getSpanClass(w: number): string {
  const md = Math.min(w, 2);
  const lg = Math.min(w, 4);
  return `col-span-1 ${MD_SPAN[md] ?? "md:col-span-2"} ${LG_SPAN[lg] ?? "lg:col-span-4"}`;
}

export function WidgetGrid({ initialLayout }: WidgetGridProps) {
  const [layout, setLayout] = useState<WidgetLayoutItem[]>(initialLayout);
  const [isEditing, setIsEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const saveLayout = useCallback(async (newLayout: WidgetLayoutItem[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await fetch("/api/widgets/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: newLayout }),
        });
      } catch (err) {
        console.error("Failed to save layout", err);
      } finally {
        setIsSaving(false);
      }
    }, 800);
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayout(prev => {
      const oldIdx = prev.findIndex(i => i.id === active.id);
      const newIdx = prev.findIndex(i => i.id === over.id);
      const newLayout = arrayMove(prev, oldIdx, newIdx);
      saveLayout(newLayout);
      return newLayout;
    });
  };

  const handleRemove = useCallback((id: string) => {
    setLayout(prev => {
      const newLayout = prev.filter(i => i.id !== id);
      saveLayout(newLayout);
      return newLayout;
    });
  }, [saveLayout]);

  const handleAdd = useCallback((item: Omit<WidgetLayoutItem, "id">) => {
    const newItem: WidgetLayoutItem = { id: crypto.randomUUID(), ...item };
    setJustAdded(prev => new Set(prev).add(newItem.id));
    // Clear the "just added" flag after the bounce animation finishes
    setTimeout(() => setJustAdded(prev => { const next = new Set(prev); next.delete(newItem.id); return next; }), 800);
    setLayout(prev => {
      const newLayout = [...prev, newItem];
      saveLayout(newLayout);
      return newLayout;
    });
  }, [saveLayout]);

  const currentWidgetIds = layout.map(i => i.widgetId);

  return (
    <div className="relative">
      {/* Edit mode toolbar */}
      <div className="flex items-center justify-between mb-3 sm:mb-6">
        <div className="flex items-center gap-2">
          {isSaving && <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${isEditing ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"}`}
          >
            {isEditing ? <><Check className="h-3.5 w-3.5" /> Done</> : <><Pencil className="h-3.5 w-3.5" /> Customize</>}
          </button>
        </div>
      </div>

      {/* Widget Grid */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={layout.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-auto">
            <AnimatePresence>
              {layout.map(item => {
                const WidgetComponent = WIDGET_COMPONENTS[item.widgetId];
                if (!WidgetComponent) return null;
                const isNew = justAdded.has(item.id);
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={isNew ? { opacity: 0, scale: 0.5, y: 30 } : { opacity: 0, scale: 0.95 }}
                    animate={isNew
                      ? { opacity: 1, scale: [0.5, 1.08, 0.96, 1.02, 1], y: 0 }
                      : { opacity: 1, scale: 1 }
                    }
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                    transition={isNew
                      ? { type: "spring", stiffness: 300, damping: 15, mass: 0.8 }
                      : { type: "spring", stiffness: 400, damping: 30 }
                    }
                    className={`min-w-0 ${getSpanClass(item.w)}`}
                  >
                    <WidgetContainer item={item} onRemove={handleRemove} isEditing={isEditing}>
                      <WidgetComponent />
                    </WidgetContainer>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Widget FAB */}
      <AnimatePresence>
        {isEditing && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setShowPicker(true)}
            className="fixed bottom-6 right-6 z-30 bg-primary text-primary-foreground rounded-full p-4 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center gap-2"
          >
            <Plus className="h-5 w-5" />
            <span className="text-sm font-medium pr-1">Add Widget</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Widget Picker */}
      <WidgetPicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onAdd={handleAdd}
        currentWidgetIds={currentWidgetIds}
      />
    </div>
  );
}
