import type { Metadata } from "next";

// V24 fix: Prevent search engines from indexing admin pages
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Admin | Aevoy",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
