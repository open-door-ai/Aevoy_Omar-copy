import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify the user via Supabase
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', user.id)
    .single();

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message } = body;
  if (!message) {
    return NextResponse.json({ error: 'No message' }, { status: 400 });
  }

  // Forward to agent
  const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';
  const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;

  const agentRes = await fetch(`${agentUrl}/task/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': webhookSecret || '',
    },
    body: JSON.stringify({
      userId: user.id,
      username: profile?.display_name || profile?.username || user.email?.split('@')[0] || 'User',
      from: 'web',
      body: message,
      inputChannel: 'web',
    }),
  });

  const result = await agentRes.json();
  return NextResponse.json(result);
}
