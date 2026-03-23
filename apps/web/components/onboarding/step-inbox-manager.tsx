"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, GlassCard, motion, springs } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { Mail, Bell, Trash2, Calendar, Phone, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

interface StepInboxManagerProps {
  onNext: (data: {
    autonomyLevel: number;
    enabled: boolean;
    aiSignatureEnabled: boolean;
    aiSignatureText: string;
    userRules: string[];
    monitorInbox: boolean;
    deleteSpam: boolean;
    respondToSimple: boolean;
    scheduleMeetings: boolean;
    callForComplex: boolean;
  }) => void;
  onBack: () => void;
  onSkip: () => void;
  botName?: string;
}

const autonomyPresets = [
  {
    level: 0,
    label: "Notify Only",
    description: "I'll watch your inbox and tell you about important emails, but won't take any action.",
    icon: Bell,
    color: "bg-slate-100 text-slate-600",
  },
  {
    level: 25,
    label: "Handle Simple Stuff",
    description: "I'll delete obvious spam and organize newsletters, but ask you about everything else.",
    icon: Trash2,
    color: "bg-blue-100 text-blue-600",
  },
  {
    level: 50,
    label: "Most Emails",
    description: "I'll respond to routine emails, schedule meetings, and handle common requests. I'll queue anything complex for your approval.",
    icon: Mail,
    color: "bg-indigo-100 text-indigo-600",
  },
  {
    level: 75,
    label: "High Autonomy",
    description: "I'll handle almost everything. I'll only call you for truly important or complex decisions.",
    icon: Calendar,
    color: "bg-violet-100 text-violet-600",
  },
  {
    level: 100,
    label: "Full Autonomy",
    description: "I run your inbox completely. I'll make decisions on your behalf and learn from your feedback over time.",
    icon: Sparkles,
    color: "bg-amber-100 text-amber-600",
  },
];

export default function StepInboxManager({ 
  onNext, 
  onBack, 
  onSkip, 
  botName = "your AI assistant" 
}: StepInboxManagerProps) {
  const [autonomyLevel, setAutonomyLevel] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiSignatureEnabled, setAiSignatureEnabled] = useState(true);
  const [aiSignatureText, setAiSignatureText] = useState(`Sent by ${botName}, your Aurora assistant`);
  const [userRules, setUserRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  
  // Derived settings from autonomy level
  const [settings, setSettings] = useState({
    monitorInbox: false,
    deleteSpam: false,
    respondToSimple: false,
    scheduleMeetings: false,
    callForComplex: false,
  });

  // Update derived settings when autonomy level changes
  useEffect(() => {
    setSettings({
      monitorInbox: autonomyLevel >= 0,
      deleteSpam: autonomyLevel >= 25,
      respondToSimple: autonomyLevel >= 50,
      scheduleMeetings: autonomyLevel >= 50,
      callForComplex: autonomyLevel >= 75,
    });
  }, [autonomyLevel]);

  const currentPreset = autonomyPresets.find(p => p.level === autonomyLevel) || autonomyPresets[0];
  const Icon = currentPreset.icon;

  const handleAddRule = () => {
    if (newRule.trim() && !userRules.includes(newRule.trim())) {
      setUserRules([...userRules, newRule.trim()]);
      setNewRule("");
    }
  };

  const handleRemoveRule = (rule: string) => {
    setUserRules(userRules.filter(r => r !== rule));
  };

  const handleContinue = () => {
    onNext({
      autonomyLevel,
      enabled,
      aiSignatureEnabled,
      aiSignatureText,
      userRules,
      ...settings,
    });
  };

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 mb-4">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Let {botName} Manage Your Inbox
          </h2>
          <p className="text-gray-600">
            Your AI can read, organize, and respond to emails on your behalf. 
            You control how much autonomy to give.
          </p>
        </div>
      </FadeIn>

      {/* Enable Toggle */}
      <FadeIn delay={0.1} className="w-full mb-8">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Enable Inbox Management</h3>
              <p className="text-sm text-gray-500">
                {enabled 
                  ? `${botName} will monitor your inbox every 5 minutes`
                  : "Your emails stay private - AI won't access them"
                }
              </p>
            </div>
            <Switch 
              checked={enabled} 
              onCheckedChange={setEnabled}
              className="data-[state=checked]:bg-blue-600"
            />
          </div>
        </GlassCard>
      </FadeIn>

      {enabled && (
        <>
          {/* Autonomy Slider */}
          <FadeIn delay={0.2} className="w-full mb-8">
            <GlassCard className="p-6">
              <Label className="text-sm font-medium text-gray-700 mb-4 block">
                How much autonomy should {botName} have?
              </Label>
              
              {/* Slider */}
              <div className="relative mb-6">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="25"
                  value={autonomyLevel}
                  onChange={(e) => setAutonomyLevel(parseInt(e.target.value))}
                  className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  style={{
                    background: `linear-gradient(to right, #2563eb 0%, #2563eb ${autonomyLevel}%, #e5e7eb ${autonomyLevel}%, #e5e7eb 100%)`
                  }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span>Notify</span>
                  <span>Simple</span>
                  <span>Most</span>
                  <span>High</span>
                  <span>Full</span>
                </div>
              </div>

              {/* Current Level Display */}
              <motion.div 
                key={autonomyLevel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.micro}
                className={`p-4 rounded-xl ${currentPreset.color} bg-opacity-50`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-white/50">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold">{currentPreset.label}</h4>
                    <p className="text-sm opacity-90 mt-1">{currentPreset.description}</p>
                  </div>
                </div>
              </motion.div>
            </GlassCard>
          </FadeIn>

          {/* What This Means */}
          <FadeIn delay={0.3} className="w-full mb-8">
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <h4 className="font-medium text-gray-900 text-sm">What {botName} will do:</h4>
              <div className="space-y-2">
                <div className={`flex items-center gap-3 text-sm ${settings.monitorInbox ? 'text-gray-700' : 'text-gray-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${settings.monitorInbox ? 'bg-green-100 text-green-600' : 'bg-gray-200'}`}>
                    {settings.monitorInbox ? '✓' : '○'}
                  </div>
                  Monitor your inbox for new emails
                </div>
                <div className={`flex items-center gap-3 text-sm ${settings.deleteSpam ? 'text-gray-700' : 'text-gray-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${settings.deleteSpam ? 'bg-green-100 text-green-600' : 'bg-gray-200'}`}>
                    {settings.deleteSpam ? '✓' : '○'}
                  </div>
                  Delete obvious spam and promotions
                </div>
                <div className={`flex items-center gap-3 text-sm ${settings.respondToSimple ? 'text-gray-700' : 'text-gray-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${settings.respondToSimple ? 'bg-green-100 text-green-600' : 'bg-gray-200'}`}>
                    {settings.respondToSimple ? '✓' : '○'}
                  </div>
                  Respond to simple emails automatically
                </div>
                <div className={`flex items-center gap-3 text-sm ${settings.scheduleMeetings ? 'text-gray-700' : 'text-gray-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${settings.scheduleMeetings ? 'bg-green-100 text-green-600' : 'bg-gray-200'}`}>
                    {settings.scheduleMeetings ? '✓' : '○'}
                  </div>
                  Schedule meetings and add to calendar
                </div>
                <div className={`flex items-center gap-3 text-sm ${settings.callForComplex ? 'text-gray-700' : 'text-gray-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${settings.callForComplex ? 'bg-green-100 text-green-600' : 'bg-gray-200'}`}>
                    {settings.callForComplex ? '✓' : '○'}
                  </div>
                  Call you for complex or important decisions
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Advanced Settings Toggle */}
          <FadeIn delay={0.4} className="w-full mb-6">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Advanced Settings
            </button>
          </FadeIn>

          {/* Advanced Settings */}
          {showAdvanced && (
            <FadeIn className="w-full mb-8 space-y-4">
              {/* AI Signature */}
              <GlassCard className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="font-medium">AI Signature</Label>
                  <Switch
                    checked={aiSignatureEnabled}
                    onCheckedChange={setAiSignatureEnabled}
                  />
                </div>
                {aiSignatureEnabled && (
                  <Input
                    value={aiSignatureText}
                    onChange={(e) => setAiSignatureText(e.target.value)}
                    placeholder="How should I sign off?"
                    className="text-sm"
                  />
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Added to emails I send on your behalf
                </p>
              </GlassCard>

              {/* User Rules */}
              <GlassCard className="p-4">
                <Label className="font-medium block mb-2">Special Instructions</Label>
                <p className="text-xs text-gray-500 mb-3">
                  Tell me how to handle specific situations. I&apos;ll learn from these over time.
                </p>
                <div className="space-y-2 mb-3">
                  {userRules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg text-sm">
                      <span className="flex-1">{rule}</span>
                      <button 
                        onClick={() => handleRemoveRule(rule)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    placeholder="E.g., Always forward emails from my boss to me immediately"
                    className="text-sm flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                  />
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleAddRule}
                    disabled={!newRule.trim()}
                  >
                    Add
                  </Button>
                </div>
              </GlassCard>
            </FadeIn>
          )}
        </>
      )}

      {/* Navigation */}
      <FadeIn delay={0.5} className="w-full">
        <div className="flex gap-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button variant="ghost" onClick={onSkip} className="px-6">
            Skip for now
          </Button>
          <Button 
            onClick={handleContinue} 
            className="flex-1 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700"
          >
            {enabled ? 'Enable Inbox Manager' : 'Continue'}
          </Button>
        </div>
      </FadeIn>
    </div>
  );
}
