import { NextRequest, NextResponse } from 'next/server';

// POST endpoint to create new task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description } = body;

    if (!description || typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }

    // Forward to Gateway
    console.log('[Task API] Forwarding task to Gateway:', description);

    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:18789';

    try {
      const gatewayResponse = await fetch(`${gatewayUrl}/incoming/web`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'omar', // TODO: Get from session
          username: 'omar',
          message: description.trim(),
        }),
      });

      if (!gatewayResponse.ok) {
        throw new Error(`Gateway returned ${gatewayResponse.status}`);
      }

      const result = await gatewayResponse.json();

      return NextResponse.json(
        {
          success: true,
          task: {
            id: crypto.randomUUID(),
            description: description.trim(),
            status: 'processing',
            createdAt: new Date().toISOString(),
          },
          message: result.message || 'Task submitted successfully'
        },
        { status: 201 }
      );
    } catch (error: any) {
      console.error('[Task API] Gateway error:', error.message);
      return NextResponse.json(
        {
          error: 'Failed to submit task to agent',
          details: error.message
        },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error('[Task API] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
