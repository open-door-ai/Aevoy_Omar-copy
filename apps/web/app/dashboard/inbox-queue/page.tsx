"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { 
  Inbox, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Mail, 
  Trash2, 
  Reply,
  Phone,
  AlertTriangle,
  ChevronLeft,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface QueueItem {
  id: string;
  from_address: string;
  from_name?: string;
  subject: string;
  body_text: string;
  received_at: string;
  classification: string;
  confidence: number;
  suggested_action: string;
  suggested_response?: string;
  reasoning: string;
  status: "pending" | "approved" | "rejected" | "modified";
  created_at: string;
}

export default function InboxQueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [modifiedResponse, setModifiedResponse] = useState<Record<string, string>>({});
  const router = useRouter();

  useEffect(() => {
    loadQueue();
  }, [activeTab]);

  const loadQueue = async () => {
    try {
      const res = await fetch(`/api/inbox/queue?status=${activeTab}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue);
      }
    } catch (err) {
      console.error("Failed to load queue:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (itemId: string, decision: "approved" | "rejected" | "modified") => {
    try {
      const res = await fetch("/api/inbox/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueId: itemId,
          decision,
          modifiedResponse: decision === "modified" ? modifiedResponse[itemId] : undefined,
        }),
      });

      if (res.ok) {
        // Remove from current view
        setQueue(queue.filter(item => item.id !== itemId));
      }
    } catch (err) {
      console.error("Failed to update:", err);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "delete": return Trash2;
      case "respond": return Reply;
      case "schedule": return Clock;
      case "call": return Phone;
      default: return Mail;
    }
  };

  const getClassificationColor = (classification: string) => {
    switch (classification) {
      case "spam": return "bg-red-100 text-red-700";
      case "urgent": return "bg-red-100 text-red-700";
      case "simple": return "bg-green-100 text-green-700";
      case "meeting": return "bg-blue-100 text-blue-700";
      case "complex": return "bg-purple-100 text-purple-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard/settings">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Email Queue</h1>
          <p className="text-gray-600">
            Review emails your AI queued for your approval
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="w-4 h-4" />
            Pending
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-2">
            <CheckCircle className="w-4 h-4" />
            Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-2">
            <XCircle className="w-4 h-4" />
            Rejected
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          {queue.length === 0 ? (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No pending emails</h3>
                <p className="text-gray-500 mt-1">
                  Your AI is handling emails based on your autonomy settings.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {queue.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                >
                  <Card className={`border-l-4 ${
                    item.classification === "urgent" ? "border-l-red-500" : "border-l-blue-500"
                  }`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{item.from_address}</span>
                            <Badge className={getClassificationColor(item.classification)}>
                              {item.classification}
                            </Badge>
                            {item.confidence > 0.8 && (
                              <Badge variant="outline" className="text-green-600">
                                High confidence
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">{item.subject}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Received {formatDate(item.received_at)}
                          </p>
                        </div>
                        <button
                          onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                          className="p-2 hover:bg-gray-100 rounded-lg"
                        >
                          {expandedItem === item.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </CardHeader>

                    <AnimatePresence>
                      {expandedItem === item.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                        >
                          <CardContent className="pt-0 space-y-4">
                            {/* Email Body */}
                            <div className="bg-gray-50 p-4 rounded-lg text-sm">
                              <p className="whitespace-pre-wrap line-clamp-10">
                                {item.body_text}
                              </p>
                            </div>

                            {/* AI Analysis */}
                            <div className="bg-blue-50 p-4 rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-blue-600" />
                                <span className="font-medium text-blue-900">AI Analysis</span>
                              </div>
                              <p className="text-sm text-blue-800">{item.reasoning}</p>
                              
                              {item.suggested_response && (
                                <div className="mt-3">
                                  <p className="text-xs font-medium text-blue-700 mb-1">
                                    Suggested Response:
                                  </p>
                                  <Textarea
                                    value={modifiedResponse[item.id] ?? item.suggested_response}
                                    onChange={(e) => setModifiedResponse({
                                      ...modifiedResponse,
                                      [item.id]: e.target.value
                                    })}
                                    className="text-sm bg-white"
                                    rows={4}
                                  />
                                </div>
                              )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              <Button
                                onClick={() => handleDecision(item.id, "approved")}
                                className="flex-1 bg-green-600 hover:bg-green-700"
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Approve
                              </Button>
                              {item.suggested_response && (
                                <Button
                                  onClick={() => handleDecision(item.id, "modified")}
                                  variant="outline"
                                  className="flex-1"
                                >
                                  Send Edited
                                </Button>
                              )}
                              <Button
                                onClick={() => handleDecision(item.id, "rejected")}
                                variant="outline"
                                className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                              >
                                <XCircle className="w-4 h-4 mr-2" />
                                Reject
                              </Button>
                            </div>
                          </CardContent>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {!expandedItem && (
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          {(() => {
                            const Icon = getActionIcon(item.suggested_action);
                            return <Icon className="w-4 h-4" />;
                          })()}
                          <span className="capitalize">{item.suggested_action.replace("_", " ")}</span>
                          <span className="text-gray-300">•</span>
                          <span>Click to review</span>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="approved" className="mt-6">
          {queue.length === 0 ? (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No approved emails</h3>
                <p className="text-gray-500 mt-1">
                  Emails you approve will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {queue.map((item) => (
                <Card key={item.id} className="border-l-4 border-l-green-500">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="font-medium">{item.subject}</span>
                    </div>
                    <p className="text-sm text-gray-500">{item.from_address}</p>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="rejected" className="mt-6">
          {queue.length === 0 ? (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <XCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No rejected emails</h3>
                <p className="text-gray-500 mt-1">
                  Emails you reject will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {queue.map((item) => (
                <Card key={item.id} className="border-l-4 border-l-red-500">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <XCircle className="w-5 h-5 text-red-500" />
                      <span className="font-medium">{item.subject}</span>
                    </div>
                    <p className="text-sm text-gray-500">{item.from_address}</p>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
