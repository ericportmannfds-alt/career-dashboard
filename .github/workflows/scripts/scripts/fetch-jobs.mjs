// fetch-jobs.mjs — holt frische Jobs (LinkedIn/Indeed/jobs.ch via JSearch/Google Jobs)
// und schreibt sie in jobs.json. Laeuft in GitHub Actions (Node 20, globales fetch).
// Braucht das Secret RAPIDAPI_KEY.

import { writeFileSync } from "node:fs";

const KEY = process.env.RAPIDAPI_KEY;
if (!KEY) { console.error("RAPIDAPI_KEY fehlt (als GitHub-Secret setzen)."); process.exit(1); }

const HOST = "jsearch.p.rapidapi.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Erics Suchen — 3 Karriere + 3 Studi/Nebenjob = 6 Requests/Lauf (~180/Monat).
// JSearch Gratis-Limit ist HART bei 200/Monat, deshalb bleibt es bei 6.
// studi:true schaltet den Studi-Filter statt des Karriere-Filters frei.
const QUERIES = [
  // --- Karriere (Plan A) — 3 breite Suchen decken tech/growth/westch/konzern ab ---
  { q: "sales OR business development OR account executive OR account manager OR customer success jobs Switzerland OR Geneva OR Lausanne", lane: "tech" },
  { q: "marketing OR digital marketing OR growth OR communications OR brand jobs Zurich OR Bern OR Basel", lane: "growth" },
  { q: "graduate program OR management trainee OR junior program OR trainee jobs Switzerland", lane: "konzern" },
  // --- Studi / Nebenjob (Teilzeit neben dem Studium) ---
  { q: "Aushilfe OR Teilzeit OR Studentenjob Service OR Gastronomie OR Barista OR Bar OR Kellner OR Buffet jobs Olten OR Aarau OR Solothurn OR Zofingen", lane: "studi", studi: true },
  { q: "Teilzeit OR Aushilfe Verkauf OR Detailhandel OR Empfang OR Sekretariat OR Office OR Kundendienst jobs Olten OR Aarau OR Solothurn OR Zurich", lane: "studi", studi: true },
  { q: "Werkstudent OR Nebenjob OR Aushilfe remote OR online OR Homeoffice Kundenservice OR Dateneingabe OR Nachhilfe OR Promotion jobs Schweiz", lane: "studi", studi: true },
];

const RELEVANT = /(sales|verkauf|verkäuf|vertrieb|business development|geschäftsentwicklung|\bbdr\b|\bsdr\b|growth|marketing|kommunikation|communication|customer success|customer|kunden|account manager|account executive|key account|commercial|conseil|vente|partnership|product manager|product owner|project coordinator|project manager|projektleit|junior|graduate|trainee|praktik|intern|stage|stagiaire|einsteiger|nachwuchs|absolvent|consultant|berater|digital|e-commerce|content|brand|community)/i;
// Klar themenfremde Rollen (Technik/Handwerk/Pflege) rauswerfen, damit der breitere Filter nicht flutet.
const EXCLUDE = /(software|developer|entwickler|informatik|sysadmin|devops|data scientist|data engineer|pflege|krankenpfleg|\barzt\b|ärzt|koch|küche|reinigung|chauffeur|elektriker|monteur|mechanik|schreiner|maler|lagerist|produktionsmitarbeit|hilfskraft)/i;
const SENIOR = /(senior|lead|head|director|principal|\bvp\b|chief|manager of|expert|architect|premaster|pre-master)/i;
const JUNIOR = /(junior|entry|graduate|trainee|associate|representative|\bbdr\b|\bsdr\b|intern|praktik|einsteiger|nachwuchs)/i;
const MID = /(manager|specialist|consultant|lead gen)/i;

// --- Studi-Filter: breit ANNEHMEN (Gastro/Retail/Buero/Remote), nur klar Ungeeignetes raus ---
const STUDI_RELEVANT = /(aushilfe|teilzeit|studenten|student|werkstudent|nebenjob|service|gastro|barista|\bbar\b|kellner|servicemit|buffet|catering|küche|counter|verkauf|verkäuf|detailhandel|kasse|sales assistant|retail|empfang|reception|rezeption|sekretari|büro|office|backoffice|kundendienst|kundenservice|kundenbet|customer service|callcenter|call center|hotline|dateneingab|data entry|nachhilfe|tutor|promot|hostess|merchandis|lager|kurier|fahrer|delivery|reinig|flyer|umfrage|inventur|barkeeper|runner)/i;
const STUDI_EXCLUDE = /(lehrstelle|lehrbeginn|ausbildung zum|ausbildung zur|eidg|diplomiert|geschäftsführ|geschäftsleit|betriebsleiter|filialleiter|abteilungsleiter|standortleiter|teamleiter|verkaufsleiter|\bsenior\b|head of|\bmeister\b|bachelor|master of|abgeschlossenes studium)/i;

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
// Studi-Begruendung — kurz, auf Stundenplan/Stundenlohn gemuenzt.
function whyStudi(title, city, remote) {
  const c = city ? ` in ${city}` : "";
  if (remote) return `Remote/Online — ortsunabhängig neben dem Studium machbar.`;
  if (/nachhilfe|tutor/i.test(title)) return `Nachhilfe — hoher Stundenlohn (CHF 40–70), flexibel am Nachmittag.`;
  if (/service|gastro|barista|bar|kellner|buffet|catering|runner|barkeeper/i.test(title)) return `Gastro/Service${c} — Abend/Wochenende, passt um die Vormittags-Uni.`;
  if (/verkauf|verkäuf|detailhandel|retail|kasse|merchandis/i.test(title)) return `Verkauf/Retail${c} — Samstage & Nachmittage, planbar.`;
  if (/empfang|reception|rezeption|sekretari|büro|office|backoffice|kundendienst|kundenservice|customer service/i.test(title)) return `Büro/Empfang${c} — nutzt dein KV, sauber neben dem Studium.`;
  return `Teilzeit/Aushilfe${c} — neben dem Studium machbar.`;
}

async function search(q) {
  const url = `https://${HOST}/search-v2?query=${encodeURIComponent(q)}&page=1&num_pages=1&country=ch&date_posted=month`;
  const res = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.data?.jobs || [];
}

const seen = new Set();
const careerJobs = [];
const studiJobs = [];

for (const { q, lane, studi } of QUERIES) {
  let data = [];
  try { data = await search(q); }
  catch (e) { console.error(`Suche fehlgeschlagen (${q}): ${e.message}`); }

  let kept = 0;
  for (const d of data) {
    const title = d.job_title || "";
    // Relevanz je nach Spur (Studi dreht den Filter um: Gastro/Retail/Buero sind erwuenscht)
    if (studi) {
      if (!STUDI_RELEVANT.test(title) || STUDI_EXCLUDE.test(title)) continue;
    } else {
      if (!RELEVANT.test(title) || EXCLUDE.test(title)) continue;
    }
    const company = d.employer_name || "Unbekannt";
    const link = d.job_apply_link || d.job_google_link;
    if (!link) continue;
    const dedupe = (link || (title + company)).toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const remote = !!d.job_is_remote;
    const city = d.job_city || (remote ? "Remote" : "Schweiz");
    const loc = remote ? `${city} · remote` : city;

    if (studi) {
      studiJobs.push({
        t: title.slice(0, 90),
        co: company,
        loc,
        gate: "g",
        lane: "studi",
        cool: remote || /nachhilfe|tutor/i.test(title),
        why: whyStudi(title, city, remote),
        u: link,
        posted: d.job_posted_at_datetime_utc || null,
      });
    } else {
      careerJobs.push({
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
    }
    kept++;
  }
  console.log(`[${lane}] ${data.length} roh -> ${kept} passend | "${q.slice(0, 48)}"`);
  await sleep(2500); // Pause, damit der Gratis-Plan nicht drosselt
}

careerJobs.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
studiJobs.sort((a, b) => (b.posted || "").localeCompare(a.posted || ""));
const capC = careerJobs.slice(0, 40);
const capS = studiJobs.slice(0, 24);
const capped = capC.concat(capS);

if (capped.length === 0) {
  console.error("Keine Jobs gefunden - jobs.json wird NICHT ueberschrieben.");
  process.exit(1);
}

const out = {
  updated: new Date().toISOString().slice(0, 10),
  source: `Automatisch aktualisiert - ${capC.length} Karriere + ${capS.length} Studi-Jobs (Google Jobs)`,
  jobs: capped,
};
writeFileSync("jobs.json", JSON.stringify(out, null, 2) + "\n");
console.log(`${capped.length} Jobs in jobs.json geschrieben (${careerJobs.length} career roh, ${studiJobs.length} studi roh).`);
