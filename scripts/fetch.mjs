// Fetches empty legs touching Austin, Dallas or Houston and writes flights.json
// Runs every morning from GitHub Actions. Keeps the previous file if anything fails.
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://web.jet-bay.com/jetbay-web/emptyLeg/queryPage";
const CITIES = new Set(["Austin", "Dallas", "Houston", "Fort Worth"]);
const NORTH_AMERICA = "1";
const MAX_PAGES = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function isoDate(d) {
  const m = /(\w{3}) (\d+), (\d{4})/.exec(d || "");
  return m ? `${m[3]}-${String(MONTHS[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

async function page(n) {
  const u = new URL(API);
  u.searchParams.set("areaId", NORTH_AMERICA);
  u.searchParams.set("current", String(n));
  u.searchParams.set("pageSize", "100");
  u.searchParams.set("currencyType", "USD");
  for (const k of ["depCity", "arrCity", "depAirport", "arrAirport", "orderByMode"]) u.searchParams.set(k, "");
  const r = await fetch(u, { headers: { LANG: "global", Accept: "application/json", "User-Agent": "Mozilla/5.0 (VauclairAviation daily update)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on page ${n}`);
  const j = await r.json();
  const L = j?.data?.emptyLegList;
  if (!L || !Array.isArray(L.data)) throw new Error(`Unexpected response on page ${n}: ${JSON.stringify(j).slice(0, 200)}`);
  return L;
}

async function main() {
  const first = await page(1);
  const pages = Math.min(first.pages || 1, MAX_PAGES);
  console.log(`total=${first.total} pages=${first.pages} pageSize=${first.pageSize}`);
  let rows = first.data;
  for (let n = 2; n <= pages; n++) {
    await sleep(400);
    rows = rows.concat((await page(n)).data);
  }
  const seen = new Set();
  const flights = [];
  for (const x of rows) {
    if (!CITIES.has(x.depCityName) && !CITIES.has(x.arrCityName)) continue;
    const f = {
      from: [x.depCityName, x.depIcao],
      to: [x.arrCityName, x.arrIcao],
      date: isoDate(x.depTime),
      model: x.aircraftModel,
      seats: Number(x.seats) || null,
      img: x.aircraftImg || null,
    };
    if (!f.date) continue;
    const key = [f.from[1], f.to[1], f.date, f.model].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    flights.push(f);
  }
  flights.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`scanned=${rows.length} kept=${flights.length}`);
  if (flights.length < 5) throw new Error("Too few flights found, keeping the previous file");
  const updated = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  writeFileSync("flights.json", JSON.stringify({ updated, source: "jetbay", flights }));
}

main().catch((e) => {
  console.error(e.message);
  try { readFileSync("flights.json"); console.error("Previous flights.json kept."); } catch {}
  process.exit(1);
});
