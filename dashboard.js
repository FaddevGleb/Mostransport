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
    const routes = event.routes.map((number) => `<a class="event-route" href="./index.html#${encodeURIComponent(number)}">${number}</a>`).join("");
    return `<article class="event-card ${event.tone}">
      <span class="event-icon">${icon}</span>
      <div>
        <span class="event-type">${event.typeLabel}</span>
        <strong>${event.title}</strong>
        <span class="event-meta">${event.place} · ${event.time}</span>
        <p>${event.note}</p>
        <div class="event-routes">${routes}</div>
      </div>
    </article>`;
  }).join("");

  document.querySelector("#weather").innerHTML = TramDemand.DISTRICTS.map((district) => `<article class="weather-card">
    <div><strong>${district.name}</strong><span>${district.condition} · ветер ${district.wind} м/с · осадки ${district.rain}%</span></div>
    <strong>${district.temp > 0 ? "+" : ""}${district.temp}°</strong>
  </article>`).join("");
}

renderDashboard().catch((error) => {
  document.querySelector("#ranking").textContent = error.message;
});
