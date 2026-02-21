"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  useEffect(() => {
    // For now, redirect to admin dashboard
    // Full code viewer with inline annotations will be added when real code submissions flow in
    router.push("/admin/dashboard");
  }, [id, router]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
}
