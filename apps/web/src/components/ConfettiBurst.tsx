import { useMemo } from "react";

const COLORS = ["#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#8b5cf6", "#22c55e"];

type Props = {
  active: boolean;
};

export function ConfettiBurst({ active }: Props) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }).map((_, index) => {
        const x = Math.floor(Math.random() * 220) - 110;
        const rotate = Math.floor(Math.random() * 120) - 60;
        const delay = Math.random() * 0.2;
        const duration = 1.2 + Math.random() * 0.6;
        const size = 6 + Math.floor(Math.random() * 4);
        return {
          key: index,
          color: COLORS[index % COLORS.length],
          style: {
            "--x": `${x}px`,
            "--rotate": `${rotate}deg`,
            "--delay": `${delay}s`,
            "--duration": `${duration}s`,
            width: `${size}px`,
            height: `${size + 6}px`,
          } as React.CSSProperties,
        };
      }),
    []
  );

  if (!active) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 overflow-visible">
      {pieces.map((piece) => (
        <span
          key={piece.key}
          className="confetti-piece"
          style={{ backgroundColor: piece.color, ...piece.style }}
        />
      ))}
    </div>
  );
}
