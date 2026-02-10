import { useMemo } from "react";

const COLORS = ["#0066FF", "#00A8E8", "#FF6B35", "#f59e0b", "#f43f5e"];

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Props = {
  active: boolean;
};

export function ConfettiBurst({ active }: Props) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }).map((_, index) => {
        const rand = mulberry32(1337 + index);
        const x = Math.floor(rand() * 220) - 110;
        const rotate = Math.floor(rand() * 120) - 60;
        const delay = rand() * 0.2;
        const duration = 1.2 + rand() * 0.6;
        const size = 6 + Math.floor(rand() * 4);
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
