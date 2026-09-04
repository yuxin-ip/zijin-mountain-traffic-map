// Build the bundled vector basemap from an Overpass `out geom` JSON extract.
// This is a build-time data conversion, never a request made by a visitor.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const input = process.argv[2];
assert(input, 'Usage: node scripts/build-basemap.cjs <overpass.json>');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
assert(!source.remark && source.elements.length > 1000, 'Incomplete Overpass response');
const project = p => [Math.round((p.lon - 118.8) * 94300 * 10) / 10, Math.round((32.07 - p.lat) * 111320 * 10) / 10];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const area = ring => ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2;
const bounds = [-1414.5, -5009.4, 11787.5, 6122.6];
const inside = p => p[0] >= bounds[0] && p[0] <= bounds[2] && p[1] >= bounds[1] && p[1] <= bounds[3];
function joinRings(members) {
  const pending = members.filter(m => m.geometry?.length > 1).map(m => m.geometry.map(project));
  const rings = [];
  while (pending.length) {
    let ring = pending.pop();
    while (!same(ring[0], ring.at(-1))) {
      const i = pending.findIndex(p => same(ring.at(-1), p[0]) || same(ring.at(-1), p.at(-1)) || same(ring[0], p[0]) || same(ring[0], p.at(-1)));
      if (i === -1) break;
      let segment = pending.splice(i, 1)[0];
      if (same(ring.at(-1), segment[0])) ring.push(...segment.slice(1));
      else if (same(ring.at(-1), segment.at(-1))) ring.push(...segment.reverse().slice(1));
      else {
        if (same(ring[0], segment[0])) segment.reverse();
        ring = [...segment.slice(0, -1), ...ring];
      }
    }
    // Never fill an incomplete relation by drawing an invented closing edge.
    if (ring.length > 3 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}
function simplify(points, tolerance) {
  if (points.length < 3 || tolerance === 0) return points;
  const a = points[0], b = points.at(-1), dx = b[0] - a[0], dy = b[1] - a[1];
  let farthest = tolerance * tolerance, index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (distance > farthest) { farthest = distance; index = i; }
  }
  return index === -1 ? [a, b] : [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
function encode(points, closed = false) {
  const simplified = simplify(points, closed ? 0.5 : 1);
  return simplified.map((p, i) => `${i ? 'L' : 'M'}${p.join(',')}`).join('') + (closed ? 'Z' : '');
}
const layers = new Map();
const labels = new Map();
function add(kind, level, d, count = 1) {
  const key = `${kind}-${level}`;
  const layer = layers.get(key) || { kind, level, d: '', count: 0 };
  layer.d += d; layer.count += count; layers.set(key, layer);
}
function addLabel(e, points, kind, level, weight = 0) {
  const name = e.tags?.['name:zh'] || e.tags?.name;
  if (!name || name.length > 24 || !points.length) return;
  const point = kind === 'street' ? points[Math.floor(points.length / 2)] : [
    (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2,
    (Math.min(...points.map(p => p[1])) + Math.max(...points.map(p => p[1]))) / 2,
  ];
  if (!inside(point)) return;
  const key = `${kind}-${name}`;
  if (!labels.has(key) || labels.get(key).weight < weight) labels.set(key, { name, point, kind, level, weight });
}
for (const e of source.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const kind = t.natural === 'peak' ? 'peak' : t.railway === 'station' ? 'station' : t.amenity === 'toilets' ? 'toilet' : 'poi';
    addLabel(e, [project(e)], kind, kind === 'peak' ? 0 : kind === 'station' ? 1 : 2);
    continue;
  }
  const points = e.geometry?.map(project) || [];
  const highway = t.highway;
  if (highway && !['construction', 'proposed', 'raceway', 'services'].includes(highway) && t.area !== 'yes' && points.length > 1) {
    const major = /^(motorway|trunk|primary|secondary)(_|$)/.test(highway);
    const trail = /^(footway|path|steps|track|cycleway|pedestrian)$/.test(highway);
    const kind = highway === 'steps' ? 'steps' : trail ? 'trail' : major ? 'major' : highway === 'service' ? 'service' : 'street';
    const level = kind === 'steps' ? 2 : ['trail', 'service'].includes(kind) ? 1 : 0;
    add(kind, level, encode(points));
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
    addLabel(e, points, 'street', major ? 0 : trail ? 2 : 1, length);
    continue;
  }
  if (t.railway && ['rail', 'subway', 'light_rail'].includes(t.railway) && points.length > 1) {
    add(t.railway === 'subway' ? 'subway' : 'rail', t.railway === 'subway' ? 1 : 0, encode(points));
    continue;
  }
  if (t.waterway && points.length > 1 && !['dam', 'weir'].includes(t.waterway)) {
    add('stream', t.waterway === 'river' ? 0 : 1, encode(points)); continue;
  }
  let outers = [], inners = [];
  if (e.type === 'relation' && t.type === 'multipolygon') {
    outers = joinRings(e.members.filter(m => m.role === 'outer' || !m.role));
    inners = joinRings(e.members.filter(m => m.role === 'inner'));
  } else if (points.length > 3 && same(points[0], points.at(-1))) outers = [points];
  if (!outers.length) continue;
  const size = outers.reduce((sum, p) => sum + Math.abs(area(p)), 0);
  let kind = '';
  if (t.natural === 'water' || ['reservoir', 'basin'].includes(t.landuse)) kind = 'water';
  else if (t.building && t.building !== 'no') kind = 'building';
  else if (t.natural === 'wood' || t.landuse === 'forest') kind = 'forest';
  else if (['park', 'garden', 'nature_reserve'].includes(t.leisure)) kind = 'park';
  else if (['pitch', 'playground'].includes(t.leisure)) kind = 'pitch';
  else if (['scrub', 'grassland', 'wetland'].includes(t.natural) || ['grass', 'meadow', 'recreation_ground', 'village_green', 'farmland', 'greenfield'].includes(t.landuse)) kind = 'grass';
  else if (t.amenity === 'university' || t.landuse === 'education') kind = 'campus';
  else if (t.amenity === 'parking') kind = 'parking';
  else if (t.landuse) kind = 'urban';
  if (!kind) { addLabel(e, outers[0], 'poi', 1, size); continue; }
  const level = kind === 'building' ? 2 : ['parking', 'pitch'].includes(kind) || size < 1800 ? 1 : 0;
  const rings = [...outers.map(p => area(p) > 0 ? p : [...p].reverse()), ...inners.map(p => area(p) < 0 ? p : [...p].reverse())];
  add(kind, level, rings.map(p => encode(p, true)).join(''));
  if (kind !== 'building') addLabel(e, outers[0], kind === 'water' ? 'water' : kind === 'forest' || kind === 'park' ? 'area' : 'poi', size > 100000 ? 0 : kind === 'parking' ? 2 : 1, size);
}
const data = {
  attribution: '© OpenStreetMap contributors',
  license: 'https://opendatacommons.org/licenses/odbl/1-0/',
  source: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  timestamp: source.osm3s.timestamp_osm_base,
  bbox: [32.015, 118.785, 32.115, 118.925], bounds,
  projection: 'x=(longitude-118.8)*94300; y=(32.07-latitude)*111320; metres',
  layers: [...layers.values()],
  labels: [...labels.values()].map(({ weight, ...label }) => label),
};
for (const kind of ['forest', 'water', 'building', 'major', 'street', 'trail']) assert(data.layers.some(l => l.kind === kind && l.count > 10), `Missing ${kind}`);
fs.mkdirSync('public/data', { recursive: true });
// Keep the importable module outside public/ (Vite reserves public/ for URLs).
// Publish an identical downloadable copy to satisfy the data licence.
fs.writeFileSync('app/data/basemap.json', JSON.stringify(data));
fs.writeFileSync('public/data/basemap.json', JSON.stringify(data));
console.log(JSON.stringify({ bytes: fs.statSync('public/data/basemap.json').size, layers: data.layers.map(({ d, ...l }) => l), labels: data.labels.length, timestamp: data.timestamp }, null, 2));
