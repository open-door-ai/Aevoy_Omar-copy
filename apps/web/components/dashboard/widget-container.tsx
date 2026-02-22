"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { WIDGET_BY_ID } from "@/lib/widgets/registry";
import { motion, AnimatePresence } from "framer-motion";

interface WidgetContainerProps {
  item: WidgetLayoutItem;
  onRemove: (id: string) => void;
  children: React.ReactNode;
  isEditing: boolean;
}

export function WidgetContainer({ item, onRemove, children, isEditing }: WidgetContainerProps) {
  const [showMenu, setShowMenu] = useState(false);
  const def = WIDGET_BY_ID.get(item.widgetId);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group min-w-0">
      {isEditing && (
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.005, 0.998, 1.002, 1] }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="absolute inset-0 z-10 rounded-xl ring-2 ring-primary/30 pointer-events-none"
        />
      )}

      {isEditing && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing bg-background/90 backdrop-blur-sm border border-border rounded-md p-1 shadow-sm hover:bg-muted transition-colors"
            title="Drag to reorder"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {isEditing && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="bg-background/90 backdrop-blur-sm border border-border rounded-md p-1 shadow-sm hover:bg-muted transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute right-0 top-8 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[120px] z-30"
                >
                  <button
                    onClick={() => { onRemove(item.id); setShowMenu(false); }}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 w-full text-left transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className={isEditing ? "pt-8 pointer-events-none" : ""}>{children}</div>

      {!isEditing && def && (
        <div className="absolute top-2 right-2 z-10 hidden md:block opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-muted-foreground/50 bg-background/50 px-1 rounded">{def.name}</span>
        </div>
      )}
    </div>
  );
}
