/* global window, TramDemand */
const TramFacts = (() => {
  const state = { routes: [], stations: [], events: [], pois: [], fleet: new Map(), fleetMeta: null, byNumber: new Map(), loaded: false };
  const poiSummaryCache = new Map();
  const POI_LABELS = {
    shop_convenience: "магазин",
    shop_supermarket: "супермаркет",
    shop_mall: "торговый центр",
    shop_department_store: "универмаг",
    kindergarten: "детский сад",
    school: "школа",
    college: "колледж",
    university: "университет",
    clinic: "поликлиника",
    hospital: "больница",
    park: "парк",
    theme_park: "парк",
    metro_entrance: "метро",
    metro_station: "метро",
    sports_centre: "спорт",
    fitness_centre: "фитнес",
    attraction: "достопримечательность",
    museum: "музей",
    gallery: "галерея",
    railway_station: "вокзал",
    stadium: "стадион",
    zoo: "зоопарк",
    bus_station: "автовокзал",
  };
  let pending = null;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text || "").replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else quoted = false;
        } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") field += char;
    }
    if (field !== "" || row.length) {
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
    }
    const headers = rows.shift() || [];
    return rows.map((cells) => {
      const item = {};
      headers.forEach((key, cellIndex) => {
        item[key] = cells[cellIndex] ?? "";
      });
      return item;
    });
  }

  function asNumber(value) {
    if (value === "" || value == null) return null;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }

  function weatherIcon(condition) {
    if (/дожд|морось|ливень|снег|гроза/i.test(condition || "")) return TramDemand.ICONS.rain;
    if (/ясно/i.test(condition || "")) return TramDemand.ICONS.sun;
    return TramDemand.ICONS.cloud;
  }

  async function load() {
    if (state.loaded) return state;
    if (pending) return pending;
    pending = Promise.all([
      fetch("./data/enrichment/routes_enriched.csv", { cache: "no-store" }).then((response) => response.text()),
      fetch("./data/enrichment/stations_averaged.csv", { cache: "no-store" }).then((response) => response.text()),
      fetch("./data/enrichment/events_nearest_station.csv", { cache: "no-store" }).then((response) => response.text()),
      fetch("./data/enrichment/tram_fleet.json", { cache: "no-store" }).then((response) => response.json()),
      fetch("./moscow_pois_overpass.csv", { cache: "no-store" }).then((response) => response.text()),
    ]).then(([routesText, stationsText, eventsText, fleetJson, poisText]) => {
      state.routes = parseCsv(routesText).map((row) => ({
        number: String(row.route_number),
        name: row.route_name,
        lengthKm: asNumber(row.length_km),
        temperature: asNumber(row.temperature_c),
        wind: asNumber(row.wind_kmh),
        precipitation: asNumber(row.precipitation_mm),
        weather: row.weather,
        weatherAlert: row.weather_alert === "1",
        holidayToday: row.holiday_today === "1",
        nextHoliday: row.next_holiday,
        accidents: asNumber(row.accidents_2024_2026) || 0,
        accidentsPerKm: asNumber(row.accidents_per_km) || 0,
        tramAccidents: asNumber(row.tram_related_accidents) || 0,
        repairs: asNumber(row.repairs_nearby),
        majorRoads: asNumber(row.major_roads_nearby),
        trafficScore: asNumber(row.traffic_score) || 0,
        poiCount: asNumber(row.poi_count) || 0,
        poiExamples: row.poi_examples || "",
      }));
      state.byNumber = new Map(state.routes.map((route) => [route.number, route]));
      state.stations = parseCsv(stationsText).map((row) => ({
        name: row["станция"],
        lat: asNumber(row["широта"]),
        lon: asNumber(row["долгота"]),
        routes: row["маршруты"],
        accidents: asNumber(row["аварий"]) || 0,
        tramAccidents: asNumber(row["аварий_с_трамваем"]) || 0,
        injuredAvg: asNumber(row["раненых_в_среднем"]),
        deadAvg: asNumber(row["погибших_в_среднем"]),
        repairs: asNumber(row["ремонтов"]) || 0,
        roads: asNumber(row["магистралей"]) || 0,
        pois: asNumber(row["точек_интереса"]) || 0,
        poiExamples: row["примеры_точек"] || "",
        temperature: asNumber(row["температура"]),
        wind: asNumber(row["ветер_км_ч"]),
        precipitation: asNumber(row["осадки_мм"]),
        weather: row["погода"],
      }));
      state.events = parseCsv(eventsText);
      state.pois = parseCsv(poisText).flatMap((row) => {
        const name = String(row.name || "").trim();
        const lat = asNumber(row.lat);
        const lon = asNumber(row.lon);
        if (!name || name === "Без названия" || lat == null || lon == null) return [];
        return [{ id: row.poi_id || `${lat},${lon}`, name, type: row.type || "", label: POI_LABELS[row.type] || "", lat, lon }];
      });
      state.fleetMeta = fleetJson;
      state.fleet = new Map(Object.entries(fleetJson.routes || {}).map(([number, row]) => [String(number), row.vehicles]));
      state.loaded = true;
      return state;
    });
    return pending;
  }

  function contextFor(routeNumber) {
    const route = state.byNumber.get(String(routeNumber));
    if (!route) return null;
    const holidayNote = route.nextHoliday ? route.nextHoliday.slice(0, 10) : "нет даты";
    const repairKnown = route.repairs != null;
    const poiSample = route.poiExamples.split(";").map((item) => item.trim()).filter(Boolean)[0] || "в радиусе линии";
    const poiNote = poiSample.length > 22 ? `${poiSample.slice(0, 21)}…` : poiSample;
    return [
      {
        label: "Погода",
        value: route.temperature == null ? "—" : `${route.temperature > 0 ? "+" : ""}${route.temperature}°`,
        note: route.weather || "нет данных",
        icon: weatherIcon(route.weather),
        title: `${route.weather}, осадки ${route.precipitation ?? 0} мм`,
      },
      {
        label: "Ветер",
        value: route.wind == null ? "—" : String(route.wind),
        note: "км/ч",
        icon: TramDemand.ICONS.wind,
        title: `Ветер ${route.wind ?? "—"} км/ч по центру линии`,
      },
      {
        label: "Праздник",
        value: route.holidayToday ? "да" : "нет",
        note: route.holidayToday ? "сегодня" : holidayNote,
        icon: TramDemand.ICONS.holiday,
        off: !route.holidayToday,
        title: route.holidayToday ? "Сегодня праздничный день" : `Ближайший: ${route.nextHoliday || "нет"}`,
      },
      {
        label: "Аварии",
        value: String(route.accidents),
        note: `${route.accidentsPerKm} на км`,
        icon: TramDemand.ICONS.accident,
        title: `ДТП 2024–2026 в 150 м от линии: ${route.accidents}`,
      },
      {
        label: "Ремонт",
        value: repairKnown ? String(route.repairs) : "—",
        note: repairKnown ? "у линии" : "нет выгрузки",
        icon: TramDemand.ICONS.works,
        off: !repairKnown || route.repairs === 0,
        title: repairKnown ? `Ремонты OSM в 150 м: ${route.repairs}` : "Слой ремонтов для этой линии не загрузился",
      },
      {
        label: "Пробки",
        value: String(route.trafficScore),
        note: repairKnown ? "из 10" : "по ДТП",
        icon: TramDemand.ICONS.traffic,
        title: "Открытый индекс: магистрали OSM и плотность ДТП, не живой балл Яндекса",
      },
      {
        label: "Места",
        value: String(route.poiCount),
        note: poiNote,
        icon: TramDemand.ICONS.poi,
        off: route.poiCount === 0,
        title: route.poiExamples || "Точек интереса нет",
      },
      {
        label: "Трамвай",
        value: String(route.tramAccidents),
        note: "в описании ДТП",
        icon: TramDemand.ICONS.metro,
        off: route.tramAccidents === 0,
        title: `ДТП, где в карточке есть трамвай: ${route.tramAccidents}`,
      },
    ];
  }

  function fleetFor(routeNumber) {
    return state.fleet.has(String(routeNumber)) ? state.fleet.get(String(routeNumber)) : null;
  }

  function normalizeName(value) {
    return String(value || "").toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/giu, "");
  }

  function stationDistance(station, lat, lon) {
    if (station.lat == null || station.lon == null || lat == null || lon == null) return Infinity;
    const dy = (station.lat - lat) * 111320;
    const dx = (station.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  }

  function poisNear(lat, lon, limit = 5, radiusMeters = 500) {
    if (lat == null || lon == null || !state.pois.length) return [];
    const found = [];
    state.pois.forEach((poi) => {
      const distance = stationDistance(poi, lat, lon);
      if (distance <= radiusMeters) found.push({ ...poi, distance });
    });
    found.sort((left, right) => left.distance - right.distance);
    return found.slice(0, limit);
  }

  function poiSummary(routeId, stops) {
    const key = String(routeId);
    if (poiSummaryCache.has(key)) return poiSummaryCache.get(key);
    const points = (stops || []).filter((stop) => stop.stop_lat != null && stop.stop_lon != null);
    const seen = new Set();
    let example = "";
    if (points.length && state.pois.length) {
      state.pois.forEach((poi) => {
        const near = points.some((stop) => stationDistance(poi, stop.stop_lat, stop.stop_lon) <= 300);
        if (!near || seen.has(poi.id)) return;
        seen.add(poi.id);
        if (!example) example = poi.name;
      });
    }
    const summary = { count: seen.size, example };
    poiSummaryCache.set(key, summary);
    return summary;
  }

  function stationFor(name, routeNumber, lat, lon) {
    const key = normalizeName(name);
    const matches = state.stations.filter((station) => normalizeName(station.name) === key);
    if (!matches.length) return null;
    const routeKey = String(routeNumber);
    const onRoute = matches.filter((station) => String(station.routes).split(/[;,]/).some((item) => item.trim() === routeKey));
    const pool = onRoute.length ? onRoute : matches;
    return pool.slice().sort((left, right) => stationDistance(left, lat, lon) - stationDistance(right, lat, lon))[0];
  }

  function toneForDensity(value) {
    if (value > 6) return "hot";
    if (value >= 5) return "warm";
    return "ok";
  }

  return { load, contextFor, fleetFor, stationFor, poisNear, poiSummary, toneForDensity, get state() { return state; } };
})();

window.TramFacts = TramFacts;
