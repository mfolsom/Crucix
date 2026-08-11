// Local-area intelligence aggregator — a "zoom-in" on the operator's home turf.
// Configurable center (defaults to Seattle via crucix.config.mjs -> config.local).
// Pulls keyless, real-time feeds scoped to a bounding box / radius around it:
//   - NWS weather alerts (api.weather.gov, keyless)
//   - USGS earthquakes (reuses the sweep's earthquake feed, keyless)
//   - OpenSky flights currently overhead (keyless)
//   - Safecast radiation readings nearby (keyless)
//   - FIRMS fires nearby (needs FIRMS_MAP_KEY; degrades gracefully)
//   - Civic emergency-response feed via Socrata (data.seattle.gov, keyless)
//
// Every feed is isolated: one failing API never fails the panel.

import { safeFetch } from '../utils/fetch.mjs';
import { fetchQuakes, haversineKm } from './usgs.mjs';
import { getMeasurements } from './safecast.mjs';
import { getFlightsInArea } from './opensky.mjs';

const NWS_BASE = 'https://api.weather.gov';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

// Convert a center + radius (km) into a lat/lon bounding box.
function bboxFor(lat, lon, radiusKm) {
  const dLat = radiusKm / 111; // ~111 km per degree latitude
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    south: +(lat - dLat).toFixed(3),
    north: +(lat + dLat).toFixed(3),
    west: +(lon - dLon).toFixed(3),
    east: +(lon + dLon).toFixed(3),
  };
}

// ─── NWS weather alerts near the center ──────────────────────────────────────
async function localWeather(center) {
  const data = await safeFetch(
    `${NWS_BASE}/alerts/active?point=${center.lat},${center.lon}`,
    { headers: { Accept: 'application/geo+json' }, timeout: 15000 }
  );
  if (data?.error || !Array.isArray(data?.features)) return { error: data?.error || 'unavailable', alerts: [] };
  const alerts = data.features.slice(0, 8).map(f => {
    const p = f.properties || {};
    return {
      event: p.event || 'Alert',
      severity: p.severity || 'Unknown',
      urgency: p.urgency || '',
      headline: (p.headline || '').substring(0, 140),
      area: (p.areaDesc || '').substring(0, 120),
      onset: p.onset || p.effective || null,
      expires: p.expires || null,
    };
  });
  return { alerts };
}

// ─── USGS quakes within the radius ───────────────────────────────────────────
async function localQuakes(center, radiusKm) {
  const { error, quakes } = await fetchQuakes();
  if (error) return { error, quakes: [] };
  const near = quakes
    .map(q => ({ ...q, distanceKm: +haversineKm(center.lat, center.lon, q.lat, q.lon).toFixed(1) }))
    // Wider net for quakes — regional seismicity matters even a few hundred km out.
    .filter(q => q.distanceKm <= Math.max(radiusKm * 3, 400))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
  return { quakes: near };
}

// ─── OpenSky flights currently in the box ────────────────────────────────────
async function localFlights(bbox) {
  const data = await getFlightsInArea(bbox.south, bbox.west, bbox.north, bbox.east);
  if (data?.error || !Array.isArray(data?.states)) return { error: data?.error || 'unavailable', count: 0, sample: [] };
  // OpenSky state vector indices: 1=callsign, 2=origin_country, 5=lon, 6=lat,
  // 7=baro_altitude, 9=velocity, 11=vertical_rate, 13=geo_altitude
  const flights = data.states.map(s => ({
    callsign: (s[1] || '').trim(),
    country: s[2] || '',
    lon: s[5], lat: s[6],
    altitude: s[13] || s[7] || null,
    velocity: s[9] || null,
    onGround: Boolean(s[8]),
  })).filter(f => f.lat != null && f.lon != null);
  const airborne = flights.filter(f => !f.onGround);
  return {
    count: airborne.length,
    onGround: flights.length - airborne.length,
    sample: airborne
      .sort((a, b) => (b.altitude || 0) - (a.altitude || 0))
      .slice(0, 8)
      .map(f => ({ callsign: f.callsign || '(no callsign)', country: f.country, altitude: f.altitude, lat: f.lat, lon: f.lon })),
  };
}

// ─── Safecast radiation nearby ───────────────────────────────────────────────
async function localRadiation(center, radiusKm) {
  const data = await getMeasurements({ latitude: center.lat, longitude: center.lon, distance: radiusKm, limit: 20 });
  const measurements = Array.isArray(data) ? data : [];
  const cpm = measurements.map(m => m.value).filter(v => typeof v === 'number');
  if (cpm.length === 0) return { readings: 0, avgCPM: null, maxCPM: null, anomaly: false };
  const avg = cpm.reduce((a, b) => a + b, 0) / cpm.length;
  return {
    readings: cpm.length,
    avgCPM: +avg.toFixed(1),
    maxCPM: +Math.max(...cpm).toFixed(1),
    // Normal background is ~10-80 CPM; flag clearly elevated readings.
    anomaly: avg > 100,
    lastReading: measurements[0]?.captured_at || null,
  };
}

// ─── FIRMS fires in the box (key-gated) ──────────────────────────────────────
async function localFires(bbox) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return { available: false, count: 0, fires: [] };
  const url = `${FIRMS_BASE}/${key}/VIIRS_SNPP_NRT/${bbox.west},${bbox.south},${bbox.east},${bbox.north}/1`;
  const raw = await safeFetch(url, { timeout: 20000 });
  const text = typeof raw === 'string' ? raw : raw?.rawText;
  if (!text || typeof text !== 'string') return { available: true, count: 0, fires: [] };
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { available: true, count: 0, fires: [] };
  const headers = lines[0].split(',');
  const li = headers.indexOf('latitude');
  const lni = headers.indexOf('longitude');
  const fi = headers.indexOf('frp');
  const fires = lines.slice(1, 40).map(l => {
    const v = l.split(',');
    return { lat: parseFloat(v[li]), lon: parseFloat(v[lni]), frp: parseFloat(v[fi]) || 0 };
  }).filter(f => !Number.isNaN(f.lat) && !Number.isNaN(f.lon));
  return { available: true, count: fires.length, fires: fires.slice(0, 20) };
}

// ─── Civic emergency-response feed (Socrata / data.seattle.gov) ──────────────
// Seattle Real-Time Fire 911 dispatch (dataset kzjm-xkqj). Keyless for modest
// use. Covers first-responder activity — fires, aid, rescue, hazmat.
async function localCivic(cfg) {
  if (!cfg.civicHost || !cfg.civicDataset) return { available: false, incidents: [] };
  const url = `https://${cfg.civicHost}/resource/${cfg.civicDataset}.json?$order=datetime DESC&$limit=12`;
  const rows = await safeFetch(url, { timeout: 15000 });
  if (rows?.error || !Array.isArray(rows)) return { available: false, error: rows?.error || 'unavailable', incidents: [] };
  const incidents = rows.map(r => ({
    type: (r.type || 'Incident').substring(0, 60),
    address: (r.address || '').substring(0, 80),
    time: r.datetime || null,
    lat: r.latitude ? parseFloat(r.latitude) : (r.longitude ? null : null),
    lon: r.longitude ? parseFloat(r.longitude) : null,
  })).filter(Boolean);
  return { available: true, source: 'Seattle Fire 911', incidents };
}

export async function briefing(cfg) {
  const center = { lat: cfg?.lat ?? 47.6062, lon: cfg?.lon ?? -122.3321 };
  const radiusKm = cfg?.radiusKm ?? 120;
  const label = cfg?.label ?? 'Seattle';
  const bbox = bboxFor(center.lat, center.lon, radiusKm);

  // Fan out; isolate each feed so one failure never sinks the panel.
  const [weather, quakes, flights, radiation, fires, civic] = await Promise.all([
    localWeather(center).catch(e => ({ error: e.message, alerts: [] })),
    localQuakes(center, radiusKm).catch(e => ({ error: e.message, quakes: [] })),
    localFlights(bbox).catch(e => ({ error: e.message, count: 0, sample: [] })),
    localRadiation(center, radiusKm).catch(e => ({ error: e.message, readings: 0 })),
    localFires(bbox).catch(e => ({ error: e.message, count: 0, fires: [] })),
    localCivic(cfg).catch(e => ({ error: e.message, incidents: [] })),
  ]);

  // Roll up a few headline signals for the alert/delta layer.
  const signals = [];
  for (const a of (weather.alerts || [])) {
    if (/Extreme|Severe/i.test(a.severity)) signals.push(`${label}: ${a.event} — ${a.severity}`);
  }
  const bigQuake = (quakes.quakes || []).find(q => q.mag >= 4);
  if (bigQuake) signals.push(`${label}: M${bigQuake.mag} quake ${bigQuake.distanceKm}km away — ${bigQuake.place}`);
  if (radiation.anomaly) signals.push(`${label}: elevated radiation ${radiation.avgCPM} CPM`);
  if ((fires.count || 0) > 0) signals.push(`${label}: ${fires.count} active fire detection(s) nearby`);

  return {
    source: 'Local',
    timestamp: new Date().toISOString(),
    label,
    center,
    radiusKm,
    bbox,
    weather,
    quakes,
    flights,
    radiation,
    fires,
    civic,
    signals,
  };
}

if (process.argv[1]?.endsWith('local.mjs')) {
  const cfg = (await import('../../crucix.config.mjs')).default.local;
  const data = await briefing(cfg);
  console.log(JSON.stringify(data, null, 2));
}
