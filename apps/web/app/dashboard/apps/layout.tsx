import type { Metadata } from "next";
export const metadata: Metadata = { title: "Connected Apps" };
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
