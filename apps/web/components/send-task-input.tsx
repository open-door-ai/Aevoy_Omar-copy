"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Send, Loader2 } from "lucide-react";

const PLACEHOLDERS = [
  "Book a restaurant, research competitors, draft an email...",
  "Cancel that subscription you forgot about...",
  "Find out why your flight is always delayed...",
  "Do that thing you've been putting off since Tuesday...",
  "Find the best laptop under $1000...",
];

export function SendTaskInput() {
  const [taskText, setTaskText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskText.trim() || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: taskText.trim(),
          body: taskText.trim(),
        }),
      });

      if (response.ok) {
        toast.success("Task submitted successfully");
        setTaskText("");
      } else {
        const data = await response.json();
        toast.error(data.message || "Failed to submit task");
      }
    } catch {
      toast.error("Failed to submit task. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative rounded-2xl border border-border bg-card shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-primary/30 transition-all duration-200">
        <textarea
          placeholder={placeholder}
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (taskText.trim() && !submitting) {
                handleSubmit(e);
              }
            }
          }}
          rows={2}
          className="w-full resize-none bg-transparent px-5 pt-5 pb-14 text-base placeholder:text-muted-foreground/60 focus:outline-none"
          disabled={submitting}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground/40 hidden sm:block">
            Enter to send
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !taskText.trim()}
            className="rounded-xl px-4 h-9"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="ml-2">Send</span>
          </Button>
        </div>
      </div>
    </form>
  );
}
