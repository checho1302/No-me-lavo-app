import React from 'react';

interface LiveSpeedometerProps {
  speedKmh: number;
}

/**
 * Waze-inspired circular live speedometer dial (km/h) for active turn-by-turn navigation.
 * Uses a dark matte charcoal bezel with a subtle progressive arc ring and bold tabular numerals.
 */
export const LiveSpeedometer: React.FC<LiveSpeedometerProps> = ({ speedKmh }) => {
  const safeSpeed = Number.isFinite(speedKmh) ? Math.max(0, Math.min(220, Math.round(speedKmh))) : 0;
  // Sweep arc across 260° (from bottom-left around top to bottom-right) mapped to 0..120 km/h
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const arcSpan = circumference * (260 / 360);
  const ratio = Math.min(1, safeSpeed / 120);
  const progressLength = arcSpan * ratio;

  const arcColor =
    safeSpeed >= 85 ? '#F43F5E' : safeSpeed >= 60 ? '#FBBF24' : '#22D3EE';

  return (
    <div
      role="status"
      aria-label={`Velocidad actual: ${safeSpeed} kilómetros por hora`}
      className="relative w-16 h-16 rounded-full bg-[#1B1F24]/95 border border-white/15 shadow-[0_10px_24px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center select-none pointer-events-auto"
    >
      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 w-full h-full -rotate-[220deg]"
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="3.5"
          strokeDasharray={`${arcSpan} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Live speed progress arc */}
        {safeSpeed > 0 && (
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth="3.5"
            strokeDasharray={`${progressLength} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-300"
          />
        )}
      </svg>

      <span className="relative text-[22px] font-extrabold font-display tabular-nums leading-none text-white tracking-tight mt-0.5">
        {safeSpeed}
      </span>
      <span className="relative text-[10px] font-semibold text-slate-300 leading-none mt-0.5">
        km/h
      </span>
    </div>
  );
};
