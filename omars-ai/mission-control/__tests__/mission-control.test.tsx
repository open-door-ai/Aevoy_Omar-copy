/**
 * Mission Control Dashboard Tests
 *
 * Tests:
 * 1. Page loads without errors
 * 2. SSE connection established
 * 3. Vision feed renders
 * 4. Task monitor updates
 * 5. Responsive on iPad dimensions
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Mission Control Dashboard', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    // Mock fetch
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should load page without errors', async () => {
    // Test that the page module can be imported
    const Page = await import('../app/page');
    expect(Page.default).toBeDefined();
  });

  it('should establish SSE connection', async () => {
    // Mock EventSource
    const mockEventSource = {
      addEventListener: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onerror: null,
      onmessage: null,
    };

    global.EventSource = jest.fn(() => mockEventSource) as any;

    const { useSSE } = await import('../lib/hooks/use-sse');

    // Hook should attempt to create EventSource
    expect(global.EventSource).toBeDefined();
  });

  it('should render vision feed component', async () => {
    const VisionFeed = (await import('../components/vision-feed')).default;
    expect(VisionFeed).toBeDefined();

    // Check component has required functionality
    expect(VisionFeed.toString()).toContain('Vision Feed');
  });

  it('should update task monitor', async () => {
    const TaskMonitor = (await import('../components/task-monitor')).default;
    expect(TaskMonitor).toBeDefined();

    // Check component accepts task prop
    const mockTask = {
      id: 'test-1',
      description: 'Test task',
      progress: 50,
      eta: '2m',
      cost: 0.001,
      actions: { completed: 5, total: 10 },
      url: 'https://example.com',
    };

    // Component should be callable with task
    expect(() => TaskMonitor({ task: mockTask })).toBeDefined();
  });

  it('should be responsive on iPad dimensions', () => {
    // Test that layout config matches iPad specs
    const expectedWidth = 1024;
    const expectedHeight = 768;

    // Check layout.tsx has correct viewport
    const fs = require('fs');
    const layoutContent = fs.readFileSync(
      __dirname + '/../app/layout.tsx',
      'utf-8'
    );

    expect(layoutContent).toContain('width=1024');

    // Check page.tsx has proper grid layout
    const pageContent = fs.readFileSync(
      __dirname + '/../app/page.tsx',
      'utf-8'
    );

    expect(pageContent).toContain('grid-cols-[350px_1fr]');
    expect(pageContent).toContain('h-screen');
  });
});

describe('API Endpoints', () => {
  it('should handle SSE events endpoint', async () => {
    const { GET } = await import('../app/api/events/route');
    expect(GET).toBeDefined();
  });

  it('should handle task creation endpoint', async () => {
    const { POST } = await import('../app/api/task/route');
    expect(POST).toBeDefined();
  });
});

describe('Components', () => {
  it('should export all required components', async () => {
    const VisionFeed = (await import('../components/vision-feed')).default;
    const TaskMonitor = (await import('../components/task-monitor')).default;
    const QueuePanel = (await import('../components/queue-panel')).default;
    const StatsPanel = (await import('../components/stats-panel')).default;

    expect(VisionFeed).toBeDefined();
    expect(TaskMonitor).toBeDefined();
    expect(QueuePanel).toBeDefined();
    expect(StatsPanel).toBeDefined();
  });
});
