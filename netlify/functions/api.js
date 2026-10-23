/**
 * WASATCH SKI WEATHER - STATELESS SERVERLESS BACKEND (Netlify Functions)
 * Replaces the Google Sheet and separate Apps Script projects completely.
 *
 * Environment Variables (Set in Netlify Site Settings -> Environment Variables):
 * - GEMINI_API_KEY: Your Google Gemini API Key (for summarizing Weather Weenies blog)
 * - UDOT_API_KEY: Your UDOT 511 API Key (defaults to configured key if omitted)
 * - SNOWOBS_TOKEN: Your SnowObs token (defaults to UAC public token if omitted)
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes in-memory warm cache
const memoryCache = {};

const RESORT_CONFIG = [
  {
    id: "alta",
    name: "Alta",
    region: "lcc",
    skiUtahName: "Alta Ski Area",
    skiUtahSlug: "alta",
    avgSiteKey: "...Alta (9800 ft)...",
    baseStations: ["ALTA - GUARD HOUSE", "ALTA - BASE"],
    summitStations: ["ALTA - COLLINS", "ALTA - TOP OF COLLINS", "ALTA - MT BALDY"]
  },
  {
    id: "snowbird",
    name: "Snowbird",
    region: "lcc",
    skiUtahName: "Snowbird",
    skiUtahSlug: "snowbird",
    avgSiteKey: "...LCC - Alta/Snowbird",
    baseStations: ["SNOWBIRD -GAD VALLEY", "SNOWBIRD - BASE", "ALTA - GUARD HOUSE"],
    summitStations: ["SNOWBIRD - HIDDEN PEAK", "SNOWBIRD", "ALTA - MT BALDY", "ALTA - COLLINS"]
  },
  {
    id: "brighton",
    name: "Brighton",
    region: "bcc",
    skiUtahName: "Brighton",
    skiUtahSlug: "brighton",
    avgSiteKey: "...Brighton Crest",
    baseStations: ["BRIGHTON", "BRIGHTON BASE", "SOLITUDE BASE"],
    summitStations: ["BRIGHTON CREST", "MILLY", "GREAT WESTERN", "SOLITUDE HONEYCOMB PEAK"]
  },
  {
    id: "solitude",
    name: "Solitude",
    region: "bcc",
    skiUtahName: "Solitude Mountain Resort",
    skiUtahSlug: "solitude",
    avgSiteKey: "...BCC - Brighton/Solitude",
    baseStations: ["SOLITUDE BASE", "SPRUCES"],
    summitStations: ["SOLITUDE HONEYCOMB PEAK", "SOLITUDE SUMMIT", "SOLITUDE POWDERHORN"]
  },
  {
    id: "spruces",
    name: "Spruces",
    region: "bcc",
    skiUtahName: "Spruces",
    skiUtahSlug: "",
    avgSiteKey: "...BCC - Mid Canyon/Spruces",
    baseStations: ["SPRUCES"],
    summitStations: ["SPRUCES"]
  },
  {
    id: "park-city",
    name: "Park City",
    region: "pc",
    skiUtahName: "Park City Mountain",
    skiUtahSlug: "park-city-mountain",
    avgSiteKey: "...Park City Ridgeline",
    baseStations: ["Canyons - Lookout", "PARK CITY - SILVERLODE BOTTOM", "Treasure Mtn Inn Main Street Park City"],
    summitStations: ["Canyons - 9990", "Canyons - Daybreak", "JUPITER"]
  },
  {
    id: "deer-valley",
    name: "Deer Valley",
    region: "pc",
    skiUtahName: "Deer Valley Resort",
    skiUtahSlug: "deer-valley-resort",
    avgSiteKey: "...Park City Ridgeline",
    baseStations: ["DEER VALLEY - SNOW PARK", "PARK CITY - SILVERLODE BOTTOM", "Canyons - Lookout"],
    summitStations: ["DEER VALLEY - BALD MTN", "DEER VALLEY - EMPIRE", "THAYNES CANYON", "Canyons - 9990"]
  },
  {
    id: "snowbasin",
    name: "Snowbasin",
    region: "ogden",
    skiUtahName: "Snowbasin Resort",
    skiUtahSlug: "snowbasin-resort",
    avgSiteKey: "...Snowbasin",
    baseStations: ["SNOWBASIN - BASE", "SNOWBASIN - BOARDWALK", "SNOWBASIN - STRAW BASE"],
    summitStations: ["SNOWBASIN - MOUNT OGDEN", "SNOWBASIN - STRAW TOP", "SNOWBASIN - STRAWBERRY TOWER 15"]
  },
  {
    id: "powder-mountain",
    name: "Powder Mountain",
    region: "ogden",
    skiUtahName: "Powder Mountain",
    skiUtahSlug: "powder-mountain",
    avgSiteKey: "...Powder Mountain",
    baseStations: ["POWDER MOUNTAIN - TIMBERLINE", "POWDER MOUNTAIN", "SNOWBASIN - BOARDWALK"],
    summitStations: ["POWDER MOUNTAIN - LIGHTNING RIDGE", "POWDER MTN", "JAMES PEAK", "SNOWBASIN - MOUNT OGDEN"]
  }
];

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300, s-maxage=600"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const query = (event.queryStringParameters && event.queryStringParameters.q) || "main";
  const now = Date.now();

  if (memoryCache[query] && now - memoryCache[query].ts < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ...memoryCache[query].data, cached: true })
    };
  }

  try {
    let result = {};
    if (query === "roads") {
      result = await fetchRoadsAndSigns();
    } else if (query === "cams") {
      result = await fetchWebcams();
    } else {
      const [stations, resortReports, avgForecast, avy, weenies, xc] = await Promise.allSettled([
        fetchWeatherStations(),
        fetchSkiUtahReports(),
        fetchNwsAvgForecast(),
        fetchUacAvalanche(),
        fetchWeatherWeenies(),
        fetchXcGrooming()
      ]);

      result = {
        updated: new Date().toISOString(),
        stations: stations.status === "fulfilled" ? stations.value : { list: [], byResort: {} },
        resortReports: resortReports.status === "fulfilled" ? resortReports.value : {},
        avgForecast: avgForecast.status === "fulfilled" ? avgForecast.value : {},
        avy: avy.status === "fulfilled" ? avy.value : { danger: "No Rating", bottomLine: "Unavailable", weather: "Unavailable", date: "" },
        forecast: weenies.status === "fulfilled" ? weenies.value : { title: "Wasatch Weather Weenies", summary: "Unavailable", link: "https://wasatchweatherweenies.blogspot.com/" },
        xc: xc.status === "fulfilled" ? xc.value : []
      };
    }

    memoryCache[query] = { ts: now, data: result };
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

async function fetchWeatherStations() {
  const token = process.env.SNOWOBS_TOKEN || "a72b286878755151cdc6672753af773dc455";
  const url = `https://api.snowobs.com/wx/v1/station/data/current/?token=${token}&calc_diff=true&units=default`;
  const resp = await fetch(url);
  const json = await resp.json();

  let stationList = [];
  if (json.STATION) stationList = Object.values(json.STATION);
  else if (json.STATIONS) stationList = Object.values(json.STATIONS);
  else if (Array.isArray(json)) stationList = json;

  const getVal = (station, keys) => {
    for (const k of keys) {
      if (station[k] !== undefined && station[k] !== null && station[k] !== "") return station[k];
    }
    if (Array.isArray(station.observations) && station.observations.length > 0) {
      const latest = station.observations[station.observations.length - 1];
      for (const k of keys) {
        if (latest[k] !== undefined && latest[k] !== null && latest[k] !== "") return latest[k];
      }
    }
    if (station.latest) {
      for (const k of keys) {
        if (station.latest[k] !== undefined && station.latest[k] !== null && station.latest[k] !== "") return station.latest[k];
      }
    }
    return null;
  };

  const degToCardinal = (deg) => {
    if (deg === null || deg === undefined || isNaN(Number(deg))) return "";
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16];
  };

  const parsedStations = stationList.map(s => {
    const name = (s.name || s.station_name || "Unknown").trim();
    const windDirRaw = getVal(s, ["wind_direction", "wind_dir", "wind_cardinal"]);
    return {
      name,
      elev: getVal(s, ["elevation", "elev"]),
      temp: getVal(s, ["air_temp", "temp", "temperature", "air_temp_set_1"]),
      windSpeed: getVal(s, ["wind_speed", "speed", "wind_speed_avg"]),
      windDir: isNaN(Number(windDirRaw)) ? (windDirRaw || "") : degToCardinal(windDirRaw),
      windGust: getVal(s, ["wind_gust", "gust", "wind_speed_max"]),
      snowDepth: getVal(s, ["snow_depth", "depth", "total_snow", "snow_depth_set_1"]),
      snow24h: getVal(s, ["snow_accum_24_hour", "new_snow", "snow_24h", "snow_depth_24hr"]),
      swe: getVal(s, ["snow_water_equiv", "swe", "snow_water_equiv_set_1"])
    };
  });

  const findStation = (candidates) => {
    for (const cand of candidates) {
      const match = parsedStations.find(st => st.name.toLowerCase().includes(cand.toLowerCase()));
      if (match) return match;
    }
    return null;
  };

  const byResort = {};
  for (const rc of RESORT_CONFIG) {
    const baseSt = findStation(rc.baseStations);
    const summitSt = findStation(rc.summitStations);
    byResort[rc.id] = {
      name: rc.name,
      base: baseSt || {},
      summit: summitSt || {}
    };
  }

  return { updated: new Date().toISOString(), byResort, list: parsedStations };
}

async function fetchSkiUtahReports() {
  const resp = await fetch("https://www.skiutah.com/snowreport");
  const html = await resp.text();
  const cleanText = html
    .replace(/&deg;/g, "°")
    .replace(/&#176;/g, "°")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const reports = {};
  for (const rc of RESORT_CONFIG) {
    if (!rc.skiUtahName || rc.id === "spruces") continue;
    let snow24 = null;
    let snow48 = null;
    let baseDepth = null;
    let weather = "-";

    const snowRegex = new RegExp(
      rc.skiUtahName + "[\\s\\S]{0,400}?24\\s*hours\\s*(\\d+)(?:[\\s\\S]{0,120}?48\\s*hours\\s*(\\d+))?[\\s\\S]{0,150}?base\\s*total\\s*(\\d+)",
      "i"
    );
    const match = cleanText.match(snowRegex);
    if (match) {
      snow24 = parseInt(match[1], 10);
      snow48 = match[2] ? parseInt(match[2], 10) : null;
      baseDepth = parseInt(match[3], 10);

      const chunk = cleanText.substring(match.index, match.index + 2500);
      const wxMatch = chunk.match(/(?:Today|Tonight)[\s\S]{0,500}?([0-9]+)°[\s\S]{0,200}?([A-Z][a-z]+[^.]*)/);
      if (wxMatch) {
        let rawDesc = wxMatch[2].trim();
        if (rawDesc.startsWith("Low") || rawDesc.startsWith("High")) {
          const parts = rawDesc.split(" ");
          if (parts.length > 2) rawDesc = parts.slice(2).join(" ");
        }
        const shortDesc = rawDesc.split(",")[0].trim();
        if (shortDesc.length > 2 && !shortDesc.includes("°")) {
          weather = shortDesc;
        }
      }
    }
    reports[rc.id] = { name: rc.name, weather, snow24, snow48, baseDepth };
  }
  return reports;
}

async function fetchNwsAvgForecast() {
  const url = "https://forecast.weather.gov/product.php?site=SLC&product=AVG&issuedby=SLC";
  const resp = await fetch(url);
  const html = await resp.text();
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!preMatch) return { updated: new Date().toISOString(), byResort: {} };

  const fullText = preMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const parseSiteBlock = (siteKey, fallbackKey) => {
    let startIdx = fullText.indexOf(siteKey);
    if (startIdx === -1 && fallbackKey) startIdx = fullText.indexOf(fallbackKey);
    if (startIdx === -1) return null;

    const firstNewLine = fullText.indexOf("\n", startIdx);
    let endIdx = fullText.indexOf("$$", firstNewLine);
    const nextHeader = fullText.indexOf("...", firstNewLine);
    if (nextHeader !== -1 && nextHeader < endIdx) endIdx = nextHeader;

    const block = fullText.substring(startIdx, endIdx);
    const lines = block.split("\n");
    const getNums = (prefix) => {
      const line = lines.find(l => l.toLowerCase().includes(prefix.toLowerCase()));
      if (!line) return [];
      const matches = line.substring(18).match(/-?\d+(\.\d+)?/g);
      return matches ? matches.map(Number) : [];
    };

    const temps = getNums("Temperature");
    const clouds = getNums("Cloud Cover (%)");
    const winds = getNums("Wind (mph)");
    const snow12 = getNums("12 Hour Snow");

    const p1Temps = temps.slice(0, 4);
    const p2Temps = temps.slice(4, 8);
    const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

    return {
      tempP1: p1Temps.length ? `${Math.max(...p1Temps)}° | ${Math.min(...p1Temps)}°` : "-",
      tempP2: p2Temps.length ? `${Math.max(...p2Temps)}° | ${Math.min(...p2Temps)}°` : "-",
      cloudP1: clouds.length >= 4 ? `${avg(clouds.slice(0, 4))}%` : "-",
      cloudP2: clouds.length >= 8 ? `${avg(clouds.slice(4, 8))}%` : "-",
      windP1: winds.length >= 4 ? `${avg(winds.slice(0, 4))} mph` : "-",
      windP2: winds.length >= 8 ? `${avg(winds.slice(4, 8))} mph` : "-",
      snowP1: snow12.length >= 2 ? `${(snow12[0] + snow12[1]).toFixed(1)}"` : "0.0\"",
      snowP2: snow12.length >= 4 ? `${(snow12[2] + snow12[3]).toFixed(1)}"` : "0.0\""
    };
  };

  const byResort = {};
  for (const rc of RESORT_CONFIG) {
    byResort[rc.id] = parseSiteBlock(rc.avgSiteKey, rc.name) || null;
  }
  return { updated: new Date().toISOString(), byResort };
}

async function fetchUacAvalanche() {
  const resp = await fetch("https://utahavalanchecenter.org/forecast/salt-lake/json");
  const data = await resp.json();
  if (!data.advisories || data.advisories.length === 0) throw new Error("No UAC advisory");

  const forecast = data.advisories[0].advisory;
  const cleanText = (html) => {
    if (!html) return "";
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;|\u00A0/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();
  };

  let dangerLevel = forecast.overall_danger_rating;
  if (typeof dangerLevel === "number") {
    const dangerMap = ["No Rating", "Low", "Moderate", "Considerable", "High", "Extreme"];
    dangerLevel = dangerMap[dangerLevel] || "No Rating";
  }

  let roseUrl = "";
  if (forecast.overall_danger_rose_image) {
    const m = forecast.overall_danger_rose_image.match(/src=["'](.*?)["']/);
    roseUrl = m && m[1] ? m[1] : forecast.overall_danger_rose_image;
    if (roseUrl.startsWith("/")) roseUrl = "https://utahavalanchecenter.org" + roseUrl;
  }

  return {
    date: forecast.date_issued || "",
    danger: dangerLevel || "No Rating",
    bottomLine: cleanText(forecast.bottom_line),
    weather: cleanText(forecast.current_conditions || forecast.mountain_weather),
    roseUrl
  };
}

async function fetchWeatherWeenies() {
  const feedUrl = "https://wasatchweatherweenies.blogspot.com/feeds/posts/default?alt=json&max-results=1";
  const resp = await fetch(feedUrl);
  const json = await resp.json();
  const entry = json.feed && json.feed.entry && json.feed.entry[0];
  if (!entry) throw new Error("No blog posts found");

  const title = entry.title.$t;
  const pubDate = entry.published.$t;
  const linkObj = (entry.link || []).find(l => l.rel === "alternate");
  const link = linkObj ? linkObj.href : "https://wasatchweatherweenies.blogspot.com/";
  const rawHtml = (entry.content && entry.content.$t) || (entry.summary && entry.summary.$t) || "";
  const cleanContent = rawHtml.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

  let summary = cleanContent.substring(0, 360) + "...";
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const gResp = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: "Summarize the following weather blog post into 2-3 concise sentences capturing the key forecast details for Wasatch skiers:\n\n" + cleanContent.substring(0, 8000)
            }]
          }]
        })
      });
      const gJson = await gResp.json();
      if (gJson.candidates && gJson.candidates[0]) {
        summary = gJson.candidates[0].content.parts[0].text.trim();
      }
    } catch (e) {
      // Fallback to excerpt
    }
  }

  return { title, date: pubDate, link, summary };
}

async function fetchXcGrooming() {
  const targets = [
    { location: "Millcreek Canyon", url: "https://utahnordic.org/millcreek-canyon/", type: "TUNA" },
    { location: "SR-65 (Big Mountain)", url: "https://utahnordic.org/sr-65/", type: "TUNA" },
    { location: "Spruces", url: "https://utahnordic.org/spruces/", type: "TUNA" },
    { location: "Mountain Dell", url: "https://utahnordic.org/mountain-dell-2/", type: "TUNA" },
    { location: "White Pine Touring", url: "https://utahnordic.org/white-pine-touring/", type: "TUNA" },
    { location: "Round Valley (MTF)", url: "https://mountaintrails.org/winter-daily-report/", type: "MTF" }
  ];

  const results = await Promise.allSettled(
    targets.map(async (site) => {
      const resp = await fetch(site.url);
      const html = await resp.text();
      let clean = html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/\n\s*\n/g, "\n");

      const dateMatch = clean.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i);
      const date = dateMatch ? dateMatch[0] : "Seasonal";

      let idx = clean.indexOf("Most recent Grooming Report");
      if (idx === -1) idx = clean.indexOf("Current Conditions");
      const snippet = idx !== -1 ? clean.substring(idx + 28, idx + 650).trim() : clean.substring(0, 400).trim();
      return { location: site.location, date, summary: snippet.replace(/\s+/g, " "), link: site.url };
    })
  );

  return results.filter(r => r.status === "fulfilled").map(r => r.value);
}

async function fetchRoadsAndSigns() {
  const apiKey = process.env.UDOT_API_KEY || "f56a96c694004ad48dca8b028e8d6d1a";
  const output = { status: "success", routes: [], signs: [] };

  const findItem = (items, keywords) => {
    for (const item of items) {
      if ((item.id && keywords.includes(item.id)) || (item.Id && keywords.includes(item.Id))) return item;
      const str = JSON.stringify(item).toLowerCase();
      if (keywords.every(k => str.includes(k.toLowerCase()))) return item;
    }
    return null;
  };

  try {
    const condResp = await fetch(`https://prod-ut.ibi511.com/api/v2/get/roadconditions?key=${apiKey}`);
    const condData = await condResp.json();
    const items = Array.isArray(condData) ? condData : (condData.result || []);
    const mapCond = (keywords, id) => {
      const it = findItem(items, keywords);
      return {
        id,
        weather: it && it.WeatherCondition ? it.WeatherCondition : "Clear",
        surface: it && it.RoadCondition ? it.RoadCondition : "Dry"
      };
    };
    output.routes.push(mapCond(["190", "Cottonwood"], "bcc"));
    output.routes.push(mapCond(["210", "Little"], "lcc"));
    output.routes.push(mapCond(["I-80", "Parley"], "parleys"));
    output.routes.push(mapCond(["158", "Powder"], "sr158"));
    output.routes.push(mapCond(["224", "Park City"], "sr224"));
  } catch (e) {
    output.error = e.message;
  }

  try {
    const signResp = await fetch(`https://prod-ut.ibi511.com/api/v2/get/messagesigns?key=${apiKey}`);
    const signData = await signResp.json();
    const sItems = Array.isArray(signData) ? signData : (signData.result || []);
    const mapSign = (keywords, name) => {
      const it = findItem(sItems, keywords);
      let text = "NO ACTIVE ALERTS";
      if (it && Array.isArray(it.Messages)) {
        const real = it.Messages.filter(m => m !== "NO_MESSAGE").map(m => m.replace(/<[^>]*>/g, "").trim());
        if (real.length > 0) text = real.join("\n");
      }
      return { name, text };
    };
    output.signs.push(mapSign(["6200 S", "190"], "BCC Approach (6200 S)"));
    output.signs.push(mapSign(["Mouth", "190"], "Big Cottonwood (Mouth)"));
    output.signs.push(mapSign(["ADX--73248"], "LCC Approach (Wasatch)"));
    output.signs.push(mapSign(["Mouth", "210"], "Little Cottonwood (Mouth)"));
  } catch (e) {
    output.signError = e.message;
  }

  return output;
}

async function fetchWebcams() {
  const resp = await fetch("https://www.skiutah.com/resorts/webcams");
  const html = await resp.text();
  const resorts = {};
  for (const rc of RESORT_CONFIG) {
    if (rc.id !== "spruces") resorts[rc.name] = [];
  }

  const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*alt=["']([^"']+)["']/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    const title = match[2].trim();
    if (url.includes("logo") || url.includes("icon") || url.includes("hero")) continue;
    for (const rc of RESORT_CONFIG) {
      if (rc.id !== "spruces" && (title.toLowerCase().includes(rc.name.toLowerCase()) || url.toLowerCase().includes(rc.skiUtahSlug))) {
        resorts[rc.name].push({ title, url });
        break;
      }
    }
  }
  if (!resorts["Powder Mountain"] || resorts["Powder Mountain"].length === 0) {
    resorts["Powder Mountain"] = [
      {
        title: "Powder Mountain Snow Stake (8,900')",
        url: "https://www.ixnay.net/cams/pm/s1/current.jpg",
        fallbackUrl: "https://ots-webcams.s3.amazonaws.com/325/25620/2026-10-22_0034/la.jpg",
        link: "https://www.ixnay.net/cams/powdermountain/"
      },
      {
        title: "Timberline Lodge & Lift",
        url: "https://www.ixnay.net/cams/pm/s4/current.jpg",
        fallbackUrl: "https://www.skiresort-service.com/typo3temp/_processed_/_cams_/webcam_74056.jpg",
        link: "https://www.ixnay.net/cams/powdermountain/"
      },
      {
        title: "Lightning Ridge & James Peak",
        url: "https://ots-webcams.s3.amazonaws.com/325/25620/2026-10-22_0034/la.jpg",
        fallbackUrl: "https://www.ixnay.net/cams/pm/s4/current.jpg",
        link: "https://www.skiutah.com/members/powder-mountain/"
      },
      {
        title: "Paradise & Village View",
        url: "https://www.skiresort-service.com/typo3temp/_processed_/_cams_/webcam_74056.jpg",
        fallbackUrl: "https://www.ixnay.net/cams/pm/s1/current.jpg",
        link: "https://www.skiutah.com/members/powder-mountain/"
      },
      {
        title: "Road | SR-158 @ Powder Mtn (MP 11.6)",
        url: "https://www.udottraffic.utah.gov/map/Cctv/168156",
        fallbackUrl: "https://www.udottraffic.utah.gov/map/Cctv/165869",
        link: "https://udottraffic.utah.gov/"
      },
      {
        title: "Road | SR-158 Canyon Climb (MP 8.3)",
        url: "https://www.udottraffic.utah.gov/map/Cctv/166786",
        fallbackUrl: "https://www.udottraffic.utah.gov/map/Cctv/165883",
        link: "https://udottraffic.utah.gov/"
      }
    ];
  }
  return { resorts };
}
