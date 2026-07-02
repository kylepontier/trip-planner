// Free, no-key weather via Open-Meteo. For each trip location we geocode the
// city name, then fetch a real FORECAST when the dates are near, or last year's
// actuals for the same dates as a "TYPICAL" stand-in when they're too far out
// for a forecast (forecasts only exist ~16 days ahead). Every failure degrades
// gracefully to "no weather" — this never throws.

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

// WMO weather codes → a simple emoji + short label.
function wmo(code) {
  if (code === 0) return { icon: "☀️", label: "Clear" };
  if (code <= 2) return { icon: "🌤️", label: "Mostly clear" };
  if (code === 3) return { icon: "☁️", label: "Cloudy" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Rain" };
  if (code >= 71 && code <= 77) return { icon: "❄️", label: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "🌦️", label: "Showers" };
  if (code >= 85 && code <= 86) return { icon: "🌨️", label: "Snow showers" };
  if (code >= 95) return { icon: "⛈️", label: "Thunderstorm" };
  return { icon: "🌡️", label: "" };
}

async function getJson(url, params) {
  const res = await fetch(url + "?" + new URLSearchParams(params));
  if (!res.ok) return null;
  return res.json();
}

async function geocode(name) {
  const j = await getJson(GEO_URL, { name, count: 1 });
  const r = j && j.results && j.results[0];
  return r ? { lat: r.latitude, lng: r.longitude } : null;
}

function shiftYear(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + delta}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toDays(daily) {
  if (!daily || !Array.isArray(daily.time)) return null;
  return daily.time.map((t, i) => ({
    date: t,
    tmax: daily.temperature_2m_max?.[i],
    tmin: daily.temperature_2m_min?.[i],
    code: daily.weather_code?.[i],
  }));
}

async function fetchRange(lat, lng, start, end) {
  const common = {
    latitude: lat,
    longitude: lng,
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    temperature_unit: "fahrenheit",
    timezone: "auto",
  };

  // Try a real forecast first.
  const f = await getJson(FORECAST_URL, { ...common, start_date: start, end_date: end });
  const fdays = toDays(f && f.daily);
  if (fdays && fdays.some((d) => d.tmax != null)) {
    return { mode: "forecast", days: fdays };
  }

  // Too far out for a forecast: use last year's actuals for the same dates.
  const a = await getJson(ARCHIVE_URL, {
    ...common,
    start_date: shiftYear(start, -1),
    end_date: shiftYear(end, -1),
  });
  const adays = toDays(a && a.daily);
  if (adays && adays.some((d) => d.tmax != null)) {
    // Map the prior-year dates back onto the actual trip dates by position.
    return {
      mode: "typical",
      days: adays.map((d) => ({ ...d, date: shiftYear(d.date, 1) })),
    };
  }

  return null;
}

// Enriches the plan in place: attaches lat/lng to each location (for the map)
// and builds plan.weather keyed by "YYYY-MM-DD". Best-effort; never throws.
export async function enrichPlanWithWeather(plan) {
  const locations = plan?.trip_summary?.locations || [];
  plan.weather = {};

  await Promise.all(
    locations.map(async (loc) => {
      try {
        const geo = await geocode(loc.name);
        if (!geo) return;
        loc.lat = geo.lat;
        loc.lng = geo.lng;

        const w = await fetchRange(geo.lat, geo.lng, loc.start, loc.end);
        if (!w) return;
        for (const d of w.days) {
          if (d.tmax == null) continue;
          const info = wmo(d.code);
          plan.weather[d.date] = {
            mode: w.mode, // "forecast" | "typical"
            tmax: Math.round(d.tmax),
            tmin: Math.round(d.tmin),
            icon: info.icon,
            label: info.label,
          };
        }
      } catch {
        /* skip this location — weather is best-effort */
      }
    }),
  );

  return plan;
}
