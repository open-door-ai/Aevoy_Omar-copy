'use client';

import { useState } from 'react';

interface QueueTask {
  id: string;
  description: string;
  priority: number;
}

export default function QueuePanel({ queue }: { queue: QueueTask[] }) {
  const [showInput, setShowInput] = useState(false);
  const [newTask, setNewTask] = useState('');

  const handleAddTask = async () => {
    if (!newTask.trim()) return;

    try {
      const response = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newTask }),
      });

      if (response.ok) {
        setNewTask('');
        setShowInput(false);
      }
    } catch (err) {
      console.error('[Queue] Failed to add task', err);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">
          📋 Queue <span className="text-sm text-gray-400">({queue.length})</span>
        </h2>
        <button
          onClick={() => setShowInput(!showInput)}
          className="text-sm bg-blue-600 hover:bg-blue-700 active:bg-blue-800 px-3 py-1 rounded font-medium transition-colors"
        >
          + New
        </button>
      </div>

      {/* Quick add input */}
      {showInput && (
        <div className="mb-3 space-y-2 fade-in">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
            placeholder="Describe the task..."
            className="w-full bg-slate-700 text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddTask}
              className="flex-1 bg-green-600 hover:bg-green-700 py-1.5 rounded text-xs font-medium"
            >
              Add Task
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewTask('');
              }}
              className="flex-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="space-y-2 overflow-y-auto flex-1">
        {queue.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-8">
            <div className="text-3xl mb-2">📭</div>
            <div>No tasks in queue</div>
          </div>
        ) : (
          queue.map((task, i) => (
            <div
              key={task.id}
              className="bg-slate-700/70 hover:bg-slate-700 p-3 rounded text-sm transition-colors group cursor-pointer"
            >
              <div className="flex items-start gap-2">
                <span className="text-gray-400 font-mono text-xs mt-0.5 min-w-[20px]">
                  {i + 1}.
                </span>
                <div className="flex-1">
                  <div className="text-white">{task.description}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Priority: {task.priority} • Waiting
                  </div>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs px-2 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle delete
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Queue stats */}
      {queue.length > 0 && (
        <div className="text-xs text-gray-400 mt-3 pt-3 border-t border-slate-700 flex justify-between">
          <span>Est. time: {queue.length * 3}m</span>
          <span>Total cost: ${(queue.length * 0.002).toFixed(3)}</span>
        </div>
      )}
    </div>
  );
}
