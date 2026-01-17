import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ScoreBadgeProps = {
  score: number;
  grade: string;
};

export function ScoreBadge({ score, grade }: ScoreBadgeProps) {
  const tone =
    grade === "A"
      ? "bg-emerald-600"
      : grade === "B"
        ? "bg-amber-600"
        : grade === "C"
          ? "bg-orange-600"
          : "bg-neutral-700";

  return (
    <div className="flex items-center gap-3">
      <Badge className={cn(tone, "text-white")}>{grade}</Badge>
      <span className="text-3xl font-semibold">{score}</span>
      <span className="text-sm text-muted-foreground">/ 100</span>
    </div>
  );
}
