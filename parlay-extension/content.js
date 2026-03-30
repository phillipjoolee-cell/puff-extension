if (!window.__puffContentScriptLoaded) {
  window.__puffContentScriptLoaded = true;
  console.log("[PUFF] content.js loaded on", window.location.href);
  console.log("[PUFF] VERSION CHECK - isTwoChildLayout exists"); // ADD THIS LINE

let selectedRoot = null;
let selecting = false;
let lastHoverEl = null;
let __puff_extractDebugLegCount = 0;

// Set immediately so executeScript fallback never sees "No message handler"
const __puff_stub = function (msg) {
  return { ok: false, error: __puff_loadError || "PUFF still loading - try again in a moment" };
};
let __puff_loadError = null;
window.__puff_contentScriptReady = true;
window.__puff_handleMessage = __puff_stub;
if (typeof globalThis !== "undefined") globalThis.__puff_handleMessage = __puff_stub;

try {
// ---------- basic helpers ----------
function normalizeBookName(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  // Keep this as a light alias layer; the full mapping lives in SPORTSBOOK_KEYWORDS.
  if (s === "dk") return "DraftKings";
  if (s === "fd") return "FanDuel";
  return raw.trim();
}

// Complete mapping of sportsbook logo identifiers to display names.
// Each entry lists lowercase substrings that can appear in img src/alt/aria-label/title.
const SPORTSBOOK_KEYWORDS = [
  { name: "FanDuel", keys: ["fanduel", "fan duel"] },
  { name: "DraftKings", keys: ["draftkings", "draft kings"] },
  { name: "BetMGM", keys: ["betmgm", "bet mgm"] },
  { name: "Caesars", keys: ["caesars", "caesars sportsbook"] },
  { name: "BetRivers", keys: ["betrivers", "bet rivers"] },
  { name: "Fanatics", keys: ["fanatics"] },
  { name: "Polymarket", keys: ["polymarket "] }, // trailing space to avoid polymarket (usa)
  { name: "Polymarket (USA)", keys: ["polymarket (usa)", "polymarket_usa", "polymarket-us"] },
  { name: "Novig", keys: ["novig"] },
  { name: "Pinny", keys: ["pinny", "pinnacle"] },
  { name: "crypto.com", keys: ["crypto.com", "crypto com"] },
  { name: "Betr Picks", keys: ["betr picks", "betr_picks"] },
  { name: "bet365", keys: ["bet365", "bet 365"] },
  { name: "betPARX", keys: ["betparx", "bet parx"] },
  { name: "BetOpenly", keys: ["betopenly", "bet openly"] },
  { name: "4Cx", keys: ["4cx"] },
  { name: "Sportzino", keys: ["sportzino"] },
  { name: "1xBet", keys: ["1xbet", "1x bet", "1x"] },
  { name: "Fliff", keys: ["fliff"] },
  { name: "Kalshi", keys: ["kalshi"] },
  { name: "Onyx Odds", keys: ["onyx odds", "onyx_odds"] },
  { name: "Thrillzz", keys: ["thrillzz", "thrillz"] },
  { name: "PrizePicks", keys: ["prizepicks", "prize picks"] },
  { name: "PrizePicks (5 or 6 Pick Flex)", keys: ["prizepicks (5 or 6 pick)", "pp_5_6_pick_flex"] },
  { name: "Prophet X", keys: ["prophet x", "prophetx"] },
  { name: "Rebet", keys: ["rebet "] }, // plain Rebet
  { name: "Rebet Props City", keys: ["rebet props", "rebet_props_city"] },
  { name: "Robinhood", keys: ["robinhood"] },
  { name: "SugarHouse", keys: ["sugarhouse", "sugar house"] },
  { name: "theScore", keys: ["thescore", "the score"] },
  { name: "Underdog Fantasy (2 Pick)", keys: ["underdog fantasy (2 pick)", "ud_2_pick"] },
  { name: "Props Builder", keys: ["props builder", "props_builder"] },
  { name: "888sport", keys: ["888sport", "888 sport"] },
  { name: "Bally Bet", keys: ["bally bet", "ballybet"] },
  { name: "bet105", keys: ["bet105"] },
  { name: "BET99", keys: ["bet99"] },
  { name: "Betano", keys: ["betano"] },
  { name: "Betfair", keys: ["betfair exchange", "betfair "] },
  { name: "Betfair Exchange (Australia)", keys: ["betfair exchange (australia)", "betfair_au"] },
  { name: "betJACK", keys: ["betjack", "bet jack"] },
  { name: "Betr", keys: [" betr ", "betr sportsbook"] },
  { name: "betr (Australia)", keys: ["betr (australia)", "betr_au"] },
  { name: "Betr Picks (All)", keys: ["betr picks (all)", "betr_picks_all"] },
  { name: "Betsson", keys: ["betsson"] },
  { name: "BetVictor", keys: ["betvictor", "bet victor"] },
  { name: "Betway", keys: ["betway "] },
  { name: "Betway (Alaska)", keys: ["betway (alaska)", "betway_ak"] },
  { name: "Boomers", keys: ["boomers"] },
  { name: "Boom Fantasy (5 Pick Insured)", keys: ["boom fantasy (5 pick insured)", "boom_5_pick_insured"] },
  { name: "Borgata", keys: ["borgata"] },
  { name: "bwin", keys: ["bwin"] },
  { name: "Casumo", keys: ["casumo"] },
  { name: "Circa Sports", keys: ["circa sports"] },
  { name: "Circa Vegas", keys: ["circa vegas"] },
  { name: "Coolbet", keys: ["coolbet", "cool bet"] },
  { name: "Dabble (3 or 5 Pick)", keys: ["dabble (3 or 5 pick)", "dabble_3_5"] },
  { name: "Dabble (Australia)", keys: ["dabble (australia)", "dabble_au"] },
  { name: "Desert Diamond", keys: ["desert diamond"] },
  { name: "DraftKings (Pick 3)", keys: ["draftkings (pick 3)", "dk_pick3"] },
  { name: "DraftKings Predictions", keys: ["draftkings predictions", "dk_predictions"] },
  { name: "Fanatics Markets", keys: ["fanatics markets"] },
  { name: "FireKeepers", keys: ["firekeepers", "fire keepers"] },
  { name: "Four Winds", keys: ["four winds"] },
  { name: "Hard Rock", keys: ["hard rock"] },
  { name: "iBet", keys: ["ibet"] },
  { name: "Jackpot.bet", keys: ["jackpot.bet", "jackpot bet"] },
  { name: "Ladbrokes", keys: ["ladbrokes "] },
  { name: "Ladbrokes (Australia)", keys: ["ladbrokes (australia)", "ladbrokes_au"] },
  { name: "LeoVegas", keys: ["leovegas", "leo vegas"] },
  { name: "Midnite", keys: ["midnite"] },
  { name: "Mise-o-jeu", keys: ["mise-o-jeu", "mise o jeu"] },
  { name: "Neds", keys: ["neds"] },
  { name: "Ninja Casino", keys: ["ninja casino"] },
  { name: "NorthStar Bets", keys: ["northstar bets", "northstarbets"] },
  { name: "OwnersBox", keys: ["ownersbox "] },
  { name: "OwnersBox (6 Pick Insured)", keys: ["ownersbox (6 pick insured)", "ownersbox_6_pick"] },
  { name: "ParlayPlay", keys: ["parlayplay", "parlay play"] },
  { name: "partypoker", keys: ["partypoker", "party poker"] },
  { name: "Picklebet", keys: ["picklebet", "pickle bet"] },
  { name: "Play Alberta", keys: ["play alberta"] },
  { name: "Play Eagle", keys: ["play eagle"] },
  { name: "PlayNow", keys: ["playnow", "play now"] },
  { name: "PointsBet (Australia)", keys: ["pointsbet (australia)", "pointsbet_au"] },
  { name: "PointsBet (Ontario)", keys: ["pointsbet (ontario)", "pointsbet_on"] },
  { name: "Prime Sports", keys: ["prime sports"] },
  { name: "Proline", keys: ["proline "] },
  { name: "Rivalry", keys: ["rivalry"] },
  { name: "Rizk", keys: ["rizk"] },
  { name: "Sleeper", keys: ["sleeper "] },
  { name: "Sportsbet", keys: ["sportsbet", "sports bet"] },
  { name: "Sports Interaction", keys: ["sports interaction"] },
  { name: "Sporttrade", keys: ["sporttrade"] },
  { name: "Stake", keys: ["stake.com", "stake "] },
  { name: "STN Sports", keys: ["stn sports"] },
  { name: "SX Bet", keys: ["sx bet", "sxbet"] },
  { name: "TAB", keys: [" tab ", "tab("] },
  { name: "TAB (New Zealand)", keys: ["tab (new zealand)", "tab_nz"] },
  { name: "TABtouch", keys: ["tabtouch"] },
  { name: "TonyBet", keys: ["tonybet", "tony bet"] },
  { name: "TwinSpires", keys: ["twinspires", "twin spires"] },
  { name: "Unibet", keys: ["unibet "] },
  { name: "Unibet (Australia)", keys: ["unibet (australia)", "unibet_au"] },
  { name: "William Hill", keys: ["william hill"] },
  { name: "Winpot", keys: ["winpot"] },
  { name: "Underdog Predictions", keys: ["underdog predictions"] },
];

/** Map image src, alt, or aria-label to sportsbook display name. Fallback "Unknown Book". */
function mapImageToSportsbook(srcOrAlt) {
  const s = String(srcOrAlt || "").trim().toLowerCase();
  if (!s) return "Unknown Book";
  for (const book of SPORTSBOOK_KEYWORDS) {
    for (const key of book.keys) {
      if (s.includes(key)) return book.name;
    }
  }
  const norm = normalizeBookName(s);
  if (norm) return norm;
  return "Unknown Book";
}

function findHitProbFromRowEl(rowEl) {
  if (!rowEl) return null;

  // look only at small cells that contain a percent
  const candidates = Array.from(
    rowEl.querySelectorAll("td,[role='cell'],div,span")
  ).slice(0, 40);

  for (const el of candidates) {
    const txt = textOf(el);
    if (!txt || txt.length > 20) continue;

    const m = txt.match(/(\d{1,3}(\.\d{1,2})?)\s*%/);
    if (!m) continue;

    const val = parseFloat(m[1]);
    if (val < 0 || val > 100) continue;
    // Values < 25% are almost certainly EV/edge, not hit probability (hit prob typically 40-70%)
    if (val < 25) continue;

    const low = txt.toLowerCase();
    const isHitContext = /hit|odds to hit|hit rate/.test(low);
    const hasEvContext = /\bev\b|edge|value/.test(low);

    // if we see explicit EV/edge/value and there is no "hit" keyword, skip this
    if (hasEvContext && !isHitContext) continue;

    return val;
  }

  return null;
}

/**
 * Detect +EV optimizer column indices from header row.
 * Columns: +EV%, EVENT, MARKET, BOOKS, PROBABILITY, BET SIZE (or similar labels).
 * If header text is missing/unclear but there are at least 6 columns, fall back to positional mapping:
 *   0: EV%, 1: EVENT, 2: MARKET, 3: BOOKS, 4: PROBABILITY, 5: BET SIZE.
 */
function getPlusEvColumnIndices(headerRow) {
  if (!headerRow) return null;
  const cells = Array.from(headerRow.querySelectorAll("th,[role='columnheader'],td,[role='cell']"));
  const out = { evCol: null, eventCol: null, marketCol: null, booksCol: null, probabilityCol: null, betSizeCol: null };

  cells.forEach((cell, idx) => {
    const t = textOf(cell).toLowerCase();
    if ((/\+?\s*ev\s*%/.test(t) || /\bev\s*%/.test(t) || /\bedge\b/.test(t)) && out.evCol == null) out.evCol = idx;
    else if (/\bevent\b/.test(t) && out.eventCol == null) out.eventCol = idx;
    else if (/\bmarket\b/.test(t) && out.marketCol == null) out.marketCol = idx;
    else if (/\bbooks?\b/.test(t) && out.booksCol == null) out.booksCol = idx;
    else if (/\bprobability\b/.test(t) && out.probabilityCol == null) out.probabilityCol = idx;
    else if (/\bbet\s*size\b/.test(t) && out.betSizeCol == null) out.betSizeCol = idx;
  });

  // Fallback: positional assumption when headers aren't labeled but structure matches +EV layout
  if (!out.evCol && cells.length >= 6) {
    out.evCol = 0;
    if (out.eventCol == null) out.eventCol = 1;
    if (out.marketCol == null) out.marketCol = 2;
    if (out.booksCol == null) out.booksCol = 3;
    if (out.probabilityCol == null) out.probabilityCol = 4;
    if (out.betSizeCol == null) out.betSizeCol = 5;
  }

  return (out.evCol != null || out.marketCol != null || out.booksCol != null) ? out : null;
}

function buildHeaderBookMap(containerEl) {
  const root = containerEl || document;
  const headerRow =
    root.querySelector("[role='rowgroup'] [role='row']") ||
    root.querySelector("thead tr") ||
    root.querySelector("[role='row']");

  if (!headerRow) return {};

  const cells = Array.from(headerRow.querySelectorAll("th,[role='columnheader'],td,[role='cell']"));
  const map = {};

  cells.forEach((cell, idx) => {
    const img = cell.querySelector("img");
    const iconName =
      img?.getAttribute("alt") ||
      img?.getAttribute("aria-label") ||
      img?.getAttribute("title") ||
      img?.getAttribute("src") ||
      cell.getAttribute("aria-label") ||
      cell.getAttribute("title") ||
      textOf(cell);

    const name = normalizeBookName(iconName) || (iconName ? mapImageToSportsbook(iconName) : null);
    if (name && name !== "Unknown Book" && name.length <= 30) map[idx] = name;
  });

  return map;
}

function findBestOddsCellInRow(rowEl) {
  if (!rowEl) return null;
  const cells = Array.from(rowEl.querySelectorAll("td,[role='cell'],div"));

  // Heuristic: pick cell that looks "selected/highlighted" or explicitly marked "best value" first
  const preferred = cells.find((c) => {
    const cls = (c.className || "").toLowerCase();
    const txt = textOf(c).toLowerCase();
    return (
      cls.includes("active") ||
      cls.includes("selected") ||
      cls.includes("best") ||
      cls.includes("highlight") ||
      txt.includes("best value")
    );
  });
  if (preferred) return preferred;

  // Else: pick the first cell that contains american odds like -220 / +150
  return cells.find((c) => /(^|\s)[+-]\d{2,4}(\s|$)/.test(textOf(c))) || null;
}

/** Get sportsbook from BOOKS column cell: prefer img src/alt/aria-label, else text. */
function getBookFromBooksCell(cell) {
  if (!cell) return "Unknown Book";
  const img = cell.querySelector("img");
  const src = img?.getAttribute("src") || "";
  const alt = img?.getAttribute("alt") || img?.getAttribute("aria-label") || img?.getAttribute("title") || "";
  const fromImg = (src || alt) ? mapImageToSportsbook(src || alt) : null;
  if (fromImg && fromImg !== "Unknown Book") return fromImg;
  const txt = textOf(cell);
  const fromText = looksLikeBook(txt) ? normalizeBookName(txt) : null;
  return fromText || fromImg || "Unknown Book";
}

function inferBookFromRow(rowEl, headerBookMap, booksColIndex) {
  const rowCells = Array.from(rowEl.querySelectorAll("td,[role='cell'],div"));
  if (booksColIndex != null && rowCells[booksColIndex]) {
    const fromCell = getBookFromBooksCell(rowCells[booksColIndex]);
    if (fromCell && fromCell !== "Unknown Book") return fromCell;
  }
  const bestCell = findBestOddsCellInRow(rowEl);
  if (!bestCell) return null;

  const idx = rowCells.indexOf(bestCell);
  if (idx >= 0 && headerBookMap && headerBookMap[idx]) return headerBookMap[idx];

  const txt = textOf(bestCell);
  const guess = looksLikeBook(txt);
  if (guess) return normalizeBookName(guess) || guess;
  const m = txt.match(/best\s*value[:\-–\s]*([A-Za-z0-9]+)/i);
  if (m) {
    const n = normalizeBookName(m[1]);
    if (n) return n;
  }
  return null;
}

/** Resolve the main bet row (OddsJam) from a row element or wrapper — card or full-width table. */
function resolveOddsJamBetRow(rowEl) {
  if (!rowEl) return null;

  // Card layout: exact match or wrapper
  if (rowEl.matches && rowEl.matches("div.tour__bet_row")) return rowEl;
  const inner = rowEl.querySelector && rowEl.querySelector("div.tour__bet_row");
  if (inner) return inner;
  const closest = rowEl.closest && rowEl.closest("div.tour__bet_row");
  if (closest) return closest;

  // Full width table layout: row contains [data-testid="event-cell"]
  // The row root is the element that directly contains event-cell, books-cell, probability-cell
  if (rowEl.querySelector && rowEl.querySelector('[data-testid="event-cell"]')) {
    const innerBetRow = rowEl.querySelector("div.tour__bet_row");
    return innerBetRow || rowEl;
  }

  // Walk up to find the ancestor that contains event-cell
  let el = rowEl;
  while (el && el !== document.body) {
    if (
      el.querySelector &&
      el.querySelector('[data-testid="event-cell"]') &&
      (el.querySelector('[data-testid="books-cell"]') || el.querySelector('[data-testid="probability-cell"]'))
    ) {
      return el;
    }
    el = el.parentElement;
  }

  // Last resort: return the element itself if it has role="button" and contains betting data
  if (rowEl.getAttribute && rowEl.getAttribute("role") === "button") return rowEl;

  return null;
}

/** Books column: exact test id preferred (no positional guessing). */
function getOddsJamBooksCell(root) {
  return (
    root.querySelector('[data-testid="books-cell"]') ||
    root.querySelector('div[class*="tour__books"]') ||
    null
  );
}

function parseOddsJamEvPctFromText(evText) {
  const evMatch = String(evText || "").trim().match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
  if (evMatch) return parseFloat(evMatch[1]);
  const bare = String(evText || "").replace(/%/g, "").trim();
  const n = parseFloat(bare);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse EV% — card layout: div.tour__profit wrapper. Full-width table: first column has the same green
 * <p> (tour__cell + font-code-next + text-brand-green-5) without tour__profit.
 */
function parseOddsJamEvPct(root) {
  const profit = root.querySelector('div[class*="tour__profit"]');
  if (profit) {
    const evP =
      profit.querySelector('p[class*="tour__cell"][class*="font-code-next"][class*="text-brand-green-5"]') ||
      profit.querySelector("p[class*='font-code-next']");
    const evText = evP ? evP.textContent.trim() : "";
    return parseOddsJamEvPctFromText(evText);
  }

  // Full-width table: +EV% is first column — same green <p> selectors, no tour__profit wrapper
  const firstCell = root.children && root.children[0];
  const evP =
    (firstCell &&
      (firstCell.querySelector(
        'p[class*="tour__cell"][class*="font-code-next"][class*="text-brand-green-5"]'
      ) ||
        firstCell.querySelector("p[class*='font-code-next']"))) ||
    root.querySelector('p[class*="tour__cell"][class*="font-code-next"][class*="text-brand-green-5"]') ||
    root.querySelector("p[class*='font-code-next'][class*='text-brand-green-5']");
  const evText = evP ? evP.textContent.trim() : "";
  let v = parseOddsJamEvPctFromText(evText);
  if (v > 0) return v;

  // Fallback: scan entire row for any green percentage text (full-width compact: EV at far left, nested columns)
  const greenCandidates = root.querySelectorAll(
    'p[class*="text-brand-green"], p[class*="text-green-"], span[class*="text-brand-green"]'
  );
  for (const el of greenCandidates) {
    const text = el.textContent.trim();
    const match = text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

/**
 * Sport • league from event-cell only; ignore date/time lines (separate DOM).
 * @param {{ omitMarket?: boolean }} [opts] — full-width table uses [data-testid="market-cell"] instead
 */
function parseOddsJamEventCell(eventCell, opts) {
  const omitMarket = !!(opts && opts.omitMarket);
  let sport = null;
  let league = null;
  let matchup = null;
  let market = "Prop";
  if (!eventCell) return { sport, league, matchup, market };

  const grayPs = eventCell.querySelectorAll('p[class*="text-brand-gray-6"]');
  for (const p of grayPs) {
    const t = (p.textContent || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (/\b(?:today|tomorrow)\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(t)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) continue;
    if (t.includes("•")) {
      const parts = t.split("•").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 1) sport = parts[0];
      if (parts.length >= 2) league = parts[1];
      break;
    }
  }

  const matchupP = eventCell.querySelector('p[class*="font-bold"]');
  if (matchupP) matchup = matchupP.textContent.replace(/\s+/g, " ").trim();

  if (!omitMarket) {
    const marketP = eventCell.querySelector('p[class*="text-brand-purple-5"]');
    if (marketP) {
      const m = marketP.textContent.replace(/\s+/g, " ").trim();
      if (m) market = m;
    }
  }

  return { sport, league, matchup, market };
}

/** Full-width: MARKET column — [data-testid="market-cell"] first, else purple p anywhere in row. */
function parseOddsJamMarketFullWidth(rowRoot) {
  const mc = rowRoot.querySelector('[data-testid="market-cell"]');
  if (mc) {
    const t = String(mc.innerText || "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  const mp = rowRoot.querySelector('p[class*="text-brand-purple-5"]');
  if (mp) {
    const m = mp.textContent.replace(/\s+/g, " ").trim();
    if (m) return m;
  }
  return "Prop";
}

/**
 * Player + prop line in BOOKS cell. Full-width table: font-bold + leading-[17px] + text-white; next p
 * with leading-[17px] + text-white is the prop line.
 */
function parseOddsJamBooksPlayerAndProp(booksCol, isFullWidthTable) {
  if (!booksCol) return { playerP: null, propLineP: null, teamAbbrev: null };

  if (isFullWidthTable) {
    const psAll = Array.from(booksCol.querySelectorAll("p"));
    const isLeadingWhite = (p) => {
      const c = p.className || "";
      return (
        c.includes("text-white") &&
        (c.includes("leading-[17px]") || c.includes("leading-"))
      );
    };
    let playerP =
      psAll.find((p) => {
        const c = p.className || "";
        return c.includes("font-bold") && isLeadingWhite(p);
      }) || null;
    if (!playerP) {
      playerP =
        booksCol.querySelector('p[class*="font-bold"][class*="text-white"]') ||
        null;
    }

    let propLineP = null;
    if (playerP) {
      const idx = psAll.indexOf(playerP);
      propLineP =
        (idx >= 0 ? psAll.slice(idx + 1).find((p) => isLeadingWhite(p) && p !== playerP) : null) ||
        null;
    }
    if (!propLineP && psAll.length >= 2) {
      const i = playerP ? psAll.indexOf(playerP) : -1;
      if (i >= 0 && psAll[i + 1]) propLineP = psAll[i + 1];
    }

    const teamSpan = booksCol.querySelector('span[class*="text-oj-text-light-tertiary"]');
    const teamAbbrev = teamSpan ? teamSpan.textContent.trim() : null;
    return { playerP, propLineP, teamAbbrev };
  }

  let playerP = booksCol.querySelector(
    'p[class*="font-bold"][class*="leading-"][class*="text-white"]'
  );

  const ps = Array.from(booksCol.querySelectorAll("p")).filter((p) => {
    const c = p.className || "";
    return c.includes("text-white") && c.includes("leading-");
  });

  if (!playerP && ps.length) {
    playerP = ps.find((p) => (p.className || "").includes("font-bold")) || null;
  }

  let propLineP = null;
  if (playerP) {
    const idx = ps.indexOf(playerP);
    if (idx >= 0) propLineP = ps[idx + 1] || null;
  }
  if (!propLineP && ps.length >= 2) propLineP = ps[1];

  const teamSpan = booksCol.querySelector('span[class*="text-oj-text-light-tertiary"]');
  const teamAbbrev = teamSpan ? teamSpan.textContent.trim() : null;

  return { playerP, propLineP, teamAbbrev };
}

function parsePropLineSideAndNumber(lineSide) {
  let side = "other";
  let line = 0;
  if (!lineSide) return { side, line };
  const s = lineSide.replace(/\s+/g, " ").trim();
  const low = s.toLowerCase();
  if (low.startsWith("over")) side = "over";
  else if (low.startsWith("under")) side = "under";

  const m = s.match(/(?:over|under)\s+([+-]?\d{1,3}(?:\.\d{1,2})?)/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) line = n;
  } else {
    const num = s.match(/([+-]?\d{1,3}(?:\.\d{1,2})?)/);
    if (num) {
      const n = parseFloat(num[1]);
      if (Number.isFinite(n)) line = n;
    }
  }
  return { side, line };
}

/** American odds next to book logo in BOOKS cell. Never null — fallback 0. */
function parseOddsJamAmericanOdds(booksCol) {
  if (!booksCol) return 0;
  const ps = booksCol.querySelectorAll("p");
  for (const p of ps) {
    const t = p.textContent.trim();
    if (/^[+-]\d{2,4}$/.test(t)) return parseInt(t, 10);
  }
  let best = null;
  for (const p of ps) {
    const m = p.textContent.match(/([+-]\d{2,4})/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v)) best = v;
    }
  }
  return best != null ? best : 0;
}

/** Prefer src, else first URL in srcset (for responsive logos). */
function imgPrimarySrc(img) {
  if (!img) return "";
  const src = img.getAttribute("src");
  if (src && src.trim()) return src.trim();
  const ss = img.getAttribute("srcset");
  if (ss) {
    const first = ss.split(",")[0].trim();
    return (first.split(/\s+/)[0] || "").trim();
  }
  return "";
}

/**
 * OddsJam CDN: .../sportsbook-logos/[name].png — extract stem for keyword mapping.
 */
function filenameStemFromSportsbookLogosUrl(url) {
  const s = String(url || "");
  const m = s.match(/sportsbook-logos\/([^/?#]+)\.(?:png|webp|jpe?g|svg)(?:\?|#|$)/i);
  if (!m) return "";
  return m[1].replace(/-/g, " ").replace(/_/g, " ").trim();
}

/**
 * Resolve display name from one logo img: alt first, then CDN filename / full src via mapImageToSportsbook.
 */
function bookNameFromSportsbookLogoImg(img) {
  if (!img) return null;
  const alt = (img.getAttribute("alt") || "").trim();
  if (alt) return alt;
  const src = imgPrimarySrc(img);
  if (!src) return null;
  if (/sportsbook-logos/i.test(src)) {
    const stem = filenameStemFromSportsbookLogosUrl(src);
    if (stem) {
      const mapped = mapImageToSportsbook(stem);
      if (mapped && mapped !== "Unknown Book") return mapped;
    }
  }
  const mapped = mapImageToSportsbook(src);
  return mapped && mapped !== "Unknown Book" ? mapped : null;
}

/**
 * Sportsbook: prefer books-cell img alt; then CDN / role=button / row-wide fallbacks
 * (expanded rows during Select Area may not scope logos under booksCol alone).
 */
function parseOddsJamBook(booksCol, rowRoot) {
  const row = rowRoot || null;

  // 1) [data-testid="books-cell"] img — alt is authoritative on OddsJam
  if (row) {
    const img = row.querySelector('[data-testid="books-cell"] img');
    const b = bookNameFromSportsbookLogoImg(img);
    if (b) return b;
  }

  // 2) Entire row: any img whose src hits OddsJam sportsbook-logos CDN
  if (row) {
    for (const img of row.querySelectorAll("img")) {
      const src = imgPrimarySrc(img);
      if (src && /sportsbook-logos/i.test(src)) {
        const b = bookNameFromSportsbookLogoImg(img);
        if (b) return b;
      }
    }
  }

  // 3) Imgs inside div[role="button"] (picker / book selector in expanded UI)
  if (row) {
    for (const img of row.querySelectorAll('div[role="button"] img')) {
      const b = bookNameFromSportsbookLogoImg(img);
      if (b) return b;
    }
  }

  // 4) Legacy: books column container (tour__books) when test id cell missing
  if (booksCol) {
    const b = bookNameFromSportsbookLogoImg(booksCol.querySelector("img"));
    if (b) return b;
  }

  // 5) Last pass: any row img (map by alt or URL)
  if (row) {
    for (const img of row.querySelectorAll("img")) {
      const b = bookNameFromSportsbookLogoImg(img);
      if (b) return b;
    }
  }

  return "Unknown Book";
}

/**
 * Hit % from probability column — never confuse with EV% in tour__profit.
 * Patterns: \\d+\\.\\d+% or \\d+%. Fallback 0 only (no fake uniform default).
 * Full-width compact: may lack probability-cell test id — fall back to rightmost non-green %.
 */
function parseOddsJamHitProbPct(root, _isFullWidthTable) {
  const profit = root.querySelector('div[class*="tour__profit"]');
  const booksCell = root.querySelector('[data-testid="books-cell"]');
  const booksRect = booksCell ? booksCell.getBoundingClientRect() : null;

  const extractPctFromText = (text) => {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    let m = s.match(/(\d+\.\d+)\s*%/);
    if (m) {
      const v = parseFloat(m[1]);
      return Number.isFinite(v) ? v : null;
    }
    m = s.match(/\b(\d{1,3})\s*%/);
    if (m) {
      const v = parseFloat(m[1]);
      return Number.isFinite(v) ? v : null;
    }
    return null;
  };

  const isInsideProfit = (el) => profit && profit.contains(el);
  /** Probability column sits to the right of BOOKS; ignore EV and left columns. */
  const isRightOfBooks = (el) => {
    if (!booksRect) return true;
    const r = el.getBoundingClientRect();
    return r.left >= booksRect.right - 1;
  };

  // 1) [data-testid="probability-cell"] — full text, then inner p/span
  const probCell = root.querySelector('[data-testid="probability-cell"]');
  if (probCell) {
    let v = extractPctFromText(textOf(probCell));
    if (v != null) return v;
    const inner = probCell.querySelectorAll("p, span");
    for (const el of inner) {
      v = extractPctFromText(el.textContent);
      if (v != null) return v;
    }
  }

  // 2) All p/span in row: match \\d+\\.\\d+% or \\d+%, exclude EV column, require right of BOOKS
  const candidates = [];
  root.querySelectorAll("p, span").forEach((el) => {
    if (isInsideProfit(el)) return;
    if (!isRightOfBooks(el)) return;
    const raw = el.textContent || "";
    if (!/%/.test(raw)) return;
    const v = extractPctFromText(raw);
    if (v == null || !Number.isFinite(v)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;
    candidates.push({ v, left: rect.left, right: rect.right });
  });

  if (candidates.length) {
    // Rightmost column: prefer largest .left (furthest right), then .right tie-break
    candidates.sort((a, b) => b.left - a.left || b.right - a.right);
    return candidates[0].v;
  }

  // Compact full width: probability cells may lack data-testid; use rightmost standalone % (not EV green)
  const standalonePct = /^\d{1,3}(?:\.\d+)?%$/;
  const isGreenEvLike = (el) => {
    const c = (el.className && String(el.className)) || "";
    return c.includes("text-brand-green") || c.includes("text-green");
  };
  const allPercentEls = Array.from(root.querySelectorAll("p, span, div")).filter((el) => {
    const text = (el.textContent || "").trim().replace(/\s+/g, "");
    return standalonePct.test(text);
  });
  if (allPercentEls.length > 0) {
    const withRects = allPercentEls
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ el, rect }) => {
        if (rect.width === 0 && rect.height === 0) return false;
        if (isInsideProfit(el)) return false;
        if (isGreenEvLike(el)) return false;
        return true;
      })
      .sort((a, b) => b.rect.left - a.rect.left);
    if (withRects.length > 0) {
      const v = extractPctFromText(withRects[0].el.textContent);
      if (v != null) return v;
    }
  }

  return 0;
}

/** Event time: span inside gray-6 p under flex flex-col items-end — not sport. */
function parseOddsJamEventTimeLabel(root) {
  const flexEnd = root.querySelector("div.flex.flex-col.items-end");
  if (!flexEnd) return null;
  const grayP = flexEnd.querySelector('p[class*="text-brand-gray-6"]');
  if (!grayP) return null;
  const span = grayP.querySelector("span");
  return span ? span.textContent.replace(/\s+/g, " ").trim() : null;
}

/** BET SIZE — full-width: [data-testid="bet-size-cell"]; fallback p[class*="tour__bet_size"]. */
function parseOddsJamBetSizeStake(root) {
  const betCell = root.querySelector('[data-testid="bet-size-cell"]');
  let sizeText = betCell ? String(betCell.innerText || "").replace(/\s+/g, " ").trim() : "";
  let m = sizeText.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (m) return parseFloat(m[1]);
  const sizeP = root.querySelector('p[class*="tour__bet_size"]');
  sizeText = sizeP ? String(sizeP.textContent || "").trim() : "";
  m = sizeText.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Fill optional RawLeg fields before backend ingest. Mutates leg.
 * Only participant and odds are required for acceptance; everything else defaults here if missing.
 */
function normalizeRawLegDefaults(leg) {
  if (!leg || typeof leg !== "object") return;
  if (leg.line == null || !Number.isFinite(Number(leg.line))) leg.line = 0;
  const evRaw = leg.ev_pct != null ? leg.ev_pct : leg.ev;
  if (evRaw == null || !Number.isFinite(Number(evRaw))) {
    leg.ev_pct = 0;
    leg.ev = 0;
  } else {
    const v = Number(evRaw);
    leg.ev_pct = v;
    leg.ev = v;
  }
  const hitRaw = leg.hit_prob_pct != null ? leg.hit_prob_pct : leg.hit_prob;
  if (hitRaw == null || !Number.isFinite(Number(hitRaw))) {
    leg.hit_prob_pct = 0;
    leg.hit_prob = 0;
  } else {
    const v = Number(hitRaw);
    leg.hit_prob_pct = v;
    leg.hit_prob = v;
  }
  const book = leg.book != null ? String(leg.book).trim() : "";
  if (!book) leg.book = "Unknown Book";
  const market = leg.market != null ? String(leg.market).trim() : "";
  if (!market) leg.market = "Prop";
}

/**
 * Relaxed validation: only participant and finite odds are required.
 * Other fields use normalizeRawLegDefaults() so partial extraction still ships to the backend.
 */
function isRawLegValidForBackend(leg) {
  if (!leg || typeof leg !== "object") return false;
  normalizeRawLegDefaults(leg);
  const p = leg.participant != null ? String(leg.participant).trim() : "";
  if (!p) return false;
  if (leg.odds == null || !Number.isFinite(Number(leg.odds))) return false;
  return true;
}

function resetPuffExtractLegDebugCount() {
  __puff_extractDebugLegCount = 0;
}

/** First 3 legs per capture batch: log resolved fields for debugging extraction. */
function logPuffExtractedLegIfDebug(leg) {
  if (!leg || __puff_extractDebugLegCount >= 3) return;
  console.log("[PUFF] leg extracted:", {
    participant: leg.participant,
    line: leg.line,
    ev: leg.ev_pct != null ? leg.ev_pct : leg.ev,
    hit_prob: leg.hit_prob_pct != null ? leg.hit_prob_pct : leg.hit_prob,
    odds: leg.odds,
    book: leg.book,
    market: leg.market,
    sport: leg.sport,
  });
  __puff_extractDebugLegCount++;
}

// Build a RawLeg from an OddsJam +EV row using exact selectors (no column guessing).
function toRawLegFromOddsJam(rowEl) {
  const rowRoot = resolveOddsJamBetRow(rowEl);
  if (!rowRoot) return null;

  // Skip detached nodes — React may have re-rendered and replaced them
  if (!document.contains(rowRoot)) return null;

  console.log(
    "[PUFF] rowRoot tag:",
    rowRoot.tagName,
    "classes:",
    rowRoot.className?.slice(0, 80),
    "children:",
    rowRoot.children.length
  );

  // Compact full-width: div.tour__bet_row with two direct children — top (event/EV/market), bottom (bet/odds/book)
  function findTwoChildBetRow(el) {
    if (!el) return null;
    const all = [el, ...Array.from(el.querySelectorAll("div.tour__bet_row"))];
    for (const candidate of all) {
      if (
        candidate.children.length === 2 &&
        !candidate.querySelector('[data-testid="books-cell"]') &&
        !candidate.querySelector('[data-testid="market-cell"]')
      )
        return candidate;
    }
    return null;
  }

  const actualBetRow = findTwoChildBetRow(rowRoot) || rowRoot;

  // 8-child full-width table layout (OddsJam desktop)
  // child 1: EV%, child 2: event/matchup/sport, child 3: market
  // child 4: participant+line+odds+book, child 5: hit prob, child 6: bet size
  if (actualBetRow.children.length >= 5) {
    const c1 = actualBetRow.children[1]?.innerText?.trim() || "";
    const c2 = actualBetRow.children[2]?.innerText?.trim() || "";
    const c3 = actualBetRow.children[3]?.innerText?.trim() || "";
    const c4 = actualBetRow.children[4]?.innerText?.trim() || "";
    const c5 = actualBetRow.children[5]?.innerText?.trim() || "";

    const evMatch = c1.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
    const ev = evMatch ? parseFloat(evMatch[1]) : 0;

    const c2lines = c2.split("\n").map((l) => l.trim()).filter(Boolean);
    let matchup = null;
    let sport = null;
    let league = null;
    for (const line of c2lines) {
      if (line.includes("•") && !/\d{1,2}:\d{2}/.test(line)) {
        const parts = line.split("•").map((p) => p.trim());
        sport = parts[0] || null;
        league = parts[1] || null;
      } else if (/\bvs\.?\b/i.test(line)) {
        matchup = line;
      }
    }

    const market = c3 || "Prop";

    const c4lines = c4.split("\n").map((l) => l.trim()).filter(Boolean);
    let participant = null;
    let oddsAm = 0;
    let lineVal = 0;
    let side = "other";
    let nameParts = [];

    for (const bline of c4lines) {
      if (/^(SITE|BET|GAME)$/i.test(bline)) continue;
      if (/^\$\d+$/.test(bline)) continue;
      if (/liq/i.test(bline)) continue;
      if (/^[+-]\d{2,4}$/.test(bline)) {
        if (oddsAm === 0) oddsAm = parseInt(bline, 10);
        continue;
      }
      const ouMatch = bline.match(/^(over|under)\s+([+-]?\d{1,3}(?:\.\d{1,2})?)/i);
      if (ouMatch) {
        side = ouMatch[1].toLowerCase();
        lineVal = parseFloat(ouMatch[2]);
        nameParts.push(bline);
        continue;
      }
      if (/^[+-]\d{1,3}(\.\d{1,2})?$/.test(bline)) {
        lineVal = parseFloat(bline);
        continue;
      }
      nameParts.push(bline);
    }

    participant = nameParts.join(" ").trim() || matchup || "Unknown participant";

    // If participant looks like a matchup (contains " vs "), child 4 had no player name — clean sport/league if appended
    if (participant && /\bvs\.?\b/i.test(participant) && !participant.match(/^(over|under)/i)) {
      participant = participant
        .replace(/\s+(Basketball|Baseball|Hockey|Soccer|Tennis|MMA|Football)\s*[•·].*$/i, "")
        .trim();
    }

    // Do not use matchup lines ("Team A vs Team B") as participant when no player name was parsed
    if (nameParts.length === 0 && participant && /\bvs\.?\b/i.test(participant.trim())) {
      participant = "Unknown participant";
    }

    // Strip team abbreviation and liquidity noise e.g. "ORL 47¢" or "Liq $54"
    participant = participant
      .replace(/\s+\b[A-Z]{2,4}\b(\s|$)/g, " ")
      .replace(/\s*\d+¢/g, "")
      .replace(/\s*Liq\s*\$[\d.]+/gi, "")
      .trim();

    if (lineVal === 0 && participant) {
      const endLineMatch = participant.match(/([+-]\d{1,3}(?:\.\d{1,2})?)$/);
      if (endLineMatch) lineVal = parseFloat(endLineMatch[1]);
      const ouInName = participant.match(/\b(over|under)\s+([+-]?\d{1,3}(?:\.\d{1,2})?)/i);
      if (ouInName) {
        side = ouInName[1].toLowerCase();
        lineVal = parseFloat(ouInName[2]);
      }
    }

    if (side === "other" && participant) {
      const low = participant.toLowerCase();
      if (/\bover\b/.test(low)) side = "over";
      else if (/\bunder\b/.test(low)) side = "under";
    }

    // If participant is just a line with no name, use matchup
    if (participant && /^(over|under)\s+[\d.]+$/i.test(participant.trim()) && matchup) {
      participant = `${matchup} ${participant}`;
    }

    const hitMatch = c5.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
    const hitProb = hitMatch ? parseFloat(hitMatch[1]) : 0;

    const bookImg = actualBetRow.children[4]?.querySelector("img");
    const book = bookImg
      ? bookImg.alt?.trim() || bookNameFromSportsbookLogoImg(bookImg) || "Unknown Book"
      : parseOddsJamBook(null, actualBetRow);

    const leg = {
      source: "extension",
      book,
      sport: sport || null,
      league: league || null,
      market,
      market_type: market,
      participant,
      player: participant,
      prop: market,
      side,
      line: Number.isFinite(lineVal) ? lineVal : 0,
      odds: oddsAm,
      odds_format: "american",
      ev,
      ev_pct: ev,
      hit_prob: hitProb,
      hit_prob_pct: hitProb,
      url: null,
      captured_at: new Date().toISOString(),
    };

    logPuffExtractedLegIfDebug(leg);

    if (!isRawLegValidForBackend(leg)) {
      console.warn("[PUFF] 8-child leg failed validation", leg);
      return null;
    }
    return leg;
  }

  const topSection = actualBetRow.children[0];
  const bottomSection = actualBetRow.children[1];

  const isTwoChildLayout = !!(
    topSection &&
    bottomSection &&
    (topSection.innerText || "").includes("•") &&
    /[+-]\d{2,4}/.test(bottomSection.innerText || "")
  );

  if (isTwoChildLayout) {
    const evEl = topSection.querySelector(
      'p[class*="font-code-next"], p[class*="text-brand-green"], span[class*="text-brand-green"]'
    );
    const evText = evEl
      ? evEl.textContent.trim()
      : (topSection.innerText || "").split("\n")[0]?.trim() || "";
    const evMatch = evText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
    const ev = evMatch ? parseFloat(evMatch[1]) : 0;

    const topLines = (topSection.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let sport = null;
    let league = null;
    let matchup = null;
    let market = "Prop";

    for (const line of topLines) {
      if (line.includes("•") && !/\d{1,2}:\d{2}/.test(line)) {
        const parts = line.split("•").map((x) => x.trim());
        sport = parts[0] || null;
        league = parts[1] || null;
      } else if (/\bvs\.?\b/i.test(line) || line.includes(" vs ")) {
        matchup = line.trim();
      } else if (
        !/^\d{1,3}(?:\.\d{1,2})?\s*%$/.test(line) &&
        !/today|tomorrow|\d{1,2}:\d{2}|\$|~/.test(line.toLowerCase()) &&
        !line.includes("•") &&
        line.length > 2 &&
        line !== matchup
      ) {
        market = line.trim();
      }
    }

    const bottomLines = (bottomSection.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let participant = null;
    let participantPlain = false;
    let lineVal = 0;
    let side = "other";
    let oddsAm = 0;
    const hitPctLine = /^\d{1,3}(?:\.\d{1,2})?\s*%$/;

    for (const bline of bottomLines) {
      if (/^(SITE|BET|GAME)$/i.test(bline)) continue;
      if (/^\$\d+$/.test(bline)) continue;
      if (/liq/i.test(bline)) continue;
      if (/^[+-]\d{2,4}$/.test(bline)) {
        if (oddsAm === 0) oddsAm = parseInt(bline, 10);
        continue;
      }
      if (/^[+-]\d{1,3}(\.\d{1,2})?$/.test(bline)) {
        lineVal = parseFloat(bline);
        continue;
      }
      const ouMatch = bline.match(/^(over|under)\s+([+-]?\d{1,3}(?:\.\d{1,2})?)/i);
      if (ouMatch) {
        side = ouMatch[1].toLowerCase();
        lineVal = parseFloat(ouMatch[2]);
        if (!participant) participant = bline.trim();
        participantPlain = false;
        continue;
      }
      if (!participant && bline.length >= 2 && !hitPctLine.test(bline)) {
        participant = bline.trim();
        const plTest = parsePropLineSideAndNumber(bline);
        participantPlain = !(plTest.line && Number.isFinite(plTest.line) && plTest.line !== 0);
      }
    }

    if ((lineVal === 0 || !Number.isFinite(lineVal)) && participant) {
      const pl = parsePropLineSideAndNumber(participant);
      if (pl.line && Number.isFinite(pl.line) && pl.line !== 0) {
        lineVal = pl.line;
        if (side === "other" && pl.side !== "other") side = pl.side;
      }
    }

    if (
      participantPlain &&
      participant &&
      lineVal !== 0 &&
      Number.isFinite(lineVal) &&
      !participant.toLowerCase().includes("over") &&
      !participant.toLowerCase().includes("under")
    ) {
      const lineSign = lineVal > 0 ? "+" : "";
      participant = `${participant} ${lineSign}${lineVal}`.trim();
    }

    if (!participant) participant = matchup || "Unknown participant";

    const book = parseOddsJamBook(bottomSection, rowRoot);

    if (!oddsAm || oddsAm === 0) {
      for (const el of bottomSection.querySelectorAll("p, span, div")) {
        const txt = (el.textContent || "").trim();
        if (/^[+-]\d{2,4}$/.test(txt)) {
          const v = parseInt(txt, 10);
          if (Number.isFinite(v) && v !== 0) {
            oddsAm = v;
            break;
          }
        }
      }
    }
    if (!oddsAm || oddsAm === 0) {
      for (const el of rowRoot.querySelectorAll("p, span, div")) {
        const txt = (el.textContent || "").trim();
        if (/^[+-]\d{2,4}$/.test(txt)) {
          const v = parseInt(txt, 10);
          if (Number.isFinite(v) && v !== 0) {
            oddsAm = v;
            break;
          }
        }
      }
    }

    let hitProb = 0;
    for (const bline of bottomLines) {
      const pctMatch = bline.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*%$/);
      if (pctMatch) {
        const v = parseFloat(pctMatch[1]);
        if (v >= 25 && v <= 99) {
          hitProb = v;
          break;
        }
      }
    }
    if (hitProb === 0) {
      hitProb = parseOddsJamHitProbPct(rowRoot, true);
    }

    const teamSpan = bottomSection.querySelector('span[class*="text-oj-text-light-tertiary"]');
    const teamAbbrev = teamSpan ? teamSpan.textContent.trim() : null;
    const stakeAmount = parseOddsJamBetSizeStake(rowRoot);
    const eventTimeLabel = parseOddsJamEventTimeLabel(rowRoot);

    const leg = {
      source: "extension",
      book,
      sport: sport || null,
      league: league || null,
      market,
      market_type: market,
      participant,
      player: participant,
      prop: market,
      side,
      line: Number.isFinite(lineVal) ? lineVal : 0,
      odds: oddsAm,
      odds_format: "american",
      ev,
      ev_pct: ev,
      hit_prob: hitProb,
      hit_prob_pct: hitProb,
      stake_amount: stakeAmount != null ? stakeAmount : undefined,
      team_abbrev: teamAbbrev || null,
      event_time_label: eventTimeLabel || null,
      url: null,
      captured_at: new Date().toISOString(),
    };

    logPuffExtractedLegIfDebug(leg);

    if (!isRawLegValidForBackend(leg)) {
      console.warn("[PUFF] two-child leg failed validation", leg);
      return null;
    }
    return leg;
  }

  const isCardLayout = rowRoot.closest("li.my-2.rounded-md") !== null;
  const isTableLayout =
    rowRoot.classList.contains("tour__bet_row") || rowRoot.querySelector("div.tour__bet_row") !== null;
  const hasTestIdCells = !!(
    rowRoot.querySelector('[data-testid="market-cell"]') ||
    rowRoot.querySelector('[data-testid="probability-cell"]') ||
    rowRoot.querySelector('[data-testid="books-cell"]')
  );
  const isFullWidthTable = (isTableLayout && !isCardLayout) || (hasTestIdCells && !isCardLayout);

  const ev = parseOddsJamEvPct(rowRoot);

  const eventCell =
    rowRoot.matches && rowRoot.matches('[data-testid="event-cell"]')
      ? rowRoot
      : rowRoot.querySelector('[data-testid="event-cell"]');
  let { sport, league, matchup, market: marketFromEvent } = parseOddsJamEventCell(eventCell, {
    omitMarket: isFullWidthTable,
  });
  // Fallback: compact full-width — sport/league in gray text as "Baseball • MLB" (bullet may not hit p[class*="text-brand-gray-6"])
  if (!sport && eventCell) {
    const allText = (eventCell.innerText || eventCell.textContent || "").replace(/\s+/g, " ");
    const bulletMatch = allText.match(
      /([A-Za-z][A-Za-z\s]+?)\s*[•·]\s*([A-Za-z][A-Za-z\s\-]+?)(?:\s*[•·]|$)/
    );
    if (bulletMatch) {
      const first = bulletMatch[1].trim();
      if (!/\b(?:today|tomorrow|mon|tue|wed|thu|fri|sat|sun|\d{1,2}:\d{2})\b/i.test(first)) {
        sport = first;
        league = bulletMatch[2].trim();
      }
    }
  }
  const market = isFullWidthTable ? parseOddsJamMarketFullWidth(rowRoot) : marketFromEvent;

  const booksCol = getOddsJamBooksCell(rowRoot);
  // For full width layout, if books-cell test id not found, use the entire row as fallback
  const booksColEffective = booksCol || (isFullWidthTable ? rowRoot : null);
  const { playerP, propLineP, teamAbbrev } = parseOddsJamBooksPlayerAndProp(booksColEffective, isFullWidthTable);

  const playerName = playerP ? playerP.textContent.replace(/\s+/g, " ").trim() : "";
  const lineSide = propLineP ? propLineP.textContent.replace(/\s+/g, " ").trim() : "";

  let { side, line } = parsePropLineSideAndNumber(lineSide);

  let participant = "";
  if (playerName && lineSide) participant = `${playerName} ${lineSide}`.trim();
  else if (playerName) participant = playerName;
  else if (matchup) participant = matchup;
  else participant = "Unknown participant";

  // Fallback: read raw BOOKS cell text when structured parsing fails (full-width compact: plain bet text)
  if (!participant || participant === "Unknown participant") {
    const booksCell = booksColEffective || getOddsJamBooksCell(rowRoot);
    if (booksCell) {
      const rawBookText = (booksCell.innerText || booksCell.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const cleaned = rawBookText
        .replace(/[+-]\d{2,4}/g, "")
        .replace(/\$\d+/g, "")
        .replace(/\bLiq\b.*$/i, "")
        .replace(/\bBET\b/gi, "")
        .replace(/\bGAME\b/gi, "")
        .replace(/\bSITE\b/gi, "")
        .replace(/\b\d+¢\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const parts = cleaned.split(/\s{2,}|\n/);
      const firstPart = parts[0]?.trim();
      if (firstPart && firstPart.length >= 3 && firstPart.length <= 80) {
        participant = firstPart;
      }
    }
  }

  // Final fallback: use matchup from event cell
  if (!participant || participant === "Unknown participant") {
    if (matchup) {
      participant = matchup;
    }
  }

  // If line is still 0, extract from participant / BOOKS text (compact layout: "Detroit Tigers -1.5", "Under 9.5")
  if (line === 0 || !line) {
    const bc = booksColEffective || getOddsJamBooksCell(rowRoot);
    const booksPlain = bc
      ? String(bc.innerText || bc.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    const textToSearch = [participant, lineSide, playerName, booksPlain]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const lineMatch = textToSearch.match(
      /(?:over|under)\s+([+-]?\d{1,3}(?:\.\d{1,2})?)|([+-]\d{1,3}(?:\.\d{1,2})?)(?:\s|$)|(?:^|\s)(\d{1,3}\.\d{1,2})(?:\s|$)/i
    );
    if (lineMatch) {
      const v = parseFloat(lineMatch[1] || lineMatch[2] || lineMatch[3]);
      if (Number.isFinite(v) && v !== 0) line = v;
    }
    if (side === "other") {
      const low = textToSearch.toLowerCase();
      if (/\bover\b/.test(low)) side = "over";
      else if (/\bunder\b/.test(low)) side = "under";
    }
  }

  const book = parseOddsJamBook(booksCol, rowRoot);
  let oddsAm = parseOddsJamAmericanOdds(booksColEffective);
  // If odds is still 0 and booksCol failed, scan the entire row for American odds pattern
  if ((!oddsAm || oddsAm === 0) && rowRoot) {
    const allPs = rowRoot.querySelectorAll("p, span, div");
    for (const el of allPs) {
      const txt = (el.textContent || "").trim();
      if (/^[+-]\d{2,4}$/.test(txt)) {
        const v = parseInt(txt, 10);
        if (Number.isFinite(v) && v !== 0) {
          oddsAm = v;
          break;
        }
      }
    }
  }

  const stakeAmount = parseOddsJamBetSizeStake(rowRoot);

  const eventTimeLabel = parseOddsJamEventTimeLabel(rowRoot);
  const hitProb = parseOddsJamHitProbPct(rowRoot, isFullWidthTable);

  const leg = {
    source: "extension",
    book,
    sport: sport || null,
    league: league || null,
    market,
    market_type: market,
    participant,
    player: playerName || participant,
    prop: market,
    side,
    line: Number.isFinite(line) ? line : 0,
    odds: oddsAm,
    odds_format: "american",
    ev,
    ev_pct: ev,
    hit_prob: hitProb,
    hit_prob_pct: hitProb,
    stake_amount: stakeAmount != null ? stakeAmount : undefined,
    team_abbrev: teamAbbrev || null,
    event_time_label: eventTimeLabel || null,
    url: null,
    captured_at: new Date().toISOString()
  };

  logPuffExtractedLegIfDebug(leg);

  if (!isRawLegValidForBackend(leg)) {
    console.warn("[PUFF] OddsJam leg failed validation after extraction", {
      leg,
      isCardLayout,
      isTableLayout,
      isFullWidthTable,
    });
    return null;
  }
  return leg;
}

function textOf(el) {
  return (el?.innerText || "").replace(/\s+/g, " ").trim();
}

function pickNonOverlayFromPoint(x, y) {
  const els = document.elementsFromPoint(x, y) || [];
  for (const el of els) {
    if (!isOverlayLike(el)) return el;
  }
  return els[0] || null;
}

function isOverlayLike(el) {
  if (!el) return false;
  const st = window.getComputedStyle(el);
  if (st.position === "fixed" || st.position === "sticky") return true;

  const txt = (el.innerText || "").toLowerCase();
  if (txt.includes("subscribe") || txt.includes("start subscription")) return true;

  return false;
}



function parseMarketSideLine(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  const low = s.toLowerCase();

  // -------- side (backend expects lowercase: over, under, yes, no, home, away, other) ----------
  let side = "other";
  if (/\bover\b/.test(low)) side = "over";
  else if (/\bunder\b/.test(low)) side = "under";
  else if (/\byes\b/.test(low)) side = "yes";
  else if (/\bno\b/.test(low)) side = "no";
  else if (/\bah1\b/.test(low) || /\bteam1\b/.test(low)) side = "home";
  else if (/\bah2\b/.test(low) || /\bteam2\b/.test(low)) side = "away";

  // -------- line (only from “real line patterns”) ----------
  let line = null;

  // parentheses: AH2(+17.5), (1.5)
  let m = s.match(/\(([+-]?\d{1,3}(\.\d{1,2})?)\)/);
  if (m) line = parseFloat(m[1]);

  // TO(1.5), TU(4)
  if (line === null) {
    m = s.match(/\bT[OU]\s*\(\s*([+-]?\d{1,3}(\.\d{1,2})?)\s*\)/i);
    if (m) line = parseFloat(m[1]);
  }

  // "Over 2.5" / "Under 1.5"
  if (line === null) {
    m = s.match(/\b(over|under)\s+([+-]?\d{1,3}(\.\d{1,2})?)\b/i);
    if (m) line = parseFloat(m[2]);
  }

  // -------- market normalization ----------
  // Order matters (more specific first)
  let market = null;

  // Game/team markets
  if (/\bmoneyline\b/.test(low) || /\bml\b/.test(low)) market = "moneyline";
  else if (/\bspread\b/.test(low) || /\bah\d?\s*\(/i.test(s)) market = "spread"; // AH treated as spread-ish
  else if (/\btotal\b/.test(low) || /\bT[OU]\s*\(/i.test(s) || /\b(over|under)\s+\d/i.test(low)) market = "total";

  // Soccer specials
  if (!market) {
    if (low.includes("corners")) market = "corners";
    else if (low.includes("yellow cards") || low.includes("cards")) market = "cards";
  }

  // Player props (common)
  const hasPropWord = (w) => low.includes(w);

  if (!market) {
    // combo props
    if (hasPropWord("points + rebounds + assists") || hasPropWord("pra")) market = "pra";
    else if (hasPropWord("points + assists") || hasPropWord("pa")) market = "points+assists";
    else if (hasPropWord("points + rebounds") || hasPropWord("pr")) market = "points+rebounds";
    else if (hasPropWord("rebounds + assists") || hasPropWord("ra")) market = "rebounds+assists";

    // singles
    else if (hasPropWord("points") || /\bpts\b/.test(low)) market = "points";
    else if (hasPropWord("assists") || /\bast\b/.test(low)) market = "assists";
    else if (hasPropWord("rebounds") || /\breb\b/.test(low)) market = "rebounds";
    else if (hasPropWord("threes") || hasPropWord("3pt") || hasPropWord("3pm")) market = "threes";
    else if (hasPropWord("steals")) market = "steals";
    else if (hasPropWord("blocks")) market = "blocks";
    else if (hasPropWord("turnovers")) market = "turnovers";
  }

  // If we detected TO/TU but didn’t set market yet, make it total
  if (!market && /\bT[OU]\s*\(/i.test(s)) market = "total";

  return { market: market || "Unknown", side, line };
}

function findHitProbPct(t) {
  const s = String(t || "");
  const low = s.toLowerCase();

  // explicit DailyGrind style
  if (low.includes("odds to hit") || low.includes("hit rate")) {
    const m = s.match(/(\d{1,3}(\.\d{1,2})?)\s*%/);
    if (!m) return null;
    const val = parseFloat(m[1]);
    return (val >= 0 && val <= 100) ? val : null;
  }

  // PrizePicks-style: row contains a percent but not the label
  const m = s.match(/(\d{1,3}(\.\d{1,2})?)\s*%/);
  if (!m) return null;

  const val = parseFloat(m[1]);
  if (!(val >= 0 && val <= 100)) return null;

  // if row also contains "ev/value/edge", treat it as EV not hit%
  const hasEvContext = low.includes("ev") || low.includes("value") || low.includes("edge");
  if (hasEvContext) return null;

  // Values < 25% are almost certainly EV/edge, not hit probability (hit prob typically 40-70%)
  if (val < 25) return null;

  // otherwise assume this percent is hit%
  return val;
}

// Parse odds and return structured value for extraction
function parseOdds(t) {
  // american: +120, -110, +186 (permissive - anywhere in string)
  const am = t.match(/[+-]\d{2,4}\b/);
  if (am) return { odds: parseInt(am[0], 10), format: "american" };

  // decimal: 1.70 - 3.50 (avoid capturing stat lines like 24.5 by requiring >= 1.2 and <= 10)
  const dec = t.match(/\b(\d+\.\d{1,2})\b/g);
  if (dec) {
    for (const m of dec) {
      const val = parseFloat(m);
    if (val >= 1.2 && val <= 10) return { odds: val, format: "decimal" };
    }
  }
  return null;
}

// Boolean check used for hover “leg-likeness”
function hasOdds(t) {
  return !!parseOdds(t);
}

function findLineInText(t) {
  const s = String(t || "");

  // Best: things inside parentheses like AH2(+17.5), AH1(-1)
  let m = s.match(/\(([+-]?\d{1,3}(\.\d{1,2})?)\)/);
  if (m) return parseFloat(m[1]);

  // TO(1.5), TU(4), etc
  m = s.match(/\bT[OU]\s*\(\s*([+-]?\d{1,3}(\.\d{1,2})?)\s*\)/i);
  if (m) return parseFloat(m[1]);

  // Bare “Over 2.5 / Under 1.5” (optional)
  m = s.match(/\b(over|under)\s+([+-]?\d{1,3}(\.\d{1,2})?)\b/i);
  if (m) return parseFloat(m[2]);

  return null;
}

function guessSide(t) {
  const low = t.toLowerCase();
  if (low.includes("over")) return "over";
  if (low.includes("under")) return "under";
  if (low.includes("yes")) return "yes";
  if (low.includes("no")) return "no";
  return "other";
}

function looksLikeBook(t) {
  const low = String(t || "").toLowerCase();

  const books = [
    "unibet","bet365","betrivers","skybet","parimatch","draftkings","fanduel",
    "betmgm","caesars","pointsbet","pinnacle","circa","hard rock","marathon",
    "tipssport","tipsport","betplay","betin asia","betinasia","stoiximan",
    "stakeit","sisal","leon","betano","betcity","bfsportsbook","fb sports"
  ];

  const hit = books.find((b) => low.includes(b));
  return hit || null;
}


function looksLikeMarket(t) {
  const s = String(t || "");
  const low = s.toLowerCase();

  if (/\bAH\d?\s*\(/i.test(s)) return "Asian Handicap";
  if (/\bT[OU]\s*\(/i.test(s) || /\b(over|under)\s+\d/i.test(low)) return "Total";

  if (low.includes("yellow cards")) return "Cards";
  if (low.includes("corners")) return "Corners";
  if (low.includes("moneyline") || /\bml\b/.test(low)) return "Moneyline";
  if (low.includes("spread")) return "Spread";

  return null;
}

function pickParticipant(t) {
  const raw = String(t || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  // common bookmaker tokens that show up at the start of rows
  const bookPrefix = /\b(unibet|bet365|betrivers|skybet|parimatch|draftkings|fanduel|betmgm|caesars|pointsbet|pinnacle|circa|hard rock|marathon)\b/i;

  // date/time patterns like "13 Feb 11:00", "09 Feb 02:00"
  const dateTime = /\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s\d{1,2}:\d{2}\b/i;

  // remove book + datetime if they appear near the start
  const stripLeadNoise = (s) => {
    let out = s.trim();

    // kill leading book name
    out = out.replace(new RegExp(`^\\s*${bookPrefix.source}\\s*`, "i"), "");

    // kill leading date/time
    out = out.replace(new RegExp(`^\\s*${dateTime.source}\\s*`, "i"), "");

    // sometimes it's "Book 13 Feb 11:00 ..."
    out = out.replace(new RegExp(`^\\s*${bookPrefix.source}\\s+${dateTime.source}\\s*`, "i"), "");

    // remove extra separators
    out = out.replace(/^[-–—:|•]+\s*/, "").trim();

    return out;
  };

  const looksLikeMatchup = (s) =>
    /\s(vs\.?|v|@)\s/i.test(s) || /.+\s-\s.+/.test(s);

  const isJunk = (s) => {
    const low = s.toLowerCase();
    if (!s || s.length < 6) return true;
    if (/[+-]\d{2,4}/.test(s)) return true;          // american odds
    if (/\b\d{1,2}(\.\d{1,2})?\s*%/.test(s)) return true;
    if (/^\d+(\.\d+)?$/.test(s)) return true;        // pure numbers
    if (low.includes("calculator") || low.includes("filters") || low.includes("valuebet")) return true;
    return false;
  };

  // split into chunks and score
  const chunks = raw
    .split(/\n|•|\||·|\t/)
    .map((s) => stripLeadNoise(s))
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = (chunks.length ? chunks : [stripLeadNoise(raw)]).slice(0, 50);

  let best = null;
  let bestScore = -999;

  for (let c of candidates) {
    c = stripLeadNoise(c);
    if (isJunk(c)) continue;

    let score = 0;

    // biggest signal: matchup format
    if (looksLikeMatchup(c)) score += 10;

    // reward reasonable length
    if (c.length >= 12 && c.length <= 90) score += 3;
    if (c.length > 120) score -= 5;

    // penalize too many digits (usually leftover metadata)
    const digitCount = (c.match(/\d/g) || []).length;
    score -= digitCount * 2;

    // small reward for multiple words (teams)
    const wordCount = c.split(" ").filter(Boolean).length;
    score += Math.min(4, wordCount - 1);

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // last resort: pull matchup from the full raw string AFTER stripping book/datetime
  if (!best) {
    const cleaned = stripLeadNoise(raw);
    const m = cleaned.match(/(.+?)\s(?:vs\.?|v|@|-)\s(.+?)(?=$|\s\||\s•)/i);
    if (m) best = `${m[1].trim()} - ${m[2].trim()}`;
  }

  const matchup = extractMatchupOnly(best);
  let out = matchup || best || null;
  if (out && out.length > 80) {
    out = out.slice(0, 80) + "…";
  }
  return out;
}

function extractMatchupOnly(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.trim();
  // Normalize common separators
  const parts = cleaned.split(/\s+[-@vvs]{1,2}\s+|\s+vs\.?\s+|\s+v\s+|\s+@\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // keep just the two sides
    return `${parts[0]} - ${parts[1]}`;
  }
  return cleaned;
}

/**
 * When pickParticipant returns null/empty, derive a readable participant label from row text
 * (and optionally row element) so no leg is ever shown as "Unknown".
 */
function deriveParticipantFromRow(rowText, { market, side, line }, rowEl) {
  const s = String(rowText || "").replace(/\s+/g, " ").trim();

  // 0) If we have a row element, try the first cell that looks like a name (no odds, no %)
  if (rowEl) {
    const cells = rowEl.querySelectorAll ? Array.from(rowEl.querySelectorAll("td, [role='cell'], th, div")) : [];
    for (const cell of cells) {
      const txt = (cell.innerText || "").replace(/\s+/g, " ").trim();
      if (txt.length < 4 || txt.length > 120) continue;
      if (/[+-]\d{2,4}\b/.test(txt) || /\d{1,3}(\.\d{1,2})?\s*%/.test(txt)) continue;
      if (/^\d+(\.\d+)?$/.test(txt)) continue;
      const out = txt.slice(0, 60);
      if (out.length >= 4) return out + (txt.length > 60 ? "…" : "");
    }
  }

  if (!s) return "Leg";

  // 1) Market + side + line (e.g. "Points Over 25.5")
  const marketLabel = (market || "Prop").replace(/^./, (c) => c.toUpperCase());
  const sideLabel = (side || "other").toLowerCase();
  if (marketLabel && marketLabel !== "Unknown") {
    const lineStr = line != null && Number.isFinite(line) ? ` ${line}` : "";
    const candidate = `${marketLabel} ${sideLabel}${lineStr}`.trim();
    if (candidate.length >= 3) return candidate;
  }

  // 2) First substantial phrase: strip odds, percentages, pure numbers
  const noOdds = s.replace(/[+-]\d{2,4}\b/g, "").replace(/\b\d{1,3}(\.\d{1,2})?\s*%/g, "").trim();
  const chunks = noOdds.split(/\s*[|•·\-]\s*|\t|\n/).map((c) => c.trim()).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length < 4) continue;
    if (/^\d+(\.\d+)?$/.test(chunk)) continue;
    if (/^[+-]?\d+$/.test(chunk)) continue;
    const cleaned = chunk.replace(/\s+/g, " ").slice(0, 60);
    if (cleaned.length >= 4) return cleaned;
  }

  // 3) Truncated row: remove leading junk (numbers, symbols, book names)
  const trimmed = s.replace(/^[\s\d.%+-]+/, "").replace(/\s+/g, " ").trim().slice(0, 50);
  if (trimmed.length >= 3) return trimmed + (s.length > 50 ? "…" : "");

  return "Leg";
}

/** Detect league/sport from row text for market_type display (e.g. NBA Player Points). */
function detectLeagueFromRow(t) {
  const low = String(t || "").toLowerCase();
  if (/\bnba\b/.test(low)) return "NBA";
  if (/\bnfl\b/.test(low)) return "NFL";
  if (/\bmlb\b/.test(low)) return "MLB";
  if (/\bnhl\b/.test(low)) return "NHL";
  if (/\bcollege basketball\b|ncaab/i.test(low)) return "NCAAB";
  if (/\bcollege football\b|ncaaf/i.test(low)) return "NCAAF";
  if (/\bsoccer\b|epl\b|mls\b/.test(low)) return "Soccer";
  if (/\btennis\b/.test(low)) return "Tennis";
  if (/\bbasketball\b/.test(low) && !/\bnba\b/.test(low)) return "Basketball";
  return null;
}

/** Parse stake amount from row text (e.g. $10, $40). Prefer whole-dollar amounts that look like stake. */
function findStakeAmount(t) {
  const s = String(t || "");
  const matches = s.match(/\$\s*(\d+(?:\.\d{2})?)\b/g);
  if (!matches || !matches.length) return null;
  const values = matches.map((m) => parseFloat(m.replace(/\$/g, "").trim()));
  for (const v of values) {
    if (v >= 0.5 && v <= 10000) return v;
  }
  return values.length ? values[0] : null;
}

/**
 * Extract a short participant string for display: player name + " " + side + " " + line.
 * Strips timestamps, game matchup, liquidity, BET, etc. from the row so we don't store raw noise.
 */
function extractShortParticipant(rowText, { market, side, line }) {
  let s = String(rowText || "").replace(/\s+/g, " ").trim();
  const low = s.toLowerCase();
  // Remove common noise patterns (timestamps, game info, liquidity, buttons)
  s = s.replace(/\bToday at \d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, "");
  s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "");
  s = s.replace(/\b(?:vs\.?|v\s)\s*[A-Za-z].*?(?=\s+[•|·]|\s+Basketball|\s+NBA|\s+Player|$)/gi, "");
  s = s.replace(/\b(?:Basketball|NBA|NFL|MLB)\s*[•|·]?\s*/gi, "");
  s = s.replace(/\bPlayer\s+Points\s*/gi, "");
  s = s.replace(/\bMIN\s+\d+¢\b/gi, "");
  s = s.replace(/\bLiq\s*\$[\d.]+\b/gi, "");
  s = s.replace(/\b\d+¢\b/g, "");
  s = s.replace(/\bBET\b/gi, "");
  s = s.replace(/\$\s*\d+(?:\.\d{2})?\b/g, "");
  s = s.replace(/\b\d{1,3}(\.\d{1,2})?\s*%/g, "");
  s = s.replace(/\s+/g, " ").trim();
  const overUnder = line != null && (side === "over" || side === "under") ? new RegExp("\\b" + (side === "over" ? "over" : "under") + "\\s+" + (line + "").replace(".", "\\.") + "\\b", "i") : null;
  if (overUnder && overUnder.test(s)) {
    let before = s.split(overUnder)[0].trim();
    before = before.replace(/^\d{1,3}(\.\d{1,2})?\s*%\s*/, "").replace(/^Today at \d{1,2}:\d{2}\s*(?:AM|PM)\s*/i, "");
    const namePart = before.split(/\s+[|•·]\s*/)[0].trim();
    if (namePart.length >= 2 && namePart.length <= 60 && !/^[\d.$]+$/.test(namePart)) return namePart;
  }
  const chunks = s.split(/\s+[|•·\-]\s*|\t/).map((c) => c.trim()).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length < 3 || chunk.length > 50) continue;
    if (/^[+-]?\d{2,4}$/.test(chunk) || /^\d+\.\d+$/.test(chunk)) continue;
    if (/^(over|under)\s+\d/.test(chunk.toLowerCase())) continue;
    return chunk.slice(0, 50);
  }
  return null;
}

function findEvPct(t) {
  const s = String(t || "");
  const low = s.toLowerCase();

  if (low.includes("odds to hit") || low.includes("hit rate")) return null;

  const hasEvContext = low.includes("ev") || low.includes("value") || low.includes("edge");
  if (!hasEvContext) return null;

  const m = s.match(/([+-]?\d{1,2}(\.\d{1,2})?)\s*%/);
  if (!m) return null;

  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  if (val < -50 || val > 50) return null;
  return val;
}

// Fallback: small percentages (0.2-15%) are typically EV/edge when no explicit hit prob found
function findEvPctFromSmallPercent(t) {
  const m = String(t || "").match(/(\d{1,2}(\.\d{1,2})?)\s*%/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return (val >= 0.2 && val <= 15) ? val : null;
}

// ---------- hover selection logic (leg/table only) ----------
// Uses extension UI colors: accentA #7c63ff, glow1/glow2 for subtle glow
function highlight(el) {
  if (!el) return;
  el.style.outline = "3px solid rgba(124, 99, 255, 0.9)";
  el.style.outlineOffset = "2px";
  el.style.backgroundColor = "rgba(124, 99, 255, 0.12)";
  el.style.boxShadow = "0 0 12px rgba(123, 99, 255, 0.35)";
}

function clearHighlight(el) {
  if (!el) return;
  el.style.outline = "";
  el.style.outlineOffset = "";
  el.style.backgroundColor = "";
  el.style.boxShadow = "";
}

// "Locked" style when user has clicked to select a leg
function highlightLocked(el) {
  if (!el) return;
  el.style.outline = "3px solid rgba(80, 200, 120, 0.95)";
  el.style.outlineOffset = "2px";
  el.style.backgroundColor = "rgba(80, 200, 120, 0.15)";
  el.style.boxShadow = "0 0 16px rgba(80, 200, 120, 0.5)";
}

function looksLikeLeg(el) {
  if (!el) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 180 || rect.height < 24) return false;
  if (rect.height > 320) return false; // avoid huge wrappers

  const raw = el.innerText || "";
  const t = raw.toLowerCase();
  if (!t || t.length < 18) return false;

  // Signals that appear in individual leg cards
  const hasPlayerish =
    /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/.test(raw) || // "Jalen Duren"
    t.includes("nba") || t.includes("mlb") || t.includes("nfl") || t.includes("nhl");

  const hasOU = t.includes("over") || t.includes("under");
  const hasLine = /\b\d+(\.\d+)?\b/.test(raw);          // 1.5 etc
  const hasOdds = /[+-]\d{2,4}\b/.test(raw) || /\b\d+\.\d{1,2}\b/.test(raw); // -245 or 1.73

  // require both a player/match signal AND some numeric/odds structure
  const hasCoreSignals = (hasPlayerish || t.includes("vs") || t.includes("v ")) && (hasOU || hasLine || hasOdds);
  if (!hasCoreSignals) return false;

  return true;
}

// Returns true if element looks like a full horizontal prop row (the whole box)
function looksLikeFullRow(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  // Full row: wide (spans multiple columns), single row height
  if (rect.width < 300) return false;
  if (rect.height < 40 || rect.height > 180) return false;
  const raw = el.innerText || "";
  const t = raw.toLowerCase();
  if (!t || t.length < 25) return false;
  const hasPlayer = /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/.test(raw);
  const hasOdds = /[+-]\d{2,4}\b/.test(raw) || /\b\d+\.\d{1,2}\b/.test(raw);
  const hasOU = t.includes("over") || t.includes("under");
  return hasPlayer && (hasOdds || hasOU);
}

// Stricter: only highlight actual prop rows on hover, not buttons/cards/generic rectangles
function looksLikeHoverableLeg(el) {
  if (!el || !looksLikeLeg(el)) return false;
  const raw = (el.innerText || "").trim();
  if (raw.length < 35) return false;
  // Must have clear player prop structure: player name + over/under+line + odds
  const hasPlayer = /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/.test(raw);
  const hasOU = /\b(over|under)\s+\d/.test(raw.toLowerCase());
  const hasOdds = /[+-]\d{2,4}\b/.test(raw);
  // Reject common non-leg elements
  if (/\b(bet|add|view|more|less|done|cancel|submit)\b/i.test(raw) && !hasOU) return false;
  return hasPlayer && hasOU && hasOdds;
}

// For hover: return only the innermost leg (single row), strict so we don't outline random rectangles
function pickInnermostLeg(startEl) {
  if (!startEl) return null;
  const rowish = startEl.closest("tr, [role='row'], [role='listitem'], li");
  if (rowish && looksLikeHoverableLeg(rowish)) return rowish;
  let el = startEl;
  for (let i = 0; i < 16 && el; i++) {
    if (looksLikeHoverableLeg(el)) return el;
    el = el.parentElement;
  }
  return null;
}

// Prefer the full row box, not inner rectangles (buttons, text spans)
function pickLegContainer(startEl) {
  if (!startEl) return null;

  // Prefer table row semantics when present.
  const rowish = startEl.closest("tr, [role='row'], [role='listitem'], li");
  if (rowish && looksLikeLeg(rowish)) return rowish;

  // Find innermost leg-like element first
  let el = startEl;
  let inner = null;
  for (let i = 0; i < 16 && el; i++) {
    if (looksLikeLeg(el)) {
      inner = el;
      break;
    }
    el = el.parentElement;
  }
  if (!inner) return null;

  // Climb to outermost container that wraps the full row (whole box)
  el = inner;
  let best = inner;
  for (let i = 0; i < 12 && el; i++) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 300 && looksLikeFullRow(el)) best = el;
    if (el === document.body) break;
    el = el.parentElement;
  }
  return best;
}

// ---------- selection / overlay helpers ----------
const CHECKBOX_OVERLAY_ID = "__puff_checkbox_overlay";

let cachedLegs = [];
let storedSelector = null;
let storedCaptureMode = "area"; // "area" or "whole"
let singleLegSelection = false; // true when user clicked a leg directly (capture 1), false when used crop window (capture all in area)

function getCssPath(el) {
  if (!el || el.nodeType !== 1) return null;
  const parts = [];
  while (el && el.nodeType === 1 && el !== document.body) {
    let part = el.nodeName.toLowerCase();
    if (el.id) {
      part += `#${el.id}`;
      parts.unshift(part);
      break;
    }
    const siblings = Array.from(el.parentNode?.children || []).filter(
      (s) => s.nodeName === el.nodeName
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

function saveStoredSelection(selector) {
  storedSelector = selector;
  chrome.storage.local.set({ puff_selectedRootSelector: selector });
}

function saveCaptureMode(mode) {
  storedCaptureMode = mode;
  chrome.storage.local.set({ puff_captureMode: mode });
}

function saveSingleLegSelection(flag) {
  singleLegSelection = !!flag;
  chrome.storage.local.set({ puff_singleLegSelection: singleLegSelection });
}

function saveCachedLegs(legs) {
  cachedLegs = legs || [];
  chrome.storage.local.set({ puff_cachedLegs: cachedLegs, puff_cachedAt: Date.now() });
}

// Deduplicate normalized legs by (player/participant, market, line, odds, book)
function deduplicateNormalizedLegs(legs) {
  const seen = new Set();
  const out = [];
  for (const l of legs || []) {
    const player = (l.player || l.participant || "").trim().toLowerCase();
    const market = (l.market || "").trim().toLowerCase();
    const line = l.line != null ? String(l.line) : "";
    const book = (l.book || "").trim().toLowerCase();
    const odds = l.odds_american != null ? String(l.odds_american) :
                 l.odds != null ? String(l.odds) : "";
    const key = [player, market, line, odds, book].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** Whole-page capture: collapse duplicates that share participant + odds + sportsbook. */
function dedupeLegsByParticipantOddsBook(legs) {
  const seen = new Set();
  const out = [];
  for (const l of legs || []) {
    const p = (l.participant || "").trim().toLowerCase();
    const o =
      l.odds != null
        ? String(l.odds)
        : l.odds_american != null
          ? String(l.odds_american)
          : "";
    const b = (l.book || "").trim().toLowerCase();
    if (!p) continue;
    const key = `${p}|${o}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function puffSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scrollable ancestor of OddsJam list rows, or main document scroller. */
function getPrimaryScrollContainerForVirtualList() {
  function overflowScrollParent(fromEl) {
    if (!fromEl) return null;
    let el = fromEl.parentElement;
    for (let i = 0; i < 28 && el; i++) {
      const st = window.getComputedStyle(el);
      const oy = st.overflowY || st.overflow || "";
      if (/scroll|auto|overlay/.test(oy) && el.scrollHeight > el.clientHeight + 6) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // Narrow layout: list rows in li.my-2.rounded-md
  let inner = overflowScrollParent(document.querySelector("li.my-2.rounded-md"));
  if (inner) return inner;

  // Full-width layout: same data in div.tour__bet_row (no li wrapper)
  inner = overflowScrollParent(document.querySelector("div.tour__bet_row"));
  if (inner) return inner;

  const main = document.querySelector("main, [role='main']");
  if (main) {
    const st = window.getComputedStyle(main);
    const oy = st.overflowY || st.overflow || "";
    if (/scroll|auto|overlay/.test(oy) && main.scrollHeight > main.clientHeight + 6) return main;
  }

  // Last resort: scroll the document (html + body — some layouts attach overflow to one or the other)
  return document.scrollingElement || document.documentElement;
}

/**
 * Scroll window + inner virtual list from top to bottom so OddsJam mounts all rows.
 * Returns saved scroll positions — pass to restoreScrollPositionsAfterCapture().
 */
async function scrollVirtualListToRevealAllRows() {
  const docEl = document.scrollingElement || document.documentElement;
  const saved = {
    winX: window.scrollX,
    winY: window.scrollY,
    docTop: docEl.scrollTop,
    docLeft: docEl.scrollLeft
  };

  let scrollEl = getPrimaryScrollContainerForVirtualList();
  const innerTop = scrollEl.scrollTop;
  const innerLeft = scrollEl.scrollLeft;

  window.scrollTo(0, 0);
  docEl.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
  scrollEl.scrollTop = 0;
  await puffSleep(100);

  let lastMarker = -1;
  for (let round = 0; round < 25; round++) {
    const sameAsDoc = scrollEl === docEl || scrollEl === document.body;
    if (!sameAsDoc) {
      const maxInner = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const stepI = Math.max(Math.floor(scrollEl.clientHeight * 0.62), 260);
      for (let y = 0; y <= maxInner + stepI; y += stepI) {
        scrollEl.scrollTop = Math.min(y, maxInner);
        await puffSleep(150);
      }
      scrollEl.scrollTop = maxInner;
      await puffSleep(150);
    }

    const maxDoc = Math.max(0, docEl.scrollHeight - window.innerHeight);
    const stepD = Math.max(Math.floor(window.innerHeight * 0.62), 260);
    for (let y = 0; y <= maxDoc + stepD; y += stepD) {
      const yClamped = Math.min(y, maxDoc);
      docEl.scrollTop = yClamped;
      if (document.body && docEl === document.documentElement) document.body.scrollTop = yClamped;
      await puffSleep(150);
    }
    docEl.scrollTop = maxDoc;
    if (document.body && docEl === document.documentElement) document.body.scrollTop = maxDoc;
    await puffSleep(150);

    scrollEl = getPrimaryScrollContainerForVirtualList();
    const nLi = document.querySelectorAll("li.my-2.rounded-md").length;
    const nTour = document.querySelectorAll("div.tour__bet_row").length;
    const n = Math.max(nLi, nTour);
    const marker = docEl.scrollHeight + scrollEl.scrollHeight + n;
    if (marker === lastMarker && round > 0) break;
    lastMarker = marker;
  }

  await puffSleep(500);

  return {
    docEl,
    scrollEl,
    innerTop,
    innerLeft,
    winX: saved.winX,
    winY: saved.winY,
    docTop: saved.docTop,
    docLeft: saved.docLeft
  };
}

function restoreScrollPositionsAfterCapture(pos) {
  if (!pos) return;
  const docEl = document.scrollingElement || document.documentElement;
  window.scrollTo(pos.winX ?? 0, pos.winY ?? 0);
  docEl.scrollTop = pos.docTop ?? 0;
  docEl.scrollLeft = pos.docLeft ?? 0;
  if (pos.scrollEl && pos.scrollEl.isConnected) {
    pos.scrollEl.scrollTop = pos.innerTop ?? 0;
    pos.scrollEl.scrollLeft = pos.innerLeft ?? 0;
  }
}

function loadStoredSelection() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      "puff_selectedRootSelector",
      "puff_captureMode",
      "puff_singleLegSelection",
    ], (res) => {
      storedSelector = res.puff_selectedRootSelector || null;
      storedCaptureMode = res.puff_captureMode || "area";
      singleLegSelection = !!res.puff_singleLegSelection;
      // Never restore cachedLegs from storage - always do fresh scan on page load
      // so we never show props that disappeared after reload
      cachedLegs = [];

      if (storedSelector) {
        const el = document.querySelector(storedSelector);
        if (el) {
          selectedRoot = el;
          highlight(selectedRoot);
        } else {
          storedSelector = null;
          chrome.storage.local.remove("puff_selectedRootSelector");
        }
      }

      resolve();
    });
  });
}


function destroyCheckboxOverlay() {
  const overlay = document.getElementById(CHECKBOX_OVERLAY_ID);
  if (!overlay) return;
  // Unwrap legs: restore original DOM structure
  const items = overlay._puffItems || [];
  items.forEach(({ wrapper, candidate }) => {
    if (!wrapper?.parentNode || !candidate?.el) return;
    const legEl = candidate.el;
    // For tr: wrapper is the td we inserted as first cell - just remove it
    if (legEl.tagName === "TR" && wrapper.parentNode === legEl) {
      wrapper.remove();
      return;
    }
    // For div wrap: move leg back to parent, remove wrapper
    if (legEl.parentNode === wrapper) {
      wrapper.parentNode.insertBefore(legEl, wrapper);
      wrapper.remove();
    }
  });
  if (overlay._puffObserver) overlay._puffObserver.disconnect();
  if (overlay._puffScrollCleanup) overlay._puffScrollCleanup();
  if (overlay._toolEl?.parentNode) overlay._toolEl.remove();
  overlay.remove();
}

// Deduplicate: keep only one candidate per leg (prefer outermost element, drop nested + overlapping duplicates)
function deduplicateLegCandidates(candidates) {
  let out = candidates.filter((c) => {
    // Skip if this element is contained inside another candidate's element
    for (const other of candidates) {
      if (other === c) continue;
      if (other.el.contains(c.el) && other.el !== c.el) return false;
    }
    return true;
  });
  // Also drop overlapping siblings (same row - keep the widest one)
  out = out.filter((c) => {
    const r = c.el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const cw = r.width;
    for (const other of out) {
      if (other === c) continue;
      const or = other.el.getBoundingClientRect();
      const ocy = or.top + or.height / 2;
      if (Math.abs(cy - ocy) < 25 && rectsIntersect(r, or)) {
        if (or.width > cw) return false; // other is wider, keep other
      }
    }
    return true;
  });
  return out;
}

function createCheckboxOverlay() {
  destroyCheckboxOverlay();

  const host = (typeof location !== "undefined" && location.host) || "";
  let candidates = (() => {
    for (const adapter of (typeof siteAdapters !== "undefined" ? siteAdapters : [])) {
      if (adapter.hostRegex && adapter.hostRegex.test(host)) {
        return adapter.extractor(document);
      }
    }
    // Use 500 limit for generic sites (OddsJam, etc.) with long lists so all visible rows get checkboxes
    return extractGenericCandidates(document, 500);
  })();
  candidates = deduplicateLegCandidates(candidates);

  // Use a lightweight overlay only for the toolbar; checkboxes are injected into the page
  // so they scroll with the content (fixes disappearing when scrolling inside scrollable divs)
  const overlay = document.createElement("div");
  overlay.id = CHECKBOX_OVERLAY_ID;
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  document.body.appendChild(overlay);

  const boxSize = 32;
  const items = [];

  function addCheckboxToLeg(legEl, c) {
    const parent = legEl.parentElement;
    if (!parent) return;
    const tag = (legEl.tagName || "").toUpperCase();
    const isTr = tag === "TR";

    if (isTr) {
      const td = document.createElement("td");
      td.dataset.puffCheckboxCell = "1";
      td.style.cssText = "vertical-align:middle;padding-right:8px;width:" + (boxSize + 8) + "px;";
      const box = document.createElement("div");
      box.style.cssText = "width:" + boxSize + "px;height:" + boxSize + "px;display:flex;align-items:center;justify-content:center;border:2px solid rgba(124,99,255,.9);border-radius:6px;background:rgba(20,27,40,.95);box-sizing:border-box;cursor:pointer;";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = false;
      input.style.cssText = "margin:0;width:18px;height:18px;accent-color:rgb(124,99,255);pointer-events:none;";
      box.appendChild(input);
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        input.checked = !input.checked;
      });
      td.appendChild(box);
      legEl.insertBefore(td, legEl.firstChild);
      items.push({ box, wrapper: td, candidate: c });
    } else {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative;display:flex;align-items:center;width:100%;";
      wrapper.dataset.puffCheckboxWrapper = "1";
      const box = document.createElement("div");
      box.style.cssText = "width:" + boxSize + "px;height:" + boxSize + "px;flex-shrink:0;margin-right:8px;pointer-events:auto;cursor:pointer;border:2px solid rgba(124,99,255,.9);border-radius:6px;background:rgba(20,27,40,.95);display:flex;align-items:center;justify-content:center;box-sizing:border-box;z-index:2147483645;";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = false;
      input.style.cssText = "margin:0;width:18px;height:18px;accent-color:rgb(124,99,255);pointer-events:none;";
      box.appendChild(input);
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        input.checked = !input.checked;
      });
      parent.insertBefore(wrapper, legEl);
      wrapper.appendChild(box);
      wrapper.appendChild(legEl);
      items.push({ box, wrapper, candidate: c });
    }
  }

  function rowHasCheckbox(row) {
    if (!row || row.nodeType !== 1) return false;
    if (row.tagName === "TR") return row.querySelector("[data-puff-checkbox-cell]") != null;
    return row.closest("[data-puff-checkbox-wrapper]") != null;
  }

  function resyncCheckboxes() {
    // OddsJam: same merge as initial overlay (tour__bet_row + li layout + generic) — no viewport branching
    const freshCandidates = /oddsjam\.com/i.test(host)
      ? mergeOddsJamCheckboxCandidates(document)
      : extractGenericCandidates(document, 500);
    const deduped = deduplicateLegCandidates(freshCandidates);
    for (const c of deduped) {
      if (rowHasCheckbox(c.el)) continue;
      addCheckboxToLeg(c.el, c);
    }
  }

  candidates.forEach((c) => addCheckboxToLeg(c.el, c));

  // Initial delayed resync: OddsJam etc. may render rows after overlay creation
  setTimeout(resyncCheckboxes, 300);

  // Scroll-triggered resync: virtual scrolling removes old rows and adds new ones—add checkboxes on scroll
  let scrollRaf = null;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      // Small delay so virtual scrollers have time to add new rows to DOM
      setTimeout(resyncCheckboxes, 50);
    });
  };
  const scrollTargets = new Set([window, document.documentElement, document.body]);
  candidates.forEach((c) => {
    let el = c.el.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      const oy = s.overflowY || s.overflow || "";
      if (/scroll|auto|overlay/.test(oy) && el.scrollHeight > el.clientHeight) {
        scrollTargets.add(el);
        break;
      }
      el = el.parentElement;
    }
  });
  // Fallback: find scroll parents of tables/grids (OddsJam etc. use virtual tables in scroll containers)
  try {
    const tables = document.querySelectorAll("table, [role='grid'], [role='table']");
    for (const t of tables) {
      let el = t.parentElement;
      for (let i = 0; i < 8 && el && el !== document.body; i++) {
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow || "";
        if (/scroll|auto|overlay/.test(oy) && el.scrollHeight > el.clientHeight) {
          scrollTargets.add(el);
          break;
        }
        el = el.parentElement;
      }
    }
  } catch (_) {}
  scrollTargets.forEach((t) => t.addEventListener("scroll", onScroll, { passive: true }));
  const removeScrollListeners = () => scrollTargets.forEach((t) => t.removeEventListener("scroll", onScroll));

  // Periodic resync fallback (handles transform-based scroll, missed events, etc.)
  const resyncInterval = setInterval(resyncCheckboxes, 600);

  // Watch for virtual scrolling: new rows added to DOM get checkboxes too
  const seenEls = new WeakSet();
  candidates.forEach((c) => seenEls.add(c.el));
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const isRow = n.tagName === "TR" || n.getAttribute?.("role") === "row";
        const isOjRow = n.matches?.("div.tour__bet_row");
        const rows = isRow
          ? [n]
          : isOjRow
            ? [n]
            : Array.from(n.querySelectorAll?.("tr, [role='row'], div.tour__bet_row") || []);
        for (const row of rows) {
          if (seenEls.has(row)) continue;
          if (!looksLikeLeg(row)) continue;
          const t = textOf(row);
          if (!t || t.length < 18 || rowScore(t) < 3) continue;
          const dupe = items.some((i) => i.candidate.el === row || (i.candidate.t && row.innerText && i.candidate.t.slice(0, 80) === t.slice(0, 80)));
          if (dupe) continue;
          seenEls.add(row);
          addCheckboxToLeg(row, { el: row, t, score: rowScore(t) });
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  overlay._puffObserver = observer;

  // OddsJam and similar sites may render rows after overlay—run resync once after short delay
  setTimeout(resyncCheckboxes, 300);

  const tool = document.createElement("div");
  tool.style.cssText =
    "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:min(96vw,520px);padding:10px 14px;border-radius:8px;background:rgba(20,27,40,.96);color:#fff;font-size:13px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;z-index:2147483647;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.4);box-sizing:border-box;overflow:visible;";
  const info = document.createElement("span");
  info.style.cssText =
    "flex:1 1 200px;min-width:0;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;line-height:1.4;";
  info.textContent =
    candidates.length === 0
      ? "No legs found on this page."
      : "Check the legs you want, then click Done on the page.";
  tool.appendChild(info);
  const doneBtn = document.createElement("button");
  doneBtn.textContent = "Done";
  doneBtn.style.cssText = "padding:6px 14px;background:rgba(124,99,255,.9);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding:6px 14px;background:rgba(60,70,90,.9);color:#fff;border:none;border-radius:6px;cursor:pointer;";

  doneBtn.addEventListener("click", () => {
    const checked = items.filter(({ box }) => box.querySelector("input")?.checked).map((i) => i.candidate);
    const headerBookMap = buildHeaderBookMap(document);
    resetPuffExtractLegDebugCount();
    const legs = checked.map((c) => toRawLeg(c, headerBookMap)).filter((l) => isRawLegValidForBackend(l));
    saveCachedLegs(legs);
    saveCaptureMode("area");
    singleLegSelection = false;
    saveStoredSelection(null);
    destroyCheckboxOverlay();
    selecting = false;
      chrome.runtime.sendMessage({ type: "AREA_SELECTED" });
  });

  cancelBtn.addEventListener("click", () => {
    destroyCheckboxOverlay();
    selecting = false;
  });

  tool.appendChild(doneBtn);
  tool.appendChild(cancelBtn);
  document.body.appendChild(tool);
  overlay._toolEl = tool;
  overlay._puffItems = items;
  overlay._puffScrollCleanup = () => {
    clearInterval(resyncInterval);
    removeScrollListeners();
    // Unwrap legs: restore original DOM structure
    items.forEach(({ wrapper, candidate }) => {
      const legEl = candidate.el;
      if (wrapper.parentNode && legEl.parentNode === wrapper) {
        wrapper.parentNode.insertBefore(legEl, wrapper);
        wrapper.remove();
      }
    });
    if (overlay._toolEl?.parentNode) overlay._toolEl.remove();
  };

  return overlay;
}

let overlayState = null;

function stopSelectionMode() {
  selecting = false;
  if (overlayState?.selectedCandidate) clearHighlight(overlayState.selectedCandidate);
  if (overlayState?.cleanup) overlayState.cleanup();
  overlayState = null;
  if (lastHoverEl && lastHoverEl !== selectedRoot) clearHighlight(lastHoverEl);
  lastHoverEl = null;
  destroyCheckboxOverlay();
}

function setSelectedRootElement(el) {
  if (!el) return;

  clearHighlight(selectedRoot);
  selectedRoot = el;
  highlight(selectedRoot);

  const selector = getCssPath(el);
  if (selector) {
    saveStoredSelection(selector);
    saveCaptureMode("area");
  }
}

function startSelectionMode() {
  if (selecting) return;
  selecting = true;
  singleLegSelection = false;
  createCheckboxOverlay();
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function refreshCachedLegs() {
  try {
    resetPuffExtractLegDebugCount();
    let candidates;
    if (singleLegSelection && selectedRoot) {
      candidates = extractSingleLeg(selectedRoot);
    } else {
      candidates = extractCandidates();
    }
    const headerBookMap = buildHeaderBookMap(selectedRoot || document);
    const legs = candidates
      .map((c) => toRawLeg(c, headerBookMap, null))
      .filter((l) => isRawLegValidForBackend(l));
    saveCachedLegs(deduplicateNormalizedLegs(legs));
  } catch (e) {
    console.warn("[PUFF] refreshCachedLegs failed", e);
  }
}

// kick off page-sync on load - always re-scan to match current page state
loadStoredSelection().then(() => {
  // If we were previously in whole-page mode, clear the selection.
  if (storedCaptureMode === "whole") selectedRoot = null;

  // Short delay for DOM to stabilize, then fresh scan (removes disappeared props)
  setTimeout(refreshCachedLegs, 3000);
});

// ---------- extraction logic ----------
function rowScore(t) {
  let score = 0;
  if (parseOdds(t)) score += 3;
  if (looksLikeMarket(t)) score += 2;
  if (looksLikeBook(t)) score += 2;
  if (findEvPct(t) !== null) score += 1;
  if (t.toLowerCase().includes("over") || t.toLowerCase().includes("under")) score += 1;
  return score;
}

// high‑level extractor that chooses a strategy based on hostname
function extractCandidates() {
  const host = location.host || "";

  for (const adapter of siteAdapters) {
    if (adapter.hostRegex.test(host)) {
      console.log("[PUFF] using adapter for", adapter.name, "on", host);
      return adapter.extractor(selectedRoot || document);
    }
  }

  // fallback
  return extractGenericCandidates(selectedRoot || document);
}

// adapters registry -- add new entries for each site as needed
const siteAdapters = [
  {
    name: "DailyGrind",
    hostRegex: /dailygrind\.com/i,
    extractor: extractDailyGrindCandidates,
  },
  {
    name: "OddsJam",
    hostRegex: /oddsjam\.com/i,
    extractor: mergeOddsJamCheckboxCandidates,
  },
  // other adapters can be inserted here
];

// generic extraction logic (moved out of extractCandidates)
// limit: max candidates to return (default 50); use higher value (e.g. 500) for checkbox resync on long lists
function extractGenericCandidates(root, limit = 50) {
  const els = [
    // Include root itself if it's a single leg (e.g. when user double-clicked one row)
    ...(root !== document && looksLikeLeg(root) ? [root] : []),
    ...root.querySelectorAll("tr"),
    ...root.querySelectorAll("[role='row']"),
    ...Array.from(root.querySelectorAll("div")).filter((el) => {
      const rect = el.getBoundingClientRect();

      // Reject huge containers (table wrappers)
      if (rect.height > 180) return false;

      // Reject very small junk (relaxed width for single prop rows)
      if (rect.height < 28 || rect.width < 200) return false;

      // Must look like a leg
      return looksLikeLeg(el);
    }),
  ];

  const candidates = [];

  for (const el of els) {
    const t = textOf(el);
    if (!t || t.length < 18) continue;

    const score = rowScore(t);
    if (score < 3) continue;

    candidates.push({ el, t, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const picked = [];
  for (const c of candidates) {
    // Use fuller key (player + line + side) to avoid collapsing distinct legs that share prefix
    const key = c.t.slice(0, 220).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

// When user double-clicked one leg: extract ONLY that element, not its children
function extractSingleLeg(root) {
  if (!root || !looksLikeLeg(root)) return [];
  const t = textOf(root);
  if (!t || t.length < 18) return [];
  return [{ el: root, t, score: 99 }];
}

// example adapter for DailyGrind (just uses generic logic for now but could
// be tweaked to rely on site-specific selectors or filters.)
function extractDailyGrindCandidates(root) {
  console.log("[PUFF] extractDailyGrindCandidates called");
  return extractGenericCandidates(root);
}

// Adapter for OddsJam +EV optimizer: narrow layout wraps rows in list items; full-width uses
// div.tour__bet_row directly. Always collect both — do not branch on viewport width.
function extractOddsJamCandidates(root) {
  console.log("[PUFF] extractOddsJamCandidates called");
  const rootEl = root && root.nodeType === 1 ? root : document;
  const byEl = new Map();

  function addRow(el) {
    if (!el || el.nodeType !== 1) return;
    const t = textOf(el);
    if (!t || t.length < 18) return;
    if (!byEl.has(el)) byEl.set(el, { el, t, score: 100 });
  }

  // Narrow / stacked: each slip often in li.my-2.rounded-md → div.tour__bet_row
  rootEl.querySelectorAll("li.my-2.rounded-md").forEach((li) => {
    const row = li.querySelector("div.tour__bet_row");
    addRow(row || li);
  });

  // Alternate list wrappers (class variants without exact my-2)
  rootEl.querySelectorAll('li[class*="rounded-md"]').forEach((li) => {
    const row = li.querySelector("div.tour__bet_row");
    if (row) addRow(row);
  });

  // Full-width / desktop: rows may not live under li.my-2 — main row is div.tour__bet_row
  rootEl.querySelectorAll("div.tour__bet_row").forEach((row) => {
    addRow(row);
  });

  // Full width compact table: rows are div.relative.z-10 with draggable=false containing event-cell
  rootEl.querySelectorAll('div[draggable="false"]').forEach((el) => {
    if (el.querySelector('[data-testid="event-cell"]')) {
      addRow(el);
    }
  });

  return Array.from(byEl.values());
}

// OddsJam: merge site-specific rows with generic heuristics so both layouts and virtual scroll work.
function mergeOddsJamCheckboxCandidates(root) {
  const r = root || document;
  const oj = extractOddsJamCandidates(r);
  const gen = extractGenericCandidates(r, 500);
  return deduplicateLegCandidates([...oj, ...gen]);
}

function toRawLeg(c, headerBookMap, columnIndices) {
  const rowEl = c.el;
  // OddsJam +EV optimizer: explicit DOM (tour__bet_row / books-cell / event-cell), no column guessing.
  const ojRow = resolveOddsJamBetRow(rowEl);
  if (ojRow) {
    try {
      const leg = toRawLegFromOddsJam(ojRow);
      if (leg) return leg;
    } catch (e) {
      console.log("[PUFF] toRawLegFromOddsJam failed, falling back to generic", e);
    }
  }

  const t = c.t;
  const rowCells = rowEl ? Array.from(rowEl.querySelectorAll("td,[role='cell'],div")) : [];

  let ev = null;
  let marketNorm = "Prop";
  let book = null;
  let hitProb = null;
  let stake_amount = null;
  let participant = null;
  let oddsFound = null;
  const { side, line } = parseMarketSideLine(t);

  if (columnIndices && rowCells.length > 0) {
    if (columnIndices.evCol != null && rowCells[columnIndices.evCol]) {
      const evText = textOf(rowCells[columnIndices.evCol]);
      const evMatch = evText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
      if (evMatch) ev = parseFloat(evMatch[1]);
    }
    if (columnIndices.marketCol != null && rowCells[columnIndices.marketCol]) {
      const marketText = textOf(rowCells[columnIndices.marketCol]).trim();
      if (marketText && marketText.length < 80) marketNorm = marketText;
    }
    if (columnIndices.booksCol != null && rowCells[columnIndices.booksCol]) {
      const booksCell = rowCells[columnIndices.booksCol];
      book = getBookFromBooksCell(booksCell);
      const booksText = textOf(booksCell);
      oddsFound = parseOdds(booksText);
    }
    if (columnIndices.probabilityCol != null && rowCells[columnIndices.probabilityCol]) {
      const probText = textOf(rowCells[columnIndices.probabilityCol]);
      const probMatch = probText.match(/(\d{1,3}(?:\.\d{1,2})?)\s*%/);
      if (probMatch) {
        const v = parseFloat(probMatch[1]);
        if (v >= 25 && v <= 99) hitProb = v;
      }
    }
    if (columnIndices.betSizeCol != null && rowCells[columnIndices.betSizeCol]) {
      const sizeText = textOf(rowCells[columnIndices.betSizeCol]);
      const sizeMatch = sizeText.match(/\$\s*(\d+(?:\.\d{2})?)/);
      if (sizeMatch) stake_amount = parseFloat(sizeMatch[1]);
    }
    if (columnIndices.eventCol != null && rowCells[columnIndices.eventCol]) {
      const eventText = textOf(rowCells[columnIndices.eventCol]);
      participant = extractMatchupFromEvent(eventText) || eventText.replace(/\bToday at \d{1,2}:\d{2}\s*(?:AM|PM)\s*/i, "").trim().slice(0, 80);
    }
  }

  if (ev == null) ev = findEvPct(t) ?? findEvPctFromSmallPercent(t);
  if (ev == null) {
    const participantRaw = pickParticipant(t) || "";
    const m = participantRaw.match(/^(\d{1,2}(\.\d{1,2})?)\s*%/);
    if (m) { const v = parseFloat(m[1]); if (v >= 0.2 && v <= 15) ev = v; }
  }
  if (!book) book = inferBookFromRow(rowEl, headerBookMap, columnIndices?.booksCol) || looksLikeBook(t);
  if (book === "Unknown" || !book) book = "Unknown Book";
  if (!marketNorm || marketNorm === "Unknown") {
    const parsed = parseMarketSideLine(t);
    marketNorm = parsed.market === "moneyline" ? "Moneyline" : (parsed.market || "Prop");
  }
  if (hitProb == null) hitProb = findHitProbFromRowEl(rowEl) ?? findHitProbPct(t);
  if (stake_amount == null) stake_amount = findStakeAmount(t);
  if (!oddsFound) oddsFound = parseOdds(t);
  if (!participant) participant = extractShortParticipant(t, { market: marketNorm, side, line }) || pickParticipant(t);
  if (!participant || participant === "Unknown") participant = deriveParticipantFromRow(t, { market: marketNorm, side, line }, rowEl);
  if (participant && participant.length > 80) participant = participant.slice(0, 80) + "…";
  if (!participant || !String(participant).trim()) participant = "Unknown participant";

  const league = detectLeagueFromRow(t);
  const market_type = [league, marketNorm].filter(Boolean).join(" ") || marketNorm;

  const evFin = ev != null && Number.isFinite(Number(ev)) ? Number(ev) : 0;
  const hitFin = hitProb != null && Number.isFinite(Number(hitProb)) ? Number(hitProb) : 0;
  const lineFin = Number.isFinite(line) ? line : 0;
  const oddsNum =
    oddsFound && oddsFound.odds != null && Number.isFinite(Number(oddsFound.odds))
      ? Number(oddsFound.odds)
      : 0;

  const leg = {
    source: "extension",
    book,
    sport: league || null,
    league: league || null,
    market: marketNorm,
    market_type,
    participant,
    player: participant,
    prop: marketNorm,
    side,
    line: lineFin,
    odds: oddsNum,
    odds_format: oddsFound ? oddsFound.format : "american",
    ev: evFin,
    ev_pct: evFin,
    hit_prob: hitFin,
    hit_prob_pct: hitFin,
    stake_amount: stake_amount != null ? stake_amount : undefined,
    url: null,
    captured_at: new Date().toISOString()
  };

  logPuffExtractedLegIfDebug(leg);

  if (!isRawLegValidForBackend(leg)) {
    console.warn("[PUFF] generic leg failed validation", leg);
    return null;
  }
  return leg;
}

function extractMatchupFromEvent(eventText) {
  const s = String(eventText || "").replace(/\s+/g, " ").trim();
  const withoutDate = s.replace(/\bToday at \d{1,2}:\d{2}\s*(?:AM|PM)\s*\/?\s*/i, "").replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\s*/g, "").trim();
  const vsMatch = withoutDate.match(/(.+?)\s*\/\s*(.+?)(?:\s*\/|\s*$)/);
  if (vsMatch) return (vsMatch[1].trim() + " / " + vsMatch[2].trim()).slice(0, 80);
  const vs = withoutDate.match(/(.+?)\s+(?:vs\.?|v\s)\s+(.+?)(?=\s|$)/i);
  if (vs) return (vs[1].trim() + " " + vs[2].trim()).slice(0, 80);
  return withoutDate.slice(0, 80) || null;
}

/** Shared capture: map candidates → raw legs → dedupe. */
function captureLegsFromCandidates(candidates, root, opts) {
  resetPuffExtractLegDebugCount();
  const participantOddsBookDedupe = !!(opts && opts.participantOddsBookDedupe);
  const headerBookMap = buildHeaderBookMap(root);
  const firstRow = candidates[0]?.el;
  let headerRow = null;
  if (firstRow) {
    const table = firstRow.closest("table");
    const grid = firstRow.closest("[role='grid']");
    if (table) headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    else if (grid) headerRow = grid.querySelector("[role='row']");
    if (!headerRow && firstRow.parentElement) headerRow = firstRow.parentElement.querySelector("tr");
  }
  const columnIndices = headerRow ? getPlusEvColumnIndices(headerRow) : null;
  if (columnIndices) console.log("[PUFF] capture: columnIndices", columnIndices);

  const legsRaw = candidates
    .map((c) => toRawLeg(c, headerBookMap, columnIndices))
    .filter((l) => isRawLegValidForBackend(l));

  let legs = deduplicateNormalizedLegs(legsRaw);
  if (participantOddsBookDedupe) legs = dedupeLegsByParticipantOddsBook(legs);
  return legs;
}

/** Whole-page capture: current DOM only, no scroll (async for message handler API). */
async function __puff_handleCaptureWholePageAsync() {
  selectedRoot = null;
  singleLegSelection = false;
  saveStoredSelection(null);
  saveCaptureMode("whole");

  try {
    const candidates = extractCandidates();
    console.log("[PUFF] capture whole page: found", candidates.length, "rows");
    const legs = captureLegsFromCandidates(candidates, document, { participantOddsBookDedupe: true });
    saveCachedLegs(legs);
    return { ok: true, legs };
  } catch (e) {
    console.error("[PUFF] capture whole page exception", e);
    return { ok: false, error: String(e) };
  }
}

// ---------- common message handler (also exposed for executeScript fallback) ----------
function __puff_handleMessage(msg) {
  if (!msg || !msg.type) return { ok: false, error: "Invalid message" };

  if (msg.type === "SELECT_AREA") {
    try {
    startSelectionMode();
    return { ok: true };
    } catch (e) {
      console.error("[PUFF] SELECT_AREA failed", e);
      return { ok: false, error: String(e) };
    }
  }

  if (msg.type === "CAPTURE_WHOLE_PAGE") {
    return {
      ok: false,
      error: "CAPTURE_WHOLE_PAGE must be handled asynchronously via sendResponse (async listener).",
    };
  }

  if (msg.type === "CAPTURE_LEGS") {
    try {
      const candidates = singleLegSelection && selectedRoot
        ? extractSingleLeg(selectedRoot)
        : extractCandidates();
      console.log("[PUFF] capture: found", candidates.length, "rows", singleLegSelection ? "(single leg)" : "");
      const root = selectedRoot || document;
      const legs = captureLegsFromCandidates(candidates, root, { participantOddsBookDedupe: false });
      saveCachedLegs(legs);
      return { ok: true, legs };
    } catch (e) {
      console.error("[PUFF] capture exception", e);
      return { ok: false, error: String(e) };
    }
  }

  if (msg.type === "GET_LEGS") {
    console.log("[PUFF] GET_LEGS -> returning", cachedLegs.length, "legs");
    return { ok: true, legs: cachedLegs };
  }

  return { ok: false, error: "Unknown message type" };
}

// ---------- messaging ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_WHOLE_PAGE") {
    __puff_handleCaptureWholePageAsync()
      .then((resp) => sendResponse(resp))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  const resp = __puff_handleMessage(msg);
  if (sendResponse) sendResponse(resp);
  return true;
});

// Expose handler & readiness flag to the page context (for executeScript fallbacks).
window.__puff_handleMessage = __puff_handleMessage;
window.__puff_handleCaptureWholePageAsync = __puff_handleCaptureWholePageAsync;
window.__puff_contentScriptReady = true;
if (typeof globalThis !== "undefined") {
  globalThis.__puff_handleMessage = __puff_handleMessage;
  globalThis.__puff_handleCaptureWholePageAsync = __puff_handleCaptureWholePageAsync;
}
} catch (e) {
  __puff_loadError = "Load failed: " + String(e?.message || e);
  console.error("[PUFF] content script failed to load", e);
}
}
