import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface Props {
  latitude: number;
  longitude: number;
  /** Tile zoom on first paint. 14 ≈ city neighbourhood, 12 ≈ city block. */
  zoom?: number;
}

/**
 * Small embedded Leaflet map for the Info tab's Metadata section.
 *
 * - **Lazy-loaded** via dynamic `import()` so Leaflet (≈40 KB gz) only ships
 *   in the chunk that needs it. Photos without GPS never pay for the lib.
 * - **OpenStreetMap tiles** — free, no API key, polite usage subject to the
 *   tile policy. Attribution is rendered by Leaflet itself.
 * - **Fixed marker icon** — Leaflet's default icon ships as a PNG resolved
 *   relative to the bundled CSS, which breaks under Vite. We work around
 *   the issue by passing an explicit `iconUrl` (the same PNG path, this
 *   time picked up via Vite's image import).
 */
export function MetadataMap({ latitude, longitude, zoom = 13 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let cancelled = false;
    let map: import('leaflet').Map | null = null;

    (async () => {
      try {
        const [L, , markerIcon, markerIcon2x, markerShadow] = await Promise.all([
          import('leaflet'),
          import('leaflet/dist/leaflet.css'),
          import('leaflet/dist/images/marker-icon.png'),
          import('leaflet/dist/images/marker-icon-2x.png'),
          import('leaflet/dist/images/marker-shadow.png'),
        ]);
        if (cancelled) return;

        // Default-icon URL fix — Vite serves the PNG with a hashed path that
        // Leaflet can't resolve from its own CSS. We pass it explicitly.
        const icon = L.icon({
          iconUrl:     (markerIcon as { default: string }).default,
          iconRetinaUrl: (markerIcon2x as { default: string }).default,
          shadowUrl:   (markerShadow as { default: string }).default,
          iconSize:    [25, 41],
          iconAnchor:  [12, 41],
          popupAnchor: [1, -34],
          shadowSize:  [41, 41],
        });

        map = L.map(node, {
          zoomControl: false,
          attributionControl: true,
          // No mouse wheel zoom — the map sits inside a scrollable sidebar
          // and a wheel-over would steal scroll. Pinch + drag still work.
          scrollWheelZoom: false,
          dragging: true,
          // Single-touch drag conflicts with the sidebar's vertical scroll;
          // require two fingers on touch screens.
          touchZoom: true,
        }).setView([latitude, longitude], zoom);

        L.tileLayer(
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
          },
        ).addTo(map);

        L.marker([latitude, longitude], { icon }).addTo(map);

        setReady(true);
      } catch (e) {
        console.error('[MetadataMap] failed to load Leaflet', e);
        setError(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude, zoom]);

  if (error) {
    return (
      <div className="flex items-center justify-center gap-1.5 px-2 py-3
        rounded-[3px] border border-separator bg-surface-secondary
        text-[10px] text-text-secondary">
        <MapPin size={10} />
        Map unavailable
      </div>
    );
  }

  return (
    <div className="relative w-full h-[140px] rounded-[3px] overflow-hidden
      border border-separator bg-surface-secondary">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        // Quiet loading placeholder — appears for the brief moment between
        // the dynamic-import start and the first tile paint.
        <div className="absolute inset-0 flex items-center justify-center
          text-[10px] text-text-secondary pointer-events-none">
          Loading map…
        </div>
      )}
    </div>
  );
}
