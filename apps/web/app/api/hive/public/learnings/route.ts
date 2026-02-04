import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= 100) return false;
  entry.count++;
  return true;
}

/**
 * GET /api/hive/public/learnings — Public browsing of all learnings
 * No auth required. Rate limited to 100 req/min per IP.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    const taskType = searchParams.get('task_type');
    const tag = searchParams.get('tag');
    const sort = searchParams.get('sort') || 'popular';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const offset = (page - 1) * limit;

    const supabase = getServiceClient();
    let query = supabase
      .from('learnings')
      .select('id, service, task_type, title, steps, gotchas, success_rate, total_attempts, total_successes, avg_duration_seconds, last_verified, difficulty, requires_login, requires_2fa, tags, is_warning, warning_details, merged_count, created_at', { count: 'exact' });

    if (service) {
      query = query.ilike('service', `%${service}%`);
    }
    if (taskType) {
      query = query.eq('task_type', taskType.toLowerCase());
    }
    if (tag) {
      query = query.contains('tags', [tag.toLowerCase()]);
    }

    // Sorting
    switch (sort) {
      case 'recent':
        query = query.order('updated_at', { ascending: false });
        break;
      case 'success':
        query = query.order('success_rate', { ascending: false });
        break;
      case 'difficulty':
        query = query.order('difficulty', { ascending: false });
        break;
      case 'popular':
      default:
        query = query.order('total_successes', { ascending: false });
        break;
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      // Handle missing table gracefully (migration not yet run)
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({
          learnings: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }
      console.error('[Hive/Public/Learnings] Error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch learnings' }, { status: 500 });
    }

    return NextResponse.json({
      learnings: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Hive/Public/Learnings] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
