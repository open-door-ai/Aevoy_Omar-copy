"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Send, Loader2 } from "lucide-react";

export function SendTaskInput() {
  const [taskText, setTaskText] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
    <Card>
      <CardContent className="pt-4 pb-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <Input
            placeholder="Tell your AI what to do..."
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            className="flex-1"
            disabled={submitting}
          />
          <Button
            type="submit"
            disabled={submitting || !taskText.trim()}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="ml-2 hidden sm:inline">Send</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
