'use client';

import { useState } from 'react';

interface Task {
  id: string;
  description: string;
  progress: number;
  eta: string;
  cost: number;
  actions: { completed: number; total: number };
  url: string;
  screenshot?: string;
}

export default function TaskMonitor({ task }: { task: Task | null }) {
  const [showScreenshot, setShowScreenshot] = useState(false);

  if (!task) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-gray-500 text-center">
          <div className="text-4xl mb-2">✨</div>
          <div className="text-sm">No active task</div>
          <div className="text-xs text-gray-600 mt-1">System idle</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg p-4 h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-lg font-semibold">📊 Current Task</h2>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-xs text-blue-400">Running</span>
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto flex-1">
        <div className="text-base font-medium text-white">{task.description}</div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-gray-400">Progress</span>
            <span className="text-white font-semibold">{task.progress}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-400 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-700/50 p-2 rounded">
            <div className="text-gray-400 text-xs">ETA</div>
            <div className="font-semibold text-sm mt-0.5">{task.eta}</div>
          </div>
          <div className="bg-slate-700/50 p-2 rounded">
            <div className="text-gray-400 text-xs">Cost</div>
            <div className="font-semibold text-sm mt-0.5">${task.cost.toFixed(4)}</div>
          </div>
          <div className="bg-slate-700/50 p-2 rounded">
            <div className="text-gray-400 text-xs">Actions</div>
            <div className="font-semibold text-sm mt-0.5">
              {task.actions.completed} / {task.actions.total}
            </div>
          </div>
        </div>

        {/* Current URL */}
        <div>
          <div className="text-gray-400 text-xs mb-1.5">Current URL</div>
          <div className="text-xs font-mono bg-slate-700/70 p-2 rounded truncate text-blue-300">
            {task.url}
          </div>
        </div>

        {/* Screenshot preview */}
        {task.screenshot && (
          <div>
            <div className="text-gray-400 text-xs mb-1.5">Browser View</div>
            <div
              className="relative group cursor-pointer"
              onClick={() => setShowScreenshot(!showScreenshot)}
            >
              <img
                src={task.screenshot}
                alt="Task screenshot"
                className="w-full h-24 object-cover rounded border border-slate-700 group-hover:border-blue-500 transition-colors"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded flex items-center justify-center transition-colors">
                <span className="text-white opacity-0 group-hover:opacity-100 text-xs bg-black/70 px-2 py-1 rounded">
                  Click to expand
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-3 mt-3 border-t border-slate-700">
        <button className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 py-2 rounded text-sm font-medium transition-colors">
          View Live
        </button>
        <button className="flex-1 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 py-2 rounded text-sm font-medium transition-colors">
          Pause
        </button>
        <button className="flex-1 bg-red-600/80 hover:bg-red-600 active:bg-red-700 py-2 rounded text-sm font-medium transition-colors">
          Cancel
        </button>
      </div>

      {/* Screenshot modal */}
      {showScreenshot && task.screenshot && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowScreenshot(false)}
        >
          <div className="max-w-4xl max-h-[90vh] relative">
            <img
              src={task.screenshot}
              alt="Task screenshot enlarged"
              className="w-full h-full object-contain rounded-lg"
            />
            <button
              className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded text-sm"
              onClick={() => setShowScreenshot(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
