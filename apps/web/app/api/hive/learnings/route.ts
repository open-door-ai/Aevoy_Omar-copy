import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateLearning } from '@/lib/hive/learning-generator';
import { mergeLearning } from '@/lib/hive/learning-merger';
import { scrubPII } from '@/lib/hive/pii-scrubber';
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
 * POST /api/hive/learnings — Agent posts a learning after task completion
 * Internal only — requires webhook secret
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateWebhookSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      task_id,
      service,
      task_type,
      steps_taken,
      outcome,
      duration_seconds,
      error_message,
      retries,
      required_login,
      required_2fa,
      gotchas_encountered,
    } = body;

    if (!service || !task_type || !steps_taken || !outcome) {
      return NextResponse.json(
        { error: 'Missing required fields: service, task_type, steps_taken, outcome' },
        { status: 400 }
      );
    }

    // Generate structured learning via AI
    const learning = await generateLearning({
      task_id: task_id || 'unknown',
      service,
      task_type,
      steps_taken,
      outcome,
      duration_seconds: duration_seconds || 0,
      error_message,
      retries,
      required_login,
      required_2fa,
      gotchas_encountered,
    });

    const supabase = getServiceClient();

    // Check for existing learning on same service + task_type
    const { data: existing } = await supabase
      .from('learnings')
      .select('*')
      .eq('service', learning.service.toLowerCase())
      .eq('task_type', learning.task_type.toLowerCase())
      .eq('is_warning', learning.is_warning)
      .limit(1)
      .single();

    if (existing) {
      // Merge with existing learning
      const { mergedData } = mergeLearning(existing, learning, outcome);

      const { data: updated, error } = await supabase
        .from('learnings')
        .update({
          ...mergedData,
          last_verified: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('[Hive/Learnings] Merge error:', error.message);
        return NextResponse.json({ error: 'Failed to merge learning' }, { status: 500 });
      }

      return NextResponse.json({ learning: updated, action: 'merged' });
    }

    // Create new learning
    const { data: created, error } = await supabase
      .from('learnings')
      .insert({
        service: learning.service.toLowerCase(),
        task_type: learning.task_type.toLowerCase(),
        title: learning.title,
        steps: learning.steps,
        gotchas: learning.gotchas,
        success_rate: outcome === 'success' ? 100 : 0,
        total_attempts: 1,
        total_successes: outcome === 'success' ? 1 : 0,
        avg_duration_seconds: learning.avg_duration_seconds,
        difficulty: learning.difficulty,
        requires_login: learning.requires_login,
        requires_2fa: learning.requires_2fa,
        tags: learning.tags,
        is_warning: learning.is_warning,
        warning_details: learning.warning_details,
      })
      .select()
      .single();

    if (error) {
      console.error('[Hive/Learnings] Create error:', error.message);
      return NextResponse.json({ error: 'Failed to create learning' }, { status: 500 });
    }

    return NextResponse.json({ learning: created, action: 'created' }, { status: 201 });
  } catch (error) {
    console.error('[Hive/Learnings] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/hive/learnings — Agent searches for relevant knowledge before executing a task
 * Internal only — requires webhook secret
 */
export async function GET(request: NextRequest) {
  try {
    if (!validateWebhookSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    const taskType = searchParams.get('task_type');
    const keyword = searchParams.get('q');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    const supabase = getServiceClient();
    let query = supabase.from('learnings').select('*');

    if (service) {
      query = query.ilike('service', `%${service}%`);
    }

    if (taskType) {
      query = query.eq('task_type', taskType.toLowerCase());
    }

    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,service.ilike.%${keyword}%`);
    }

    const { data, error } = await query
      .order('total_successes', { ascending: false })
      .order('success_rate', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Hive/Learnings] Search error:', error.message);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    return NextResponse.json({ learnings: data || [] });
  } catch (error) {
    console.error('[Hive/Learnings] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
