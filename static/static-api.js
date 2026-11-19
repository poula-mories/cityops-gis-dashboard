/* CityOps static online demo: answers the dashboard's data calls in the browser, in place of
 * PostGIS + GeoServer, so the demo can be hosted as plain files.
 *
 * - Sample data comes from data/requests.json and data/districts.json (exported from PostGIS).
 *   Dates move forward by the time since the export, so "Last 7 days" and the weekly chart look the
 *   same on any day.
 * - A visitor's own changes are kept in their browser (localStorage) as edits on top of the sample
 *   data; "reset sample data" removes them. Nothing is sent anywhere.
 * - District counts, "closest" and "within a radius" are computed here with the same rules as the
 *   server's SQL (point in polygon; great-circle distance in metres).
 */
'use strict';

window.createStaticApi = function createStaticApi({ matches }) {
  const KEY = 'cityops-demo-edits-v1';
  const blank = () => ({ v: 1, added: [], changed: {}, deleted: [], nextId: 0 });
  let edits = readEdits();
  let data = null;             // { districts, seed, firstFreeId }
  const districtOf = new Map(); // request id -> district id (points never move)

  function readEdits() {
    try {
      const e = JSON.parse(localStorage.getItem(KEY));
      if (e && e.v === 1) return e;
    } catch (_) { /* storage blocked or unreadable: start from the sample data */ }
    return blank();
  }
  function saveEdits() {
    try { localStorage.setItem(KEY, JSON.stringify(edits)); }
    catch (_) { /* storage blocked (private mode): changes last until the page is reloaded */ }
  }

  async function load() {
    if (data) return data;
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const [req, dis] = await Promise.all([get('data/requests.json'), get('data/districts.json')]);
    const shift = Date.now() - Date.parse(req.exported_at);
    const move = s => new Date(Date.parse(s) + shift).toISOString();
    req.features.forEach(f => {
      f.properties.created_at = move(f.properties.created_at);
      f.properties.updated_at = move(f.properties.updated_at);
    });
    dis.features.forEach(d => { d.bbox = bboxOf(d.geometry); });
    data = { districts: dis, seed: req.features, firstFreeId: Math.max(...req.features.map(f => f.properties.id)) + 1 };
    return data;
  }

  /* The current requests: sample data plus this visitor's additions, changes and deletions. */
  function current() {
    const deleted = new Set(edits.deleted);
    return data.seed.concat(edits.added)
      .filter(f => !deleted.has(f.properties.id))
      .map(f => ({ ...f, properties: { ...f.properties, ...(edits.changed[f.properties.id] || {}) } }));
  }
  const collection = features => ({ type: 'FeatureCollection', features });
  const idOf = fid => Number(String(fid).split('.').pop());

  /* ---- geometry */
  function bboxOf(g) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    polys.forEach(p => p[0].forEach(([x, y]) => {
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }));
    return b;
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function districtIdAt([x, y]) {
    const d = data.districts.features.find(d => {
      const [x0, y0, x1, y1] = d.bbox;
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const polys = d.geometry.type === 'MultiPolygon' ? d.geometry.coordinates : [d.geometry.coordinates];
      return polys.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some(h => inRing(x, y, h)));
    });
    return d ? d.properties.id : null;
  }
  function metres(lat1, lon1, lat2, lon2) {            // great-circle distance
    const R = 6371008.8, rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  return {
    /* Requests matching the dashboard's filters. */
    async requests() {
      await load();
      return collection(current().filter(f => matches(f.properties)));
    },

    /* Districts with open / approved / total counts over all requests (like the district_stats view). */
    async districts() {
      await load();
      const counts = new Map();
      current().forEach(f => {
        const id = f.properties.id;
        if (!districtOf.has(id)) districtOf.set(id, districtIdAt(f.geometry.coordinates));
        const d = districtOf.get(id);
        if (d == null) return;
        const c = counts.get(d) || { open: 0, approved: 0, total: 0 };
        if (f.properties.status === 'new' || f.properties.status === 'in_review') c.open++;
        if (f.properties.status === 'approved') c.approved++;
        c.total++;
        counts.set(d, c);
      });
      return collection(data.districts.features.map(d => {
        const c = counts.get(d.properties.id) || { open: 0, approved: 0, total: 0 };
        return { type: 'Feature', id: d.id, geometry: d.geometry,
                 properties: { ...d.properties, open_requests: c.open, approved_requests: c.approved, total_requests: c.total } };
      }));
    },

    /* "Closest k" and "within a radius", over the requests matching the filters. */
    async area(view, params) {
      await load();
      const lon = +params.lon, lat = +params.lat;
      const list = current().filter(f => matches(f.properties)).map(f => {
        const [x, y] = f.geometry.coordinates;
        return { f, d: metres(lat, lon, y, x) };
      }).sort((a, b) => a.d - b.d);
      const picked = view === 'nearest_requests' ? list.slice(0, +params.k) : list.filter(r => r.d <= +params.radius);
      return collection(picked.map(({ f, d }) => ({ ...f, properties: { ...f.properties, distance_m: Math.round(d) } })));
    },

    async insert({ category, priority, description, lat, lng }) {
      await load();
      const id = Math.max(data.firstFreeId, edits.nextId);
      const now = new Date().toISOString();
      edits.added.push({
        type: 'Feature', id: `service_requests.${id}`,
        properties: { id, category, status: 'new', priority, description, created_at: now, updated_at: now },
        geometry: { type: 'Point', coordinates: [+lng.toFixed(6), +lat.toFixed(6)] }
      });
      edits.nextId = id + 1;
      saveEdits();
      return String(id);
    },

    async update(fid, props) {
      await load();
      const id = idOf(fid);
      if (!current().some(f => f.properties.id === id)) throw new Error('The change could not be saved. Please try again.');
      edits.changed[id] = { ...(edits.changed[id] || {}), ...props, updated_at: new Date().toISOString() };
      saveEdits();
    },

    async remove(fid) {
      await load();
      const id = idOf(fid);
      edits.deleted.push(id);
      delete edits.changed[id];
      saveEdits();
    },

    /* Back to the original sample data. */
    reset() {
      edits = blank();
      try { localStorage.removeItem(KEY); } catch (_) { /* nothing stored */ }
    }
  };
};
