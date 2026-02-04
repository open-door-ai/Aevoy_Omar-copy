import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhookSecret } from '@/lib/verify-webhook';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function validateWebhookSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-webhook-secret') || request.headers.get('x-internal-key');
  return verifyWebhookSecret(secret);
}

/**
 * POST /api/hive/sync — Daily sync for agents to absorb new learnings
 * Called by cron job. Fetches all learnings updated since last sync.
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateWebhookSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Find last sync time for this user
    const { data: lastSync } = await supabase
      .from('agent_sync_log')
      .select('synced_at')
      .eq('user_id', user_id)
      .eq('sync_type', 'daily_learnings')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single();

    const since = lastSync?.synced_at || new Date(0).toISOString();

    // Fetch learnings updated since last sync
    const { data: newLearnings, error } = await supabase
      .from('learnings')
      .select('id, service, task_type, title, steps, gotchas, success_rate, difficulty, tags, is_warning')
      .gt('updated_at', since)
      .order('total_successes', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[Hive/Sync] Fetch error:', error.message);
      return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
    }

    // Log the sync
    await supabase.from('agent_sync_log').insert({
      user_id,
      sync_type: 'daily_learnings',
      learnings_absorbed: newLearnings?.length || 0,
    });

    return NextResponse.json({
      learnings: newLearnings || [],
      count: newLearnings?.length || 0,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Hive/Sync] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
