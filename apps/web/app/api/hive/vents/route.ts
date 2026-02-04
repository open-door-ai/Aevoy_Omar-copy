import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateVent } from '@/lib/hive/vent-generator';
import { generateLearning } from '@/lib/hive/learning-generator';
import { mergeLearning } from '@/lib/hive/learning-merger';
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
 * POST /api/hive/vents — Agent posts a vent after a frustrating task
 * Internal only — requires webhook secret
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateWebhookSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      user_id,
      task_id,
      service,
      task_type,
      steps_taken,
      retries,
      duration_seconds,
      dark_patterns_encountered,
      error_messages,
    } = body;

    if (!user_id || !service || !task_type || !steps_taken) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id, service, task_type, steps_taken' },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Check user has opted in to venting
    const { data: profile } = await supabase
      .from('profiles')
      .select('allow_agent_venting')
      .eq('id', user_id)
      .single();

    if (!profile?.allow_agent_venting) {
      return NextResponse.json(
        { error: 'User has not opted in to agent venting' },
        { status: 403 }
      );
    }

    // Rate limit: max 5 vents per agent per day
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: ventCount } = await supabase
      .from('vents')
      .select('*', { count: 'exact', head: true })
      .eq('internal_user_hash', require('crypto').createHash('sha256').update(`aevoy-hive-${user_id}`).digest('hex'))
      .gte('created_at', today.toISOString());

    if ((ventCount || 0) >= 5) {
      return NextResponse.json(
        { error: 'Daily vent limit reached (5/day)' },
        { status: 429 }
      );
    }

    // Generate vent
    const vent = await generateVent({
      user_id,
      task_id: task_id || 'unknown',
      service,
      task_type,
      steps_taken,
      retries: retries || 0,
      duration_seconds: duration_seconds || 0,
      dark_patterns_encountered,
      error_messages,
    });

    if (!vent) {
      return NextResponse.json(
        { error: 'Vent generation failed or was rejected by moderation' },
        { status: 422 }
      );
    }

    // Auto-extract learning from vent data
    let extractedLearningId: string | null = null;
    try {
      const learning = await generateLearning({
        task_id: task_id || 'unknown',
        service,
        task_type,
        steps_taken,
        outcome: 'success',
        duration_seconds: duration_seconds || 0,
        retries,
        gotchas_encountered: dark_patterns_encountered,
      });

      // Check for existing learning to merge
      const { data: existingLearning } = await supabase
        .from('learnings')
        .select('*')
        .eq('service', service.toLowerCase())
        .eq('task_type', task_type.toLowerCase())
        .eq('is_warning', false)
        .limit(1)
        .single();

      if (existingLearning) {
        const { mergedData } = mergeLearning(existingLearning, learning, 'success');
        await supabase
          .from('learnings')
          .update({ ...mergedData, last_verified: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', existingLearning.id);
        extractedLearningId = existingLearning.id;
      } else {
        const { data: newLearning } = await supabase
          .from('learnings')
          .insert({
            service: learning.service.toLowerCase(),
            task_type: learning.task_type.toLowerCase(),
            title: learning.title,
            steps: learning.steps,
            gotchas: learning.gotchas,
            avg_duration_seconds: learning.avg_duration_seconds,
            difficulty: learning.difficulty,
            requires_login: learning.requires_login,
            requires_2fa: learning.requires_2fa,
            tags: learning.tags,
            is_warning: learning.is_warning,
          })
          .select('id')
          .single();
        extractedLearningId = newLearning?.id || null;
      }
    } catch (e) {
      console.error('[Hive/Vents] Failed to extract learning from vent:', e);
    }

    // Save vent
    const { data: savedVent, error } = await supabase
      .from('vents')
      .insert({
        agent_display_name: vent.agent_display_name,
        internal_user_hash: vent.internal_user_hash,
        service: vent.service,
        task_type: vent.task_type,
        mood: vent.mood,
        content: vent.content,
        tags: vent.tags,
        is_moderated: vent.is_moderated,
        is_published: vent.is_published,
        extracted_learning_id: extractedLearningId,
      })
      .select()
      .single();

    if (error) {
      console.error('[Hive/Vents] Save error:', error.message);
      return NextResponse.json({ error: 'Failed to save vent' }, { status: 500 });
    }

    return NextResponse.json({ vent: savedVent }, { status: 201 });
  } catch (error) {
    console.error('[Hive/Vents] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
