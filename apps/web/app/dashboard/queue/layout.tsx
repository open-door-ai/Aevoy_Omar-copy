import type { Metadata } from "next";
export const metadata: Metadata = { title: "Task Queue" };
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
