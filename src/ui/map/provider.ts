/**
 * Map / geocoding provider abstraction. No provider is configured yet and NO API key is bundled.
 * To enable one later (after approval), implement this interface in a client module and set
 * NEXT_PUBLIC_MAP_PROVIDER (plus a restricted, referrer-locked browser key) — the LocationPicker
 * then renders the provider's pin selector. Coordinates must stay client→server only (never in URLs).
 */
export interface MapProvider {
  name: string;
  /** Render an interactive pin picker; call onPick with the chosen point. */
  renderPicker(el: HTMLElement, initial: { lat: number; lng: number } | null, onPick: (p: { lat: number; lng: number }) => void): () => void;
  /** Optional reverse geocoding to pre-fill (never auto-submit) the written address. */
  reverseGeocode?(p: { lat: number; lng: number }): Promise<Partial<{ city: string; street: string; landmark: string }>>;
}

export function configuredMapProvider(): string | null {
  return process.env.NEXT_PUBLIC_MAP_PROVIDER || null;
}
