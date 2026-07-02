// Per-activity geocoding via Photon (OpenStreetMap-based, free, no API key,
// good at points of interest). Best-effort: an activity that doesn't resolve
// simply gets no pin, and any failure leaves the plan untouched.

const PHOTON_URL = "https://photon.komoot.io/api/";

// Cap total lookups so a very long trip can't balloon latency.
const MAX_GEOCODES = 60;

async function geocodeOne(query) {
  const res = await fetch(PHOTON_URL + "?" + new URLSearchParams({ q: query, limit: "1" }));
  if (!res.ok) return null;
  const j = await res.json();
  const f = j && j.features && j.features[0];
  const c = f && f.geometry && f.geometry.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") {
    return null;
  }
  return { lat: c[1], lng: c[0] }; // GeoJSON is [lng, lat]
}

// Run fn over items with limited concurrency; failures become null.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch {
        results[idx] = null;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// Query key for a slot: its clean "place" name plus the city to disambiguate.
// Returns "" when the slot has no specific place (so it's skipped).
function slotQuery(slot, city) {
  const place = String(slot.place || "").trim();
  return place ? `${place}, ${city}` : "";
}

// Attaches lat/lng to each itinerary slot whose "place" could be located. The
// model supplies "place" as a bare, mappable venue name (the descriptive
// activity_title is too embellished to geocode reliably).
export async function enrichPlanWithActivityCoords(plan) {
  const days = plan?.itinerary || [];
  const queries = [
    ...new Set(
      days.flatMap((d) =>
        (d.slots || []).map((s) => slotQuery(s, d.location)).filter(Boolean),
      ),
    ),
  ].slice(0, MAX_GEOCODES);

  const results = await mapLimit(queries, 5, geocodeOne);
  const coords = new Map(queries.map((q, i) => [q, results[i]]));

  for (const day of days) {
    for (const slot of day.slots || []) {
      const c = coords.get(slotQuery(slot, day.location));
      if (c) {
        slot.lat = c.lat;
        slot.lng = c.lng;
      }
    }
  }
  return plan;
}
