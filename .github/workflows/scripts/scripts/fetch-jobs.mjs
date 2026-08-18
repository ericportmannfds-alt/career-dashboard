// fetch-jobs.mjs — holt frische Jobs (LinkedIn/Indeed/jobs.ch via JSearch/Google Jobs)
// und schreibt sie in jobs.json. Laeuft in GitHub Actions (Node 20, globales fetch).
// Braucht das Secret RAPIDAPI_KEY.

import { writeFileSync } from "node:fs";

const KEY = process.env.RAPIDAPI_KEY;
if (!KEY) { console.error("RAPIDAPI_KEY fehlt (als GitHub-Secret setzen)."); process.exit(1); }

const HOST = "jsearch.p.rapidapi.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Erics Suchen — auf Profil, Regionen & Ziele abgestimmt. lane = Standard-Spur.
const QUERIES = [
  { q: "sales OR business development OR account manager jobs Zurich", lane: "tech" },
  { q: "customer success OR inside sales OR account manager jobs Zug OR Basel", lane: "tech" },
  { q: "marketing OR digital marketing OR growth OR communications jobs Zurich OR Bern", lane: "growth" },
  { q: "sales OR business development OR marketing jobs Geneva OR Lausanne", lane: "westch" },
  { q: "graduate program OR management trainee OR junior program jobs Switzerland", lane: "konzern" },
  { q: "sales development representative OR account executive OR key account jobs Switzerland", lane: "tech" },
];

const RELEVANT = /(sales|verkauf|verkäuf|vertrieb|business development|geschäftsentwicklung|\bbdr\b|\bsdr\b|growth|marketing|kommunikation|communication|customer success|customer|kunden|account manager|account executive|key account|commercial|conseil|vente|partnership|product manager|product owner|project coordinator|project manager|projektleit|junior|graduate|trainee|praktik|intern|stage|stagiaire|einsteiger|nachwuchs|absolvent|consultant|berater|digital|e-commerce|content|brand|community)/i;
// Klar themenfremde Rollen (Technik/Handwerk/Pflege) rauswerfen, damit der breitere Filter nicht flutet.
const EXCLUDE = /(software|developer|entwickler|informatik|sysadmin|devops|data scientist|data engineer|pflege|krankenpfleg|\barzt\b|ärzt|koch|küche|reinigung|chauffeur|elektriker|monteur|mechanik|schreiner|maler|lagerist|produktionsmitarbeit|hilfskraft)/i;
const SENIOR = /(senior|lead|head|director|principal|\bvp\b|chief|manager of|expert|architect|premaster|pre-master)/i;
const JUNIOR = /(junior|entry|graduate|trainee|associate|representative|\bbdr\b|\bsdr\b|intern|praktik|einsteiger|nachwuchs)/i;
const MID = /(manager|specialist|consultant|lead gen)/i;

const ROMANDIE = /(gen[eè]ve|geneva|lausanne|vaud|neuch[aâ]tel|fribourg|sion|valais|montreux|nyon|morges|vevey|renens|pully)/i;
const BIGBRAND = /(nestl|coca|glencore|roche|novartis|mettler|\babb\b|sika|logitech|philip morris|\bpmi\b|swisscom|\bubs\b|credit suisse|richemont|siemens|bosch|ingram|selecta|hitachi|firmenich|dsm|givaudan|lindt|sonova|zurich insurance)/i;
const COOLCO = /(mammut|\bon\b|on ag|salesforce|google|scandit|frontify|beekeeper|nexthink|proton|getyourguide|v[aä]rdex|crypto|web3|climeworks)/i;
// Konzerne mit starker Australien-Praesenz (fuer Transfer-/PR-Weg)
const AUBRAND = /(nestl|roche|novartis|glencore|\babb\b|coca|logitech|philip morris|\bpmi\b|zurich insurance|sonova)/i;

function classifyGate(title) {
  if (SENIOR.test(title)) return "r";
  if (JUNIOR.test(title)) return "g";
  if (MID.test(title)) return "a";
  return "g";
}
function classifyLane(title, city, remote, company, def) {
  if (remote || COOLCO.test(company)) return "cool";
  if (BIGBRAND.test(company)) return "konzern";
  if (ROMANDIE.test(city || "")) return "westch";
  if (/(growth|marketing|digital|crm|content|brand)/i.test(title)) return "growth";
  return def || "tech";
}
function why(title, city, company) {
  const c = city ? ` in ${city}` : "";
  if (AUBRAND.test(company)) return `Konzern mit Australien-Praesenz${c} — idealer Cheat-Code-Arbeitgeber (spaeterer Transfer).`;
  if (/growth|marketing|digital|crm/i.test(title)) return `Growth/Marketing-Rolle${c} — passt zu deinem Fokus.`;
  if (/customer success|account/i.test(title)) return `Kundennaher Einstieg${c} — nutzt deine Kommunikationsstaerke.`;
  return `Sales/Business-Development${c} — skalierbarer Einstieg, dein Kernpfad.`;
}

async function search(q) {
  const url = `https://${HOST}/search-v2?query=${encodeURIComponent(q)}&page=1&num_pages=1&country=ch&date_posted=month`;
  const res = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.data?.jobs || [];
}

const seen = new Set();
const jobs = [];

for (const { q, lane } of QUERIES) {
  let data = [];
  try { data = await search(q); }
  catch (e) { console.error(`Suche fehlgeschlagen (${q}): ${e.message}`); }

  let kept = 0;
  for (const d of data) {
    const title = d.job_title || "";
    if (!RELEVANT.test(title) || EXCLUDE.test(title)) continue;
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
      why: why(title, city, company),
      u: link,
      posted: d.job_posted_at_datetime_utc || null,
    });
    kept++;
  }
  console.log(`[${lane}] ${data.length} roh -> ${kept} passend | "${q.slice(0, 48)}"`);
  await sleep(2500); // Pause, damit der Gratis-Plan nicht drosselt
}

jobs.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
const capped = jobs.slice(0, 60);

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
