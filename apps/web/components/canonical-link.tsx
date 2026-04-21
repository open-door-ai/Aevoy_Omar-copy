'use client';

import { usePathname } from 'next/navigation';

export function CanonicalLink() {
  const pathname = usePathname();
  const href = `https://anticipy.ai${pathname === '/' ? '' : pathname}`;
  return <link rel="canonical" href={href} />;
}
