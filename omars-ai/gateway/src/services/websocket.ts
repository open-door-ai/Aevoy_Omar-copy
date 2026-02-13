import { Server as SocketIO, Socket } from 'socket.io';

let io: SocketIO;

export function initWebSocket(socketServer: SocketIO): void {
  io = socketServer;

  io.on('connection', (socket: Socket) => {
    console.log('[WEBSOCKET] Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('[WEBSOCKET] Client disconnected:', socket.id);
    });

    socket.on('subscribe', (room: string) => {
      socket.join(room);
      console.log(`[WEBSOCKET] Client ${socket.id} joined room: ${room}`);
    });
  });

  console.log('[WEBSOCKET] WebSocket server initialized');
}

export function broadcastTaskUpdate(taskId: string, update: any): void {
  if (io) {
    io.emit('task:update', { taskId, ...update });
  }
}

export function broadcastQueueUpdate(queueData: any): void {
  if (io) {
    io.emit('queue:update', queueData);
  }
}

export function broadcastStatsUpdate(stats: any): void {
  if (io) {
    io.emit('stats:update', stats);
  }
}

export function broadcastPresence(userId: string, present: boolean): void {
  if (io) {
    io.emit('presence:update', { userId, present, timestamp: new Date().toISOString() });
  }
}
