'use client';

interface Stats {
  tasksCompleted: number;
  tasksFailed: number;
  tasksPending: number;
  costToday: number;
  actionsTotal: number;
  avgTime: string;
  successRate: number;
}

export default function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 flex items-center justify-center h-full">
        <div className="text-gray-500 text-sm">Loading stats...</div>
      </div>
    );
  }

  const totalTasks = stats.tasksCompleted + stats.tasksFailed + stats.tasksPending;

  return (
    <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
      <h2 className="text-lg font-semibold mb-3">📈 Today's Activity</h2>

      <div className="space-y-3 flex-1">
        {/* Tasks breakdown */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">Tasks</span>
            <span className="text-sm font-semibold text-white">{totalTasks} total</span>
          </div>
          <div className="flex gap-2 text-xs">
            <div className="flex-1 bg-green-500/20 border border-green-500/30 rounded px-2 py-1.5 text-center">
              <div className="text-green-400 font-semibold">{stats.tasksCompleted}</div>
              <div className="text-green-400/70">Done ✓</div>
            </div>
            <div className="flex-1 bg-yellow-500/20 border border-yellow-500/30 rounded px-2 py-1.5 text-center">
              <div className="text-yellow-400 font-semibold">{stats.tasksPending}</div>
              <div className="text-yellow-400/70">Queue</div>
            </div>
            <div className="flex-1 bg-red-500/20 border border-red-500/30 rounded px-2 py-1.5 text-center">
              <div className="text-red-400 font-semibold">{stats.tasksFailed}</div>
              <div className="text-red-400/70">Failed</div>
            </div>
          </div>
        </div>

        {/* Cost */}
        <div className="bg-slate-700/50 rounded p-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Cost Today</span>
            <span className="text-lg font-semibold text-white">
              ${stats.costToday.toFixed(2)}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            ${(stats.costToday / totalTasks || 0).toFixed(3)} per task
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center bg-slate-700/30 rounded p-2">
          <span className="text-sm text-gray-400">Total Actions</span>
          <span className="text-sm font-semibold text-white">{stats.actionsTotal}</span>
        </div>

        {/* Avg time */}
        <div className="flex justify-between items-center bg-slate-700/30 rounded p-2">
          <span className="text-sm text-gray-400">Avg Time</span>
          <span className="text-sm font-semibold text-white">{stats.avgTime}</span>
        </div>

        {/* Success rate */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">Success Rate</span>
            <span className="text-sm font-semibold text-green-400">{stats.successRate}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-green-500 to-green-400 h-2 rounded-full"
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-slate-700 text-center">
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
