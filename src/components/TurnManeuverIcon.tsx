import React from 'react';
import type { NavManeuverType } from '../utils/routeWeatherLogic';

interface TurnManeuverIconProps {
  maneuver: NavManeuverType;
  className?: string;
}

/**
 * Crisp Google Maps / Waze-style white navigation maneuver arrow icons
 * covering straight, left/right turns, slight/sharp turns, ramps, U-turns, roundabouts, and arrival.
 */
export const TurnManeuverIcon: React.FC<TurnManeuverIconProps> = ({
  maneuver,
  className = 'w-8 h-8',
}) => {
  switch (maneuver) {
    case 'TURN_LEFT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M19 23V12a2 2 0 0 0-2-2H7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11.5 5.5L6.5 10L11.5 14.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'TURN_RIGHT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M9 23V12a2 2 0 0 1 2-2h10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16.5 5.5L21.5 10L16.5 14.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'TURN_SLIGHT_LEFT':
    case 'RAMP_LEFT':
    case 'FORK_LEFT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M17 23v-6.5L9 8"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 14V7.5H15"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'TURN_SLIGHT_RIGHT':
    case 'RAMP_RIGHT':
    case 'FORK_RIGHT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M11 23v-6.5L19 8"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M19.5 14V7.5H13"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'TURN_SHARP_LEFT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M19 23V9.5L8 18"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 12.5V18.5H14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'TURN_SHARP_RIGHT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M9 23V9.5L20 18"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 12.5V18.5H14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'UTURN_LEFT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M19 23V11a5 5 0 0 0-10 0v7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M5.5 14.5L9 18.5L12.5 14.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'UTURN_RIGHT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M9 23V11a5 5 0 0 1 10 0v7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15.5 14.5L19 18.5L22.5 14.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'ROUNDABOUT_LEFT':
    case 'ROUNDABOUT_RIGHT':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <circle cx="14" cy="14" r="5" stroke="currentColor" strokeWidth="2.8" />
          <path
            d="M14 23v-4M14 9V5"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M10.5 8L14 4.5L17.5 8"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'MERGE':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M14 23V6M8.5 22L14 14M19.5 22L14 14"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 10.5L14 5.5L18.5 10.5"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'ARRIVE':
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M14 24s7-6.8 7-12.5A7 7 0 1 0 7 11.5C7 17.2 14 24 14 24Z"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <circle cx="14" cy="11.5" r="2.6" fill="currentColor" />
        </svg>
      );

    case 'DEPART':
    case 'STRAIGHT':
    case 'NAME_CHANGE':
    default:
      return (
        <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
          <path
            d="M14 17V6"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M14 20.5v.5M14 23.5v.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M9 10.5L14 5.5L19 10.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};
