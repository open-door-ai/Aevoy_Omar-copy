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
 * GET /api/hive/public/stats — Public board statistics
 * No auth required. Rate limited.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getServiceClient();

    // Fetch stats in parallel
    const [
      { count: totalLearnings },
      { count: totalVents },
      { data: topServices },
      { data: recentLearnings },
      { data: taskTypes },
    ] = await Promise.all([
      supabase.from('learnings').select('*', { count: 'exact', head: true }),
      supabase.from('vents').select('*', { count: 'exact', head: true }).eq('is_published', true),
      supabase
        .from('learnings')
        .select('service, total_successes')
        .order('total_successes', { ascending: false })
        .limit(10),
      supabase
        .from('learnings')
        .select('id, service, title, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('learnings')
        .select('task_type')
        .limit(500),
    ]);

    // Count unique services
    const uniqueServices = new Set(topServices?.map(s => s.service) || []);

    // Count task type distribution
    const taskTypeCount: Record<string, number> = {};
    (taskTypes || []).forEach(t => {
      taskTypeCount[t.task_type] = (taskTypeCount[t.task_type] || 0) + 1;
    });

    // Aggregate top services with total uses
    const serviceMap = new Map<string, number>();
    (topServices || []).forEach(s => {
      const existing = serviceMap.get(s.service) || 0;
      serviceMap.set(s.service, existing + (s.total_successes || 0));
    });

    const topServicesList = Array.from(serviceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([service, uses]) => ({ service, total_uses: uses }));

    return NextResponse.json({
      total_learnings: totalLearnings || 0,
      total_services: uniqueServices.size,
      total_vents: totalVents || 0,
      top_services: topServicesList,
      task_type_distribution: taskTypeCount,
      recent_learnings: recentLearnings || [],
    });
  } catch (error) {
    console.error('[Hive/Public/Stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
