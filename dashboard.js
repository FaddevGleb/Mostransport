const SPLIT_KEY = "tram-dashboard-splits";
const SPLIT_MIN = 220;

async function renderDashboard() {
  const response = await fetch("./data/tram_routes_3221.geojson", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось прочитать локальный GeoJSON");
  const payload = await response.json();
  const routes = payload.features.map((feature) => {
    const properties = feature.properties || {};
    const number = properties.RouteNumber || "—";
    const demand = TramDemand.demandFor(number);
    return {
      number,
      name: properties.RouteName || number,
      track: properties.TrackOfFollowing || "",
      demand,
      tone: TramDemand.loadTone(demand.index),
    };
  }).sort((left, right) => right.demand.index - left.demand.index);

  const overloaded = routes.filter((route) => route.demand.index > 1).length;
  const comfortable = routes.filter((route) => route.demand.index < 0.8).length;
  const average = routes.reduce((sum, route) => sum + route.demand.index, 0) / (routes.length || 1);
  document.querySelector("#summary").innerHTML = [
    ["Средний индекс", TramDemand.formatLoad(average), "от расчётной пропускной способности"],
    ["Выше расчёта", String(overloaded), "маршрутов с загрузкой больше 100%"],
    ["Свободные", String(comfortable), "маршрутов с загрузкой меньше 80%"],
  ].map(([label, value, note]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong><span>${note}</span></article>`).join("");

  document.querySelector("#ranking").innerHTML = routes.map((route, index) => {
    const width = Math.min(100, Math.round(route.demand.index * 100));
    return `<a class="rank-row" href="./index.html#${encodeURIComponent(route.number)}">
      <span class="rank-index">${index + 1}</span>
      <span class="route-badge" style="background:${route.tone === "hot" ? "#e23b4b" : route.tone === "warm" ? "#e2a322" : "#2faf67"}">${route.number}</span>
      <span><span class="rank-name">${route.name}</span><span class="rank-meta">${TramDemand.formatPassengers(route.demand.current.passengers)} пасс./час</span></span>
      <span class="load-track"><span class="load-fill ${route.tone}" style="width:${width}%"></span></span>
      <span class="load-pill ${route.tone}">${TramDemand.formatLoad(route.demand.index)}</span>
    </a>`;
  }).join("");

  document.querySelector("#events").innerHTML = TramDemand.EVENTS.map((event) => {
    const iconKey = event.type === "parade" ? "holiday" : event.type;
    const icon = TramDemand.ICONS[iconKey] || TramDemand.ICONS.holiday;
    const links = event.routes.map((number) => `<a class="event-route" href="./index.html#${encodeURIComponent(number)}">${number}</a>`).join("");
    return `<article class="event-card ${event.tone}">
      <span class="event-icon">${icon}</span>
      <div>
        <span class="event-type">${event.typeLabel}</span>
        <strong>${event.title}</strong>
        <span class="event-meta">${event.place} · ${event.time}</span>
        <p>${event.note}</p>
        <div class="event-routes">${links}</div>
      </div>
    </article>`;
  }).join("");

  document.querySelector("#weather").innerHTML = TramDemand.DISTRICTS.map((district) => `<article class="weather-card">
    <div><strong>${district.name}</strong><span>${district.condition} · ветер ${district.wind} м/с · осадки ${district.rain}%</span></div>
    <strong>${district.temp > 0 ? "+" : ""}${district.temp}°</strong>
  </article>`).join("");

  document.querySelector("#traffic").innerHTML = TramDemand.TRAFFIC.map((road) => {
    const tone = road.score >= 8 ? "hot" : road.score >= 5 ? "warm" : "ok";
    return `<article class="traffic-row">
      <div class="traffic-head"><strong>${road.name}</strong><span>${road.score}/10 · +${road.delay} мин</span></div>
      <span class="load-track"><span class="load-fill ${tone}" style="width:${road.score * 10}%"></span></span>
    </article>`;
  }).join("");

  document.querySelector("#production").innerHTML = TramDemand.PRODUCTION.map((item) => `<article class="event-card ${item.tone}">
    <span class="event-icon">${item.tone === "hot" ? TramDemand.ICONS.accident : TramDemand.ICONS.works}</span>
    <div>
      <span class="event-type">${item.typeLabel}</span>
      <strong>${item.title}</strong>
      <span class="event-meta">${item.time}</span>
      <p>${item.note}</p>
    </div>
  </article>`).join("");

  document.querySelector("#stations").innerHTML = busiestStops(routes).map((stop) => `<article class="station-row">
    <div>
      <strong>${stop.name}</strong>
      <span class="station-meta">${stop.routes} маршр. · пик ${TramDemand.formatPassengers(stop.peak)} пасс.</span>
    </div>
  </article>`).join("");

  renderAnalytics(routes);
  bindSplits();
}

function renderAnalytics(routes) {
  const bands = [
    ["меньше 80%", routes.filter((route) => route.demand.index < 0.8).length, "ok"],
    ["80–100%", routes.filter((route) => route.demand.index >= 0.8 && route.demand.index <= 1).length, "warm"],
    ["больше 100%", routes.filter((route) => route.demand.index > 1).length, "hot"],
  ];
  const bandMax = Math.max(...bands.map((band) => band[1]), 1);
  document.querySelector("#load-mix").innerHTML = bands.map(([label, count, tone]) => `<div class="mix-row">
    <span>${label}</span>
    <span class="load-track"><span class="load-fill ${tone}" style="width:${Math.round((count / bandMax) * 100)}%"></span></span>
    <strong>${count}</strong>
  </div>`).join("");

  const hours = Array.from({ length: 12 }, (_, shift) => {
    const sample = routes[0]?.demand.upcoming[shift];
    const passengers = routes.reduce((sum, route) => sum + (route.demand.upcoming[shift]?.passengers || 0), 0);
    return { hour: sample?.hour ?? shift, passengers };
  });
  const max = Math.max(...hours.map((item) => item.passengers), 1);
  document.querySelector("#network-hours").innerHTML = hours.map((item) => `<div class="hour-col" title="${TramDemand.formatHour(item.hour)} · ${TramDemand.formatPassengers(item.passengers)} пасс.">
    <div class="week-bar-slot"><div class="hour-bar ok" style="height:${Math.max(8, (item.passengers / max) * 100)}%"></div></div>
    <span>${String(item.hour).padStart(2, "0")}</span>
  </div>`).join("");
}

function busiestStops(routes) {
  const counts = new Map();
  routes.forEach((route) => {
    new Set(parseStops(route.track)).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))
    .slice(0, 8)
    .map(([name, routeCount]) => ({
      name,
      routes: routeCount,
      peak: TramDemand.demandFor(name).tomorrow.peak.passengers,
    }));
}

function parseStops(track) {
  const stops = [];
  String(track || "").split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean).forEach((token) => {
    const previous = stops[stops.length - 1];
    const continuation = previous && (
      /^[а-яё]/.test(token)
      || (previous === "Покровское" && /^(Глебово|Стрешнево)$/.test(token))
      || (previous === "Свято" && token.startsWith("Данилов"))
    );
    if (continuation) {
      stops[stops.length - 1] = `${previous} - ${token}`;
      return;
    }
    if (previous === token) return;
    stops.push(token);
  });
  return stops;
}

function bindSplits() {
  const saved = readSplits();
  document.querySelectorAll(".split-row").forEach((row) => {
    applySplit(row, saved[row.dataset.split] || [1, 1, 1]);
    row.querySelectorAll(".split-gutter").forEach((gutter) => {
      gutter.addEventListener("pointerdown", (event) => startSplit(event, row, Number(gutter.dataset.index)));
    });
  });
}

function readSplits() {
  try {
    return JSON.parse(localStorage.getItem(SPLIT_KEY)) || {};
  } catch {
    return {};
  }
}

function applySplit(row, fractions) {
  const [left, middle, right] = fractions;
  row.style.gridTemplateColumns = `minmax(0, ${left}fr) 12px minmax(0, ${middle}fr) 12px minmax(0, ${right}fr)`;
}

function startSplit(event, row, index) {
  if (window.matchMedia("(max-width: 780px)").matches) return;
  event.preventDefault();
  gutterCapture(event.currentTarget, event.pointerId);
  const panels = [...row.querySelectorAll(":scope > .panel-block")];
  const widths = panels.map((panel) => panel.getBoundingClientRect().width);
  const startX = event.clientX;
  const leftStart = widths[index];
  const rightStart = widths[index + 1];
  row.classList.add("is-dragging");

  const move = (moveEvent) => {
    let left = leftStart + (moveEvent.clientX - startX);
    let right = rightStart - (moveEvent.clientX - startX);
    if (left < SPLIT_MIN) {
      right -= SPLIT_MIN - left;
      left = SPLIT_MIN;
    }
    if (right < SPLIT_MIN) {
      left -= SPLIT_MIN - right;
      right = SPLIT_MIN;
    }
    if (left < SPLIT_MIN || right < SPLIT_MIN) return;
    const next = widths.slice();
    next[index] = left;
    next[index + 1] = right;
    const fractions = next.map((width) => width / widths.reduce((sum, item) => sum + item, 0));
    applySplit(row, fractions);
    const saved = readSplits();
    saved[row.dataset.split] = fractions;
    localStorage.setItem(SPLIT_KEY, JSON.stringify(saved));
  };
  const stop = () => {
    row.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function gutterCapture(gutter, pointerId) {
  try {
    gutter.setPointerCapture(pointerId);
  } catch {
    /* Drag still follows window pointer events if capture is unavailable. */
  }
}

renderDashboard().catch((error) => {
  document.querySelector("#ranking").textContent = error.message;
});
