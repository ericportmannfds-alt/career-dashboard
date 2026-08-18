// fetch-jobs.mjs — holt frische Jobs (LinkedIn/Indeed/jobs.ch via JSearch/Google Jobs)
// und schreibt sie in jobs.json. Laeuft in GitHub Actions (Node 20, globales fetch).
// Braucht das Secret RAPIDAPI_KEY.

import { writeFileSync } from "node:fs";

const KEY = process.env.RAPIDAPI_KEY;
if (!KEY) { console.error("RAPIDAPI_KEY fehlt (als GitHub-Secret setzen)."); process.exit(1); }

const HOST = "jsearch.p.rapidapi.com";

const QUERIES = [
  { q: "junior sales OR business development representative jobs in Zurich, Switzerland", lane: "tech" },
  { q: "junior business development OR account manager jobs in Zug, Switzerland",         lane: "tech" },
  { q: "junior sales OR marketing jobs in Basel, Switzerland",                            lane: "growth" },
  { q: "junior growth marketing OR digital marketing jobs in Switzerland",                lane: "growth" },
  { q: "junior customer success OR account manager jobs in Switzerland",                  lane: "tech" },
  { q: "sales OR business development jobs in Geneva OR Lausanne, Switzerland",            lane: "westch" },
];

const RELEVANT = /(sales|business development|\bbdr\b|\bsdr\b|growth|marketing|customer success|account manager|account executive|commercial|partnership|product manager|project coordinator|junior)/i;
const SENIOR = /(senior|lead|head|director|principal|vp|chief|manager of|expert|architect|premaster|pre-master)/i;
const JUNIOR = /(junior|entry|graduate|trainee|associate|representative|\bbdr\b|\bsdr\b|intern|praktik|einsteiger|nachwuchs)/i;
const MID = /(manager|specialist|consultant|lead gen)/i;

const ROMANDIE = /(gen[eè]ve|geneva|lausanne|vaud|neuch[aâ]tel|fribourg|sion|valais|montreux|nyon|morges|vevey|renens|pully)/i;
const BIGBRAND = /(nestl|coca|glencore|roche|novartis|mettler|abb|sika|logitech|philip morris|\bpmi\b|swisscom|ubs|credit suisse|richemont|siemens|bosch|ingram|selecta|hitachi)/i;
const COOLCO   = /(mammut|\bon\b|on ag|salesforce|google|scandit|frontify|beekeeper|nexthink|proton|getyourguide|v[aä]rdex|crypto|web3|climeworks)/i;

function classifyGate(title) {
  if (SENIOR.test(title)) return "r";
  if (JUNIOR.test(title)) return "g";
  if (MID.test(title))    return "a";
  return "g";
}
function classifyLane(title, city, remote, company, def) {
  if (remote || COOLCO.test(company)) return "cool";
  if (ROMANDIE.test(city || "")) return "westch";
  if (BIGBRAND.test(company)) return "konzern";
  if (/(growth|marketing|digital|crm|content|brand)/i.test(title)) return "growth";
  return def || "tech";
}
function why(title, city) {
  const c = city ? ` in ${city}` : "";
  if (/growth|marketing|digital|crm/i.test(title)) return `Growth/Marketing-Rolle${c} - passt zu deinem Fokus.`;
  if (/customer success|account/i.test(title))     return `Kundennaher Einstieg${c} - nutzt deine Kommunikationsstaerke.`;
  return `Sales/Business-Development${c} - skalierbarer Einstieg, dein Kernpfad.`;
}

async function search(q) {
  const url = `https://${HOST}/search?query=${encodeURIComponent(q)}&page=1&num_pages=1&country=ch&date_posted=month`;
  const res = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

const seen = new Set();
const jobs = [];

for (const { q, lane } of QUERIES) {
  let data = [];
  try { data = await search(q); }
  catch (e) { console.error(`Suche fehlgeschlagen (${q}): ${e.message}`); continue; }

  for (const d of data) {
    const title = d.job_title || "";
    if (!RELEVANT.test(title)) continue;
    const company = d.employer_name || "Unbekannt";
    const link = d.job_apply_link || d.job_google_link;
    if (!link) continue;
    const dedupe = (link || (title + company)).toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const remote = !!d.job_is_remote;
    const city = d.job_city || (remote ? "Remote" : "Schweiz");
    const loc = remote ? `${city} · remote` : city;

    jobs.push({
      t: title.slice(0, 90),
      co: company,
      loc,
      gate: classifyGate(title),
      lane: classifyLane(title, city, remote, company, lane),
      cool: remote || COOLCO.test(company),
      why: why(title, city),
      u: link,
      posted: d.job_posted_at_datetime_utc || null,
    });
  }
}

jobs.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
const capped = jobs.slice(0, 40);

if (capped.length === 0) {
  console.error("Keine Jobs gefunden - jobs.json wird NICHT ueberschrieben.");
  process.exit(1);
}

const out = {
  updated: new Date().toISOString().slice(0, 10),
  source: `Automatisch aktualisiert - ${capped.length} Treffer aus LinkedIn/Indeed/jobs.ch (Google Jobs)`,
  jobs: capped,
};
writeFileSync("jobs.json", JSON.stringify(out, null, 2) + "\n");
console.log(`${capped.length} Jobs in jobs.json geschrieben.`);
