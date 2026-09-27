const SPLIT_KEY = "tram-dashboard-splits";
const SPLIT_MIN = 220;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function routeLinks(routes) {
  return String(routes || "").split(";").filter(Boolean).map((number) => `<a class="event-route" href="./index.html#${encodeURIComponent(number)}">${escapeHtml(number)}</a>`).join("");
}

async function renderDashboard() {
  await TramFacts.load();
  if (window.TramForecast) {
    try {
      await TramForecast.load();
    } catch {
      /* The forecast panel explains that the files are unavailable. */
    }
  }
  renderForecastWatch();
  const routes = [...TramFacts.state.routes].sort((left, right) => right.accidentsPerKm - left.accidentsPerKm || right.accidents - left.accidents);
  const stations = [...TramFacts.state.stations].sort((left, right) => right.accidents - left.accidents || right.tramAccidents - left.tramAccidents);
  const accidentTotal = TramFacts.state.events.filter((event) => event["тип"] === "авария").length;
  const repairTotal = TramFacts.state.events.filter((event) => event["тип"] === "ремонт").length;
  const poiTotal = TramFacts.state.events.filter((event) => event["тип"] === "точка интереса").length;
  const maxDensity = Math.max(...routes.map((route) => route.accidentsPerKm), 1);

  document.querySelector("#summary").innerHTML = [
    ["ДТП у линий", String(accidentTotal)],
    ["Ремонты", String(repairTotal)],
    ["Места", String(poiTotal)],
  ].map(([label, value]) => `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");

  document.querySelector("#ranking").innerHTML = routes.map((route, index) => {
    const tone = TramFacts.toneForDensity(route.accidentsPerKm);
    const width = Math.min(100, Math.round((route.accidentsPerKm / maxDensity) * 100));
    return `<a class="rank-row" href="./index.html#${encodeURIComponent(route.number)}">
      <span class="rank-index">${index + 1}</span>
      <span class="route-badge" style="background:${tone === "hot" ? "#e23b4b" : tone === "warm" ? "#e2a322" : "#2faf67"}">${escapeHtml(route.number)}</span>
      <span><span class="rank-name">${escapeHtml(route.name)}</span><span class="rank-meta">${route.accidents} ДТП · индекс ${route.trafficScore}</span></span>
      <span class="load-track"><span class="load-fill ${tone}" style="width:${width}%"></span></span>
      <span class="load-pill ${tone}">${route.accidentsPerKm}</span>
    </a>`;
  }).join("");

  document.querySelector("#events").innerHTML = stations.slice(0, 8).map((station) => {
    const tone = station.tramAccidents > 0 ? "hot" : station.accidents > 0 ? "warm" : "ok";
    return `<article class="event-card ${tone}">
      <span class="event-icon">${TramDemand.ICONS.accident}</span>
      <div>
        <span class="event-type">Авария</span>
        <strong>${escapeHtml(station.name)}</strong>
        <span class="event-meta">${escapeHtml(station.routes || "—")} · ${station.accidents} ДТП · трамвай ${station.tramAccidents}</span>
        <div class="event-routes">${routeLinks(station.routes)}</div>
      </div>
    </article>`;
  }).join("");

  document.querySelector("#weather").innerHTML = [...TramFacts.state.routes].map((route) => `<article class="weather-card">
    <div><strong>${escapeHtml(route.number)} · ${escapeHtml(route.name)}</strong><span>${escapeHtml(route.weather)} · ветер ${route.wind ?? "—"} км/ч · осадки ${route.precipitation ?? 0} мм</span></div>
    <strong>${route.temperature == null ? "—" : `${route.temperature > 0 ? "+" : ""}${route.temperature}°`}</strong>
  </article>`).join("");

  document.querySelector("#traffic").innerHTML = [...TramFacts.state.routes].sort((left, right) => right.trafficScore - left.trafficScore).map((route) => {
    const tone = route.trafficScore >= 6 ? "hot" : route.trafficScore >= 4 ? "warm" : "ok";
    return `<article class="traffic-row">
      <div class="traffic-head"><strong>${escapeHtml(route.number)} ${escapeHtml(route.name)}</strong><span>${route.trafficScore}/10</span></div>
      <span class="load-track"><span class="load-fill ${tone}" style="width:${Math.min(100, route.trafficScore * 10)}%"></span></span>
    </article>`;
  }).join("");

  document.querySelector("#production").innerHTML = [...TramFacts.state.routes].sort((left, right) => (right.repairs ?? -1) - (left.repairs ?? -1)).map((route) => {
    const known = route.repairs != null;
    const tone = !known ? "ok" : route.repairs >= 20 ? "hot" : route.repairs > 0 ? "warm" : "ok";
    return `<article class="event-card ${tone}">
      <span class="event-icon">${TramDemand.ICONS.works}</span>
      <div>
        <span class="event-type">Ремонт</span>
        <strong>${escapeHtml(route.number)} · ${escapeHtml(route.name)}</strong>
        <span class="event-meta">${known ? route.repairs : "—"}</span>
      </div>
    </article>`;
  }).join("");

  document.querySelector("#stations").innerHTML = stations.slice(0, 8).map((station) => `<article class="station-row">
    <div>
      <strong>${escapeHtml(station.name)}</strong>
      <span class="station-meta">${escapeHtml(station.routes)} · ${station.accidents} ДТП · ${station.repairs} рем. · ${station.pois} мест</span>
    </div>
  </article>`).join("");

  renderAnalytics(routes);
  bindSplits();
}

function renderForecastWatch() {
  const host = document.querySelector("#forecast-watch");
  if (!window.TramForecast?.state.loaded) {
    host.textContent = "—";
    return;
  }
  const rows = TramForecast.watchlist("2025-11-03", 7, 3);
  host.innerHTML = rows.map((row, index) => {
    const deviation = row.deviation == null ? "—" : `${row.deviation > 0 ? "+" : ""}${Math.round(row.deviation * 100)}%`;
    const usual = row.usual == null ? "—" : TramForecast.formatCount(row.usual);
    const geometry = TramForecast.hasGeometry(row.route);
    const label = `${escapeHtml(row.route)} · ${String(row.hour).padStart(2, "0")}:00`;
    const title = geometry
      ? `<a class="rank-name" href="./index.html?date=2025-11-03&hour=${row.hour}#${encodeURIComponent(row.route)}">${label}</a>`
      : `<span class="rank-name">${label}</span>`;
    const tone = row.deviation == null ? "missing" : row.deviation > 0.15 ? "hot" : row.deviation > 0 ? "warm" : "ok";
    return `<article class="rank-row">
      <span class="rank-index">${index + 1}</span>
      <span class="route-badge">${escapeHtml(row.route)}</span>
      <span>${title}<span class="rank-meta">${TramForecast.formatCount(row.value)} · ${usual}</span></span>
      <span class="load-track" aria-hidden="true"></span>
      <span class="load-pill ${tone}">${deviation}</span>
    </article>`;
  }).join("");
}

function renderAnalytics(routes) {
  const bands = [
    ["меньше 5 на км", routes.filter((route) => route.accidentsPerKm < 5).length, "ok"],
    ["5–6 на км", routes.filter((route) => route.accidentsPerKm >= 5 && route.accidentsPerKm <= 6).length, "warm"],
    ["больше 6 на км", routes.filter((route) => route.accidentsPerKm > 6).length, "hot"],
  ];
  const bandMax = Math.max(...bands.map((band) => band[1]), 1);
  document.querySelector("#load-mix").innerHTML = bands.map(([label, count, tone]) => `<div class="mix-row">
    <span>${escapeHtml(label)}</span>
    <span class="load-track"><span class="load-fill ${tone}" style="width:${Math.round((count / bandMax) * 100)}%"></span></span>
    <strong>${count}</strong>
  </div>`).join("");

  const ordered = [...routes].sort((left, right) => Number(left.number) - Number(right.number));
  const max = Math.max(...ordered.map((route) => route.accidents), 1);
  document.querySelector("#network-hours").innerHTML = ordered.map((route) => `<div class="hour-col" title="${escapeHtml(route.number)} · ${route.accidents} ДТП">
    <div class="week-bar-slot"><div class="hour-bar ${TramFacts.toneForDensity(route.accidentsPerKm)}" style="height:${Math.max(8, (route.accidents / max) * 100)}%"></div></div>
    <span>${escapeHtml(route.number)}</span>
  </div>`).join("");
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
