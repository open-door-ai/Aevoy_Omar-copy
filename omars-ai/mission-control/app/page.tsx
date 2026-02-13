'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Monitor, ListTodo, FileText, Mic, Phone, Camera, Sparkles, Send, Settings, Bell, Zap, Calendar, Mail, Globe, Code, Database, Cpu, Activity, Clock, CheckCircle2, XCircle, AlertCircle, Loader2, TrendingUp, Users, Shield, Terminal, BookOpen } from 'lucide-react';
import { GlassCard } from '@/components/glass-card';
import { springs, staggerDelay } from '@/lib/springs';
import VisionFeed from '@/components/vision-feed';
import { useSSE } from '@/lib/hooks/use-sse';

type Tab = 'conversation' | 'browser' | 'queue' | 'logs';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
}

interface Shortcut {
  id: string;
  label: string;
  icon: any;
  description: string;
  action: () => void;
}

const tabs = [
  { id: 'conversation' as Tab, label: 'Conversation', icon: MessageSquare },
  { id: 'browser' as Tab, label: 'Live Browser', icon: Monitor },
  { id: 'queue' as Tab, label: 'Task Queue', icon: ListTodo },
  { id: 'logs' as Tab, label: 'System Logs', icon: FileText },
];

const activityTypes = [
  { type: 'task_completed', icon: CheckCircle2, color: 'text-green-400' },
  { type: 'task_failed', icon: XCircle, color: 'text-red-400' },
  { type: 'task_started', icon: Loader2, color: 'text-blue-400' },
  { type: 'email_received', icon: Mail, color: 'text-purple-400' },
  { type: 'browser_action', icon: Globe, color: 'text-cyan-400' },
];

export default function MissionControl() {
  const [activeTab, setActiveTab] = useState<Tab>('conversation');
  const { currentTask, queue, stats, presence, connected } = useSSE();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hi Omar! I'm your AI co-pilot. I can browse the web, manage your email, control your browser, and automate tasks. What can I help you with?",
      timestamp: new Date(),
    }
  ]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  const shortcuts: Shortcut[] = [
    {
      id: 'email',
      label: 'Check Email',
      icon: Mail,
      description: 'Scan inbox for important messages',
      action: () => handleShortcut('Check my email for anything urgent'),
    },
    {
      id: 'calendar',
      label: 'Today\'s Schedule',
      icon: Calendar,
      description: 'Review calendar events',
      action: () => handleShortcut('What\'s on my calendar today?'),
    },
    {
      id: 'research',
      label: 'Research Mode',
      icon: BookOpen,
      description: 'Deep dive research assistant',
      action: () => handleShortcut('Start research mode'),
    },
    {
      id: 'code',
      label: 'Code Review',
      icon: Code,
      description: 'Review latest commits',
      action: () => handleShortcut('Review my latest code changes'),
    },
  ];

  const handleShortcut = async (query: string) => {
    setInput(query);
    setTimeout(() => handleSubmit(), 100);
  };

  const handleSubmit = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
      status: 'sending',
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = input;
    setInput('');

    try {
      const res = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: messageText }),
      });

      if (res.ok) {
        setMessages(prev => prev.map(m =>
          m.id === userMessage.id ? { ...m, status: 'sent' } : m
        ));

        const data = await res.json();

        // Add AI response
        const aiMessage: Message = {
          id: Date.now().toString() + '-ai',
          role: 'assistant',
          content: data.message || 'Task submitted successfully! Processing now...',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, aiMessage]);

        // Add to activity
        setRecentActivity(prev => [{
          type: 'task_started',
          message: messageText,
          timestamp: new Date(),
        }, ...prev].slice(0, 10));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === userMessage.id ? { ...m, status: 'error' } : m
        ));
      }
    } catch (error) {
      console.error('[UI] Failed to submit task:', error);
      setMessages(prev => prev.map(m =>
        m.id === userMessage.id ? { ...m, status: 'error' } : m
      ));
    }
  };

  const handleVoice = () => {
    setIsVoiceActive(!isVoiceActive);
    if (!isVoiceActive) {
      setRecentActivity(prev => [{
        type: 'browser_action',
        message: 'Voice session started',
        timestamp: new Date(),
      }, ...prev].slice(0, 10));
    }
  };

  const handleCall = () => {
    window.open('tel:+17789008951');
    setRecentActivity(prev => [{
      type: 'task_started',
      message: 'Phone call initiated',
      timestamp: new Date(),
    }, ...prev].slice(0, 10));
  };

  const handleScreenshot = async () => {
    setRecentActivity(prev => [{
      type: 'browser_action',
      message: 'Screenshot captured',
      timestamp: new Date(),
    }, ...prev].slice(0, 10));
  };

  return (
    <div className="h-screen w-screen bg-background overflow-hidden flex flex-col">
      {/* Header */}
      <header className="glass border-b border-white/10 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Mission Control</h1>
              <p className="text-xs text-secondary-text">Omar's AI Co-Pilot</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Quick Stats */}
            <div className="flex items-center gap-4 px-4 py-2 rounded-xl bg-white/5">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium">{stats?.processing || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium">{stats?.completed || 0}</span>
              </div>
            </div>

            {/* Notifications */}
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 hover:bg-white/10 rounded-lg transition-all"
            >
              <Bell className="w-5 h-5" />
              {recentActivity.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-xs flex items-center justify-center">
                  {recentActivity.length}
                </span>
              )}
            </button>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-error'}`} />
              <span className="text-sm text-secondary-text">{connected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Notifications Dropdown */}
      <AnimatePresence>
        {showNotifications && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 right-6 z-50"
          >
            <GlassCard className="w-80 p-4">
              <h3 className="font-semibold mb-3">Recent Activity</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {recentActivity.length > 0 ? recentActivity.map((activity, i) => {
                  const ActivityIcon = activityTypes.find(t => t.type === activity.type)?.icon || Activity;
                  const iconColor = activityTypes.find(t => t.type === activity.type)?.color || 'text-gray-400';

                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-white/5"
                    >
                      <ActivityIcon className={`w-4 h-4 mt-0.5 ${iconColor}`} />
                      <div className="flex-1">
                        <p className="text-sm">{activity.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(activity.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </motion.div>
                  );
                }) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Layout */}
      <div className="flex-1 grid grid-cols-[320px_1fr_320px] gap-4 p-4 min-h-0">
        {/* Left Sidebar */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Vision Feed */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.1 }}
            className="h-64"
          >
            <VisionFeed />
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.2 }}
          >
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={handleVoice}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    isVoiceActive
                      ? 'bg-red-500/20 border border-red-500/30'
                      : 'hover:bg-white/10 dark:hover:bg-white/5'
                  }`}
                >
                  <Mic className={`w-4 h-4 ${isVoiceActive ? 'text-red-400' : 'text-brand'}`} />
                  <span className="text-sm">{isVoiceActive ? 'Stop Voice' : 'Start Voice'}</span>
                </button>
                <button
                  onClick={handleCall}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 dark:hover:bg-white/5 transition-all text-left"
                >
                  <Phone className="w-4 h-4 text-brand" />
                  <span className="text-sm">Call AI</span>
                </button>
                <button
                  onClick={handleScreenshot}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 dark:hover:bg-white/5 transition-all text-left"
                >
                  <Camera className="w-4 h-4 text-brand" />
                  <span className="text-sm">Screenshot</span>
                </button>
              </div>
            </GlassCard>
          </motion.div>

          {/* Shortcuts */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.3 }}
            className="flex-1 min-h-0"
          >
            <GlassCard className="p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Shortcuts</h3>
                <Zap className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="grid grid-cols-2 gap-2 overflow-y-auto">
                {shortcuts.map((shortcut, i) => (
                  <motion.button
                    key={shortcut.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={shortcut.action}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left group"
                  >
                    <shortcut.icon className="w-5 h-5 mb-2 text-brand group-hover:scale-110 transition-transform" />
                    <p className="text-xs font-medium">{shortcut.label}</p>
                  </motion.button>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>

        {/* Center - Tabbed Content */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Tab Bar */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.default}
          >
            <GlassCard className="p-2">
              <div className="flex gap-2">
                {tabs.map((tab, i) => (
                  <motion.button
                    key={tab.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...springs.default, delay: staggerDelay(i) }}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                      activeTab === tab.id
                        ? 'bg-white/10 text-foreground shadow-lg'
                        : 'text-muted-foreground hover:bg-white/5'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    <span className="text-sm">{tab.label}</span>
                  </motion.button>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0">
            <AnimatePresence mode="wait">
              {activeTab === 'conversation' && (
                <motion.div
                  key="conversation"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={springs.default}
                  className="h-full flex flex-col"
                >
                  <GlassCard className="flex-1 flex flex-col p-6 min-h-0">
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto pr-4 space-y-4">
                      {messages.map((message, i) => (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...springs.default, delay: i * 0.05 }}
                          className={`flex ${message.role === 'user' ? 'justify-end' : 'items-start gap-3'}`}
                        >
                          {message.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                              <Sparkles className="w-4 h-4 text-white" />
                            </div>
                          )}
                          <div className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                            message.role === 'user'
                              ? 'bg-brand text-white'
                              : 'bg-white/10 dark:bg-white/5 backdrop-blur-lg'
                          }`}>
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs opacity-70">
                                {message.timestamp.toLocaleTimeString()}
                              </span>
                              {message.status && message.role === 'user' && (
                                <span className="text-xs">
                                  {message.status === 'sending' && <Loader2 className="w-3 h-3 animate-spin inline" />}
                                  {message.status === 'sent' && <CheckCircle2 className="w-3 h-3 text-green-400 inline" />}
                                  {message.status === 'error' && <XCircle className="w-3 h-3 text-red-400 inline" />}
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Input */}
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <div className="flex items-end gap-3">
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit();
                            }
                          }}
                          placeholder="What can I help you with?"
                          className="flex-1 resize-none rounded-2xl bg-white/5 border border-white/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand min-h-[44px] max-h-32"
                          rows={1}
                        />
                        <button
                          onClick={handleSubmit}
                          disabled={!input.trim()}
                          className="rounded-full bg-brand p-3 disabled:opacity-50 hover:bg-brand-light transition-all disabled:cursor-not-allowed"
                        >
                          <Send className="w-5 h-5 text-white" />
                        </button>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {activeTab === 'browser' && (
                <motion.div
                  key="browser"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={springs.default}
                  className="h-full"
                >
                  <GlassCard className="h-full p-6 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <Monitor className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-sm">No active browser session</p>
                      <p className="text-xs mt-2">Browser view will appear when automating tasks</p>
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {activeTab === 'queue' && (
                <motion.div
                  key="queue"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={springs.default}
                  className="h-full"
                >
                  <GlassCard className="h-full p-6 overflow-y-auto">
                    <h2 className="text-lg font-semibold mb-4">Task Queue</h2>
                    <div className="text-center text-muted-foreground py-12">
                      <ListTodo className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-sm">No tasks in queue</p>
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {activeTab === 'logs' && (
                <motion.div
                  key="logs"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={springs.default}
                  className="h-full"
                >
                  <GlassCard className="h-full p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold">System Logs</h2>
                      <Terminal className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="font-mono text-xs space-y-1 text-muted-foreground">
                      <p>[{new Date().toISOString()}] Mission Control initialized</p>
                      <p>[{new Date().toISOString()}] Connected to Gateway</p>
                      <p>[{new Date().toISOString()}] System ready</p>
                    </div>
                  </GlassCard>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.1 }}
          >
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold mb-4">Today's Activity</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 rounded-xl bg-green-500/10">
                  <div className="text-2xl font-bold text-success">{stats?.completed || 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">Completed</div>
                </div>
                <div className="text-center p-3 rounded-xl bg-red-500/10">
                  <div className="text-2xl font-bold text-error">{stats?.failed || 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">Failed</div>
                </div>
                <div className="text-center p-3 rounded-xl bg-blue-500/10">
                  <div className="text-2xl font-bold text-info">{stats?.processing || 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">Active</div>
                </div>
                <div className="text-center p-3 rounded-xl bg-yellow-500/10">
                  <div className="text-2xl font-bold text-warning">{stats?.pending || 0}</div>
                  <div className="text-xs text-muted-foreground mt-1">Queued</div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* System Health */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.2 }}
          >
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">System Health</h3>
                <Shield className="w-4 h-4 text-green-400" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gateway</span>
                  <span className="text-green-400">✓ Online</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Core Agent</span>
                  <span className="text-green-400">✓ Online</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Vision</span>
                  <span className="text-yellow-400">○ Standby</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Performance */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springs.default, delay: 0.3 }}
            className="flex-1 min-h-0"
          >
            <GlassCard className="p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Performance</h3>
                <TrendingUp className="w-4 h-4 text-brand" />
              </div>
              <div className="space-y-3 flex-1 overflow-y-auto">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Success Rate</span>
                    <span className="font-medium">98%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-green-400 w-[98%]" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Avg Response</span>
                    <span className="font-medium">1.2s</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 w-[85%]" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">CPU Usage</span>
                    <span className="font-medium">24%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-400 w-[24%]" />
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
