import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Bookmark, MapPin, Navigation, Search, X } from 'lucide-react';
import type { FavoriteLocation } from '../types/weather';

export interface RouteDestination {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface DestinationSearchBarProps {
  destination: RouteDestination | null;
  originCenter: { lat: number; lng: number };
  favorites: FavoriteLocation[];
  onSelectDestination: (dest: RouteDestination) => void;
  onClearDestination: () => void;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err ?? '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QuotaExceeded') ||
    msg.includes('429')
  );
}

export const DestinationSearchBar: React.FC<DestinationSearchBarProps> = ({
  destination,
  originCenter,
  favorites,
  onSelectDestination,
  onClearDestination,
}) => {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState(destination?.name ?? '');
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (destination) {
      setQuery(destination.name);
    } else if (!focused) {
      setQuery('');
    }
  }, [destination, focused]);

  // Close dropdown on click outside
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  // Debounced Places API (New) AutocompleteSuggestion fetch with session token
  useEffect(() => {
    if (!placesLib || !focused) return;
    const trimmed = query.trim();
    if (trimmed.length < 2 || (destination && trimmed === destination.name)) {
      setSuggestions([]);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        setLoading(true);
        setSearchError(null);

        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ['co'],
          origin: originCenter,
          locationBias: {
            center: originCenter,
            radius: 35000,
          },
        };

        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (!cancelled) {
          setSuggestions(res.suggestions ?? []);
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (!cancelled) {
          setSuggestions([]);
          setSearchError('No fue posible buscar direcciones en este momento.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, query, focused, originCenter.lat, originCenter.lng, destination]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });
        const loc = place.location;
        if (!loc) return;

        const name =
          place.displayName ||
          suggestion.placePrediction.mainText?.text ||
          suggestion.placePrediction.text.text;
        const address = place.formattedAddress || suggestion.placePrediction.text.text;

        onSelectDestination({
          name,
          address,
          lat: loc.lat(),
          lng: loc.lng(),
        });

        setQuery(name);
        setFocused(false);
        setSuggestions([]);
        sessionTokenRef.current = null;
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setSearchError('No se pudo obtener la ubicación de ese lugar.');
      }
    },
    [placesLib, onSelectDestination]
  );

  const showDropdown =
    focused && (suggestions.length > 0 || loading || searchError !== null || (query.trim().length < 2 && favorites.length > 0));

  return (
    <div ref={containerRef} className="relative w-full pointer-events-auto">
      <div className="flex items-center gap-2 min-h-[46px] px-3.5 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-700/90 shadow-lg focus-within:border-sky-500">
        {destination ? (
          <Navigation className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
        ) : (
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
        )}
        <input
          type="text"
          value={query}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!focused) setFocused(true);
          }}
          placeholder="¿A dónde vas? (evita la lluvia)"
          aria-label="Buscar destino para calcular ruta evitando la lluvia"
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none py-2"
        />
        {(query.length > 0 || destination) && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              sessionTokenRef.current = null;
              onClearDestination();
            }}
            aria-label="Limpiar destino"
            className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-white/98 dark:bg-slate-900/98 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden z-40 max-h-72 overflow-y-auto">
          {loading && (
            <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
              Buscando lugares...
            </p>
          )}

          {searchError && (
            <p className="px-4 py-3 text-xs text-amber-700 dark:text-amber-400">{searchError}</p>
          )}

          {!loading && suggestions.length > 0 && (
            <ul role="listbox" className="divide-y divide-slate-100 dark:divide-slate-800">
              {suggestions.map((sug, idx) => {
                const pred = sug.placePrediction;
                if (!pred) return null;
                return (
                  <li key={pred.placeId || idx}>
                    <button
                      type="button"
                      onClick={() => void handleSelectSuggestion(sug)}
                      className="w-full min-h-[50px] px-4 py-2.5 flex items-start gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                    >
                      <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {pred.mainText?.text ?? pred.text.text}
                        </p>
                        {pred.secondaryText?.text && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {pred.secondaryText.text}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && query.trim().length < 2 && favorites.length > 0 && (
            <div className="p-2">
              <p className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Tus favoritos
              </p>
              {favorites.map((fav) => (
                <button
                  key={fav.id}
                  type="button"
                  onClick={() => {
                    onSelectDestination({
                      name: fav.label,
                      address: `${fav.locality}, ${fav.city}`,
                      lat: fav.latitude,
                      lng: fav.longitude,
                    });
                    setQuery(fav.label);
                    setFocused(false);
                  }}
                  className="w-full min-h-[44px] px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70"
                >
                  <Bookmark className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {fav.label}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {fav.city}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
