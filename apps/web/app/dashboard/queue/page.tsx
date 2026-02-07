'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Eye,
  Trash2,
  Filter,
  Search,
  ChevronRight,
  Monitor,
  Smartphone,
  Laptop,
  Globe,
  Zap,
  Brain,
  Target,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface QueueTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  progress: number;
  estimatedTime: string;
  assignedTo: 'ai' | 'browser' | 'human';
  device?: 'desktop' | 'mobile' | 'tablet';
  browserSession?: {
    url: string;
    screenshot?: string;
    active: boolean;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

const MOCK_TASKS: QueueTask[] = [
  {
    id: '1',
    title: 'Research market trends for Q1 2026',
    description: 'Analyze competitor data and market sentiment across 15 sources',
    status: 'running',
    priority: 'high',
    progress: 67,
    estimatedTime: '2m remaining',
    assignedTo: 'ai',
    device: 'desktop',
    createdAt: '2026-02-07T06:30:00Z',
    startedAt: '2026-02-07T06:35:00Z',
  },
  {
    id: '2',
    title: 'Book hotel for March trip',
    description: '4-star hotel in San Francisco, check-in March 15, checkout March 20',
    status: 'pending',
    priority: 'urgent',
    progress: 0,
    estimatedTime: '5m',
    assignedTo: 'browser',
    device: 'desktop',
    browserSession: {
      url: 'https://booking.com',
      active: false,
    },
    createdAt: '2026-02-07T06:40:00Z',
  },
  {
    id: '3',
    title: 'Update Q4 expense report',
    description: 'Categorize 47 transactions in Google Sheets',
    status: 'completed',
    priority: 'medium',
    progress: 100,
    estimatedTime: 'Done',
    assignedTo: 'ai',
    device: 'mobile',
    createdAt: '2026-02-07T05:00:00Z',
    startedAt: '2026-02-07T05:05:00Z',
    completedAt: '2026-02-07T05:12:00Z',
  },
  {
    id: '4',
    title: 'Schedule team standup for next week',
    description: 'Find common availability across 8 calendars',
    status: 'paused',
    priority: 'medium',
    progress: 34,
    estimatedTime: 'Paused',
    assignedTo: 'ai',
    device: 'tablet',
    createdAt: '2026-02-07T04:00:00Z',
    startedAt: '2026-02-07T04:10:00Z',
  },
  {
    id: '5',
    title: 'Download and summarize latest research papers',
    description: 'ArXiv search: "transformer attention mechanisms" (last 30 days)',
    status: 'failed',
    priority: 'low',
    progress: 15,
    estimatedTime: 'Failed',
    assignedTo: 'browser',
    device: 'desktop',
    createdAt: '2026-02-07T03:00:00Z',
    startedAt: '2026-02-07T03:05:00Z',
  },
];

export default function TaskQueuePage() {
  const [tasks, setTasks] = useState<QueueTask[]>(MOCK_TASKS);
  const [selectedTask, setSelectedTask] = useState<QueueTask | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showBrowserPortal, setShowBrowserPortal] = useState(false);

  const filteredTasks = tasks.filter((task) => {
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) || task.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const stats = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };

  const getStatusIcon = (status: QueueTask['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-400" />;
      case 'running':
        return <PlayCircle className="w-5 h-5 text-blue-400 animate-pulse" />;
      case 'paused':
        return <PauseCircle className="w-5 h-5 text-yellow-400" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      default:
        return <Circle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getPriorityColor = (priority: QueueTask['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'border-red-500/50 bg-red-500/5';
      case 'high':
        return 'border-orange-500/50 bg-orange-500/5';
      case 'medium':
        return 'border-blue-500/50 bg-blue-500/5';
      default:
        return 'border-gray-500/50 bg-gray-500/5';
    }
  };

  const getAssignedIcon = (assignedTo: QueueTask['assignedTo']) => {
    switch (assignedTo) {
      case 'ai':
        return <Brain className="w-4 h-4 text-purple-400" />;
      case 'browser':
        return <Globe className="w-4 h-4 text-blue-400" />;
      default:
        return <Target className="w-4 h-4 text-gray-400" />;
    }
  };

  const getDeviceIcon = (device?: QueueTask['device']) => {
    switch (device) {
      case 'mobile':
        return <Smartphone className="w-4 h-4 text-gray-400" />;
      case 'tablet':
        return <Laptop className="w-4 h-4 text-gray-400" />;
      default:
        return <Monitor className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 lg:p-8">
      <div className="max-w-[1920px] mx-auto">
        {/* Liquid Glass Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/10 via-white/5 to-transparent backdrop-blur-xl border border-white/20 p-6 md:p-8">
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-blue-500/10 to-pink-500/10" />

            <div className="relative z-10">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                Task Queue
              </h1>
              <p className="text-gray-400 text-sm md:text-base">
                Real-time orchestration of {tasks.length} autonomous tasks
              </p>

              {/* Stats Pills */}
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/20 border border-blue-500/30 backdrop-blur-sm">
                  <PlayCircle className="w-4 h-4 text-blue-400" />
                  <span className="text-white font-medium">{stats.running} Running</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-500/20 border border-gray-500/30 backdrop-blur-sm">
                  <Circle className="w-4 h-4 text-gray-400" />
                  <span className="text-white font-medium">{stats.pending} Pending</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30 backdrop-blur-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="text-white font-medium">{stats.completed} Done</span>
                </div>
                {stats.failed > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 border border-red-500/30 backdrop-blur-sm">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-white font-medium">{stats.failed} Failed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Task List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters & Search */}
            <div className="rounded-2xl bg-gradient-to-br from-white/10 via-white/5 to-transparent backdrop-blur-xl border border-white/20 p-4">
              <div className="flex flex-col md:flex-row gap-3">
                {/* Search */}
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks..."
                    className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                  />
                </div>

                {/* Status Filter */}
                <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                  {['all', 'running', 'pending', 'paused', 'completed', 'failed'].map((status) => (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(status)}
                      className={`px-4 py-2 rounded-xl font-medium whitespace-nowrap transition-all ${
                        filterStatus === status
                          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/50'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Task Cards */}
            <AnimatePresence mode="popLayout">
              {filteredTasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedTask(task)}
                  className={`relative overflow-hidden rounded-2xl border-2 ${getPriorityColor(
                    task.priority
                  )} backdrop-blur-xl cursor-pointer group hover:scale-[1.02] transition-all duration-300`}
                >
                  {/* Background gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="relative p-5 md:p-6">
                    <div className="flex items-start gap-4">
                      {/* Status Icon */}
                      <div className="flex-shrink-0 mt-1">{getStatusIcon(task.status)}</div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <h3 className="text-white font-semibold text-base md:text-lg group-hover:text-purple-300 transition-colors">
                            {task.title}
                          </h3>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {getAssignedIcon(task.assignedTo)}
                            {getDeviceIcon(task.device)}
                          </div>
                        </div>

                        <p className="text-gray-400 text-sm mb-4 line-clamp-2">{task.description}</p>

                        {/* Progress Bar */}
                        {task.status === 'running' || task.status === 'paused' ? (
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                              <span>Progress</span>
                              <span>{task.progress}%</span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${task.progress}%` }}
                                transition={{ duration: 0.5 }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {/* Footer */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            <span>{task.estimatedTime}</span>
                          </div>

                          <button className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-xs font-medium transition-colors">
                            View Details
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {filteredTasks.length === 0 && (
              <div className="text-center py-12 rounded-2xl bg-white/5 border border-white/10">
                <Filter className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No tasks match your filters</p>
              </div>
            )}
          </div>

          {/* Right Panel - Task Details & Browser Portal */}
          <div className="space-y-4">
            <AnimatePresence mode="wait">
              {selectedTask ? (
                <motion.div
                  key={selectedTask.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="rounded-2xl bg-gradient-to-br from-white/10 via-white/5 to-transparent backdrop-blur-xl border border-white/20 p-6 sticky top-6"
                >
                  <h2 className="text-xl font-bold text-white mb-4">Task Details</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wider">Title</label>
                      <p className="text-white font-medium mt-1">{selectedTask.title}</p>
                    </div>

                    <div>
                      <label className="text-xs text-gray-400 uppercase tracking-wider">Description</label>
                      <p className="text-gray-300 text-sm mt-1">{selectedTask.description}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-gray-400 uppercase tracking-wider">Status</label>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusIcon(selectedTask.status)}
                          <span className="text-white capitalize">{selectedTask.status}</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-gray-400 uppercase tracking-wider">Priority</label>
                        <p className="text-white capitalize mt-1">{selectedTask.priority}</p>
                      </div>
                    </div>

                    {selectedTask.browserSession && (
                      <div>
                        <label className="text-xs text-gray-400 uppercase tracking-wider">Browser Session</label>
                        <div className="mt-2 p-3 bg-white/5 rounded-lg border border-white/10">
                          <div className="flex items-center gap-2 mb-2">
                            <Globe className="w-4 h-4 text-blue-400" />
                            <span className="text-white text-sm truncate">{selectedTask.browserSession.url}</span>
                          </div>
                          <button
                            onClick={() => setShowBrowserPortal(true)}
                            className="w-full mt-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            Open Browser Portal
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-2 pt-4 border-t border-white/10">
                      {selectedTask.status === 'running' && (
                        <button className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-yellow-300 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                          <PauseCircle className="w-4 h-4" />
                          Pause
                        </button>
                      )}
                      {(selectedTask.status === 'paused' || selectedTask.status === 'pending') && (
                        <button className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-300 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                          <PlayCircle className="w-4 h-4" />
                          Resume
                        </button>
                      )}
                      <button className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                        <Trash2 className="w-4 h-4" />
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-12 text-center">
                  <Target className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">Select a task to view details</p>
                </div>
              )}
            </AnimatePresence>

            {/* Browser Portal Modal */}
            <AnimatePresence>
              {showBrowserPortal && selectedTask?.browserSession && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                  onClick={() => setShowBrowserPortal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-6xl h-[80vh] rounded-3xl bg-gradient-to-br from-white/10 via-white/5 to-transparent backdrop-blur-xl border border-white/20 overflow-hidden"
                  >
                    {/* Browser Header */}
                    <div className="bg-white/10 border-b border-white/10 px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <Globe className="w-5 h-5 text-blue-400" />
                        <input
                          type="text"
                          value={selectedTask.browserSession.url}
                          readOnly
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm"
                        />
                      </div>
                      <button
                        onClick={() => setShowBrowserPortal(false)}
                        className="ml-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-colors"
                      >
                        Close
                      </button>
                    </div>

                    {/* Browser Content */}
                    <div className="h-full bg-white/5 flex items-center justify-center">
                      <div className="text-center">
                        <Monitor className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 mb-2">Browser automation in progress</p>
                        <p className="text-gray-500 text-sm">Live session will appear here</p>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
