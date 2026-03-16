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
      {/* Widget Grid — clean, full-width stacked layout */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={layout.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="space-y-4">
            <AnimatePresence>
              {layout.map(item => {
                const WidgetComponent = WIDGET_COMPONENTS[item.widgetId];
                if (!WidgetComponent) return null;
                const isNew = justAdded.has(item.id);
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={isNew ? { opacity: 0, scale: 0.95, y: 20 } : { opacity: 0 }}
                    animate={isNew
                      ? { opacity: 1, scale: 1, y: 0 }
                      : { opacity: 1 }
                    }
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                    transition={isNew
                      ? { type: "spring", stiffness: 300, damping: 20 }
                      : { duration: 0.3 }
                    }
                    className="w-full"
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

      {/* Customize link — minimal, at the bottom */}
      <div className="flex items-center justify-end mt-6 gap-2">
        {isSaving && <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>}
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
            isEditing
              ? "text-primary font-medium"
              : "text-muted-foreground/50 hover:text-muted-foreground"
          }`}
        >
          {isEditing ? <><Check className="h-3 w-3" /> Done</> : <><Pencil className="h-3 w-3" /> Customize</>}
        </button>
      </div>

      {/* Add Widget FAB — only in edit mode */}
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
