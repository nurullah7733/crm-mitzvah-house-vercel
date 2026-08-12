import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-primary">{hint}</p> : null}
    </div>
  );
}

export const selectClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-base text-foreground";

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}