// USGS Earthquake Hazards Program — global seismic activity
// No auth required. Real-time GeoJSON feeds, updated every minute.
// Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

import { safeFetch } from '../utils/fetch.mjs';

// Rolling 24h feed of M2.5+ quakes worldwide (small, fast, good signal).
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

function mapQuake(f) {
  const [lon, lat, depth] = f.geometry?.coordinates || [];
  const p = f.properties || {};
  return {
    id: f.id,
    mag: typeof p.mag === 'number' ? +p.mag.toFixed(1) : null,
    place: (p.place || '').substring(0, 90),
    time: p.time ? new Date(p.time).toISOString() : null,
    depth: typeof depth === 'number' ? +depth.toFixed(1) : null,
    tsunami: p.tsunami === 1,
    felt: p.felt || 0,
    url: p.url || null,
    lat: typeof lat === 'number' ? +lat.toFixed(3) : null,
    lon: typeof lon === 'number' ? +lon.toFixed(3) : null,
  };
}

// Great-circle distance in km (haversine).
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fetch and normalize the rolling feed. Reused by the local-area aggregator so
// we don't hit USGS twice per sweep.
export async function fetchQuakes() {
  const data = await safeFetch(FEED_URL, { timeout: 20000, retries: 1 });
  if (data?.error || !Array.isArray(data?.features)) {
    return { error: data?.error || 'No earthquake data', quakes: [] };
  }
  const quakes = data.features
    .map(mapQuake)
    .filter(q => q.lat != null && q.lon != null && q.mag != null)
    .sort((a, b) => (b.mag || 0) - (a.mag || 0));
  return { quakes };
}

export async function briefing() {
  const { error, quakes } = await fetchQuakes();
  if (error) {
    return { source: 'USGS', error, quakes: [], signals: [] };
  }

  const significant = quakes.filter(q => q.mag >= 5);
  const tsunamiFlags = quakes.filter(q => q.tsunami);

  const signals = [];
  for (const q of significant.slice(0, 5)) {
    signals.push(`M${q.mag} earthquake — ${q.place}`);
  }
  if (tsunamiFlags.length > 0) {
    signals.push(`TSUNAMI flag on ${tsunamiFlags.length} event(s) — verify with NWS/NOAA`);
  }

  return {
    source: 'USGS',
    timestamp: new Date().toISOString(),
    total: quakes.length,
    maxMag: quakes[0]?.mag ?? null,
    significant: significant.length,
    // Cap the payload; the feed can carry a few hundred small quakes.
    quakes: quakes.slice(0, 60),
    signals: signals.length ? signals : ['No significant (M5+) earthquakes in the last 24h'],
  };
}

if (process.argv[1]?.endsWith('usgs.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
