export interface TriggerResult {
  type: string;
  shouldTrigger: boolean;
  description: string;
  taskDescription: string;
  critical: boolean;
}

export interface HeartbeatState {
  presenceMode: 'active' | 'idle' | 'sleep';
  lastCheck: Record<string, number>;
  triggerCount: Record<string, number>;
}
