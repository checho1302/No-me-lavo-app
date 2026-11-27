import React, { useEffect } from 'react';
import {
  Bell,
  CalendarDays,
  Droplets,
  MessageSquarePlus,
  Radio,
  X,
} from 'lucide-react';

export type WheelActionId = 'radar' | 'estaciones' | 'pronostico' | 'alertas' | 'reportar';

interface FunctionWheelProps {
  open: boolean;
  radarBarOpen: boolean;
  alertCount: number;
  rainingStationsCount: number;
  onToggleOpen: () => void;
  onClose: () => void;
  onSelectAction: (action: WheelActionId) => void;
}

interface WheelItem {
  id: WheelActionId;
  label: string;
  angleDeg: number;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}

const WHEEL_ITEMS: WheelItem[] = [
  {
    id: 'radar',
    label: 'Radar',
    angleDeg: -165,
    icon: Radio,
    accentClass: 'text-sky-600 dark:text-sky-400',
  },
  {
    id: 'estaciones',
    label: 'Lluvias',
    angleDeg: -127.5,
    icon: Droplets,
    accentClass: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    id: 'pronostico',
    label: 'Pronóstico',
    angleDeg: -90,
    icon: CalendarDays,
    accentClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'alertas',
    label: 'Alertas',
    angleDeg: -52.5,
    icon: Bell,
    accentClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    id: 'reportar',
    label: 'Reportar',
    angleDeg: -15,
    icon: MessageSquarePlus,
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  },
];

const WHEEL_RADIUS_PX = 108;

export const FunctionWheel: React.FC<FunctionWheelProps> = ({
  open,
  radarBarOpen,
  alertCount,
  rainingStationsCount,
  onToggleOpen,
  onClose,
  onSelectAction,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {/* Subtle tap-outside backdrop when the wheel is open */}
      {open && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-20 bg-slate-950/20 dark:bg-slate-950/45 backdrop-blur-[1px] transition-opacity"
        />
      )}

      {/* Radial Function Wheel Container */}
      <div
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center pointer-events-none pb-safe"
        aria-label="Rueda de funciones"
      >
        <div className="relative w-16 h-16 flex items-center justify-center">
          {/* Visible circular wheel track ring when expanded */}
          <div
            aria-hidden="true"
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 dark:border-slate-700/90 bg-white/35 dark:bg-slate-900/45 backdrop-blur-md shadow-xl transition-all duration-200 ease-out pointer-events-none ${
              open ? 'w-[244px] h-[244px] opacity-100 scale-100' : 'w-16 h-16 opacity-0 scale-50'
            }`}
            style={{
              clipPath: 'inset(0 0 38% 0)',
            }}
          />

          {/* Radial spoke lines SVG when expanded */}
          <svg
            aria-hidden="true"
            viewBox="-130 -130 260 260"
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] h-[260px] pointer-events-none transition-opacity duration-200 ${
              open ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {WHEEL_ITEMS.map((item) => {
              const rad = (item.angleDeg * Math.PI) / 180;
              const x2 = Math.cos(rad) * (WHEEL_RADIUS_PX - 26);
              const y2 = Math.sin(rad) * (WHEEL_RADIUS_PX - 26);
              return (
                <line
                  key={item.id}
                  x1="0"
                  y1="0"
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="3 4"
                  className="text-slate-500/45 dark:text-slate-400/45"
                />
              );
            })}
          </svg>

          {/* 5 Radial Function Buttons positioned on the wheel circumference */}
          {WHEEL_ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const rad = (item.angleDeg * Math.PI) / 180;
            const tx = open ? Math.round(Math.cos(rad) * WHEEL_RADIUS_PX) : 0;
            const ty = open ? Math.round(Math.sin(rad) * WHEEL_RADIUS_PX) : 0;
            const isHighlighted = item.id === 'radar' && radarBarOpen;
            const badgeNum =
              item.id === 'alertas' && alertCount > 0
                ? alertCount
                : item.id === 'estaciones' && rainingStationsCount > 0
                  ? rainingStationsCount
                  : null;

            return (
              <div
                key={item.id}
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${open ? 1 : 0.4})`,
                  transitionDelay: open ? `${idx * 25}ms` : '0ms',
                }}
                className={`absolute left-1/2 top-1/2 -ml-7 -mt-7 w-14 flex flex-col items-center transition-all duration-200 ease-out ${
                  open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectAction(item.id);
                    onClose();
                  }}
                  aria-label={item.label}
                  className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg border transition-transform active:scale-95 ${
                    isHighlighted
                      ? 'bg-[#0F213D] dark:bg-sky-500 text-white border-[#0F213D] dark:border-sky-400'
                      : 'bg-white/95 dark:bg-slate-900/95 border-slate-200/90 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 ${
                      isHighlighted ? 'text-white' : item.accentClass
                    }`}
                  />
                  {badgeNum !== null && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#0F213D] dark:bg-sky-500 text-white text-[10px] font-bold font-mono tabular-nums flex items-center justify-center shadow">
                      {badgeNum > 99 ? '99' : badgeNum}
                    </span>
                  )}
                </button>
                <span className="mt-1 px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-slate-900/90 text-[11px] font-semibold text-slate-800 dark:text-slate-100 shadow-xs whitespace-nowrap leading-none">
                  {item.label}
                </span>
              </div>
            );
          })}

          {/* Central Wheel Hub Button */}
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={open ? 'Cerrar rueda de funciones' : 'Abrir rueda de funciones'}
            className={`relative pointer-events-auto w-16 h-16 rounded-full shadow-xl border-2 flex items-center justify-center transition-all duration-200 active:scale-95 ${
              open
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-white/80 dark:border-slate-800 rotate-90'
                : 'bg-[#0F213D] dark:bg-sky-500 text-white border-white/90 dark:border-slate-900 hover:bg-[#17325C] dark:hover:bg-sky-400'
            }`}
          >
            {open ? (
              <X className="w-6 h-6" />
            ) : (
              /* Custom Wheel / Dial SVG Icon so the user immediately sees the "rueda" */
              <svg
                viewBox="0 0 36 36"
                className="w-9 h-9"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="18" cy="18" r="14" stroke="currentColor" strokeWidth="1.8" strokeOpacity="0.4" />
                <circle cx="18" cy="18" r="5" fill="currentColor" />
                <circle cx="18" cy="6.5" r="2.2" fill="currentColor" />
                <circle cx="28.8" cy="14.5" r="2.2" fill="currentColor" />
                <circle cx="24.7" cy="27.2" r="2.2" fill="currentColor" />
                <circle cx="11.3" cy="27.2" r="2.2" fill="currentColor" />
                <circle cx="7.2" cy="14.5" r="2.2" fill="currentColor" />
                <path
                  d="M18 13V8.7M22.7 16.5L26.6 15.2M20.9 22L23.3 25.3M15.1 22L12.7 25.3M13.3 16.5L9.4 15.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeOpacity="0.75"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  );
};
