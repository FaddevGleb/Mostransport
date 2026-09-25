/* global L, JSZip */

const MOSCOW = [55.7558, 37.6173];
const MOSCOW_MKAD_BOUNDS = [
  [55.55, 37.30],
  [55.93, 37.99],
];
const MOSCOW_MAP_ZOOM = 11;
const DEFAULT_ENDPOINT = "https://apidata.mos.ru/v1/datasets/3221/features";
const PAGE_SIZE = 1000;

const state = {
  map: null,
  layers: new Map(),
  stopsLayer: null,
  feed: null,
  routes: [],
  selectedId: null,
  showStops: true,
  usingDemo: false,
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", () => {
  setupMap();
  bindEvents();
  renderFeed(makeDemoFeed(), true);
  setStatus("Готово · набор 3221 GeoJSON");
  loadLocalGeoJson({ silent: true }).catch(() => {});
});

function setupMap() {
  const cityBounds = L.latLngBounds(MOSCOW_MKAD_BOUNDS);
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    minZoom: MOSCOW_MAP_ZOOM,
    maxZoom: MOSCOW_MAP_ZOOM,
    maxBounds: cityBounds,
    maxBoundsViscosity: 1,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
  }).setView(MOSCOW, MOSCOW_MAP_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    updateWhenIdle: true,
    keepBuffer: 3,
  }).addTo(state.map);
  state.stopsLayer = L.layerGroup().addTo(state.map);
  window.addEventListener("resize", () => state.map.invalidateSize({ pan: false }));
  setTimeout(() => state.map.invalidateSize({ pan: false }), 250);
}

function bindEvents() {
  $("#route-search").addEventListener("input", (event) => renderRouteList(event.target.value));
  $("#close-details").addEventListener("click", () => {
    $("#route-details").classList.add("hidden");
    state.selectedId = null;
    renderMap();
    renderRouteList($("#route-search").value);
  });
  $("#toggle-stops").addEventListener("click", () => {
    state.showStops = !state.showStops;
    $("#toggle-stops").classList.toggle("active", state.showStops);
    renderStops();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement.tagName !== "INPUT") {
      event.preventDefault();
      $("#route-search").focus();
    }
  });
}

async function loadData() {
  const button = $("#load-data");
  const endpoint = $("#endpoint").value.trim() || DEFAULT_ENDPOINT;
  const apiKey = $("#api-key").value.trim();
  button.disabled = true;
  button.innerHTML = '<span class="button-icon">⋯</span> Загружаю данные';
  setStatus("Получение данных…");

  try {
    const records = await fetchAllRows(endpoint, apiKey);
    const feed = buildGtfsFeed(records);
    if (!feed.routes.length) throw new Error("В ответе не найдены трамвайные маршруты");
    renderFeed(feed, false);
    showToast(`Загружено из data.mos.ru: ${feed.routes.length} маршрутов`);
    setStatus(`data.mos.ru · 3221 · ${feed.routes.length} трамвайных маршрутов`);
  } catch (error) {
    console.warn("Не удалось загрузить data.mos.ru", error);
    try {
      await loadLocalGeoJson({ silent: true });
      showToast("API недоступен — использован локальный GeoJSON");
    } catch {
      try {
        await loadLocalGtfs({ silent: true });
        showToast("API и GeoJSON недоступны — использована локальная GTFS-выгрузка");
      } catch {
        renderFeed(makeDemoFeed(), true);
        showToast("Источники недоступны — показана демонстрационная геометрия.");
        setStatus("Демо-данные · источники недоступны");
      }
    }
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="button-icon">↻</span> Загрузить данные';
  }
}

async function loadLocalGtfs(options = {}) {
  const button = $("#load-local-gtfs");
  if (!options.silent) {
    button.disabled = true;
    button.textContent = "Загружаю локальный GTFS…";
    setStatus("Чтение moscow-tram-gtfs.zip…");
  }
  try {
    const response = await fetch("./moscow-tram-gtfs.zip", { cache: "no-store" });
    if (!response.ok) throw new Error(`Локальный ZIP не найден: HTTP ${response.status}`);
    const feed = await parseGtfsZip(await response.arrayBuffer());
    if (!feed.routes.length) throw new Error("В локальном GTFS нет routes.txt");
    renderFeed(feed, false);
    setStatus(`Локальный GTFS · ${feed.routes.length} маршрутов`);
    if (!options.silent) showToast(`Загружено из ZIP: ${feed.routes.length} маршрутов`);
    return feed;
  } finally {
    if (!options.silent) {
      button.disabled = false;
      button.innerHTML = '<span class="button-icon">▣</span> Открыть локальный GTFS ZIP';
    }
  }
}

async function loadLocalGeoJson(options = {}) {
  const button = $("#load-local-geojson");
  if (!options.silent) {
    button.disabled = true;
    button.textContent = "Загружаю GeoJSON…";
    setStatus("Чтение data/tram_routes_3221.geojson…");
  }
  try {
    const response = await fetch("./data/tram_routes_3221.geojson", { cache: "no-store" });
    if (!response.ok) throw new Error(`Локальный GeoJSON не найден: HTTP ${response.status}`);
    const payload = await response.json();
    const records = (payload.features || []).map((feature) => ({
      ...(feature.properties?.attributes || feature.properties || feature.attributes || {}),
      geometry: feature.geometry,
    }));
    const feed = buildGtfsFeed(records);
    if (!feed.routes.length) throw new Error("В локальном GeoJSON нет трамвайных маршрутов");
    renderFeed(feed, false);
    setStatus(`Локальный GeoJSON · ${feed.routes.length} трамвайных маршрутов`);
    if (!options.silent) showToast(`Загружено из GeoJSON: ${feed.routes.length} маршрутов`);
    return feed;
  } finally {
    if (!options.silent) {
      button.disabled = false;
      button.innerHTML = '<span class="button-icon">⌁</span> Открыть актуальный GeoJSON';
    }
  }
}

async function parseGtfsZip(buffer) {
  if (!window.JSZip) throw new Error("JSZip не загружен");
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name) => {
    const file = zip.file(name);
    return file ? parseCsv(await file.async("text")) : [];
  };
  const [agency, routes, stops, trips, stopTimes, calendar, shapes] = await Promise.all([
    read("agency.txt"), read("routes.txt"), read("stops.txt"), read("trips.txt"),
    read("stop_times.txt"), read("calendar.txt"), read("shapes.txt"),
  ]);
  return {
    agency,
    routes: routes.map((route, index) => ({
      ...route,
      route_type: Number(route.route_type || 0),
      route_color: routeColor(index),
    })),
    stops: stops.map((stop) => ({ ...stop, stop_lat: Number(stop.stop_lat), stop_lon: Number(stop.stop_lon) })),
    trips: trips.map((trip) => ({ ...trip, direction_id: Number(trip.direction_id || 0) })),
    stopTimes: stopTimes.map((item) => ({ ...item, stop_sequence: Number(item.stop_sequence || 0) })),
    calendar,
    shapes: shapes.map((shape) => ({
      ...shape,
      shape_pt_lat: Number(shape.shape_pt_lat),
      shape_pt_lon: Number(shape.shape_pt_lon),
      shape_pt_sequence: Number(shape.shape_pt_sequence || 0),
    })),
  };
}

function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows.map((values) => headers.reduce((result, header, index) => {
    result[header] = values[index] ?? "";
    return result;
  }, {}));
}

async function fetchAllRows(endpoint, apiKey) {
  const rows = [];
  let skip = 0;
  let total = Infinity;
  const base = endpoint.replace(/[?&]$/, "");

  while (rows.length < total && skip < 20000) {
    const url = new URL(base);
    url.searchParams.set("$top", PAGE_SIZE);
    url.searchParams.set("$skip", skip);
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const page = unwrapRows(json);
    if (!page.length) break;
    rows.push(...page);
    total = Number(json.Count ?? json.count ?? json.total ?? total);
    skip += page.length;
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.Rows)) return payload.Rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.features)) {
    return payload.features.map((feature) => {
      const attributes = feature.attributes || feature.properties || {};
      return {
      ...(attributes.attributes || attributes),
      geometry: feature.geometry,
      };
    });
  }
  return [];
}

function buildGtfsFeed(records) {
  const normalized = records.map(normalizeRecord).filter((record) => record.routeId && record.points.length);
  const tramRecords = normalized.filter((record) => isTramRecord(record, normalized));
  const hasTransportType = normalized.some((record) => record.hasTransportType);
  const recordsToUse = hasTransportType ? tramRecords : (tramRecords.length ? tramRecords : normalized);
  const grouped = new Map();

  recordsToUse.forEach((record) => {
    const key = `${record.routeId}|${record.direction || "0"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });

  const routes = [];
  const stops = [];
  const trips = [];
  const stopTimes = [];
  const shapes = [];
  let routeNumber = 0;

  for (const [groupKey, recordsInGroup] of grouped) {
    const first = recordsInGroup[0];
    const routeId = slug(first.routeId);
    const direction = first.direction || "0";
    const routeKey = `${routeId}|${direction}`;
    const ordered = recordsInGroup
      .sort((a, b) => (a.stopSequence ?? 9999) - (b.stopSequence ?? 9999))
      .flatMap((record) => record.points.map((point, index) => ({
        ...point,
        order: (record.stopSequence ?? 0) * 100 + index,
      })))
      .sort((a, b) => a.order - b.order);
    const deduped = dedupePoints(ordered);
    if (deduped.length < 2) continue;

    const id = `route_${routeNumber++}`;
    const tripId = `trip_${routeNumber}`;
    const shapeId = `shape_${routeNumber}`;
    routes.push({
      route_id: id,
      route_short_name: first.routeId,
      route_long_name: first.routeName || `Трамвай ${first.routeId}`,
      route_type: 0,
      route_color: routeColor(routeNumber),
      route_text_color: "FFFFFF",
      direction,
    });
    trips.push({ route_id: id, service_id: "MOSCOW", trip_id: tripId, trip_headsign: first.headsign || "", direction_id: direction === "0" ? 0 : 1, shape_id: shapeId });

    const namedStops = first.stopNames.length ? placeStopsAlongLine(deduped, first.stopNames) : deduped;
    namedStops.forEach((point, index) => {
      const stop = {
        stop_id: `stop_${id}_${index + 1}`,
        stop_code: point.id || "",
        stop_name: point.name || `Остановка ${index + 1}`,
        stop_lat: point.lat,
        stop_lon: point.lon,
      };
      stops.push(stop);
      const time = formatTime(5 * index);
      stopTimes.push({ trip_id: tripId, arrival_time: time, departure_time: time, stop_id: stop.stop_id, stop_sequence: index + 1 });
    });
    deduped.forEach((point, index) => shapes.push({ shape_id: shapeId, shape_pt_lat: point.lat, shape_pt_lon: point.lon, shape_pt_sequence: index + 1 }));
  }

  return makeFeed({ routes, stops, trips, stopTimes, shapes });
}

function normalizeRecord(raw) {
  const source = raw?.Cells || raw?.cells || raw?.attributes || raw?.properties || raw || {};
  const entries = Object.entries(source);
  const get = (patterns) => {
    const match = entries.find(([key]) => patterns.some((pattern) => pattern.test(normalizeKey(key))));
    return match?.[1];
  };
  const routeId = clean(get([/route.?short.?name/, /route.?number/, /route.?id/, /^route$/, /номер.*маршрут/, /маршрут/, /номер/, /линия/]));
  const routeName = clean(get([/route.?long.?name/, /route.?name/, /наименование/, /название/, /^name$/]));
  const direction = clean(get([/direction/, /направлен/])) || "0";
  const stopSequence = number(get([/stop.?sequence/, /sequence/, /порядок/, /номер.*останов/]));
  const stopName = clean(get([/stop.?name/, /название.*останов/, /остановка/]));
  const stopId = clean(get([/^stop.?id$/, /^id.*останов/, /код.*останов/]));
  const type = clean(get([/route.?type/, /transport.?type/, /type.?of.?transport/, /typeoftransport/, /type.?object/, /vehicle/, /транспорт/, /вид.*маршрут/, /тип.*транспорт/, /вид/]));
  const track = clean(get([/^trackoffollowing$/, /трассаследования/]));
  const searchText = entries.map(([, value]) => clean(value)).join(" ");
  const points = extractPoints({ ...source, geometry: raw?.geometry || source.geometry }, stopName, stopId);
  return {
    routeId, routeName, direction, stopSequence, stopName, stopId, type, searchText,
    stopNames: parseRouteStops(track),
    hasTransportType: Boolean(type), points, headsign: clean(get([/headsign/, /конечн/])),
  };
}

function parseRouteStops(forward) {
  const stops = [];
  tokenizeTrack(forward).forEach((token) => {
    const previous = stops[stops.length - 1];
    if (previous && isStopNameContinuation(previous, token)) {
      stops[stops.length - 1] = `${previous} - ${token}`;
      return;
    }
    if (previous === token) return;
    stops.push(token);
  });
  return stops;
}

function isStopNameContinuation(previous, token) {
  if (/^[а-яё]/.test(token)) return true;
  if (previous === "Покровское" && /^(Глебово|Стрешнево)$/.test(token)) return true;
  return previous === "Свято" && token.startsWith("Данилов");
}

function tokenizeTrack(value) {
  return clean(value).split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
}

function placeStopsAlongLine(points, names) {
  if (names.length === 1) return [{ ...points[0], name: names[0], id: "" }];
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + pointDistance(points[index - 1], points[index]));
  }
  const total = distances[distances.length - 1] || 0;
  return names.map((name, nameIndex) => {
    const target = total * (nameIndex / (names.length - 1));
    const segment = Math.max(1, distances.findIndex((distance) => distance >= target));
    const previous = distances[segment - 1];
    const span = distances[segment] - previous || 1;
    const ratio = Math.min(1, Math.max(0, (target - previous) / span));
    const start = points[segment - 1];
    const finish = points[Math.min(segment, points.length - 1)];
    return {
      lat: start.lat + (finish.lat - start.lat) * ratio,
      lon: start.lon + (finish.lon - start.lon) * ratio,
      name,
      id: "",
    };
  });
}

function pointDistance(a, b) {
  return haversine(
    { stop_lat: a.lat, stop_lon: a.lon },
    { stop_lat: b.lat, stop_lon: b.lon },
  );
}

function isTramRecord(record, allRecords) {
  if (record.hasTransportType) {
    return /трам|tram/i.test(record.type || "") || /^0$/.test(record.type || "");
  }
  if (/трам|tram/i.test(record.searchText || "")) return true;
  return allRecords.every((item) => !item.hasTransportType);
}

function extractPoints(source, fallbackName, fallbackId) {
  const points = [];
  const geometryEntry = Object.entries(source).find(([key]) => /geo|coord|гео|координат/i.test(key));
  const geometry = source.geometry || source.geoData || source.geo_data || source.coordinates || geometryEntry?.[1];
  if (geometry) points.push(...parseGeometry(geometry, fallbackName, fallbackId));
  if (points.length) return points;

  const entries = Object.entries(source);
  const lat = findNumber(entries, [/^lat/, /широт/, /latitude/]);
  const lon = findNumber(entries, [/^lon/, /долгот/, /longitude/]);
  if (lat !== null && lon !== null && inMoscow(lat, lon)) {
    return [{ lat, lon, name: fallbackName, id: fallbackId }];
  }
  return [];
}

function parseGeometry(value, name, id) {
  if (typeof value === "object" && value.coordinates) return parseCoordinates(value.coordinates, name, id);
  if (typeof value === "object" && value.geometry) return parseGeometry(value.geometry, name, id);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return parseGeometry(parsed, name, id);
  } catch {
    const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (numbers.length >= 2) {
      const [a, b] = numbers;
      const lat = Math.abs(a) > 50 ? a : b;
      const lon = Math.abs(a) > 50 ? b : a;
      return inMoscow(lat, lon) ? [{ lat, lon, name, id }] : [];
    }
  }
  return [];
}

function parseCoordinates(coordinates, name, id) {
  if (!Array.isArray(coordinates)) return [];
  if (typeof coordinates[0] === "number") {
    const [lon, lat] = coordinates;
    return inMoscow(lat, lon) ? [{ lat, lon, name, id }] : [];
  }
  return coordinates.flatMap((item) => parseCoordinates(item, name, id));
}

function findNumber(entries, patterns) {
  const pair = entries.find(([key]) => patterns.some((pattern) => pattern.test(normalizeKey(key))));
  const value = Number(String(pair?.[1] ?? "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function makeFeed(data) {
  return {
    agency: [{ agency_name: "Мосгортранс", agency_url: "https://mosgortrans.ru", agency_timezone: "Europe/Moscow", agency_lang: "ru" }],
    routes: data.routes,
    stops: data.stops,
    trips: data.trips,
    stopTimes: data.stopTimes,
    shapes: data.shapes,
    calendar: [{ service_id: "MOSCOW", monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1, start_date: "20260101", end_date: "20261231" }],
  };
}

function renderFeed(feed, usingDemo) {
  state.feed = feed;
  state.routes = feed.routes;
  state.usingDemo = usingDemo;
  state.selectedId = null;
  $("#route-details").classList.add("hidden");
  renderMap();
  renderRouteList();
  updateStats();
  fitMap();
  selectFromHash();
}

function renderMap() {
  state.layers.forEach((layer) => layer.remove());
  state.layers.clear();
  const shapeGroups = groupBy(state.feed.shapes, "shape_id");
  const routes = [...state.routes].sort((left, right) => Number(left.route_id === state.selectedId) - Number(right.route_id === state.selectedId));
  routes.forEach((route) => {
    const trip = state.feed.trips.find((item) => item.route_id === route.route_id);
    const points = (shapeGroups[trip?.shape_id] || []).sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence).map((point) => [point.shape_pt_lat, point.shape_pt_lon]);
    if (points.length < 2) return;
    const selected = route.route_id === state.selectedId;
    const dimmed = state.selectedId && !selected;
    const color = `#${route.route_color || "e33d4d"}`;
    const casing = L.polyline(points, { color: "#ffffff", weight: selected ? 14 : 11, opacity: dimmed ? .1 : .9, lineCap: "round", lineJoin: "round" });
    const line = L.polyline(points, { color, weight: selected ? 8 : 6, opacity: dimmed ? .1 : 1, lineCap: "round", lineJoin: "round" })
      .bindTooltip(`${route.route_short_name} · ${route.route_long_name}`, { className: "tram-tooltip", sticky: true })
      .on("click", () => selectRoute(route.route_id));
    state.layers.set(route.route_id, L.layerGroup([casing, line]).addTo(state.map));
  });
  renderStops();
}

function renderStops() {
  state.stopsLayer.clearLayers();
  if (!state.showStops || !state.feed) return;
  const selectedStopIds = new Set((state.selectedId ? stopsForRoute(state.selectedId) : []).map((stop) => stop.stop_id));
  const stopColors = buildStopColorIndex();
  const selectedRoute = state.routes.find((route) => route.route_id === state.selectedId);
  const stops = [...state.feed.stops].sort((left, right) => Number(selectedStopIds.has(left.stop_id)) - Number(selectedStopIds.has(right.stop_id)));
  stops.forEach((stop) => {
    const belongsToSelection = !state.selectedId || selectedStopIds.has(stop.stop_id);
    const colors = stopColors.get(stop.stop_id) || [];
    const color = belongsToSelection && selectedRoute ? selectedRoute.route_color : (colors[0] || "e33d4d");
    const tooltip = colors.length > 1
      ? `${stop.stop_name} · ${colors.length} линии`
      : stop.stop_name;
    L.circleMarker([stop.stop_lat, stop.stop_lon], {
      radius: belongsToSelection && state.selectedId ? 4.5 : 3.5,
      weight: 1.5,
      color: "#fff",
      opacity: belongsToSelection ? 1 : .1,
      fillColor: `#${color}`,
      fillOpacity: belongsToSelection ? 1 : .1,
    }).bindTooltip(tooltip, { direction: "top", offset: [0, -4], className: "tram-tooltip" }).addTo(state.stopsLayer);
  });
}

function buildStopColorIndex() {
  const colors = new Map();
  const trips = new Map(state.feed.trips.map((trip) => [trip.trip_id, trip]));
  const routes = new Map(state.feed.routes.map((route) => [route.route_id, route]));
  state.feed.stopTimes.forEach((stopTime) => {
    const route = routes.get(trips.get(stopTime.trip_id)?.route_id);
    if (!route?.route_color) return;
    if (!colors.has(stopTime.stop_id)) colors.set(stopTime.stop_id, []);
    const stopColors = colors.get(stopTime.stop_id);
    if (!stopColors.includes(route.route_color)) stopColors.push(route.route_color);
  });
  return colors;
}

function renderRouteList(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const list = $("#route-list");
  const routes = state.routes.filter((route) => {
    if (!normalizedQuery) return true;
    return `${route.route_short_name} ${route.route_long_name} ${stopsForRoute(route.route_id).map((stop) => stop.stop_name).join(" ")}`.toLowerCase().includes(normalizedQuery);
  });
  $("#route-count").textContent = state.routes.length;
  list.innerHTML = routes.length ? routes.map((route) => {
    const stops = stopsForRoute(route.route_id);
    const demand = TramDemand.demandFor(route.route_short_name);
    return `<button class="route-item ${route.route_id === state.selectedId ? "selected" : ""}" data-route-id="${route.route_id}">
      <span class="route-badge" style="background:#${route.route_color}">${escapeHtml(route.route_short_name)}</span>
      <span class="route-item-text"><span class="route-item-name">${escapeHtml(route.route_long_name)}</span><span class="route-item-meta">${stops.length} остановок · ${route.direction === "1" ? "обратное" : "прямое"}</span></span>
      <span class="load-pill ${TramDemand.loadTone(demand.index)}" title="Пиковая загрузка ближайших 12 часов">${TramDemand.formatLoad(demand.index)}</span>
    </button>`;
  }).join("") : '<div class="empty-state">Ничего не найдено.<br />Попробуйте номер маршрута или название остановки.</div>';
  list.querySelectorAll("[data-route-id]").forEach((item) => item.addEventListener("click", () => selectRoute(item.dataset.routeId)));
}

function selectRoute(routeId) {
  const route = state.routes.find((item) => item.route_id === routeId);
  if (!route) return;
  state.selectedId = routeId;
  renderMap();
  renderRouteList($("#route-search").value);
  const stops = stopsForRoute(routeId);
  $("#detail-number").textContent = route.route_short_name;
  $("#detail-number").style.backgroundColor = `#${route.route_color}`;
  $("#detail-name").textContent = route.route_long_name;
  $("#detail-stops").textContent = stops.length;
  $("#detail-length").textContent = `${routeDistance(stops).toFixed(1)} км`;
  $("#detail-direction").textContent = route.direction === "1" ? "обратное" : "прямое";
  renderDemand(route);
  $("#route-details").classList.remove("hidden");
}

function renderDemand(route) {
  const demand = TramDemand.demandFor(route.route_short_name);
  state.demand = demand;
  $("#demand-now").textContent = TramDemand.formatPassengers(demand.current.passengers);
  const load = $("#demand-load");
  load.textContent = TramDemand.formatLoad(demand.index);
  load.title = "Пик ближайших 12 часов";
  load.className = `load-pill ${TramDemand.loadTone(demand.index)}`;
  $("#demand-today").innerHTML = hourColumns(demand.upcoming);
  const tomorrowPeak = demand.tomorrow.peak;
  $("#demand-tomorrow").innerHTML = `<strong>${TramDemand.formatPassengers(demand.tomorrow.total)}</strong><span>пассажиров за день · пик ${TramDemand.formatLoad(tomorrowPeak.load)} в ${TramDemand.formatHour(tomorrowPeak.hour)}</span><div class="hour-chart">${hourColumns(demand.tomorrow.hours)}</div>`;
  $("#demand-week").innerHTML = weekColumns(demand.week);
  $("#demand-context").innerHTML = TramDemand.contextFor(route.route_short_name).map((item) => `<article class="factor-card ${item.off ? "off" : ""}" title="${escapeHtml(item.title)}"><span class="factor-icon">${item.icon}</span><span class="factor-label">${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><span class="factor-note">${escapeHtml(item.note)}</span></article>`).join("");
}

function weekColumns(days) {
  const max = Math.max(...days.map((day) => day.peak.passengers), 1);
  return days.map((day) => {
    const peak = day.peak;
    return `<div class="hour-col" title="${escapeHtml(day.label)} · пик ${TramDemand.formatPassengers(peak.passengers)} пасс. в ${TramDemand.formatHour(peak.hour)} · ${TramDemand.formatLoad(peak.load)}"><span class="week-value">${TramDemand.formatPassengers(peak.passengers)}</span><div class="week-bar-slot"><div class="hour-bar ${TramDemand.loadTone(peak.load)}" style="height:${Math.max(12, (peak.passengers / max) * 100)}%"></div></div><span>${escapeHtml(day.shortLabel)}</span></div>`;
  }).join("");
}

function hourColumns(hours) {
  const max = Math.max(...hours.map((item) => item.passengers), 1);
  return hours.map((item) => `<div class="hour-col" title="${TramDemand.formatHour(item.hour)} · ${TramDemand.formatPassengers(item.passengers)} пасс. · ${TramDemand.formatLoad(item.load)}"><div class="hour-bar ${TramDemand.loadTone(item.load)}" style="height:${Math.max(8, (item.passengers / max) * 100)}%"></div><span>${String(item.hour).padStart(2, "0")}</span></div>`).join("");
}

function selectFromHash() {
  const routeName = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!routeName) return;
  const route = state.routes.find((item) => item.route_short_name === routeName);
  if (route) selectRoute(route.route_id);
}

function stopsForRoute(routeId) {
  const trip = state.feed?.trips.find((item) => item.route_id === routeId);
  if (!trip) return [];
  return state.feed.stopTimes.filter((item) => item.trip_id === trip.trip_id).sort((a, b) => a.stop_sequence - b.stop_sequence)
    .map((item) => state.feed.stops.find((stop) => stop.stop_id === item.stop_id)).filter(Boolean);
}

function updateStats() {
  const allStops = state.feed.stops.length;
  const distance = state.routes.reduce((total, route) => total + routeDistance(stopsForRoute(route.route_id)), 0);
  $("#stat-routes").textContent = state.routes.length;
  $("#stat-stops").textContent = allStops;
  $("#stat-distance").textContent = Math.round(distance);
}

function fitMap() {
  state.map.setView(MOSCOW, MOSCOW_MAP_ZOOM, { animate: false });
  setTimeout(() => state.map.invalidateSize({ pan: false }), 120);
}

async function downloadGtfs() {
  if (!state.feed || !window.JSZip) return;
  const zip = new JSZip();
  const files = {
    "agency.txt": csv(state.feed.agency),
    "routes.txt": csv(state.feed.routes.map(({ direction, ...route }) => route)),
    "stops.txt": csv(state.feed.stops),
    "trips.txt": csv(state.feed.trips),
    "stop_times.txt": csv(state.feed.stopTimes),
    "calendar.txt": csv(state.feed.calendar),
    "shapes.txt": csv(state.feed.shapes),
  };
  Object.entries(files).forEach(([name, content]) => zip.file(name, content));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "moscow-tram-gtfs.zip";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("GTFS ZIP сформирован и скачан");
}

function csv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => quote(row[header])).join(","))].join("\r\n");
}

function makeDemoFeed() {
  const basePaths = [
    ["3", "Метро «Чистые пруды» — улица Академика Янгеля", [[55.764, 37.638], [55.752, 37.635], [55.737, 37.625], [55.721, 37.608], [55.704, 37.592], [55.682, 37.588]]],
    ["6", "Станция «Сокол» — Братцево", [[55.810, 37.516], [55.800, 37.535], [55.790, 37.556], [55.783, 37.579], [55.794, 37.608], [55.811, 37.624], [55.836, 37.625]]],
    ["17", "Останкино — Медведково", [[55.821, 37.619], [55.821, 37.647], [55.830, 37.674], [55.844, 37.686], [55.866, 37.677], [55.884, 37.660]]],
    ["39", "Метро «Университет» — Черёмушки", [[55.693, 37.526], [55.710, 37.542], [55.725, 37.558], [55.735, 37.579], [55.728, 37.606], [55.713, 37.625]]],
    ["43", "Метро «Пролетарская» — Автозаводская", [[55.731, 37.667], [55.720, 37.664], [55.706, 37.657], [55.696, 37.646], [55.694, 37.627], [55.700, 37.608]]],
    ["46", "Станция «Каланчёвская» — Сокольники", [[55.776, 37.652], [55.787, 37.650], [55.800, 37.656], [55.817, 37.662], [55.831, 37.669]]],
    ["47", "Новогиреево — Курский вокзал", [[55.752, 37.815], [55.760, 37.788], [55.764, 37.752], [55.765, 37.718], [55.760, 37.684], [55.757, 37.648]]],
    ["50", "Трамвайное депо — Тушино", [[55.858, 37.438], [55.846, 37.464], [55.834, 37.486], [55.826, 37.512], [55.819, 37.540], [55.810, 37.561]]],
  ];
  const routeNumbers = ["1", "2", "3", "4", "6", "7", "8", "10", "11", "12", "13", "14", "15", "16", "17", "20", "21", "23", "24", "25", "27", "29", "30", "31", "32", "33", "35", "39", "40", "43", "45", "46", "47", "Т1", "Т2"];
  const namedRoutes = {
    Т1: "Метрогородок — метро «Университет»",
    Т2: "Чертановская — МЦД «Новогиреево»",
  };
  const routes = [], stops = [], trips = [], stopTimes = [], shapes = [];
  routeNumbers.forEach((number, routeIndex) => {
    const [, , baseCoordinates] = basePaths[routeIndex % basePaths.length];
    const driftLat = ((routeIndex % 5) - 2) * 0.0018;
    const driftLon = ((Math.floor(routeIndex / 5) % 5) - 2) * 0.0018;
    const coordinates = baseCoordinates.map(([lat, lon]) => [lat + driftLat, lon + driftLon]);
    const name = namedRoutes[number] || `${number} · трамвайная линия`;
    const routeId = `route_${routeIndex + 1}`, tripId = `trip_${routeIndex + 1}`, shapeId = `shape_${routeIndex + 1}`;
    routes.push({ route_id: routeId, route_short_name: number, route_long_name: name, route_type: 0, route_color: routeColor(routeIndex), route_text_color: "FFFFFF", direction: "0" });
    trips.push({ route_id: routeId, service_id: "MOSCOW", trip_id: tripId, trip_headsign: name.split(" — ")[1] || name, direction_id: 0, shape_id: shapeId });
    coordinates.forEach(([lat, lon], index) => {
      const stopId = `stop_${routeIndex + 1}_${index + 1}`;
      stops.push({ stop_id: stopId, stop_code: "", stop_name: `${number} · остановка ${index + 1}`, stop_lat: lat, stop_lon: lon });
      stopTimes.push({ trip_id: tripId, arrival_time: formatTime(index * 5), departure_time: formatTime(index * 5), stop_id: stopId, stop_sequence: index + 1 });
      shapes.push({ shape_id: shapeId, shape_pt_lat: lat, shape_pt_lon: lon, shape_pt_sequence: index + 1 });
    });
  });
  return makeFeed({ routes, stops, trips, stopTimes, shapes });
}

function routeDistance(stops) {
  return stops.slice(1).reduce((sum, stop, index) => sum + haversine(stops[index], stop), 0);
}
function haversine(a, b) {
  const rad = Math.PI / 180, dLat = (b.stop_lat - a.stop_lat) * rad, dLon = (b.stop_lon - a.stop_lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.stop_lat * rad) * Math.cos(b.stop_lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function dedupePoints(points) { return points.filter((point, index) => index === 0 || point.lat !== points[index - 1].lat || point.lon !== points[index - 1].lon); }
function groupBy(items, key) { return items.reduce((result, item) => ((result[item[key]] ||= []).push(item), result), {}); }
function normalizeKey(key) { return String(key).toLowerCase().replaceAll(/[«»"']/g, "").replaceAll(/[_\s-]+/g, ""); }
function clean(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function number(value) { const parsed = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : null; }
function inMoscow(lat, lon) { return lat > 54.2 && lat < 56.6 && lon > 35.2 && lon < 40.5; }
function slug(value) { return clean(value).toLowerCase().replaceAll(/[^a-zа-яё0-9]+/gi, "_"); }
function formatTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`; }
function routeColor(index) {
  const hue = (index * 137.508) % 360;
  const saturation = 84 / 100;
  const lightness = 50 / 100;
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    return lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("");
}
function escapeHtml(value) { return clean(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function setStatus(text) { $("#data-status").textContent = text; }
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 4500);
}
