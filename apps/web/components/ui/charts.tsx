"use client";

import * as React from "react";
import {
  Line,
  LineChart as RechartsLineChart,
  Bar,
  BarChart as RechartsBarChart,
  Pie,
  PieChart as RechartsPieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

// Default color palette
const DEFAULT_COLORS = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--secondary))",
  accent: "hsl(var(--accent))",
  groq: "#10B981",
  deepseek: "#3B82F6",
  claude: "#8B5CF6",
  gemini: "#F59E0B",
  kimi: "#EC4899",
};

// Color array for charts
const CHART_COLORS = [
  DEFAULT_COLORS.primary,
  DEFAULT_COLORS.secondary,
  DEFAULT_COLORS.accent,
  DEFAULT_COLORS.groq,
  DEFAULT_COLORS.deepseek,
  DEFAULT_COLORS.claude,
  DEFAULT_COLORS.gemini,
  DEFAULT_COLORS.kimi,
];

export interface LineChartProps {
  data: any[];
  xKey: string;
  yKeys: string[];
  colors?: string[];
  height?: number;
  className?: string;
  showGrid?: boolean;
  showLegend?: boolean;
  animate?: boolean;
}

export function LineChart({
  data,
  xKey,
  yKeys,
  colors = CHART_COLORS,
  height = 300,
  className,
  showGrid = true,
  showLegend = true,
  animate = true,
}: LineChartProps) {
  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-muted"
              vertical={false}
            />
          )}
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "hsl(var(--popover-foreground))" }}
          />
          {showLegend && <Legend wrapperStyle={{ fontSize: "12px" }} />}
          {yKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[index % colors.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              animationDuration={animate ? 1000 : 0}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarChartProps {
  data: any[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  className?: string;
  showGrid?: boolean;
  animate?: boolean;
}

export function BarChart({
  data,
  xKey,
  yKey,
  color = DEFAULT_COLORS.primary,
  height = 300,
  className,
  showGrid = true,
  animate = true,
}: BarChartProps) {
  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-muted"
              vertical={false}
            />
          )}
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            cursor={{ fill: "hsl(var(--muted))" }}
          />
          <Bar
            dataKey={yKey}
            fill={color}
            radius={[8, 8, 0, 0]}
            animationDuration={animate ? 1000 : 0}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutChartProps {
  data: any[];
  labelKey: string;
  valueKey: string;
  colors?: string[];
  height?: number;
  className?: string;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
  animate?: boolean;
}

export function DonutChart({
  data,
  labelKey,
  valueKey,
  colors = CHART_COLORS,
  height = 300,
  className,
  innerRadius = 60,
  outerRadius = 90,
  showLegend = true,
  animate = true,
}: DonutChartProps) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  const total = React.useMemo(() => {
    return data.reduce((sum, item) => sum + (item[valueKey] || 0), 0);
  }, [data, valueKey]);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={labelKey}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            animationDuration={animate ? 800 : 0}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={colors[index % colors.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                style={{ transition: "opacity 0.2s" }}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: any) => {
              const percentage = ((value / total) * 100).toFixed(1);
              return `${value} (${percentage}%)`;
            }}
          />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: "12px" }}
              verticalAlign="bottom"
              height={36}
            />
          )}
        </RechartsPieChart>
      </ResponsiveContainer>
      {/* Center text showing total */}
      <div
        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ marginTop: `-${(height - 36) / 2}px` }}
      >
        <div className="text-2xl font-bold">{total}</div>
        <div className="text-xs text-muted-foreground">Total</div>
      </div>
    </div>
  );
}

export interface SparkLineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
}

export function SparkLine({
  data,
  color = DEFAULT_COLORS.primary,
  height = 40,
  width = 100,
  className,
}: SparkLineProps) {
  const chartData = React.useMemo(() => {
    return data.map((value, index) => ({ index, value }));
  }, [data]);

  return (
    <div className={cn("inline-block", className)}>
      <ResponsiveContainer width={width} height={height}>
        <RechartsLineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            animationDuration={500}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Export useful color constants for consumers
export { DEFAULT_COLORS, CHART_COLORS };
