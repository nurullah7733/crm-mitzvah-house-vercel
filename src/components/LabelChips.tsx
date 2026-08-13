import { Link } from "@tanstack/react-router";

/**
 * Small clickable tag / program chips. Clicking one opens the People screen
 * filtered to everyone who carries that tag or program.
 */
export function LabelChips({
  tags = [],
  programs = [],
  className,
}: {
  tags?: string[];
  programs?: string[];
  className?: string;
}) {
  if (tags.length === 0 && programs.length === 0) return null;
  return (
    <div className={`mt-2 flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {tags.map((t) => (
        <Link
          key={`tag-${t}`}
          to="/people"
          search={{ tag: t }}
          title={`See everyone tagged ${t}`}
          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground hover:ring-1 hover:ring-primary/40"
        >
          {t}
        </Link>
      ))}
      {programs.map((p) => (
        <Link
          key={`program-${p}`}
          to="/people"
          search={{ program: p }}
          title={`See everyone in ${p}`}
          className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:ring-1 hover:ring-primary/40"
        >
          {p}
        </Link>
      ))}
    </div>
  );
}
