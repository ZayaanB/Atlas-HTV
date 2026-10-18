import { useId } from "react";

export function GeminiMark({ size = 20 }: { size?: number }) {
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="gemini-mark">
      <defs>
        <linearGradient id={gradient} x1="2" y1="21" x2="22" y2="3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285f4" />
          <stop offset=".5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradient})`} d="M12 1C12 7.075 7.075 12 1 12c6.075 0 11 4.925 11 11 0-6.075 4.925-11 11-11-6.075 0-11-4.925-11-11Z" />
    </svg>
  );
}
