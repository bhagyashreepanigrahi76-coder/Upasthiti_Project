// College emblem: a chakra (wheel) with eight spokes, a motif woven into
// Sambalpuri saris, in sindoori maroon with a haldi centre.
export function CollegeMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#7a1f2b" />
      <circle cx="20" cy="20" r="14" fill="none" stroke="#f6efe3" strokeWidth="1.5" />
      {spokes.map((a) => (
        <line key={a} x1={20 + 5 * Math.cos(a)} y1={20 + 5 * Math.sin(a)} x2={20 + 14 * Math.cos(a)} y2={20 + 14 * Math.sin(a)} stroke="#f6efe3" strokeWidth="1.5" />
      ))}
      <path d="M20 14 26 20 20 26 14 20Z" fill="#e0a526" />
      <circle cx="20" cy="20" r="2" fill="#7a1f2b" />
    </svg>
  );
}
