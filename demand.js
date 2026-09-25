/* global window */
const TramDemand = (() => {
  const DISTRICTS = [
    ["Хамовники", "Облачно", 13, 4, 20],
    ["Якиманка", "Небольшой дождь", 12, 5, 70],
    ["Сокольники", "Пасмурно", 11, 3, 35],
    ["Преображенское", "Облачно", 12, 4, 25],
    ["Лефортово", "Дождь", 11, 6, 80],
    ["Даниловский", "Переменная облачность", 13, 4, 15],
    ["Чертаново Южное", "Ясно", 14, 3, 5],
    ["Останкинский", "Облачно", 12, 5, 30],
    ["Щукино", "Пасмурно", 11, 4, 40],
    ["Северное Медведково", "Морось", 10, 5, 55],
    ["Сокол", "Облачно", 12, 3, 20],
    ["Новогиреево", "Ясно", 14, 2, 0],
  ].map(([name, condition, temp, wind, rain]) => ({ name, condition, temp, wind, rain }));

  function hash(value) {
    let result = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function mix(seed) {
    const value = Math.sin(seed) * 10000;
    return value - Math.floor(value);
  }

  function profile(seed, hour, dayOffset) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const commute = (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20);
    const night = hour < 6 || hour >= 23;
    const shape = night ? 0.22 : commute ? 1.05 : 0.68;
    const noise = 0.8 + mix(seed + hour * 19 + dayOffset * 53) * 0.45;
    const pressure = 0.48 + mix(seed + 11) * 0.95;
    const capacity = 900 + (seed % 1700);
    const passengers = Math.max(40, Math.round(capacity * shape * noise * pressure * (weekend ? 0.76 : 1)));
    return { hour, passengers, load: passengers / capacity, capacity };
  }

  function dayBlock(seed, dayOffset) {
    const hours = Array.from({ length: 24 }, (_, hour) => profile(seed, hour, dayOffset));
    const peak = hours.reduce((best, item) => (item.load > best.load ? item : best), hours[0]);
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    return {
      label: date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "short" }),
      shortLabel: `${date.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "")} ${date.getDate()}`,
      hours,
      total: hours.reduce((sum, item) => sum + item.passengers, 0),
      peak,
    };
  }

  function demandFor(routeKey) {
    const seed = hash(routeKey);
    const today = dayBlock(seed, 0);
    const tomorrow = dayBlock(seed, 1);
    const hourNow = new Date().getHours();
    const upcoming = Array.from({ length: 12 }, (_, shift) => {
      const dayOffset = Math.floor((hourNow + shift) / 24);
      return profile(seed, (hourNow + shift) % 24, dayOffset);
    });
    const peak = upcoming.reduce((best, item) => (item.load > best.load ? item : best), upcoming[0]);
    return {
      capacity: today.hours[0].capacity,
      current: today.hours[hourNow],
      upcoming,
      index: peak.load,
      today: today.hours.filter((item) => item.hour >= hourNow),
      tomorrow,
      week: Array.from({ length: 7 }, (_, index) => dayBlock(seed, index + 1)),
    };
  }

  function loadTone(load) {
    if (load > 1) return "hot";
    if (load >= 0.8) return "warm";
    return "ok";
  }

  function formatLoad(load) {
    return `${Math.round(load * 100)}%`;
  }

  function formatPassengers(value) {
    return Math.round(value).toLocaleString("ru-RU");
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function svgIcon(paths) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  const ICONS = {
    sun: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4"/>'),
    cloud: svgIcon('<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.5 3.5 0 0 0 7 18z"/>'),
    rain: svgIcon('<path d="M7 16h9.5a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.6 1.4A3.2 3.2 0 0 0 7 16z"/><path d="M8.5 18.5 8 21M12 18.5 11.5 21M15.5 18.5 15 21"/>'),
    match: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 4c2 2.4 3 4.8 3 8s-1 5.6-3 8M12 4c-2 2.4-3 4.8-3 8s1 5.6 3 8M4 12h16M6.2 8h11.6M6.2 16h11.6"/>'),
    metro: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M8 16V9.5L12 8l4 1.5V16M8 12h8"/>'),
    accident: svgIcon('<path d="M12 3 3 19h18L12 3z"/><path d="M12 9v5M12 16.5v.5"/>'),
    concert: svgIcon('<path d="M9 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M11.5 15.5V6l8-2v9.5"/><path d="M17 15.5a2.5 2.5 0 1 0 0-5"/>'),
    works: svgIcon('<path d="M14.5 4.5 19.5 9.5M9 15l-5 5M16 8l-8 8"/><path d="M14 6a4 4 0 0 1 4 4"/>'),
    wind: svgIcon('<path d="M4 8h11a3 3 0 1 0-3-3"/><path d="M4 12h13a3 3 0 1 1-3 3"/><path d="M4 16h7"/>'),
    holiday: svgIcon('<path d="M5 21V5l7 3 7-3v16"/><path d="M5 12h14"/>'),
    hospital: svgIcon('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
    office: svgIcon('<path d="M5 21V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15"/><path d="M15 10h4v11H5"/><path d="M8 9h2M8 13h2M8 17h2M12 9h2M12 13h2M12 17h2"/>'),
    store: svgIcon('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/><path d="M9 13v3M15 13v3"/>'),
    park: svgIcon('<path d="M12 21V11"/><path d="M7 13a5 5 0 1 1 10 0H7z"/><path d="M8 21h8"/>'),
    university: svgIcon('<path d="M3 10 12 5l9 5-9 5-9-5z"/><path d="M7 12.5V17c2.4 1.4 7.6 1.4 10 0v-4.5"/>'),
  };

  const HOLIDAYS = ["День города", "Фестиваль", "Каникулы"];

  function weatherIcon(condition) {
    if (/дожд|морось/i.test(condition)) return ICONS.rain;
    if (/ясно/i.test(condition)) return ICONS.sun;
    return ICONS.cloud;
  }

  function countLabel(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (count === 0) return "нет";
    if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
    return `${count} ${many}`;
  }

  function contextFor(routeKey) {
    const seed = hash(routeKey);
    const district = DISTRICTS[seed % DISTRICTS.length];
    const holiday = mix(seed + 3) > 0.78;
    const holidayName = HOLIDAYS[seed % HOLIDAYS.length];
    const hospital = seed % 4;
    const office = 3 + (seed % 10);
    const store = 5 + ((seed >>> 3) % 12);
    const park = (seed >>> 5) % 5;
    const university = (seed >>> 7) % 3;
    const windNote = district.wind >= 5 ? "сильный" : "умеренный";
    return [
      {
        label: "Погода",
        value: `${district.temp > 0 ? "+" : ""}${district.temp}°`,
        note: district.condition,
        icon: weatherIcon(district.condition),
        title: `${district.name}: ${district.condition}, ${district.temp}°`,
      },
      {
        label: "Ветер",
        value: `${district.wind} м/с`,
        note: windNote,
        icon: ICONS.wind,
        title: `Скорость ветра ${district.wind} м/с`,
      },
      {
        label: "Праздник",
        value: holiday ? "да" : "нет",
        note: holiday ? holidayName : "обычный день",
        icon: ICONS.holiday,
        off: !holiday,
        title: holiday ? holidayName : "Праздников по маршруту нет",
      },
      {
        label: "Больница",
        value: hospital ? String(hospital) : "нет",
        note: hospital ? countLabel(hospital, "объект", "объекта", "объектов") : "вне зоны",
        icon: ICONS.hospital,
        off: hospital === 0,
        title: hospital ? `${countLabel(hospital, "больница", "больницы", "больниц")} по маршруту` : "Больниц рядом нет",
      },
      {
        label: "Офис",
        value: String(office),
        note: countLabel(office, "кластер", "кластера", "кластеров"),
        icon: ICONS.office,
        title: `${office} офисных кластеров по маршруту`,
      },
      {
        label: "Магазин",
        value: String(store),
        note: countLabel(store, "точка", "точки", "точек"),
        icon: ICONS.store,
        title: `${store} магазинов по маршруту`,
      },
      {
        label: "Парк",
        value: park ? String(park) : "нет",
        note: park ? countLabel(park, "зона", "зоны", "зон") : "вне зоны",
        icon: ICONS.park,
        off: park === 0,
        title: park ? `${countLabel(park, "парк", "парка", "парков")} по маршруту` : "Парков рядом нет",
      },
      {
        label: "Университет",
        value: university ? String(university) : "нет",
        note: university ? countLabel(university, "кампус", "кампуса", "кампусов") : "вне зоны",
        icon: ICONS.university,
        off: university === 0,
        title: university ? `${countLabel(university, "университет", "университета", "университетов")} по маршруту` : "Университетов рядом нет",
      },
    ];
  }

  const EVENTS = [
    {
      type: "match",
      typeLabel: "Матч",
      tone: "warm",
      title: "Спартак — ЦСКА",
      place: "Лужники",
      time: "сегодня, 19:00",
      routes: ["14", "26", "39"],
      note: "Наплыв после финального свистка",
    },
    {
      type: "parade",
      typeLabel: "Парад",
      tone: "hot",
      title: "Городской парад",
      place: "Тверская улица",
      time: "завтра, 11:00",
      routes: ["А", "7", "50"],
      note: "Перекрытие участка, удлинение рейса",
    },
    {
      type: "metro",
      typeLabel: "Метро",
      tone: "hot",
      title: "Закрытие «Сокол»",
      place: "Замоскворецкая линия",
      time: "до 22:00",
      routes: ["6", "15", "23", "27"],
      note: "Пересадка на трамвай в обход станции",
    },
    {
      type: "accident",
      typeLabel: "Авария",
      tone: "hot",
      title: "Сход вагона на стрелке",
      place: "Проспект Мира",
      time: "сейчас",
      routes: ["7", "4"],
      note: "Движение ограничено, интервал 18 мин",
    },
    {
      type: "works",
      typeLabel: "Ремонт",
      tone: "warm",
      title: "Замена путей",
      place: "Щукинская",
      time: "до воскресенья",
      routes: ["10", "21", "15"],
      note: "Короткий оборот у метро",
    },
    {
      type: "concert",
      typeLabel: "Концерт",
      tone: "ok",
      title: "Вечер на ВДНХ",
      place: "Останкино",
      time: "сегодня, 20:30",
      routes: ["11", "17", "25"],
      note: "Пик к окончанию программы",
    },
  ];

  return { DISTRICTS, EVENTS, ICONS, demandFor, contextFor, loadTone, formatLoad, formatPassengers, formatHour };
})();

window.TramDemand = TramDemand;
