import { Tag } from "@/components/ui/legacy";

export function MetricStrip({ metrics }: { metrics: Array<{ label: string; value: string | number; detail: string; tone?: "red" | "blue" | "gray" }> }) {
  return (
    <div className="metric-strip" aria-label="今日概览">
      {metrics.map((metric) => (
        <article className="metric-cell" key={metric.label}>
          <div className="metric-label"><span>{metric.label}</span>{metric.tone && <Tag type={metric.tone} size="sm">演示</Tag>}</div>
          <strong>{metric.value}</strong>
          <p>{metric.detail}</p>
        </article>
      ))}
    </div>
  );
}
