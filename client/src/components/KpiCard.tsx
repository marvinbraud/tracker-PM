interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  accent?: boolean;
  tooltip?: string;
}

export default function KpiCard({ label, value, sub, subColor, accent, tooltip }: KpiCardProps) {
  return (
    <div
      className="bb-card"
      title={tooltip}
      style={{
        borderColor: accent ? "var(--primary)" : "var(--border)",
        borderLeft: accent ? "3px solid var(--primary)" : undefined,
        cursor: tooltip ? "help" : "default",
      }}
    >
      <div className="bb-card-title">{label}</div>
      <div
        className="bb-value-md tabnum"
        style={{ color: accent ? "var(--primary)" : "var(--text)", fontSize: "17px" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="bb-value-sm tabnum"
          style={{ color: subColor ?? "var(--text-muted)", marginTop: "4px", fontSize: "12px" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
