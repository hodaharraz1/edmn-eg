import { z } from 'zod';
import { decryptJson, encryptJson } from '@/server/core/crypto';

/**
 * Delivery / pickup location: a usable structured address (always required) plus an OPTIONAL GPS pin.
 * Coordinates are only ever captured in the browser after the user clicks "use my current location"
 * and grants permission. They are sensitive personal data: stored encrypted (AES-256-GCM), never put
 * in URLs, never logged, and only shown to the deal parties at the appropriate stage and to staff
 * with the relevant permission. GPS never replaces the written address.
 */
const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

export const locationSchema = z.object({
  governorateId: z.coerce.number().int().min(1, 'اختر المحافظة').max(99),
  city: z.string().trim().min(2, 'اكتب المدينة / المنطقة').max(100),
  street: z.string().trim().min(2, 'اكتب الشارع').max(200),
  building: optionalText(50),
  floor: optionalText(20),
  apartment: optionalText(20),
  landmark: optionalText(200),
  notes: optionalText(500),
  // GPS — all-or-nothing, validated ranges; empty strings mean "not shared".
  lat: z.union([z.literal(''), z.coerce.number().min(-90).max(90)]).optional().default(''),
  lng: z.union([z.literal(''), z.coerce.number().min(-180).max(180)]).optional().default(''),
  accuracy: z.union([z.literal(''), z.coerce.number().min(0).max(100_000)]).optional().default(''),
});
export type LocationInput = z.input<typeof locationSchema>;

export interface StoredLocation {
  governorateId: number;
  city: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  notes: string;
  gps: { lat: number; lng: number; accuracy: number | null } | null;
}

export function toStoredLocation(input: z.infer<typeof locationSchema>): StoredLocation {
  const hasGps = typeof input.lat === 'number' && typeof input.lng === 'number';
  return {
    governorateId: input.governorateId,
    city: input.city,
    street: input.street,
    building: input.building,
    floor: input.floor,
    apartment: input.apartment,
    landmark: input.landmark,
    notes: input.notes,
    // Coordinates are rounded to ~1 m; we never keep more precision than needed for delivery.
    gps: hasGps ? { lat: round(input.lat as number, 5), lng: round(input.lng as number, 5), accuracy: typeof input.accuracy === 'number' ? Math.round(input.accuracy) : null } : null,
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export const encryptLocation = (l: StoredLocation) => encryptJson(l);
export const decryptLocation = (enc: string | null | undefined): StoredLocation | null => (enc ? decryptJson<StoredLocation>(enc) : null);

/** Read a location from FormData-like string values with a field prefix (e.g. "loc_city"). */
export function locationFromValues(values: Record<string, unknown>, prefix = 'loc_'): Record<string, unknown> {
  const keys = ['governorateId', 'city', 'street', 'building', 'floor', 'apartment', 'landmark', 'notes', 'lat', 'lng', 'accuracy'];
  return Object.fromEntries(keys.map((k) => [k, values[`${prefix}${k}`] ?? '']));
}
