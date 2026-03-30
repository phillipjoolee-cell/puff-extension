# Parlay Portfolio Extension – Project Spec

## 🎯 Vision

Build a Chrome extension + FastAPI backend that:
- Extracts betting legs from optimizer sites (DailyGrind, BetBurger, etc.)
- Normalizes markets, odds, hit probability, and EV
- Generates mathematically disciplined parlay portfolios
- Applies exposure caps and bankroll-based sizing
- Is optimizer-agnostic (works across platforms)

Goal: A disciplined, math-first slip portfolio generator that is convenient and monetizable.

---

## 🧩 System Architecture

### Extension (PUFF)
- **Capture flow:** Single "Select Area" button enters selection mode; user checks legs, clicks Done. Single "Capture" button captures the whole page (no crop overlay).
- DOM hover selection mode with checkboxes on optimizer rows
- Extract leg-level data (no giant wrapper blobs)
- Site adapters: OddsJam, DailyGrind, generic fallback (table rows, div-based grids)
- Scroll-aware resync: checkboxes stay visible when scrolling; 600ms periodic resync + scroll listeners
- Leg limit: 500 candidates for extraction
- Popup↔content messaging: early bootstrap stub; `executeScript` (ISOLATED world) preferred; try/catch surfaces real load errors
- Normalize:
  - participant
  - market
  - side
  - line
  - odds + format
  - hit_prob_pct
  - ev_pct
- Send structured legs to backend `/v1/parlays/suggest`

### Backend (FastAPI)
- Normalize odds (american/decimal)
- Deduplicate legs
- Portfolio generation engine
- Exposure enforcement:
  - max_player_exposure
  - max_game_exposure (future)
- Portfolio modes:
  - conservative
  - balanced
  - aggressive
- Optional bankroll-based unit sizing

---

## 🧮 Portfolio Engine Principles

1. Exposure caps are hard constraints.
2. No duplicate slips.
3. Reuse allowed within exposure limits.
4. Diversification preferred.
5. If hit_prob_pct exists → use as model probability.
6. If not → fallback to implied probability.
7. EV is treated as edge proxy, not probability.

---

## 📋 Recent Changes (Changelog)

### Extension Fixes (March 2025)

**1. Checkboxes disappearing on scroll (OddsJam)**
- Increased leg limit from 50 → 500 in `extractGenericCandidates`
- Added OddsJam-specific adapter in `siteAdapters`
- Scroll-based resync: listeners on `window`, `document.documentElement`, `document.body`, plus scroll containers for tables/grids
- 600ms periodic resync as fallback
- Resync uses `extractGenericCandidates` for `tr`, `[role='row']`, and div-based legs

**2. UI cleanup – capture flow simplified**
- **Removed** crop overlay (drag-to-select rectangle and related logic)
- **Consolidated** two capture buttons into one: single **Capture** button always captures the whole page (`CAPTURE_WHOLE_PAGE`)
- Flow: **Select Area** → check legs → **Capture** → generate portfolio

**3. Select Area / Capture messaging ("PUFF still loading")** ✅ Working
- Early bootstrap in `content.js`: `window.__puff_handleMessage` and `window.__puff_contentScriptReady` set at top so a handler is always present
- `sendMessageWithInject` prefers `chrome.scripting.executeScript` with `world: "ISOLATED"` before falling back to `chrome.tabs.sendMessage`
- Tab resolution adjusted for popup-open case (`lastFocusedWindow`, `currentWindow`)
- Try/catch around content script body to surface real load errors instead of generic "PUFF still loading"
- `ensureContentScript` injects content script via `executeScript` before messaging

---

## 🛠 Current Status

- Leg extraction stable on OddsJam and generic table layouts.
- Odds normalization implemented.
- Portfolio generator built.
- Exposure cap logic implemented.
- No-duplicate-slip rule being refined.
- Game exposure temporarily disabled (matchup parsing pending).
- Extension capture flow: Select Area → Capture (whole page) working reliably.

---

## 🔮 Future Improvements

- True game-level exposure (using extracted matchup field).
- Correlation control (no same-team overs, etc.).
- Weighted unit sizing.
- Portfolio diversity penalty scoring.
- Auto-relax constraints if portfolio impossible.
- UI settings for EV vs hit% prioritization.

---

## 💰 Monetization Idea

Offer:
- AI portfolio generator
- Exposure-managed slips
- Bankroll-based sizing
- Optimizer-agnostic support

Price undercut compared to optimizer add-ons.
Target: ~50 users for meaningful side income.
Added diversification penalty scoring layer