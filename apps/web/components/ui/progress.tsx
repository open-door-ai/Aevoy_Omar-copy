"use client";

import * as React from "react";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`relative h-4 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${className || ""}`}
        {...props}
      >
        {children || (
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${value || 0}%` }}
          />
        )}
      </div>
    );
  }
);

Progress.displayName = "Progress";

export { Progress };
