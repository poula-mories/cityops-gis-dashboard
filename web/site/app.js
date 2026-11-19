/* CityOps GIS dashboard
 * Reads:  GeoServer WMS (district choropleth) and WFS (requests, district stats, SQL views)
 * Writes: WFS-T Insert / Update / Delete through /api/wfst (Nginx adds the editor credentials)
 */
'use strict';

const GS = '/geoserver/demo';
const WFST_URL = '/api/wfst';
const NS = 'http://cityops.example/demo';

const STATUS = {
  new:       { label: 'New',       color: '#2563eb' },
  in_review: { label: 'In review', color: '#f59e0b' },
  approved:  { label: 'Approved',  color: '#16a34a' },
  rejected:  { label: 'Rejected',  color: '#dc2626' }
};
const CATEGORY = {
  road:     { label: 'Road',     color: '#475569' },
  water:    { label: 'Water',    color: '#0284c7' },
  lighting: { label: 'Lighting', color: '#eab308' },
  waste:    { label: 'Waste',    color: '#a16207' }
};
const PRIORITY_RADIUS = { low: 4, normal: 5.5, high: 7 };

const state = {
  categories: new Set(Object.keys(CATEGORY)),
  statuses: new Set(Object.keys(STATUS)),
  priority: 'all',
  periodDays: 0,
  features: [],
  districts: null,
  mode: null,            // 'add' | 'nearest' | 'radius'
  pendingLatLng: null
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xmlEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/* ------------------------------------------------------------------ toasts */
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* -------------------------------------------------------------------- map */
/* Drawing order, bottom to top: basemap, district colours (tiles), hotspots, request points, then
   district names. Names ignore the mouse, so clicks always reach the points underneath. */
const map = L.map('map', { zoomControl: false, zoomSnap: 0.25, renderer: L.canvas({ pane: 'requestsPane' }) })
  .setView([30.045, 31.28], 13);
map.createPane('labelsPane').style.zIndex = 460;
map.getPane('labelsPane').style.pointerEvents = 'none';
map.createPane('requestsPane').style.zIndex = 450;
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

const BASEMAPS = {
  // OSM tiles muted with a CSS filter: a clean "light" basemap with no API key.
  Light: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'tiles-muted', attribution: '&copy; OpenStreetMap contributors' }),
  Streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery &copy; Esri' })
};
let currentBase = BASEMAPS.Light.addTo(map);

const districtsWms = L.tileLayer.wms(`${GS}/wms`, {
  layers: 'demo:district_stats', format: 'image/png', transparent: true, version: '1.1.1', _ts: Date.now(),
  attribution: 'Districts &copy; CAPMAS'
}).addTo(map);
const districtLabels = L.layerGroup().addTo(map);
const requestsLayer = L.layerGroup().addTo(map);
const heatLayer = L.heatLayer([], { radius: 26, blur: 20, maxZoom: 15, max: 2.5, minOpacity: 0.3,
  gradient: { 0.25: '#fde68a', 0.5: '#f59e0b', 0.75: '#ef4444', 1: '#7f1d1d' } });
const analysisLayer = L.layerGroup().addTo(map);

/* Map panel: basemaps + layers + legend */
const panel = L.control({ position: 'topright' });
panel.onAdd = () => {
  const div = L.DomUtil.create('div', 'map-panel');
  // On small screens the panel starts folded behind a "Map layers" button so it doesn't cover the map.
  div.innerHTML = `
    <button type="button" class="mp-toggle" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      Map layers
    </button>
    <div class="mp-body">
    <h4>Basemap</h4>
    <div class="basemaps">${Object.keys(BASEMAPS).map((k, i) => `<button data-base="${k}" class="${i === 0 ? 'on' : ''}">${k}</button>`).join('')}</div>
    <h4 style="margin-top:10px">Layers</h4>
    <label><input type="checkbox" data-layer="requests" checked> Requests</label>
    <label><input type="checkbox" data-layer="districts" checked> Districts</label>
    <label><input type="checkbox" data-layer="heat"> Hotspots</label>
    <h4 style="margin-top:10px">Request status</h4>
    ${Object.values(STATUS).map(s => `<div class="legend-row"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`).join('')}
    <h4 style="margin-top:10px">Open requests per district</h4>
    <div class="legend-row"><span class="legend-sw" style="background:#ccfbf1"></span>6 or fewer</div>
    <div class="legend-row"><span class="legend-sw" style="background:#5eead4"></span>7 – 11</div>
    <div class="legend-row"><span class="legend-sw" style="background:#0d9488"></span>12 or more</div>
    </div>`;
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  div.addEventListener('click', e => {
    const toggle = e.target.closest('.mp-toggle');
    if (toggle) {
      const open = div.classList.toggle('expanded');
      toggle.setAttribute('aria-expanded', open);
      return;
    }
    const base = e.target.dataset.base;
    if (!base) return;
    map.removeLayer(currentBase);
    currentBase = BASEMAPS[base].addTo(map);
    currentBase.bringToBack();
    div.querySelectorAll('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === base));
  });
  div.addEventListener('change', e => {
    const layer = e.target.dataset.layer, on = e.target.checked;
    const target = { districts: [districtsWms, districtLabels], requests: [requestsLayer], heat: [heatLayer] }[layer];
    target.forEach(l => on ? l.addTo(map) : map.removeLayer(l));
    if (on && layer === 'districts') { districtLabels.eachLayer(g => g.bringToBack()); setTimeout(declutterLabels, 0); }
    if (on && layer === 'heat') heatLayer.setLatLngs(state.heatPoints || []);
  });
  return div;
};
panel.addTo(map);

/* ------------------------------------------------------------ filters (UI) */
function buildChips(containerId, dict, set) {
  const box = $(containerId);
  box.innerHTML = Object.entries(dict).map(([k, v]) =>
    `<span class="chip on" data-key="${k}"><span class="sw" style="background:${v.color}"></span>${v.label}</span>`).join('');
  box.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const k = chip.dataset.key;
    set.has(k) ? set.delete(k) : set.add(k);
    chip.classList.toggle('on', set.has(k));
    applyFilters();
  });
}
/* Filters apply to the map, numbers, charts and the open "Explore an area" result alike. */
function applyFilters() {
  loadRequests();
  if (state.lastAnalysis) rerunAnalysis();
}
buildChips('categoryChips', CATEGORY, state.categories);
buildChips('statusChips', STATUS, state.statuses);
$('priorityFilter').addEventListener('change', e => { state.priority = e.target.value; applyFilters(); });
$('periodFilter').addEventListener('change', e => { state.periodDays = +e.target.value; applyFilters(); });
$('resetFilters').addEventListener('click', () => {
  Object.keys(CATEGORY).forEach(k => state.categories.add(k));
  Object.keys(STATUS).forEach(k => state.statuses.add(k));
  document.querySelectorAll('.chip').forEach(c => c.classList.add('on'));
  state.priority = 'all'; $('priorityFilter').value = 'all';
  state.periodDays = 0; $('periodFilter').value = '0';
  applyFilters();
});

/* Server-side filter: ECQL sent to GeoServer, executed by PostGIS. */
function buildCql() {
  if (!state.categories.size || !state.statuses.size) return 'EXCLUDE';
  const parts = [
    `category IN (${[...state.categories].map(c => `'${c}'`).join(',')})`,
    `status IN (${[...state.statuses].map(s => `'${s}'`).join(',')})`
  ];
  if (state.priority !== 'all') parts.push(`priority = '${state.priority}'`);
  if (state.periodDays) {
    const from = new Date(Date.now() - state.periodDays * 864e5).toISOString().slice(0, 19) + 'Z';
    parts.push(`created_at >= ${from}`);
  }
  return parts.join(' AND ');
}

function wfsUrl(typeName, extra = '') {
  return `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=demo:${typeName}` +
         `&outputFormat=application/json&srsName=EPSG:4326${extra}`;
}

/* ------------------------------------------------------------ data loading */
/* Each loader returns true when the data changed, so a background refresh redraws only what moved.
   Responses can come back out of order (quick filter clicks, a background check, a save), so each
   load is numbered and only the newest one is drawn. */
async function loadRequests({ quiet = false } = {}) {
  const seq = state.requestsSeq = (state.requestsSeq || 0) + 1;
  try {
    const res = await fetch(wfsUrl('service_requests', `&CQL_FILTER=${encodeURIComponent(buildCql())}`));
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    const fc = await res.json();
    if (seq !== state.requestsSeq) return false;
    const sig = fc.features.map(f => `${f.id}|${f.properties.status}|${f.properties.priority}|${f.properties.updated_at}`).sort().join(';');
    if (quiet && sig === state.requestsSig) return false;
    state.requestsSig = sig;
    state.features = fc.features;
    renderRequests();
    renderKpis();
    renderCharts();
    return true;
  } catch (err) {
    console.error(err);
    if (!quiet && seq === state.requestsSeq) toast('Could not load the requests. Please refresh the page.', 'err');
    return false;
  }
}

async function loadDistricts({ quiet = false } = {}) {
  const seq = state.districtsSeq = (state.districtsSeq || 0) + 1;
  let fc;
  try {
    const res = await fetch(wfsUrl('district_stats'));
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    fc = await res.json();
  } catch (err) {
    console.error(err);
    if (!quiet && seq === state.districtsSeq) toast('Could not load the districts. Please refresh the page.', 'err');
    return false;
  }
  if (seq !== state.districtsSeq) return false;
  // district_stats is a view with no primary key, so GeoServer invents a new feature id on every
  // request: compare the view's own id column and counts, in a fixed order.
  const sig = fc.features.map(f => { const p = f.properties; return `${p.id}|${p.open_requests}|${p.approved_requests}|${p.total_requests}`; }).sort().join(';');
  if (quiet && sig === state.districtsSig) return false;
  state.districtsSig = sig;
  state.districts = fc;
  districtLabels.clearLayers();
  L.geoJSON(state.districts, {
    style: { stroke: false, fillOpacity: 0 },
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(esc(p.name), { permanent: true, direction: 'center', className: 'district-label', pane: 'labelsPane' });
      const html = `<div class="popup"><h3>${esc(p.name)} <span class="ar" lang="ar" dir="rtl">${esc(p.name_ar)}</span></h3>
        <div class="meta">Requests in this district</div>
        Open: <b>${p.open_requests}</b> · Approved: <b>${p.approved_requests}</b> · Total: <b>${p.total_requests}</b></div>`;
      // While picking a point (new request, closest, around), let the click through to the map.
      layer.on('click', e => {
        if (state.mode) return;
        L.DomEvent.stop(e);
        L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
      });
    }
  }).addTo(districtLabels);
  // District click areas share the canvas with the points: keep them underneath so points stay clickable.
  districtLabels.eachLayer(g => g.bringToBack());
  setTimeout(declutterLabels, 0);
  districtsWms.setParams({ _ts: Date.now() });
  if (!state.districtBounds) { state.districtBounds = L.geoJSON(state.districts).getBounds(); fitDistricts(); }
  return true;
}

/* District names: when two names would overlap, keep the larger district's name and hide the
   smaller one; zooming in brings the hidden names back. */
function declutterLabels() {
  const labels = [];
  districtLabels.eachLayer(g => g.eachLayer(l => {
    const el = l.getTooltip()?.getElement();
    if (!el) return;
    const b = l.getBounds();
    labels.push({ el, size: (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth()) });
  }));
  labels.sort((a, b) => b.size - a.size);
  const kept = [];
  labels.forEach(({ el }) => {
    el.style.visibility = 'visible';
    const r = el.getBoundingClientRect();
    const clash = kept.some(k => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
    if (clash) el.style.visibility = 'hidden'; else kept.push(r);
  });
}
map.on('zoomend', () => setTimeout(declutterLabels, 0));

/* Frame all districts; the right-hand padding keeps them clear of the map panel. */
function fitDistricts() {
  const panelWidth = document.querySelector('.map-panel')?.offsetWidth || 0;
  map.fitBounds(state.districtBounds, { paddingTopLeft: [10, 10], paddingBottomRight: [panelWidth + 20, 10], animate: false });
}

/* Reload everything that shows a number: KPIs, charts, map points, district counts and colours,
   and the open "Explore an area" result. quiet = background check that only redraws on change. */
async function refreshAll({ quiet = false } = {}) {
  const [requestsChanged, districtsChanged] = await Promise.all([loadRequests({ quiet }), loadDistricts({ quiet })]);
  const changed = requestsChanged || districtsChanged;
  if (state.lastAnalysis && (changed || !quiet)) await rerunAnalysis();
  return changed;
}

/* Background refresh: picks up changes made by other users or in other tabs. It waits while the
   user is busy (form open, popup open, picking a point) so nothing closes under their cursor. */
function userIsBusy() {
  return !!state.mode || !$('modal').classList.contains('hidden') || !$('confirmModal').classList.contains('hidden') ||
         !!document.querySelector('.leaflet-popup');
}
async function backgroundRefresh() {
  if (document.hidden || userIsBusy() || state.refreshing) return;
  state.refreshing = true;
  try {
    if (await refreshAll({ quiet: true })) toast('Updated with the latest changes');
  } finally { state.refreshing = false; }
}
setInterval(backgroundRefresh, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) backgroundRefresh(); });

/* Which district a [lng, lat] point falls in (ray casting on the loaded district polygons). */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function districtAt([x, y]) {
  const f = state.districts?.features.find(d => {
    const polys = d.geometry.type === 'MultiPolygon' ? d.geometry.coordinates : [d.geometry.coordinates];
    return polys.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some(h => inRing(x, y, h)));
  });
  return f?.properties.name || null;
}

/* --------------------------------------------------------------- rendering */
function fid(f) { return f.id; }
function rid(f) { return f.properties.id ?? f.id.split('.').pop(); }

function renderRequests() {
  requestsLayer.clearLayers();
  state.features.forEach(f => {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    const m = L.circleMarker([lat, lng], {
      radius: PRIORITY_RADIUS[p.priority] || 6, color: '#fff', weight: 1.5,
      fillColor: STATUS[p.status]?.color || '#64748b', fillOpacity: .92
    });
    m.featureRef = f;
    // While picking a point, let the click through to the map instead of opening the request.
    m.on('click', e => {
      if (state.mode) return;
      L.DomEvent.stop(e);
      openRequestPopup(m);
    });
    m.addTo(requestsLayer);
  });
  // The hotspot layer can only redraw while it is on the map; it picks the points up when switched on.
  state.heatPoints = state.features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0],
    f.properties.priority === 'high' ? 1 : f.properties.priority === 'normal' ? 0.7 : 0.45]);
  if (map.hasLayer(heatLayer)) heatLayer.setLatLngs(state.heatPoints);
}

function openRequestPopup(m) {
  const f = m.featureRef;
  const popup = L.popup({ maxWidth: 300 }).setLatLng(m.getLatLng()).setContent(popupHtml(f)).openOn(map);
  wirePopup(popup, f);
}

function popupHtml(f) {
  const p = f.properties;
  const opt = (dict, val) => Object.entries(dict).map(([k, v]) =>
    `<option value="${k}" ${k === val ? 'selected' : ''}>${v.label || v}</option>`).join('');
  return `<div class="popup">
    <h3>Request #${esc(rid(f))} <span class="pill" style="background:${STATUS[p.status].color}">${STATUS[p.status].label}</span></h3>
    <div class="meta">${CATEGORY[p.category]?.label || esc(p.category)} · ${esc(p.priority)} priority · ${fmtDate(p.created_at)}${districtAt(f.geometry.coordinates) ? ' · ' + esc(districtAt(f.geometry.coordinates)) : ''}</div>
    <div class="desc">${esc(p.description || 'No description')}</div>
    <div class="edit">
      <select data-f="status">${opt(STATUS, p.status)}</select>
      <select data-f="priority">${opt({ low: 'Low', normal: 'Normal', high: 'High' }, p.priority)}</select>
    </div>
    <div class="actions">
      <button class="btn danger" data-act="delete">Delete</button>
      <button class="btn primary" data-act="save">Save changes</button>
    </div></div>`;
}

function wirePopup(popup, f) {
  const root = popup.getElement();
  const saveBtn = root.querySelector('[data-act="save"]');
  saveBtn.onclick = async () => {
    if (saveBtn.disabled) return;               // ignore double-clicks while saving
    const status = root.querySelector('[data-f="status"]').value;
    const priority = root.querySelector('[data-f="priority"]').value;
    saveBtn.disabled = true;
    try {
      await wfsUpdate(fid(f), { status, priority });
      map.closePopup();
      toast(`Request #${rid(f)} updated`);
      refreshAll();
    } catch (err) { toast(err.message, 'err'); }
    finally { saveBtn.disabled = false; }
  };
  root.querySelector('[data-act="delete"]').onclick = () => {
    map.closePopup();
    confirmDialog(`Request #${rid(f)} will be deleted permanently.`, async () => {
      try {
        await wfsDelete(fid(f));
        toast(`Request #${rid(f)} deleted`);
        refreshAll();
      } catch (err) { toast(err.message, 'err'); }
    });
  };
}

/* KPIs */
function setNumber(id, value) {
  const el = $(id), text = String(value);
  if (el.textContent === text) return;
  const first = el.textContent === '–' || el.textContent === '' || el.textContent === 'Loading…';
  el.textContent = text;
  if (first) return;
  el.classList.remove('bump');
  void el.offsetWidth;            // restart the animation
  el.classList.add('bump');
}
function renderKpis() {
  const fs = state.features.map(f => f.properties);
  const open = fs.filter(p => p.status === 'new' || p.status === 'in_review');
  const approved = fs.filter(p => p.status === 'approved').length;
  const rejected = fs.filter(p => p.status === 'rejected').length;
  const avgAge = open.length ? open.reduce((s, p) => s + (Date.now() - new Date(p.created_at)) / 864e5, 0) / open.length : 0;
  setNumber('kpiTotal', fs.length);
  setNumber('kpiOpen', open.length);
  setNumber('kpiRate', approved + rejected ? `${Math.round(100 * approved / (approved + rejected))}%` : '–');
  setNumber('kpiAge', open.length ? avgAge.toFixed(1) : '–');
}

/* Charts */
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#64748b';
const charts = {};
function renderCharts() {
  const fs = state.features.map(f => f.properties);
  const count = (key, dict) => Object.keys(dict).map(k => fs.filter(p => p[key] === k).length);

  const weeks = 13, now = Date.now(), weekMs = 7 * 864e5;
  const trend = Array(weeks).fill(0);
  fs.forEach(p => {
    const w = Math.floor((now - new Date(p.created_at)) / weekMs);
    if (w >= 0 && w < weeks) trend[weeks - 1 - w]++;
  });
  const trendLabels = trend.map((_, i) => {
    const d = new Date(now - (weeks - 1 - i) * weekMs);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  });

  upsertChart('statusChart', {
    type: 'doughnut',
    data: { labels: Object.values(STATUS).map(s => s.label),
            datasets: [{ data: count('status', STATUS), backgroundColor: Object.values(STATUS).map(s => s.color), borderWidth: 2 }] },
    options: { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } } }
  });
  upsertChart('categoryChart', {
    type: 'bar',
    data: { labels: Object.values(CATEGORY).map(c => c.label),
            datasets: [{ data: count('category', CATEGORY), backgroundColor: '#0d9488', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }
  });
  upsertChart('trendChart', {
    type: 'line',
    data: { labels: trendLabels,
            datasets: [{ data: trend, borderColor: '#0f766e', backgroundColor: 'rgba(13,148,136,.12)', fill: true, tension: .35, pointRadius: 2 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }
  });
}
function upsertChart(id, cfg) {
  if (charts[id]) { charts[id].data = cfg.data; charts[id].update(); return; }
  cfg.options = { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, ...cfg.options };
  $(id).parentElement.style.height = id === 'trendChart' ? '150px' : '230px';
  charts[id] = new Chart($(id), cfg);
}

/* ------------------------------------------------------------------- WFS-T */
async function wfsTransaction(body) {
  const xml = `<wfs:Transaction service="WFS" version="1.1.0"
    xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml"
    xmlns:ogc="http://www.opengis.net/ogc" xmlns:demo="${NS}">${body}</wfs:Transaction>`;
  const res = await fetch(WFST_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xml });
  const text = await res.text();
  if (!res.ok || text.includes('ExceptionReport')) {
    const msg = (text.match(/<ows:ExceptionText>([^<]+)/) || [])[1];
    console.error('Edit refused:', msg || text);
    throw new Error('The change could not be saved. Please try again.');
  }
  return text;
}
async function wfsInsert({ category, priority, description, lat, lng }) {
  const text = await wfsTransaction(`<wfs:Insert><demo:service_requests>
      <demo:category>${xmlEsc(category)}</demo:category>
      <demo:status>new</demo:status>
      <demo:priority>${xmlEsc(priority)}</demo:priority>
      <demo:description>${xmlEsc(description)}</demo:description>
      <demo:geom><gml:Point srsName="EPSG:4326"><gml:pos>${lng.toFixed(6)} ${lat.toFixed(6)}</gml:pos></gml:Point></demo:geom>
    </demo:service_requests></wfs:Insert>`);
  return (text.match(/fid="service_requests\.(\d+)"/) || [])[1];
}
function wfsUpdate(featureId, props) {
  const set = Object.entries(props).map(([k, v]) =>
    `<wfs:Property><wfs:Name>${k}</wfs:Name><wfs:Value>${xmlEsc(v)}</wfs:Value></wfs:Property>`).join('');
  return wfsTransaction(`<wfs:Update typeName="demo:service_requests">${set}
    <ogc:Filter><ogc:FeatureId fid="${xmlEsc(featureId)}"/></ogc:Filter></wfs:Update>`);
}
function wfsDelete(featureId) {
  return wfsTransaction(`<wfs:Delete typeName="demo:service_requests">
    <ogc:Filter><ogc:FeatureId fid="${xmlEsc(featureId)}"/></ogc:Filter></wfs:Delete>`);
}

/* ------------------------------------------------------------ map "modes" */
function setMode(mode, text) {
  state.mode = mode;
  $('modeBanner').classList.toggle('hidden', !mode);
  $('modeText').textContent = text || '';
  map.getContainer().classList.toggle('picking', !!mode);
  ['nearestBtn', 'radiusBtn'].forEach(id => $(id).classList.remove('active'));
  if (mode === 'nearest') $('nearestBtn').classList.add('active');
  if (mode === 'radius') $('radiusBtn').classList.add('active');
  if (mode) { $('sidebar').classList.remove('open'); foldMapPanel(); }   // on phones they would cover the map
}
function foldMapPanel() {
  const p = document.querySelector('.map-panel');
  p.classList.remove('expanded');
  p.querySelector('.mp-toggle').setAttribute('aria-expanded', false);
}
$('cancelMode').addEventListener('click', () => setMode(null));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setMode(null); closeModal(); } });

$('addRequestBtn').addEventListener('click', () => setMode('add', 'Click on the map where the problem is'));
$('nearestBtn').addEventListener('click', () => setMode('nearest', 'Click a place on the map to see the closest requests'));
$('radiusBtn').addEventListener('click', () => setMode('radius', `Click a place on the map to see requests within ${$('radiusInput').value} m`));
$('radiusInput').addEventListener('input', e => {
  $('radiusLabel').textContent = `${e.target.value} m`;
  if (state.mode === 'radius') $('modeText').textContent = `Click a place on the map to see requests within ${e.target.value} m`;
});

map.on('preclick', foldMapPanel);   // any tap on the map, including on a district or request
map.on('click', e => {
  const mode = state.mode;
  if (!mode) return;
  setMode(null);
  if (mode === 'add') return openModal(e.latlng);
  (mode === 'nearest' ? runNearest(e.latlng) : runRadius(e.latlng)).then(() => {
    // On phones the result sits in the closed side panel: give the headline as a message too.
    const h = $('analysisResult').querySelector('h4');
    if (h && matchMedia('(max-width: 900px)').matches) toast(`${h.textContent}. Open the menu for the list.`);
  });
});

/* -------------------------------------------------------------- analysis */
function viewparams(obj) {
  return '&viewparams=' + encodeURIComponent(Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(';'));
}
function pin(latlng) {
  return L.circleMarker(latlng, { radius: 7, color: '#0f172a', weight: 3, fillColor: '#fff', fillOpacity: 1 });
}
function resultItem(f, extra) {
  const p = f.properties;
  return `<li data-lat="${f.geometry.coordinates[1]}" data-lng="${f.geometry.coordinates[0]}">
    <b>#${p.id}</b> ${esc(CATEGORY[p.category]?.label || p.category)}
    <span class="pill" style="background:${STATUS[p.status].color}">${STATUS[p.status].label}</span> · ${extra}</li>`;
}
/* Keep request points above the analysis shapes drawn on the same canvas. */
function pointsOnTop() { requestsLayer.eachLayer(l => l.bringToFront()); }
function showResult(html) {
  pointsOnTop();
  const box = $('analysisResult');
  box.innerHTML = html;
  box.classList.remove('hidden');
  box.querySelectorAll('li[data-lat]').forEach(li =>
    li.addEventListener('click', () => map.flyTo([+li.dataset.lat, +li.dataset.lng], 17)));
}

/* The current filters, passed to the area searches so they count the same requests as the map.
   Lists are space-separated: GeoServer reserves commas and semicolons in viewparams. */
function filterParams() {
  return { cats: [...state.categories].join(' '), sts: [...state.statuses].join(' '),
           prio: state.priority, days: state.periodDays };
}
/* Runs an area search; returns null when a newer search has started (its result would be stale). */
async function areaQuery(view, params) {
  const seq = state.analysisSeq = (state.analysisSeq || 0) + 1;
  let fc = { features: [] };
  if (state.categories.size && state.statuses.size) {   // nothing can match when a whole filter is off
    const res = await fetch(wfsUrl(view, viewparams({ ...params, ...filterParams() })));
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    fc = await res.json();
  }
  return seq === state.analysisSeq ? fc : null;
}

async function runNearest(latlng, k = $('nearestK').value) {
  state.lastAnalysis = { type: 'nearest', latlng, k };
  analysisLayer.clearLayers();
  pin(latlng).addTo(analysisLayer);
  try {
    const fc = await areaQuery('nearest_requests', { lon: latlng.lng.toFixed(6), lat: latlng.lat.toFixed(6), k });
    if (!fc) return;
    if (!fc.features.length) return showResult('<h4>No requests match the current filters</h4>');
    fc.features.forEach(f => {
      const to = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
      L.polyline([latlng, to], { color: '#2563eb', weight: 2, dashArray: '4 4' }).addTo(analysisLayer);
      L.circleMarker(to, { radius: 9, color: '#2563eb', weight: 2, fill: false }).addTo(analysisLayer);
    });
    showResult(`<h4>${fc.features.length} closest requests</h4><ol>${
      fc.features.map(f => resultItem(f, `${f.properties.distance_m} m`)).join('')}</ol>`);
  } catch (err) { toast('Could not find nearby requests. Please try again.', 'err'); }
}

async function runRadius(latlng, fit = true, radius = +$('radiusInput').value) {
  state.lastAnalysis = { type: 'radius', latlng, radius };
  analysisLayer.clearLayers();
  pin(latlng).addTo(analysisLayer);
  L.circle(latlng, { radius, color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: .15 }).addTo(analysisLayer);
  try {
    const fc = await areaQuery('requests_within_radius', { lon: latlng.lng.toFixed(6), lat: latlng.lat.toFixed(6), radius });
    if (!fc) return;
    const by = (key, dict) => Object.entries(dict)
      .map(([k, v]) => [v.label, fc.features.filter(f => f.properties[key] === k).length])
      .filter(([, n]) => n).map(([l, n]) => `${l} <b>${n}</b>`).join(' · ') || '–';
    const open = fc.features.filter(f => ['new', 'in_review'].includes(f.properties.status)).length;
    showResult(`<h4>${fc.features.length} requests within ${radius} m (${open} open)</h4>
      <div>${by('category', CATEGORY)}</div><div style="margin-top:4px">${by('status', STATUS)}</div>
      <ol>${fc.features.slice(0, 8).map(f => resultItem(f, `${f.properties.distance_m} m`)).join('')}</ol>
      ${fc.features.length > 8 ? `<div class="muted">+ ${fc.features.length - 8} more</div>` : ''}`);
    if (fit) map.fitBounds(L.latLng(latlng).toBounds(radius * 2.4));
  } catch (err) { toast('Could not search this area. Please try again.', 'err'); }
}
function rerunAnalysis() {
  const a = state.lastAnalysis;
  return a.type === 'nearest' ? runNearest(a.latlng, a.k) : runRadius(a.latlng, false, a.radius);
}
$('clearAnalysis').addEventListener('click', () => {
  state.lastAnalysis = null;
  analysisLayer.clearLayers();
  $('analysisResult').classList.add('hidden');
});

/* ------------------------------------------------------------- new request */
function openModal(latlng) {
  state.pendingLatLng = latlng;
  $('requestForm').reset();
  $('requestForm').querySelector('[type=submit]').disabled = false;
  const where = districtAt([latlng.lng, latlng.lat]);
  $('fLocation').textContent = where ? `Location: ${where} district` : 'Location: outside the mapped districts';
  $('modal').classList.remove('hidden');
  $('fDescription').focus();
}
function closeModal() { $('modal').classList.add('hidden'); $('confirmModal').classList.add('hidden'); }
$('modalCancel').addEventListener('click', closeModal);
$('requestForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('requestForm').querySelector('[type=submit]');
  if (btn.disabled) return;                     // a double-click must not save the request twice
  const description = $('fDescription').value.trim();
  if (!description) {                           // spaces alone pass the browser's "required" check
    $('fDescription').value = '';
    $('fDescription').reportValidity();
    return;
  }
  const { lat, lng } = state.pendingLatLng;
  btn.disabled = true;
  try {
    const id = await wfsInsert({ category: $('fCategory').value, priority: $('fPriority').value, description, lat, lng });
    closeModal();
    toast(`Request #${id} saved`);
    await refreshAll();
    const created = state.features.find(f => String(rid(f)) === String(id));
    if (created) map.flyTo([lat, lng], 16);
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; }
});

function confirmDialog(text, onYes) {
  $('confirmText').textContent = text;
  $('confirmModal').classList.remove('hidden');
  $('confirmNo').onclick = closeModal;
  $('confirmYes').onclick = () => { closeModal(); onYes(); };
}

/* ------------------------------------------------------------------ search */
$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  // A request found by an earlier search opens when the map stops moving; a new search cancels it.
  if (state.openAfterMove) map.off('moveend', state.openAfterMove);
  state.openAfterMove = null;
  const q = $('searchInput').value.trim().replace(/^#/, '');
  if (!q) return;
  if (/^\d+$/.test(q)) {
    let found = null;
    requestsLayer.eachLayer(m => { if (String(rid(m.featureRef)) === q) found = m; });
    if (!found) return toast(`Request #${q} was not found. If it exists, it may be hidden by the filters.`, 'err');
    if (!map.hasLayer(requestsLayer)) {         // the Requests layer was switched off: show it again
      requestsLayer.addTo(map);
      document.querySelector('[data-layer="requests"]').checked = true;
    }
    map.flyTo(found.getLatLng(), 17);
    state.openAfterMove = () => { state.openAfterMove = null; openRequestPopup(found); };
    map.once('moveend', state.openAfterMove);
    return;
  }
  // District names in English or Arabic; an exact name wins, then a name that starts with the text.
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');
  const t = norm(q);
  const score = p => Math.max(...[p.name, p.name_ar].map(norm).map(n => n === t ? 3 : n.startsWith(t) ? 2 : n.includes(t) ? 1 : 0));
  const d = (state.districts?.features || []).map(f => [f, score(f.properties)]).filter(([, s]) => s)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!d) return toast(`No district matches "${q}"`, 'err');
  map.flyToBounds(L.geoJSON(d).getBounds(), { padding: [40, 40] });
});

/* ------------------------------------------------------------------ mobile */
$('toggleSidebar').addEventListener('click', () => $('sidebar').classList.toggle('open'));

// Fonts and the flex layout can settle after Leaflet measures the map; re-measure so no tile row is missed.
window.addEventListener('load', () => map.invalidateSize());
// Keep all districts framed when the layout changes, until the user starts moving the map themselves.
['mousedown', 'touchstart', 'wheel'].forEach(ev =>
  map.getContainer().addEventListener(ev, () => { state.userMoved = true; }, { passive: true }));
$('searchForm').addEventListener('submit', () => { state.userMoved = true; });
let refitTimer = null;
new ResizeObserver(() => {
  map.invalidateSize();
  if (!state.districtBounds || state.userMoved) return;
  clearTimeout(refitTimer);   // wait for the layout to settle, then frame once
  refitTimer = setTimeout(fitDistricts, 200);
}).observe($('map'));

refreshAll().then(() => {
  // ?demo=analysis shows the radius tool and the heatmap (used for README screenshots).
  if (new URLSearchParams(location.search).get('demo') === 'analysis') {
    $('radiusInput').value = 900;
    $('radiusLabel').textContent = '900 m';
    heatLayer.addTo(map).setLatLngs(state.heatPoints || []);
    document.querySelector('[data-layer="heat"]').checked = true;
    state.userMoved = true;
    map.setView([30.052, 31.262], 14.5, { animate: false });
    runRadius(L.latLng(30.052, 31.262), false).then(() => {
      const card = $('analysisResult').closest('.card');
      $('sidebar').scrollTop = card.offsetTop - 12;
    });
  }
});
