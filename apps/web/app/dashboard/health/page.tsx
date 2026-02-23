import { Heart } from 'lucide-react';

export default function HealthPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center mb-6">
        <Heart className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Health</h1>
      <p className="text-lg text-muted-foreground mt-1">Coming Soon</p>
      <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">
        Track your health metrics, connect fitness devices, and get AI-powered health insights.
      </p>
    </div>
  );
}
