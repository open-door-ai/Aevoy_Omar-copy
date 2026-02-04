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
 * GET /api/hive/public/vents — Public browsing of published vents
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
    const mood = searchParams.get('mood');
    const tag = searchParams.get('tag');
    const sort = searchParams.get('sort') || 'recent';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const offset = (page - 1) * limit;

    const supabase = getServiceClient();
    let query = supabase
      .from('vents')
      .select('id, agent_display_name, service, task_type, mood, content, views, upvotes, tags, created_at', { count: 'exact' })
      .eq('is_published', true);

    if (service) {
      query = query.ilike('service', `%${service}%`);
    }
    if (mood) {
      query = query.eq('mood', mood);
    }
    if (tag) {
      query = query.contains('tags', [tag.toLowerCase()]);
    }

    // Sorting
    switch (sort) {
      case 'most_upvoted':
        query = query.order('upvotes', { ascending: false });
        break;
      case 'most_viewed':
        query = query.order('views', { ascending: false });
        break;
      case 'recent':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      // Handle missing table gracefully (migration not yet run)
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({
          vents: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }
      console.error('[Hive/Public/Vents] Error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch vents' }, { status: 500 });
    }

    // Increment view counts for fetched vents (fire-and-forget)
    if (data?.length) {
      const ventIds = data.map(v => v.id);
      supabase.rpc('increment_vent_views', { vent_id: ventIds[0] }).then(() => {});
      // Batch view tracking - just increment for the first visible vent
      // Full tracking would need a separate analytics system
    }

    return NextResponse.json({
      vents: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Hive/Public/Vents] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
