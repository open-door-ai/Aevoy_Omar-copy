"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle, Clock, Shield, DollarSign, Trash2, Share2, XCircle, AlertTriangle } from "lucide-react";

interface ExecutionPlan {
  id: string;
  goal: string;
  estimatedSteps: number;
  estimatedDuration: number;
  estimatedCost: number;
  highStakes: {
    spendingMoney: boolean;
    cancelingSubscription: boolean;
    deletingAccount: boolean;
    sharingPersonalInfo: boolean;
    amount?: number;
  };
  requiredAuth: Array<{
    service: string;
    status: "ready" | "missing" | "needs_refresh";
    instructions?: string;
  }>;
  anticipatedObstacles: Array<{
    type: string;
    probability: number;
    mitigation: string;
  }>;
  alternativePaths: Array<{
    name: string;
    description: string;
  }>;
  steps: Array<{
    order: number;
    type: string;
    description: string;
  }>;
  status: string;
}

export default function PlanConfirmationPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;
  
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [modifications, setModifications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadPlan();
  }, [planId]);

  async function loadPlan() {
    try {
      const { data, error } = await supabase
        .from("execution_plans")
        .select("*")
        .eq("id", planId)
        .single();

      if (error) throw error;
      setPlan(data as ExecutionPlan);
    } catch (err) {
      setError("Failed to load plan");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/plan/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "yes" }),
      });

      if (!response.ok) throw new Error("Failed to confirm");
      
      router.push("/dashboard?status=executing");
    } catch (err) {
      setError("Failed to confirm plan");
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setSubmitting(true);
    try {
      await fetch("/api/plan/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "no" }),
      });
      
      router.push("/dashboard?status=cancelled");
    } catch (err) {
      setError("Failed to cancel");
      setSubmitting(false);
    }
  }

  async function handleModify() {
    if (!modifications.trim()) return;
    
    setSubmitting(true);
    try {
      await fetch("/api/plan/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, action: "modify", modifications }),
      });
      
      router.refresh();
    } catch (err) {
      setError("Failed to modify");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <p>Plan not found or already processed</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasHighStakes = plan.highStakes.spendingMoney || 
                        plan.highStakes.cancelingSubscription || 
                        plan.highStakes.deletingAccount || 
                        plan.highStakes.sharingPersonalInfo;

  const missingAuth = plan.requiredAuth.filter(a => a.status !== "ready");

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Review Plan</h1>
        <p className="text-gray-600">
          The AI has analyzed your request and created an execution plan.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* High Stakes Warning */}
      {hasHighStakes && (
        <Card className="mb-6 border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800">
              <AlertTriangle className="w-5 h-5" />
              High-Stakes Actions Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plan.highStakes.spendingMoney && (
                <div className="flex items-center gap-2 text-orange-700">
                  <DollarSign className="w-4 h-4" />
                  Spending {plan.highStakes.amount ? `$${plan.highStakes.amount}` : "money"}
                </div>
              )}
              {plan.highStakes.cancelingSubscription && (
                <div className="flex items-center gap-2 text-orange-700">
                  <XCircle className="w-4 h-4" />
                  Canceling subscription
                </div>
              )}
              {plan.highStakes.deletingAccount && (
                <div className="flex items-center gap-2 text-orange-700">
                  <Trash2 className="w-4 h-4" />
                  Deleting account
                </div>
              )}
              {plan.highStakes.sharingPersonalInfo && (
                <div className="flex items-center gap-2 text-orange-700">
                  <Share2 className="w-4 h-4" />
                  Sharing personal information
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Missing Auth */}
      {missingAuth.length > 0 && (
        <Card className="mb-6 border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-800">
              <Shield className="w-5 h-5" />
              Authentication Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {missingAuth.map((auth, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg">
                  <span className="font-medium">{auth.service}</span>
                  <Badge variant="secondary">{auth.status}</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-yellow-700">
              Please sign in to these services first, or the AI will ask for credentials during execution.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Plan Overview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{plan.goal}</CardTitle>
          <CardDescription>
            <div className="flex flex-wrap gap-4 mt-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                ~{plan.estimatedDuration} min
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <CheckCircle className="w-4 h-4" />
                {plan.estimatedSteps} steps
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <DollarSign className="w-4 h-4" />
                ~${plan.estimatedCost.toFixed(2)}
              </div>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Execution Steps</h3>
              <div className="space-y-2">
                {plan.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-200 rounded-full text-sm font-medium">
                      {step.order}
                    </span>
                    <div>
                      <p className="font-medium capitalize">{step.type}</p>
                      <p className="text-sm text-gray-600">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {plan.anticipatedObstacles.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Anticipated Obstacles</h3>
                <div className="space-y-2">
                  {plan.anticipatedObstacles.map((obs, i) => (
                    <div key={i} className="p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-blue-900">{obs.type}</span>
                        <Badge variant="outline" className="text-blue-700">
                          {Math.round(obs.probability * 100)}% chance
                        </Badge>
                      </div>
                      <p className="text-sm text-blue-700">{obs.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plan.alternativePaths.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Alternative Paths</h3>
                <div className="space-y-2">
                  {plan.alternativePaths.map((alt, i) => (
                    <div key={i} className="p-3 bg-gray-50 rounded-lg">
                      <p className="font-medium">{alt.name}</p>
                      <p className="text-sm text-gray-600">{alt.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Confirm Execution</CardTitle>
          <CardDescription>
            The AI will execute this plan autonomously with 99th percentile quality verification.
            You can modify the plan or cancel if needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Modifications (optional)
              </label>
              <Textarea
                placeholder="E.g., 'Don't spend more than $50', 'Use my business account', etc."
                value={modifications}
                onChange={(e) => setModifications(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 min-w-[140px]"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Execute Plan
              </>
            )}
          </Button>

          {modifications.trim() && (
            <Button
              variant="outline"
              onClick={handleModify}
              disabled={submitting}
              className="flex-1 min-w-[140px]"
            >
              Update & Re-plan
            </Button>
          )}

          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={submitting}
            className="flex-1 min-w-[140px]"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
