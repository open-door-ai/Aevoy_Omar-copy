import { NextRequest } from 'next/server';

// Server-Sent Events endpoint for real-time updates
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      console.log('[SSE] Client connected');

      // Send initial connection message
      const connectionMsg = `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(connectionMsg));

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = `data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch (err) {
          console.error('[SSE] Heartbeat error:', err);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // TODO: Connect to Core agent for real-time task updates
      // Implementation:
      // 1. Connect WebSocket to Core at ws://localhost:3002/tasks
      // 2. Forward task events: task:update, queue:update, stats:update
      // 3. Include actual task data (not mock)
      //
      // Example event format:
      // event: task:update
      // data: {"id": "uuid", "description": "...", "progress": 0-100, ...}
      //
      // For now, this endpoint only sends heartbeats (no mock data)

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        console.log('[SSE] Client disconnected');
        clearInterval(heartbeatInterval);
        // TODO: Close WebSocket connection to Core here
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

export const dynamic = 'force-dynamic';
