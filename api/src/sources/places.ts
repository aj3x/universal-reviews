/**
 * Google Places API (New), kept inside the free monthly caps:
 *  - Autocomplete Requests (10k/month free), with a session token
 *  - Place Details Essentials (10k/month free): only id, formattedAddress, location.
 *    displayName is a Pro field, so the name comes from the autocomplete suggestion.
 * The API key stays on the server.
 */

export type PlaceSuggestion = { placeId: string; name: string; secondary: string; distanceMeters?: number; types: string[] };
export type PlaceEssentials = { placeId: string; address: string | null; lat: number | null; lng: number | null };

export interface PlacesClient {
  autocomplete(input: string, sessionToken: string, near?: { lat: number; lng: number }): Promise<PlaceSuggestion[]>;
  details(placeId: string, sessionToken?: string): Promise<PlaceEssentials>;
}

import { UpstreamError, upstreamFetch } from "./upstream.js";

const BASE = "https://places.googleapis.com/v1";

export function createPlacesClient(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesClient {
  return {
    async autocomplete(input, sessionToken, near) {
      const body: Record<string, unknown> = {
        input,
        sessionToken,
        includedPrimaryTypes: ["restaurant", "cafe", "bar", "bakery", "meal_takeaway"],
      };
      if (near) {
        body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 20000 } };
        body.origin = { latitude: near.lat, longitude: near.lng }; // makes Google return distanceMeters
      }
      const res = await upstreamFetch("places", fetchImpl, `${BASE}/places:autocomplete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new UpstreamError("places", `autocomplete failed: ${res.status}`);
      const json = (await res.json()) as {
        suggestions?: Array<{
          placePrediction?: {
            placeId: string;
            distanceMeters?: number;
            types?: string[];
            structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
            text?: { text: string };
          };
        }>;
      };
      const out = (json.suggestions ?? []).flatMap((s): PlaceSuggestion[] => {
        const p = s.placePrediction;
        if (!p) return [];
        return [{
          placeId: p.placeId,
          name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
          secondary: p.structuredFormat?.secondaryText?.text ?? "",
          types: p.types ?? [],
          distanceMeters: p.distanceMeters,
        }];
      });
      return out;
    },

    async details(placeId, sessionToken) {
      const url = new URL(`${BASE}/places/${encodeURIComponent(placeId)}`);
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
      const res = await upstreamFetch("places", fetchImpl, url, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,formattedAddress,location" },
      });
      if (!res.ok) throw new UpstreamError("places", `details failed: ${res.status}`);
      const json = (await res.json()) as {
        id: string;
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
      };
      return {
        placeId: json.id,
        address: json.formattedAddress ?? null,
        lat: json.location?.latitude ?? null,
        lng: json.location?.longitude ?? null,
      };
    },
  };
}
