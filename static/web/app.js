/* ───────────────────────── Hisse Plus Terminal — SPA ───────────────────────── */
const USER_ID = 424232285;
const API = (path) => fetch(path, { headers: { "Accept": "application/json" } })
  .then(r => r.ok ? r.json() : Promise.reject({ status: r.status, text: r.statusText }));
const APIPOST = (path, body) => fetch(path, {
  method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(body || {}),
}).then(r => r.json());

/* ───────────── State ───────────── */
const state = {
  route: "dashboard",
  routeParam: null,
  symbols: [],            // tüm BIST sembol listesi
  watchlist: [],          // kullanıcı izlem listesi (varsayılan: ilk 30 + portföy)
  user: null,
  prices: {},             // sembol → {fiyat, degisim, ...}
  indices: [],            // BIST endeksleri
  marketSummary: null,
  lastFetch: 0,
  pollers: [],
  cache: { detail: {}, akd: {}, ohlcv: {}, technical: {}, takas: {} },
};
window._appState = state;  // global ref so inner closures can reach it past shadowing

/* ───────────── Utils ───────────── */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmtNum = (n, d=2) => {
  if (n == null || isNaN(n)) return "—";
  const v = Number(n);
  return v.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtPct = (n, d=2) => {
  if (n == null || isNaN(n)) return "—";
  const v = Number(n);
  return (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
};
const fmtCurr = (n, d=2) => n == null ? "—" : "₺" + fmtNum(n, d);
const fmtVol = (n) => {
  if (n == null) return "—";
  const v = Math.abs(Number(n));
  if (v >= 1e9) return (n/1e9).toFixed(2) + " mlr";
  if (v >= 1e6) return (n/1e6).toFixed(2) + " mln";
  if (v >= 1e3) return (n/1e3).toFixed(1) + " bin";
  return fmtNum(n, 0);
};
const colorClass = (n) => n > 0 ? "up" : n < 0 ? "down" : "flat";
const arrowFor   = (n) => n > 0 ? "▲" : n < 0 ? "▼" : "—";
const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function clearPollers() {
  state.pollers.forEach(t => clearInterval(t));
  state.pollers = [];
}
function addPoller(fn, ms) {
  fn();
  const id = setInterval(fn, ms);
  state.pollers.push(id);
}

function setConn(kind, txt) {
  const dot = $("#conn-dot"), tx = $("#conn-text");
  dot.classList.remove("ok", "warn", "err");
  if (kind === "ok") dot.classList.add("ok");
  if (kind === "warn") dot.classList.add("warn");
  if (kind === "err") dot.classList.add("err");
  tx.textContent = txt;
}

/* ───────────── Bootstrap ───────────── */
async function bootstrap() {
  setConn("warn", "yükleniyor…");
  try {
    const [sembolRes, userRes] = await Promise.all([
      API(`/api/v1/semboller?user_id=${USER_ID}`).catch(() => null),
      API(`/api/v1/kullanici?user_id=${USER_ID}`).catch(() => null),
    ]);
    if (sembolRes?.semboller) state.symbols = sembolRes.semboller;
    state.user = userRes;
    const u = userRes || {};
    const userTxt = u.is_premium ? "Premium • " + (u.abonelik?.plan || "premium") : "Standart";
    $("#user-line").textContent = userTxt;
    setConn("ok", "bağlı");
  } catch (e) {
    setConn("err", "bağlantı hatası");
  }
  // load saved watchlist or default
  try {
    const saved = JSON.parse(localStorage.getItem("hp.watchlist") || "[]");
    if (saved.length) state.watchlist = saved;
    else state.watchlist = state.symbols.slice(0, 12);
  } catch { state.watchlist = state.symbols.slice(0, 12); }

  // top-bar ticker (BIST endeksleri + 3 büyük hisse) — canlı: 8 sn
  refreshTicker();
  setInterval(refreshTicker, 8_000);

  // route from hash
  routeFromHash();
}

async function refreshTicker() {
  try {
    const ind = await API(`/api/v1/endeksler?user_id=${USER_ID}`);
    const list = (ind?.endeksler || []).slice(0, 5);
    const html = list.map(e => `
      <span class="tk">
        <b>${escapeHtml(e.label || e.code)}</b>
        <span>${fmtNum(e.value, 2)}</span>
        <span class="${colorClass(e.change)}">${fmtPct(e.change)}</span>
      </span>`).join("");
    $("#ticker-strip").innerHTML = html;
  } catch {/* ignore */}
}

/* ───────────── Routing ───────────── */
function routeFromHash() {
  const h = (location.hash || "#dashboard").slice(1);
  const [route, param, sub] = h.split("/");
  state.route = route || "dashboard";
  state.routeParam = param ? decodeURIComponent(param) : null;
  state.routeSub = sub ? decodeURIComponent(sub) : null;
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.route === state.route));
  clearPollers();
  render();
}
window.addEventListener("hashchange", routeFromHash);

function navTo(route, param, sub) {
  location.hash = "#" + route
    + (param ? "/" + encodeURIComponent(param) : "")
    + (sub ? "/" + encodeURIComponent(sub) : "");
}

function render() {
  const el = $("#content");
  el.scrollTop = 0;
  switch (state.route) {
    case "dashboard": return renderDashboard(el);
    case "watchlist": return renderWatchlist(el);
    case "markets":   return renderMarkets(el);
    case "screener":  return renderScreener(el);
    case "akd":         return renderAkd(el);
    case "kurumsal":    return renderKurumsal(el);
    case "takasanaliz": return renderTakasAnaliz(el);
    case "kappay":      return renderKapPay(el);
    case "alarms":      return renderAlarms(el);
    case "portfolio":   return renderPortfolio(el);
    case "compare":     return renderCompare(el);
    case "settings":    return renderSettings(el);
    case "symbol":      return renderSymbol(el, state.routeParam);
    default: el.innerHTML = `<div class="error-box">Bilinmeyen sayfa: ${escapeHtml(state.route)}</div>`;
  }
}

/* ───────────── DASHBOARD ───────────── */
async function renderDashboard(el) {
  el.innerHTML = `
    <div class="grid g-4" id="dash-kpis">
      ${[1,2,3,4].map(()=>`<div class="kpi"><div class="kpi-label">…</div><div class="kpi-val">—</div><div class="kpi-sub">—</div></div>`).join("")}
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel" id="dash-yuk">
        <div class="panel-head"><div class="panel-title">Yükselenler <span id="dash-yuk-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div></div>
        <div id="dash-yuk-body" class="loading" style="max-height:520px;overflow-y:auto">…</div>
      </div>
      <div class="panel" id="dash-dus">
        <div class="panel-head"><div class="panel-title">Düşenler <span id="dash-dus-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div></div>
        <div id="dash-dus-body" class="loading" style="max-height:520px;overflow-y:auto">…</div>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel" id="dash-hac">
        <div class="panel-head"><div class="panel-title">Hacim Liderleri <span id="dash-hac-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div></div>
        <div id="dash-hac-body" class="loading" style="max-height:400px;overflow-y:auto">…</div>
      </div>
      <div class="panel" id="dash-watch">
        <div class="panel-head">
          <div class="panel-title">İzlem Listem</div>
          <div class="panel-actions"><button class="btn" onclick="navTo('watchlist')">Tümü →</button></div>
        </div>
        <div id="dash-watch-body" class="loading">…</div>
      </div>
    </div>
  `;

  /* Phase 1: KPIs + Hacim + Watchlist (fast) */
  async function refresh() {
    try {
      const wlPre = (state.watchlist || []).slice(0, 8);
      const [piyasa, indices, fiyatRes] = await Promise.all([
        API(`/api/v1/piyasa_ozeti?user_id=${USER_ID}`),
        API(`/api/v1/endeksler?user_id=${USER_ID}`),
        wlPre.length
          ? API(`/api/v1/fiyatlar?semboller=${wlPre.join(",")}&user_id=${USER_ID}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      const dashKpis = $("#dash-kpis");
      if (!dashKpis) return;
      state.marketSummary = piyasa;
      state.indices = indices?.endeksler || [];

      const kpis = [];
      (state.indices || []).slice(0, 3).forEach(ix => {
        kpis.push({
          label: ix.label || ix.code,
          val: fmtNum(ix.value, 2),
          sub: `<span class="${colorClass(ix.change)} arrow">${arrowFor(ix.change)}</span><span class="${colorClass(ix.change)}">${fmtPct(ix.change)}</span>`,
        });
      });
      const upN = piyasa?.yukselen_sayi ?? (piyasa?.yukselenler || []).length;
      const dnN = piyasa?.dusen_sayi   ?? (piyasa?.dusenler   || []).length;
      const flat = piyasa?.degismez_sayi ?? null;
      const total = piyasa?.toplam_hisse ?? null;
      kpis.push({
        label: "Piyasa Geneli",
        val: `${upN}↑ / ${dnN}↓`,
        sub: flat != null
          ? `<span class="muted">${flat} değişmez${total ? ` · ${total} hisse` : ""}</span>`
          : `<span class="muted">yükselen · düşen</span>`,
      });
      dashKpis.innerHTML = kpis.map(k => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(k.label)}</div>
          <div class="kpi-val">${k.val}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>`).join("");

      const hac = piyasa?.hacim_liderleri || piyasa?.en_hacimli || piyasa?.hacim || [];
      const dHac = $("#dash-hac-body"), dHacCnt = $("#dash-hac-cnt");
      if (dHac) { dHac.classList.remove("loading"); dHac.innerHTML = renderMoverTable(hac, "vol", Infinity); }
      if (dHacCnt && hac.length) dHacCnt.textContent = `(${hac.length})`;

      const wbody = $("#dash-watch-body");
      if (wbody) {
        wbody.classList.remove("loading");
        if (wlPre.length) {
          wbody.innerHTML = renderPriceTable(wlPre, fiyatRes?.fiyatlar || {});
        } else {
          wbody.innerHTML = `<div class="muted">Henüz izlem listenize sembol eklemediniz.</div>`;
        }
      }
    } catch {/**/}
  }

  /* Phase 2: full movers (slower) */
  async function refreshMovers() {
    try {
      const movers = await API(`/api/v1/piyasa_movers?user_id=${USER_ID}`);
      const dYuk = $("#dash-yuk-body"), dDus = $("#dash-dus-body"), dHac = $("#dash-hac-body");
      const dYukCnt = $("#dash-yuk-cnt"), dDusCnt = $("#dash-dus-cnt"), dHacCnt = $("#dash-hac-cnt");
      if (!dYuk) return;
      const yuk = movers?.yukselenler   || [];
      const dus = movers?.dusenler      || [];
      const hac = movers?.hacim_liderleri || [];
      dYuk.classList.remove("loading"); dYuk.innerHTML = renderMoverTable(yuk, "up",   Infinity);
      dDus.classList.remove("loading"); dDus.innerHTML = renderMoverTable(dus, "down", Infinity);
      if (hac.length) { dHac.classList.remove("loading"); dHac.innerHTML = renderMoverTable(hac, "vol", Infinity); }
      if (dYukCnt) dYukCnt.textContent = yuk.length ? `(${yuk.length})` : "";
      if (dDusCnt) dDusCnt.textContent = dus.length ? `(${dus.length})` : "";
      if (dHacCnt) dHacCnt.textContent = hac.length ? `(${hac.length})` : "";
    } catch {/**/}
  }

  refresh();
  refreshMovers();
  addPoller(refresh, 30_000);
  addPoller(refreshMovers, 60_000);
}

function renderMoverTable(rows, kind, limit = 8) {
  if (!rows || !rows.length) return `<div class="muted">Veri yok.</div>`;
  const lim = limit === Infinity ? rows : rows.slice(0, limit);
  const head = kind === "vol"
    ? `<tr><th>Sembol</th><th class="num">Fiyat</th><th class="num">Hacim</th></tr>`
    : `<tr><th>Sembol</th><th class="num">Fiyat</th><th class="num">Değişim</th></tr>`;
  const body = lim.map(r => {
    const chg = r.degisim ?? r.change ?? 0;
    const last = r.fiyat ?? r.last ?? r.price ?? 0;
    const sym = r.sembol ?? r.symbol ?? r.code ?? "";
    const vol = r.hacim ?? r.hacim_tl ?? r.volume_tl ?? r.volume ?? null;
    return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(sym)}')">
      <td class="sym">${escapeHtml(sym)}</td>
      <td class="num">${fmtNum(last,2)}</td>
      <td class="num pct ${kind==="vol" ? "" : colorClass(chg)}">${
        kind === "vol" ? fmtVol(vol) : fmtPct(chg)
      }</td>
    </tr>`;
  }).join("");
  return `<table class="tbl">${head}${body}</table>`;
}

function renderPriceTable(symbols, fiyatlar) {
  if (!symbols.length) return `<div class="muted">Boş.</div>`;
  const head = `<tr><th>Sembol</th><th class="num">Fiyat</th><th class="num">Değişim</th><th class="num">Hacim</th></tr>`;
  const body = symbols.map(s => {
    const f = fiyatlar[s] || {};
    return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(s)}')">
      <td class="sym">${escapeHtml(s)}</td>
      <td class="num">${fmtNum(f.fiyat, 2)}</td>
      <td class="num pct ${colorClass(f.degisim)}">${fmtPct(f.degisim)}</td>
      <td class="num">${fmtVol(f.hacim)}</td>
    </tr>`;
  }).join("");
  return `<table class="tbl">${head}${body}</table>`;
}

/* ───────────── WATCHLIST ───────────── */
async function renderWatchlist(el) {
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">İzlem Listem (${state.watchlist.length})</div>
        <div class="panel-actions">
          <button class="btn" onclick="addToWatchlistPrompt()">+ Sembol Ekle</button>
          <button class="btn danger" onclick="clearWatchlist()">Temizle</button>
        </div>
      </div>
      <div id="wl-body" class="loading">…</div>
    </div>
  `;
  const lastPx = {};
  async function refresh() {
    if (!state.watchlist.length) {
      const wlB = $("#wl-body");
      if (wlB) wlB.innerHTML = `<div class="muted">Boş. Üst arama çubuğundan sembol bulup detayda ★ ile ekleyebilirsiniz.</div>`;
      return;
    }
    try {
      const r = await API(`/api/v1/fiyatlar?semboller=${state.watchlist.join(",")}&user_id=${USER_ID}`);
      const wlBody = $("#wl-body");
      if (!wlBody) return;
      const f = r?.fiyatlar || {};
      const head = `<tr>
        <th>Sembol</th>
        <th class="num">Fiyat</th>
        <th class="num">Değ.</th>
        <th class="num">Hacim</th>
        <th class="num">1H</th>
        <th class="num">1A</th>
        <th class="num">YTD</th>
        <th></th>
      </tr>`;
      const body = state.watchlist.map(s => {
        const x = f[s] || {};
        const prev = lastPx[s];
        const flash = (prev != null && x.fiyat != null && x.fiyat !== prev)
          ? (x.fiyat > prev ? "flash-up" : "flash-down") : "";
        if (x.fiyat != null) lastPx[s] = x.fiyat;
        return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(s)}')">
          <td class="sym">${escapeHtml(s)}</td>
          <td class="num ${flash}">${fmtNum(x.fiyat,2)}</td>
          <td class="num pct ${colorClass(x.degisim)}">${fmtPct(x.degisim)}</td>
          <td class="num">${fmtVol(x.hacim)}</td>
          <td class="num pct ${colorClass(x.getiri_1h)}">${fmtPct(x.getiri_1h)}</td>
          <td class="num pct ${colorClass(x.getiri_1a)}">${fmtPct(x.getiri_1a)}</td>
          <td class="num pct ${colorClass(x.getiri_ytd)}">${fmtPct(x.getiri_ytd)}</td>
          <td class="num"><button class="btn danger" onclick="event.stopPropagation();removeFromWatchlist('${escapeHtml(s)}')">✕</button></td>
        </tr>`;
      }).join("");
      wlBody.classList.remove("loading");
      wlBody.innerHTML = `<table class="tbl">${head}${body}</table>`;
    } catch (e) {
      const wlBody = $("#wl-body");
      if (wlBody) { wlBody.classList.remove("loading"); wlBody.innerHTML = `<div class="error-box">Yüklenemedi.</div>`; }
    }
  }
  addPoller(refresh, 8_000);
}

function saveWatchlist() {
  localStorage.setItem("hp.watchlist", JSON.stringify(state.watchlist));
}
function addToWatchlist(s) {
  s = (s || "").toUpperCase().trim();
  if (!s) return;
  if (!state.watchlist.includes(s)) {
    state.watchlist.push(s);
    saveWatchlist();
    if (state.route === "watchlist") render();
  }
}
function removeFromWatchlist(s) {
  state.watchlist = state.watchlist.filter(x => x !== s);
  saveWatchlist();
  if (state.route === "watchlist") render();
}
function addToWatchlistPrompt() {
  const s = prompt("Eklenecek sembol (örn. THYAO):");
  if (s) addToWatchlist(s);
}
function clearWatchlist() {
  if (!confirm("İzlem listesi tamamen silinsin mi?")) return;
  state.watchlist = [];
  saveWatchlist();
  render();
}
function inWatchlist(s) { return state.watchlist.includes(s); }

/* ───────────── MARKETS (endeksler + tüm yükselen/düşen) ───────────── */
async function renderMarkets(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Endeksler</div></div>
      <div id="m-idx" class="loading">…</div>
    </div>
    <div class="grid g-2" style="margin-bottom:14px">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Yükselenler <span id="m-yuk-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div>
        </div>
        <div id="m-yuk" class="loading" style="max-height:640px;overflow-y:auto">…</div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Düşenler <span id="m-dus-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div>
        </div>
        <div id="m-dus" class="loading" style="max-height:640px;overflow-y:auto">…</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Hacim Liderleri <span id="m-hac-cnt" class="muted" style="font-size:11px;font-weight:400"></span></div>
      </div>
      <div id="m-hac" class="loading" style="max-height:480px;overflow-y:auto">…</div>
    </div>
  `;

  /* Phase 1: endeksler + hacim (fast) */
  async function refreshSummary() {
    try {
      const [idx, piyasa] = await Promise.all([
        API(`/api/v1/endeksler?user_id=${USER_ID}`),
        API(`/api/v1/piyasa_ozeti?user_id=${USER_ID}`),
      ]);
      const mIdx = $("#m-idx");
      if (!mIdx) return;
      mIdx.classList.remove("loading");
      const ie = idx?.endeksler || [];
      mIdx.innerHTML = `
        <table class="tbl">
          <tr><th>Endeks</th><th class="num">Değer</th><th class="num">Önceki</th><th class="num">Değişim</th></tr>
          ${ie.map(e => `<tr>
            <td class="sym">${escapeHtml(e.label || e.code)} <span class="muted" style="font-weight:400">${escapeHtml(e.code)}</span></td>
            <td class="num">${fmtNum(e.value,2)}</td>
            <td class="num">${fmtNum(e.prev,2)}</td>
            <td class="num pct ${colorClass(e.change)}">${fmtPct(e.change)}</td>
          </tr>`).join("")}
        </table>`;
      const hac = piyasa?.hacim_liderleri || piyasa?.en_hacimli || piyasa?.hacim || [];
      const mHac = $("#m-hac"), mHacCnt = $("#m-hac-cnt");
      if (mHac) { mHac.classList.remove("loading"); mHac.innerHTML = renderMoverTable(hac, "vol", Infinity); }
      if (mHacCnt && hac.length) mHacCnt.textContent = `(${hac.length})`;
    } catch {/**/}
  }

  /* Phase 2: full movers list from piyasa_movers (slower — all symbols) */
  async function refreshMovers() {
    try {
      const movers = await API(`/api/v1/piyasa_movers?user_id=${USER_ID}`);
      const mYuk = $("#m-yuk"), mDus = $("#m-dus"), mHac = $("#m-hac");
      const mYukCnt = $("#m-yuk-cnt"), mDusCnt = $("#m-dus-cnt"), mHacCnt = $("#m-hac-cnt");
      if (!mYuk) return;
      const yuk = movers?.yukselenler    || [];
      const dus = movers?.dusenler       || [];
      const hac = movers?.hacim_liderleri || [];
      mYuk.classList.remove("loading"); mYuk.innerHTML = renderMoverTable(yuk, "up",   Infinity);
      mDus.classList.remove("loading"); mDus.innerHTML = renderMoverTable(dus, "down", Infinity);
      if (hac.length && mHac) { mHac.classList.remove("loading"); mHac.innerHTML = renderMoverTable(hac, "vol", Infinity); }
      if (mYukCnt) mYukCnt.textContent = yuk.length ? `(${yuk.length})` : "";
      if (mDusCnt) mDusCnt.textContent = dus.length ? `(${dus.length})` : "";
      if (mHacCnt) mHacCnt.textContent = hac.length ? `(${hac.length})` : "";
    } catch {/**/}
  }

  refreshSummary();
  refreshMovers();
  addPoller(refreshSummary, 30_000);
  addPoller(refreshMovers,  60_000);
}

/* ───────────── SCREENER (sirala_cache 4 modlu) ───────────── */
const SC_MODES = [
  { id: "teknik",     label: "Teknik",     defaultSort: "skor",
    cols: [["sembol","Sembol","sym"],["aksiyon","Aksiyon","tag"],["skor","Skor","num"],["fiyat","Fiyat","num"],["degisim","Değ %","num pct"]] },
  { id: "analiz",     label: "Analiz",     defaultSort: "skor",
    cols: [["sembol","Sembol","sym"],["aksiyon","Aksiyon","tag"],["skor","Skor","num"],["fiyat","Fiyat","num"],["degisim","Değ %","num pct"]] },
  { id: "birleshik",  label: "Birleşik",   defaultSort: "skor",
    cols: [["sembol","Sembol","sym"],["aksiyon","Aksiyon","tag"],["skor","Birleşik","num"],["teknikSkor","Teknik","num"],["analizPuan","Analiz","num"],["fiyat","Fiyat","num"],["degisim","Değ %","num pct"]] },
  { id: "diptakas",   label: "Dip Takas",  defaultSort: "skor",
    cols: [["sembol","Sembol","sym"],["skor","Skor","num"],["top_kurum","Top Kurum","txt"],["top_oran","Top %","num pct1"],["top3_oran","Top3 %","num pct1"],["alan_sayi","Alan #","num"],["satan_sayi","Satan #","num"],["fiyat","Fiyat","num"],["degisim","Değ %","num pct"]] },
];

async function renderScreener(el) {
  const tabsHtml = SC_MODES.map((m,i) => `<div class="tab ${i===0?'active':''}" data-sc-tab="${m.id}">${m.label}</div>`).join("");
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Tarama — sirala_cache</div>
        <div class="panel-actions">
          <input id="sc-filter" placeholder="Filtre…" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:5px 8px;color:var(--text);font-size:11px;width:140px">
          <button class="btn" id="sc-populate" title="Tüm sembolleri tara ve önbelleği doldur">Doldur</button>
          <button class="btn" id="sc-refresh">Yenile</button>
        </div>
      </div>
      <div class="tabs" id="sc-tabs">${tabsHtml}</div>
      <div id="sc-body" class="loading" style="padding:18px">yükleniyor…</div>
    </div>
  `;
  const state = { mode: SC_MODES[0].id, sortKey: SC_MODES[0].defaultSort, sortDir: -1, cache: {} };
  window._scState = state;

  $$("#sc-tabs .tab").forEach(t => t.onclick = () => {
    state.mode = t.dataset.scTab;
    const m = SC_MODES.find(x => x.id === state.mode);
    state.sortKey = m.defaultSort; state.sortDir = -1;
    $$("#sc-tabs .tab").forEach(x => x.classList.toggle("active", x === t));
    load();
  });
  $("#sc-refresh").onclick = () => { delete state.cache[state.mode]; load(); };
  $("#sc-populate").onclick = async () => {
    const btn = $("#sc-populate");
    btn.disabled = true; btn.textContent = "Taranıyor…";
    try {
      const globalSyms = window._appState.symbols;
      const syms = globalSyms.length ? globalSyms : undefined;
      const body = syms ? { mode: state.mode, semboller: syms.slice(0, 150) } : { mode: state.mode };
      const r = await APIPOST(`/api/v1/sirala_populate`, body);
      if (r?.ok) {
        delete state.cache[state.mode];
        await load();
        btn.textContent = `Tamam (${r.count ?? "?"})`;
      } else {
        btn.textContent = "Hata";
      }
    } catch { btn.textContent = "Hata"; }
    setTimeout(() => { if ($("#sc-populate")) { $("#sc-populate").disabled = false; $("#sc-populate").textContent = "Doldur"; } }, 3000);
  };
  $("#sc-filter").addEventListener("input", () => render());
  window._scSetSort = (k) => {
    if (state.sortKey === k) state.sortDir = -state.sortDir;
    else { state.sortKey = k; state.sortDir = -1; }
    render();
  };

  async function load() {
    if (state.cache[state.mode]) { render(); return; }
    $("#sc-body").innerHTML = `<div class="loading" style="padding:18px">yükleniyor…</div>`;
    try {
      const c = await API(`/api/v1/sirala_cache?mode=${state.mode}&user_id=${USER_ID}`);
      state.cache[state.mode] = Array.isArray(c?.data) ? c.data : [];
      render();
    } catch (e) {
      $("#sc-body").innerHTML = `<div class="error-box">Tarama önbelleği alınamadı (${state.mode}).</div>`;
    }
  }
  function render() {
    const all = state.cache[state.mode] || [];
    const m = SC_MODES.find(x => x.id === state.mode);
    const q = ($("#sc-filter").value || "").toUpperCase().trim();
    const rows = all.filter(r => !q || (r.sembol || "").toUpperCase().includes(q));
    rows.sort((a, b) => {
      const av = a[state.sortKey], bv = b[state.sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * state.sortDir;
      return String(av).localeCompare(String(bv)) * state.sortDir;
    });
    const head = `<tr>${m.cols.map(c => `<th class="sortable ${c[2].includes('num')?'num':''}" onclick="_scSetSort('${c[0]}')">${c[1]}${state.sortKey===c[0]?(state.sortDir>0?' ▲':' ▼'):''}</th>`).join("")}</tr>`;
    const body = rows.slice(0, 500).map(r => {
      return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(r.sembol)}')">${m.cols.map(c => {
        const v = r[c[0]];
        const cls = c[2];
        if (c[0] === "sembol") return `<td class="sym">${escapeHtml(v)}</td>`;
        if (cls === "tag") {
          const tag = String(v||"").toUpperCase();
          const tcls = tag.includes("AL")||tag.includes("YÜK") ? "tag green" : (tag.includes("SAT")||tag.includes("DÜŞ")?"tag red":"tag amber");
          return `<td><span class="${tcls}">${escapeHtml(v||"-")}</span></td>`;
        }
        if (cls === "txt") return `<td>${escapeHtml(v||"-")}</td>`;
        if (cls.includes("pct1") && typeof v === "number") return `<td class="num pct">${fmtNum(v,1)}%</td>`;
        if (cls.includes("pct")  && typeof v === "number") return `<td class="num pct ${colorClass(v)}">${fmtPct(v)}</td>`;
        if (typeof v === "number") return `<td class="num">${fmtNum(v,2)}</td>`;
        return `<td class="num">${escapeHtml(v??"-")}</td>`;
      }).join("")}</tr>`;
    }).join("");
    $("#sc-body").classList.remove("loading");
    $("#sc-body").innerHTML = rows.length
      ? `<table class="tbl">${head}${body}</table>` + (rows.length > 500 ? `<div class="muted" style="margin-top:8px;padding:0 14px 12px">İlk 500 satır gösteriliyor (${rows.length} eşleşme).</div>` : "")
      : `<div class="muted" style="padding:18px">Bu mod için kayıt yok.</div>`;
  }
  load();
}

/* ───────────── AKD (Aracı Kurum Dağılımı) ───────────── */
async function renderAkd(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">AKD — Toplu Aracı Kurum Dağılımı</div>
        <div class="panel-actions">
          <input id="akd-syms" placeholder="Semboller (örn. THYAO,ASELS)" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:5px 8px;color:var(--text);font-size:11px;width:260px">
          <button class="btn primary" id="akd-go">Çalıştır</button>
        </div>
      </div>
      <div class="muted" style="font-size:11px">Boş bırakılırsa izlem listenizdeki semboller analiz edilir.</div>
    </div>
    <div id="akd-results"></div>
  `;
  $("#akd-go").onclick = run;
  async function run() {
    const inp = $("#akd-syms").value.trim();
    const syms = inp ? inp.split(/[,\s]+/).map(s => s.toUpperCase()).filter(Boolean) : state.watchlist.slice(0, 8);
    if (!syms.length) { $("#akd-results").innerHTML = `<div class="muted">Sembol yok.</div>`; return; }
    $("#akd-results").innerHTML = `<div class="loading">${syms.length} sembol için AKD hesaplanıyor…</div>`;
    try {
      const r = await APIPOST(`/api/v1/akd_bulk`, { semboller: syms, user_id: USER_ID });
      const arr = Array.isArray(r?.sonuclar) ? r.sonuclar
        : Array.isArray(r?.results) ? r.results
        : Array.isArray(r?.data) ? r.data
        : (r && typeof r === "object" && !Array.isArray(r))
          ? Object.entries(r).filter(([k]) => k !== "ok" && k !== "cached").map(([k,v]) => ({sembol:k,...(v||{})}))
          : [];
      if (!arr.length) { $("#akd-results").innerHTML = `<div class="muted">Sonuç yok.</div>`; return; }
      const html = arr.map(a => {
        const son       = (a.son_girisler || []).slice(0, 8);
        const alPasta   = (a.alicilar_pasta || []);
        const satPasta  = (a.saticilar_pasta || []);
        const sm        = a.smart_money || {};
        return `<div class="panel" style="margin-bottom:14px">
          <div class="panel-head">
            <div class="panel-title" style="display:flex;align-items:center;gap:10px">
              <span class="sym" style="font-size:15px">${escapeHtml(a.sembol)}</span>
              <span class="tag ${a.skor>=70?'green':a.skor>=40?'amber':'red'}" style="font-size:11px">Skor ${fmtNum(a.skor,1)}</span>
              <span class="muted" style="font-size:11px">${escapeHtml(a.top_kurum||"")} ${a.top_oran?fmtNum(a.top_oran,1)+"% top":""}  </span>
            </div>
            <div class="panel-actions">
              <span class="muted" style="font-size:11px">${fmtCurr(a.fiyat,2)} <span class="${colorClass(a.degisim)}">${fmtPct(a.degisim)}</span></span>
              <button class="btn" onclick="navTo('symbol','${escapeHtml(a.sembol)}')">Detay →</button>
            </div>
          </div>
          <div class="grid g-4" style="margin-bottom:10px">
            <div class="kpi"><div class="kpi-label">Alan Kurum</div><div class="kpi-val">${a.alan_sayi ?? "—"}</div></div>
            <div class="kpi"><div class="kpi-label">Satan Kurum</div><div class="kpi-val">${a.satan_sayi ?? "—"}</div></div>
            <div class="kpi"><div class="kpi-label">Top3 %</div><div class="kpi-val up">${fmtNum(a.top3_oran,1)}%</div></div>
            <div class="kpi"><div class="kpi-label">Virman</div><div class="kpi-val ${a.virman_sayi>0?'down':'muted'}">${a.virman_sayi ?? 0}</div></div>
          </div>
          ${(alPasta.length || satPasta.length) ? `<div class="grid g-2" style="margin-bottom:10px">
            ${alPasta.length ? `<div>
              <div class="muted" style="font-size:11px;padding:0 14px 4px">Alıcı Kurumlar</div>
              <table class="tbl">${alPasta.map(p=>`<tr><td class="sym">${escapeHtml(p.kurum)}</td><td class="num up">${fmtNum(p.oran,1)}%</td></tr>`).join("")}</table>
            </div>` : ""}
            ${satPasta.length ? `<div>
              <div class="muted" style="font-size:11px;padding:0 14px 4px">Satıcı Kurumlar</div>
              <table class="tbl">${satPasta.map(p=>`<tr><td class="sym">${escapeHtml(p.kurum)}</td><td class="num down">${fmtNum(p.oran,1)}%</td></tr>`).join("")}</table>
            </div>` : ""}
          </div>` : ""}
          ${son.length ? `<div class="muted" style="font-size:11px;padding:0 14px 4px">Son Girişler</div>
          <table class="tbl">
            <tr><th>Kurum</th><th class="num">Son AKD</th><th class="num">Önceki</th><th class="num">Maliyet</th><th class="num">Fark %</th><th>İşaret</th></tr>
            ${son.map(c => `<tr>
              <td class="sym">${escapeHtml(c.kurum)}</td>
              <td class="num">${fmtNum(c.son_akd, 2)}</td>
              <td class="num">${fmtNum(c.onceki_akd, 2)}</td>
              <td class="num">${fmtCurr(c.maliyet, 2)}</td>
              <td class="num pct ${colorClass(c.fark_pct)}">${fmtPct(c.fark_pct)}</td>
              <td class="muted" style="font-size:10px">${escapeHtml(c.isaretci||"")}</td>
            </tr>`).join("")}
          </table>` : ""}
          ${sm.toplam_net != null ? `<div class="muted" style="font-size:11px;padding:6px 14px 4px">Smart Money — Net: <b class="${colorClass(sm.toplam_net)}">${fmtVol(sm.toplam_net)}</b> · Çakal: ${sm.cakal_sayi ?? 0} · AKD Mal. ${fmtCurr(sm.akd_maliyet,2)}</div>` : ""}
        </div>`;
      }).join("");
      $("#akd-results").innerHTML = html;
    } catch (e) {
      $("#akd-results").innerHTML = `<div class="error-box">AKD hesaplanamadı.</div>`;
    }
  }
}

/* ───────────── ALARMS ───────────── */
async function renderAlarms(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Yeni Alarm Ekle</div></div>
      <div style="padding:12px 16px">
        <div class="pf-add-form">
          <input id="al-sym" type="text" placeholder="Sembol" maxlength="10" class="sym-inp">
          <select id="al-tip" style="background:var(--panel);border:1px solid var(--border-2);border-radius:6px;padding:6px 10px;color:var(--text);outline:none">
            <option value="above">Yukarı ≥</option>
            <option value="below">Aşağı ≤</option>
          </select>
          <input id="al-fiyat" type="number" placeholder="Fiyat (₺)" step="0.01" class="num-inp">
          <input id="al-not" type="text" placeholder="Not (opsiyonel)" style="flex:1;min-width:100px">
          <button class="btn primary" onclick="alarmAdd()">+ Ekle</button>
          <button class="btn" onclick="requestNotifPermission()" title="Alarmlar tetiklendiğinde bildirim almak için izin verin">🔔 İzin</button>
        </div>
        <div id="al-form-err" style="color:var(--red);font-size:12px;min-height:16px"></div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">Yerel Alarmlar</div>
        <div class="panel-actions"><button class="btn" onclick="alarmClearTriggered()">Tetiklenenler Temizle</button></div>
      </div>
      <div id="al-local-body">…</div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">API Alarmlar</div>
        <div class="panel-actions"><button class="btn" id="al-refresh">↻ Yenile</button></div>
      </div>
      <div id="al-api-body" class="loading">…</div>
    </div>
  `;

  const alSymInp = document.getElementById("al-sym");
  if (alSymInp) alSymInp.addEventListener("keyup", e => { e.target.value = e.target.value.toUpperCase(); });

  function renderLocalAlarms() {
    const alarms = getLocalAlarms();
    const body = document.getElementById("al-local-body");
    if (!body) return;
    if (!alarms.length) {
      body.innerHTML = `<div class="muted" style="padding:12px 16px">Yerel alarm yok. Yukarıdan ekleyin.</div>`;
      return;
    }
    const head = `<tr><th>Sembol</th><th>Koşul</th><th class="num">Fiyat</th><th>Not</th><th>Durum</th><th>Eklenme</th><th></th></tr>`;
    const rows = alarms.map(a => `<tr>
      <td class="sym clickable" onclick="navTo('symbol','${escapeHtml(a.sembol)}')">${escapeHtml(a.sembol)}</td>
      <td><span class="tag ${a.tip==='above'?'green':'red'}">${a.tip==='above'?'≥ Yukarı':'≤ Aşağı'}</span></td>
      <td class="num">${fmtCurr(a.fiyat, 2)}</td>
      <td class="muted" style="font-size:11px;max-width:120px">${escapeHtml(a.note||'')}</td>
      <td>${a.triggered
        ? `<span class="tag amber">Tetiklendi ₺${(a.triggeredPrice||0).toFixed(2)}</span>`
        : `<span class="tag green">Aktif</span>`}</td>
      <td class="muted" style="font-size:11px">${escapeHtml((a.createdAt||'').slice(0,16).replace('T',' '))}</td>
      <td><button class="btn danger" style="padding:2px 8px;font-size:11px" onclick="alarmRemove(${a.id})">Sil</button></td>
    </tr>`).join("");
    body.innerHTML = `<table class="tbl">${head}${rows}</table>`;
  }

  async function loadApiAlarms() {
    const body = document.getElementById("al-api-body");
    if (!body) return;
    try {
      const r = await API(`/api/v1/alarm_liste?user_id=${USER_ID}`);
      const list = r?.alarmlar || [];
      if (!list.length) {
        body.innerHTML = `<div class="muted" style="padding:12px 16px">API'de aktif alarm yok.</div>`;
      } else {
        const head = `<tr><th>Sembol</th><th>Tip</th><th class="num">Tetik</th><th class="num">Güncel</th><th>Tarih</th></tr>`;
        const rows = list.map(a => `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(a.sembol)}')">
          <td class="sym">${escapeHtml(a.sembol)}</td>
          <td><span class="tag violet">${escapeHtml(a.alarm_type)}</span></td>
          <td class="num">${a.fiyat == null ? "—" : fmtNum(a.fiyat,2)}</td>
          <td class="num">${a.guncel_fiyat == null ? "—" : fmtNum(a.guncel_fiyat,2)}</td>
          <td class="muted" style="font-size:11px">${escapeHtml((a.tarih||"").replace("T"," ").slice(0,16))}</td>
        </tr>`).join("");
        body.innerHTML = `<table class="tbl">${head}${rows}</table>`;
      }
    } catch {
      const b = document.getElementById("al-api-body");
      if (b) b.innerHTML = `<div class="muted" style="padding:12px 16px">API alarmları alınamadı.</div>`;
    }
  }

  renderLocalAlarms();
  loadApiAlarms();
  document.getElementById("al-refresh").onclick = loadApiAlarms;

  window.alarmAdd = function() {
    const sym  = (document.getElementById("al-sym")?.value  || "").toUpperCase().trim();
    const tip  = document.getElementById("al-tip")?.value;
    const fiyat = parseFloat(document.getElementById("al-fiyat")?.value || "");
    const not  = document.getElementById("al-not")?.value || "";
    const errEl = document.getElementById("al-form-err");
    if (!sym)             { if (errEl) errEl.textContent = "Sembol gerekli"; return; }
    if (!fiyat || fiyat <= 0) { if (errEl) errEl.textContent = "Geçerli fiyat girin"; return; }
    if (errEl) errEl.textContent = "";
    addLocalAlarm(sym, tip, fiyat, not);
    ["al-sym","al-fiyat","al-not"].forEach(id => { const i = document.getElementById(id); if (i) i.value = ""; });
    renderLocalAlarms();
  };
  window.alarmRemove = function(id) {
    removeLocalAlarm(id);
    renderLocalAlarms();
  };
  window.alarmClearTriggered = function() {
    saveLocalAlarms(getLocalAlarms().filter(a => !a.triggered));
    renderLocalAlarms();
  };
  window.requestNotifPermission = function() {
    if ("Notification" in window) {
      Notification.requestPermission().then(p => {
        alert(p === "granted" ? "✅ Bildirim izni verildi. Alarmlar tetiklendiğinde bildirim alırsınız." : "❌ Bildirim izni reddedildi.");
      });
    } else {
      alert("Bu tarayıcı bildirimleri desteklemiyor.");
    }
  };
}

/* ───────────── SETTINGS ───────────── */
async function renderSettings(el) {
  el.innerHTML = `
    <div class="grid g-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Hesap</div></div>
        <div class="kv" id="se-user">…</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Telegram Oturum / init_data</div></div>
        <div class="kv" id="se-tg">…</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="se-refresh-init">init_data Yenile</button>
          <a class="btn" href="/admin/telegram" target="_blank">Yönetim Paneli →</a>
        </div>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Kanal & Sponsor Durumu</div></div>
        <div class="kv" id="se-kanal">…</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">İzlem Listesi (yerel)</div></div>
        <div id="se-wl" class="muted">…</div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn" onclick="addToWatchlistPrompt()">+ Ekle</button>
          <button class="btn danger" onclick="clearWatchlist()">Temizle</button>
        </div>
      </div>
    </div>
  `;

  // user
  const u = state.user || {};
  const ab = u.abonelik || {};
  $("#se-user").innerHTML = `
    <div class="k">Premium</div><div class="v">${u.is_premium ? "Evet" : "Hayır"}</div>
    <div class="k">Plan</div><div class="v">${escapeHtml(ab.plan || "—")}</div>
    <div class="k">Başlangıç</div><div class="v">${escapeHtml(ab.baslangic || "—")}</div>
    <div class="k">Bitiş</div><div class="v">${escapeHtml(ab.bitis || u.bitis || "—")}</div>
  `;

  // telegram status
  try {
    const s = await API(`/api/v1/telegram/status`);
    const seTg = $("#se-tg");
    if (!seTg) return;
    seTg.innerHTML = `
      <div class="k">Telegram Oturumu</div><div class="v">${s.logged_in ? "<span class='tag green'>Açık</span>" : "<span class='tag red'>Kapalı</span>"}</div>
      <div class="k">Bot</div><div class="v">@${escapeHtml(s.bot_username || "—")}</div>
      <div class="k">init_data Yaşı</div><div class="v">${s.init_age_hours == null ? "—" : (s.init_age_hours + " saat" + (s.init_expired ? " (DOLMUŞ)" : ""))}</div>
      <div class="k">Son Yenileme</div><div class="v">${s.last_refresh_ts ? new Date(s.last_refresh_ts*1000).toLocaleString("tr-TR") : "—"}</div>
      <div class="k">Son Hata</div><div class="v">${escapeHtml(s.last_refresh_error || "—")}</div>
    `;
  } catch {
    const seTg = $("#se-tg");
    if (seTg) seTg.innerHTML = `<div class="muted">Durum alınamadı.</div>`;
  }
  $("#se-refresh-init").onclick = async () => {
    $("#se-refresh-init").disabled = true;
    $("#se-refresh-init").textContent = "Yenileniyor…";
    try {
      const r = await APIPOST(`/api/v1/telegram/refresh`);
      alert(r.ok ? "Yenilendi (auth_date=" + r.auth_date + ")" : "Hata: " + (r.detail || r.reason));
    } catch { alert("Yenileme başarısız."); }
    $("#se-refresh-init").disabled = false;
    $("#se-refresh-init").textContent = "init_data Yenile";
    renderSettings(el);
  };

  try {
    const [k, sp] = await Promise.all([
      API(`/api/v1/kanal_kontrol`).catch(()=>null),
      API(`/api/v1/sponsor/durum`).catch(()=>null),
    ]);
    const seKanal = $("#se-kanal");
    if (!seKanal) return;
    seKanal.innerHTML = `
      <div class="k">Kanal Üyeliği</div><div class="v">${k?.uye ? "<span class='tag green'>Üye</span>" : "<span class='tag red'>Üye değil</span>"}</div>
      <div class="k">Kanal Adı</div><div class="v">${escapeHtml(k?.kanal || "—")}</div>
      <div class="k">Sponsor</div><div class="v">${sp?.katildi ? "<span class='tag green'>Katıldı</span>" : "<span class='tag amber'>Katılmadı</span>"}</div>
      <div class="k">Sponsor Linki</div><div class="v">${sp?.link ? `<a href="${escapeHtml(sp.link)}" target="_blank">${escapeHtml(sp.link)}</a>` : "—"}</div>
    `;
    const seWl = $("#se-wl");
    if (seWl) seWl.innerHTML = state.watchlist.length
      ? state.watchlist.map(s => `<span class="tag gray" style="margin:2px 4px 2px 0;cursor:pointer" onclick="navTo('symbol','${escapeHtml(s)}')">${escapeHtml(s)}</span>`).join("")
      : "Boş.";
  } catch {/**/}
}

/* ───────────── SYMBOL DETAIL ───────────── */
async function renderSymbol(el, sym) {
  if (!sym) { el.innerHTML = `<div class="error-box">Sembol belirtilmemiş.</div>`; return; }
  sym = sym.toUpperCase();
  trackRecent(sym);
  el.innerHTML = `
    <a class="back-btn" onclick="history.back()">← Geri</a>
    <div id="sym-head" class="loading">${escapeHtml(sym)} yükleniyor…</div>
    <div class="tabs scrollx" id="sym-tabs">
      <span class="tab active" data-tab="overview">Özet</span>
      <span class="tab" data-tab="derinlik">Derinlik</span>
      <span class="tab" data-tab="canli">Canlı</span>
      <span class="tab" data-tab="avwap">AVWAP</span>
      <span class="tab" data-tab="technical">Teknik</span>
      <span class="tab" data-tab="analiz">Analiz</span>
      <span class="tab" data-tab="finansal">Finansallar</span>
      <span class="tab" data-tab="sirket">Şirket</span>
      <span class="tab" data-tab="haberler">Haberler</span>
      <span class="tab" data-tab="zincir">Zincir</span>
      <span class="tab" data-tab="temettu">Temettü</span>
      <span class="tab" data-tab="akd">AKD</span>
      <span class="tab" data-tab="takas">Takas</span>
      <span class="tab" data-tab="rtakas">R.Takas</span>
      <span class="tab" data-tab="kap">KAP</span>
      <span class="tab" data-tab="analist">Analist</span>
      <span class="tab" data-tab="gerialim">Geri Alım</span>
      <span class="tab" data-tab="akis">Akış</span>
    </div>
    <div id="sym-body" class="loading">…</div>
  `;
  let activeTab = state.routeSub || "overview";
  // initial tab selection from hash
  $$(".tab", $("#sym-tabs")).forEach(x => x.classList.toggle("active", x.dataset.tab === activeTab));
  $$(".tab", $("#sym-tabs")).forEach(t => t.onclick = () => {
    activeTab = t.dataset.tab;
    $$(".tab", $("#sym-tabs")).forEach(x => x.classList.toggle("active", x === t));
    location.hash = "#symbol/" + encodeURIComponent(sym) + "/" + activeTab;
    renderTab();
  });

  let analiz = null, prices = null, f = {};
  try {
    [analiz, prices] = await Promise.all([
      API(`/api/v1/analiz?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`),
      API(`/api/v1/fiyatlar?semboller=${encodeURIComponent(sym)}&user_id=${USER_ID}`),
    ]);
  } catch {
    const hErr = $("#sym-head");
    if (hErr) hErr.innerHTML = `<div class="error-box">Sembol bilgisi alınamadı.</div>`;
    return;
  }
  if (!el.isConnected) return;
  f = (prices?.fiyatlar || {})[sym] || {};
  const inWl = inWatchlist(sym);
  const logoUrl = analiz?.logo ? analiz.logo : null;
  const symHead = $("#sym-head");
  if (!symHead) return;
  symHead.innerHTML = `
    <div class="sym-head">
      <div class="logo">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" onerror="this.replaceWith(document.createTextNode('${escapeHtml(sym.slice(0,2))}'))">` : escapeHtml(sym.slice(0,2))}</div>
      <div>
        <h1>${escapeHtml(sym)}</h1>
        <div class="desc">${escapeHtml(analiz?.aciklama || "")}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div class="price" id="sym-price">${fmtCurr(f.fiyat ?? analiz?.fiyat, 2)}</div>
        <div class="change ${colorClass(f.degisim ?? analiz?.degisim)}" id="sym-change">${arrowFor(f.degisim ?? analiz?.degisim)} ${fmtPct(f.degisim ?? analiz?.degisim)}</div>
        <div class="muted" style="font-size:10px;margin-top:2px" id="sym-tick">canlı · 5sn</div>
      </div>
      <div style="display:flex;gap:6px;flex-direction:column">
        <button class="btn ${inWl?'active':''}" onclick="${inWl?'removeFromWatchlist':'addToWatchlist'}('${escapeHtml(sym)}');navTo('symbol','${escapeHtml(sym)}')">${inWl?'★ İzlemde':'☆ İzleme Ekle'}</button>
        <a class="btn" href="https://www.tradingview.com/symbols/BIST-${escapeHtml(sym)}/" target="_blank">TradingView ↗</a>
      </div>
    </div>
  `;

  // Canlı sembol başlık fiyatı — her 5 sn yenile, değişimde flaş
  let lastHeadPrice = f.fiyat ?? analiz?.fiyat ?? null;
  async function refreshHead() {
    try {
      const r = await API(`/api/v1/fiyatlar?semboller=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
      const nf = (r?.fiyatlar || {})[sym];
      if (!nf) return;
      const p = $("#sym-price"), c = $("#sym-change"), t = $("#sym-tick");
      if (!p || !c) return;
      const flash = (lastHeadPrice != null && nf.fiyat !== lastHeadPrice)
        ? (nf.fiyat > lastHeadPrice ? "flash-up" : "flash-down") : "";
      p.className = "price " + flash;
      p.textContent = fmtCurr(nf.fiyat, 2);
      c.className = "change " + colorClass(nf.degisim);
      c.textContent = `${arrowFor(nf.degisim)} ${fmtPct(nf.degisim)}`;
      if (t) t.textContent = `canlı · ${new Date().toLocaleTimeString('tr-TR')}`;
      lastHeadPrice = nf.fiyat;
    } catch {/**/}
  }
  addPoller(refreshHead, 5_000);

  function renderTab() {
    const body = $("#sym-body");
    if (!body) return;
    body.innerHTML = `<div class="loading">…</div>`;
    if (activeTab === "overview")  return renderOverviewTab(body, sym, analiz, f);
    if (activeTab === "derinlik")  return renderDerinlikTab(body, sym);
    if (activeTab === "canli")     return renderCanliTab(body, sym);
    if (activeTab === "avwap")     return renderAvwapTab(body, sym);
    if (activeTab === "technical") return renderTechnicalTab(body, sym);
    if (activeTab === "analiz")    return renderAnalizTab(body, sym, analiz);
    if (activeTab === "finansal")  return renderFinansalTab(body, sym);
    if (activeTab === "sirket")    return renderSirketTab(body, sym);
    if (activeTab === "haberler")  return renderHaberlerTab(body, sym);
    if (activeTab === "zincir")    return renderZincirTab(body, sym);
    if (activeTab === "temettu")   return renderTemettuTab(body, sym);
    if (activeTab === "akd")       return renderAkdTab(body, sym);
    if (activeTab === "takas")     return renderTakasTab(body, sym, "takas");
    if (activeTab === "rtakas")    return renderTakasTab(body, sym, "realtakas");
    if (activeTab === "kap")       return renderKapTab(body, sym);
    if (activeTab === "analist")   return renderAnalistTab(body, sym);
    if (activeTab === "gerialim")  return renderGeriAlimTab(body, sym);
    if (activeTab === "akis")      return renderAkisTab(body, sym);
  }
  renderTab();
}

async function renderOverviewTab(body, sym, analiz, f) {
  const an  = analiz?.analiz || {};
  const ta  = analiz?.temel_analiz || {};
  const dir = an.direncler || {};
  const fibRows  = dir.fibonacci || [];
  const hacRows  = dir.hacim    || [];
  const sinyaller = an.sinyaller || [];
  const tahmin   = an.tahmin || null;
  const tahminler = an.tahminler || null;

  function drTable(rows) {
    if (!rows.length) return '<div class="muted" style="padding:8px">Veri yok</div>';
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="text-align:left;padding:4px 6px;color:var(--muted)">Tür</th>
        <th style="text-align:right;padding:4px 6px;color:var(--muted)">Fiyat</th>
        <th style="text-align:right;padding:4px 6px;color:var(--muted)">Değişim</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const isDestek = r.tur === "Destek";
        const isDir    = r.tur === "Direnç";
        const cls = isDestek ? "down" : isDir ? "up" : "muted";
        const label = r.tur || "—";
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:4px 6px" class="${cls}">${escapeHtml(label)}</td>
          <td style="padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums">${r.fiyat != null ? fmtNum(r.fiyat,2) : "—"}</td>
          <td style="padding:4px 6px;text-align:right" class="${r.degisim ? colorClass(parseFloat(r.degisim)) : ''}">${r.degisim ? escapeHtml(r.degisim) : "—"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  }

  function riskColor(risk) {
    if (!risk) return "";
    if (risk.includes("Çok Yüksek")) return "down";
    if (risk.includes("Yüksek"))     return "down";
    if (risk.includes("Orta"))       return "muted";
    if (risk.includes("Düşük"))      return "up";
    return "";
  }

  body.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Fiyat Grafiği</div>
        <div class="panel-actions chart-toolbar">
          <button class="btn active" id="ov-ct-line">Çizgi</button>
          <button class="btn" id="ov-ct-candle">Mum</button>
          <div class="sep"></div>
          <div id="ov-res" style="display:flex;gap:4px">
            <button class="btn active" data-r="D">Günlük</button>
            <button class="btn" data-r="W">Haftalık</button>
          </div>
        </div>
      </div>
      <div id="ov-chart" class="chart-wrap"><div class="loading">grafik…</div></div>
    </div>

    <div class="grid g-4" id="ov-stats" style="margin-bottom:14px"></div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Getiriler</div></div>
      <div class="chip-grid" id="ov-returns"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">HissePlus Analiz</div></div>
      <div class="grid g-4" id="ov-analiz-kpi" style="margin-bottom:12px"></div>
      ${an.trend ? `<div style="padding:0 4px 10px;font-size:12px;line-height:1.6;color:var(--text-muted)">${escapeHtml(an.trend)}</div>` : ""}
      ${tahmin ? `<div style="background:var(--panel-alt,#151d28);border-radius:8px;padding:10px 14px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Yakın Dönem Tahmini (${escapeHtml(tahmin.tarih||"")})</div>
        <div style="font-size:14px;font-weight:600">${escapeHtml(tahmin.fiyat||"")}</div>
        ${tahmin.yorum ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.5">${escapeHtml(tahmin.yorum)}</div>` : ""}
      </div>` : ""}
      ${tahminler ? `<div class="chip-grid" style="margin-bottom:10px">
        ${tahminler.uc_ay ? `<div class="chip"><div class="lab">3 Ay Tahmini</div><div class="val">${escapeHtml(tahminler.uc_ay.fiyat||"")} <span class="muted">(${escapeHtml(tahminler.uc_ay.oran||"")})</span></div></div>` : ""}
        ${tahminler.bi_sene ? `<div class="chip"><div class="lab">1 Yıl Tahmini</div><div class="val">${escapeHtml(tahminler.bi_sene.fiyat||"")} <span class="muted">(${escapeHtml(tahminler.bi_sene.oran||"")})</span></div></div>` : ""}
      </div>` : ""}
      ${an.sinyal ? `<div style="background:var(--panel-alt,#151d28);border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12px;line-height:1.6;color:var(--text-muted)">${escapeHtml(an.sinyal)}</div>` : ""}
      ${an.gunluk ? `<div style="padding:0 4px 4px;font-size:12px;line-height:1.6;color:var(--text-muted)">${escapeHtml(an.gunluk)}</div>` : ""}
      ${sinyaller.length ? `<div style="margin-top:10px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;padding:0 4px">Son Sinyaller</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>
            <th style="text-align:left;padding:4px 6px;color:var(--muted)">Sinyal</th>
            <th style="text-align:left;padding:4px 6px;color:var(--muted)">Tarih</th>
            <th style="text-align:left;padding:4px 6px;color:var(--muted)">Yön</th>
          </tr></thead>
          <tbody>${sinyaller.map(s => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:4px 6px">${escapeHtml(s.veri||"")}</td>
            <td style="padding:4px 6px;color:var(--muted)">${escapeHtml(s.tarih||"")} <span class="muted">(${escapeHtml(s.gun||"")})</span></td>
            <td style="padding:4px 6px" class="${s.yon==='High'?'up':'down'}">${s.yon==='High'?'▲ Yükseliş':'▼ Düşüş'}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>` : ""}
    </div>

    ${(fibRows.length || hacRows.length) ? `<div class="grid g-2" style="margin-bottom:14px">
      ${fibRows.length ? `<div class="panel">
        <div class="panel-head"><div class="panel-title">Fibonacci Destek / Direnç</div></div>
        ${drTable(fibRows)}
      </div>` : ""}
      ${hacRows.length ? `<div class="panel">
        <div class="panel-head"><div class="panel-title">Hacim Destek / Direnç</div></div>
        ${drTable(hacRows)}
      </div>` : ""}
    </div>` : ""}

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Temel Analiz</div></div>
      <div class="chip-grid" id="ov-temel"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Değerleme</div></div>
      <div class="chip-grid" id="ov-deger"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Finansal</div></div>
      <div class="chip-grid" id="ov-finansal"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Sektör Karşılaştırması</div></div>
      <div id="ov-sektor"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Değerleme Skorları</div></div>
      <div id="ov-skorlar"></div>
    </div>

    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">Notlarım</div>
        <span class="notes-saved" id="ov-notes-saved">kaydedildi ✓</span>
      </div>
      <div style="padding:10px 14px">
        <textarea id="ov-notes" class="notes-area" placeholder="Bu hisse için kişisel notlarınızı buraya yazın…"></textarea>
      </div>
    </div>
  `;

  // Fiyat KPIs
  const stats = [
    ["Fiyat",       fmtCurr(f.fiyat ?? analiz?.fiyat, 2)],
    ["Değişim",     `<span class="${colorClass(f.degisim)}">${arrowFor(f.degisim)} ${fmtPct(f.degisim)}</span>`],
    ["Hacim (TL)",  fmtVol(f.hacim  ?? analiz?.hacim)],
    ["Hacim (Lot)", fmtVol(f.hacim_lot)],
    ["Alış",        fmtNum(f.alis,  2)],
    ["Satış",       fmtNum(f.satis, 2)],
  ];
  $("#ov-stats").innerHTML = stats.map(([k,v]) => `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(k)}</div>
      <div class="kpi-val">${v}</div>
    </div>`).join("");

  // Getiriler
  const ret = [
    ["1H", f.getiri_1h], ["1A", f.getiri_1a], ["3A", f.getiri_3a],
    ["6A", f.getiri_6a], ["YTD", f.getiri_ytd], ["1Y", f.getiri_1y],
  ];
  $("#ov-returns").innerHTML = ret.map(([k,v]) => `
    <div class="chip">
      <div class="lab">${escapeHtml(k)}</div>
      <div class="val ${colorClass(v)}">${fmtPct(v)}</div>
    </div>`).join("");

  // HissePlus Analiz KPIs
  const anKpis = [
    ["HP Puan",   an.puan != null ? fmtNum(an.puan, 3) : "—", ""],
    ["Risk",      an.risk || "—",                              riskColor(an.risk)],
    ["Pivot",     an.pivot || "—",                            an.pivot === "Zirve" ? "up" : an.pivot === "Dip" ? "down" : ""],
    ["Pivot Ne Zaman", an.pivot_zaman || "—",                 "muted"],
    ["Yön",       an.upwards != null ? (an.upwards ? "▲ Yukarı" : "▼ Aşağı") : "—", an.upwards ? "up" : "down"],
    ["Stop",      an.stop != null ? fmtNum(an.stop, 2) : "—", "down"],
  ];
  $("#ov-analiz-kpi").innerHTML = anKpis.map(([k,v,cls]) => `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(k)}</div>
      <div class="kpi-val ${cls}">${v}</div>
    </div>`).join("");

  // Temel Analiz chips
  const temelChips = [
    ["F/K",          ta["Hisse F/K Oranı"]   != null ? fmtNum(ta["Hisse F/K Oranı"],2)  : "—"],
    ["PD/DD",        ta["Hisse PD/DD Oranı"] != null ? fmtNum(ta["Hisse PD/DD Oranı"],2): "—"],
    ["Sektör F/K",   ta["Sektör F/K Oranı"]  != null ? fmtNum(ta["Sektör F/K Oranı"],2) : "—"],
    ["Sektör PD/DD", ta["Sektör PD/DD Oranı"]!= null ? fmtNum(ta["Sektör PD/DD Oranı"],2):"—"],
    ["Sektör",       ta["Sektör"] || "—"],
    ["Piyasa Değeri",ta["Güncel Piyasa Değeri"] != null ? fmtVol(ta["Güncel Piyasa Değeri"]) : "—"],
  ];
  $("#ov-temel").innerHTML = temelChips.map(([k,v]) => `
    <div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val">${v}</div></div>`).join("");

  // Değerleme chips
  const degerChips = [
    ["Değerleme Fiyatı",      ta["Hissenin Değerleme Fiyatı (₺)"]                 != null ? fmtCurr(ta["Hissenin Değerleme Fiyatı (₺)"],2)                 : "—"],
    ["Prim Potansiyeli",      ta["Hissenin Prim Potansiyeli (%)"]                  != null ? fmtPct(ta["Hissenin Prim Potansiyeli (%)"])                     : "—"],
    ["Bedelsiz Potansiyeli",  ta["Hissenin Bedelsiz Potansiyeli (%)"]              != null ? fmtPct(ta["Hissenin Bedelsiz Potansiyeli (%)"])                  : "—"],
    ["Endeks Bazlı Fiyat",    ta["Hissenin Endekse Göre Olması Gereken Fiyatı (₺)"]!= null ? fmtCurr(ta["Hissenin Endekse Göre Olması Gereken Fiyatı (₺)"],2): "—"],
    ["Sektör Bazlı Fiyat",    ta["Hissenin Sektöre Göre Olması Gereken Fiyatı (₺)"]!=null ? fmtCurr(ta["Hissenin Sektöre Göre Olması Gereken Fiyatı (₺)"],2): "—"],
  ];
  const prim = ta["Hissenin Prim Potansiyeli (%)"];
  const bedelsiz = ta["Hissenin Bedelsiz Potansiyeli (%)"];
  $("#ov-deger").innerHTML = degerChips.map(([k,v], i) => {
    const cls = i === 1 ? colorClass(prim) : i === 2 ? colorClass(bedelsiz) : "";
    return `<div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val ${cls}">${v}</div></div>`;
  }).join("");

  // Finansal chips
  const fmtMilyar = v => v != null ? `${(v/1e9).toFixed(2)} Mrd ₺` : "—";
  const finansalChips = [
    ["12A Net Kâr",          fmtMilyar(ta["12 Aylık Net Kâr"])],
    ["Yıl Sonu Tahmin Kâr",  fmtMilyar(ta["Yıl Sonu Tahmini Net Kâr"])],
    ["Ödenmiş Sermaye",      fmtMilyar(ta["Ödenmiş Sermaye"])],
    ["Özsermaye",            fmtMilyar(ta["Özsermaye"])],
  ];
  const netKar = ta["12 Aylık Net Kâr"];
  $("#ov-finansal").innerHTML = finansalChips.map(([k,v], i) => {
    const cls = i === 0 ? colorClass(netKar) : "";
    return `<div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val ${cls}">${v}</div></div>`;
  }).join("");

  // Sektör Karşılaştırması
  const sektorEl = $("#ov-sektor");
  if (sektorEl) {
    const hisseFiyat  = f.fiyat ?? analiz?.fiyat;
    const hisseFK     = ta["Hisse F/K Oranı"];
    const hissePDDD   = ta["Hisse PD/DD Oranı"];
    const sektorFK    = ta["Sektör F/K Oranı"];
    const sektorPDDD  = ta["Sektör PD/DD Oranı"];
    const sektorAdi   = ta["Sektör"] || "Sektör";
    const sektorFiyat = ta["Hissenin Sektöre Göre Olması Gereken Fiyatı (₺)"];
    const endeksFiyat = ta["Hissenin Endekse Göre Olması Gereken Fiyatı (₺)"];
    const degerFiyat  = ta["Hissenin Değerleme Fiyatı (₺)"];
    const pdMilyar    = v => v != null ? `${(v/1e9).toFixed(1)} Mrd ₺` : "—";
    const piyasaDeger = ta["Güncel Piyasa Değeri"];

    const rowStyle = "border-top:1px solid var(--border)";
    const thStyle  = "padding:6px 10px;text-align:right;color:var(--muted);font-size:11px;font-weight:500";
    const tdStyle  = "padding:6px 10px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums";
    const tdLStyle = "padding:6px 10px;text-align:left;font-size:12px;color:var(--muted)";

    // F/K comparison color: lower is cheaper (positive for hisse vs sektör)
    const fkCls = (hisseFK != null && sektorFK != null && sektorFK > 0)
      ? (hisseFK < sektorFK ? "up" : "down") : "";

    sektorEl.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${thStyle};text-align:left">Metrik</th>
          <th style="${thStyle}">${escapeHtml(sym)}</th>
          <th style="${thStyle}">${escapeHtml(sektorAdi)}</th>
        </tr></thead>
        <tbody>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">F/K Oranı</td>
            <td style="${tdStyle}" class="${fkCls}">${hisseFK != null ? fmtNum(hisseFK,2) : "—"}</td>
            <td style="${tdStyle}">${sektorFK  != null ? fmtNum(sektorFK,2)  : "—"}</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">PD/DD Oranı</td>
            <td style="${tdStyle}">${hissePDDD != null ? fmtNum(hissePDDD,2) : "—"}</td>
            <td style="${tdStyle}">${sektorPDDD!= null ? fmtNum(sektorPDDD,2): "—"}</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">Mevcut Fiyat</td>
            <td style="${tdStyle}">${hisseFiyat != null ? fmtCurr(hisseFiyat,2) : "—"}</td>
            <td style="${tdStyle} color:var(--muted)">—</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">Sektör Bazlı Hedef</td>
            <td style="${tdStyle} ${sektorFiyat != null && hisseFiyat != null ? colorClass(sektorFiyat - hisseFiyat) : ''}">${sektorFiyat != null ? fmtCurr(sektorFiyat,2) : "—"}</td>
            <td style="${tdStyle} color:var(--muted)">—</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">Endeks Bazlı Hedef</td>
            <td style="${tdStyle} ${endeksFiyat != null && hisseFiyat != null ? colorClass(endeksFiyat - hisseFiyat) : ''}">${endeksFiyat != null ? fmtCurr(endeksFiyat,2) : "—"}</td>
            <td style="${tdStyle} color:var(--muted)">—</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">Değerleme Fiyatı</td>
            <td style="${tdStyle} ${degerFiyat != null && hisseFiyat != null ? colorClass(degerFiyat - hisseFiyat) : ''}">${degerFiyat != null ? fmtCurr(degerFiyat,2) : "—"}</td>
            <td style="${tdStyle} color:var(--muted)">—</td>
          </tr>
          <tr style="${rowStyle}">
            <td style="${tdLStyle}">Piyasa Değeri</td>
            <td style="${tdStyle}">${pdMilyar(piyasaDeger)}</td>
            <td style="${tdStyle} color:var(--muted)">—</td>
          </tr>
        </tbody>
      </table>`;
  }

  // Değerleme Skorları (1-9)
  const skorEl = $("#ov-skorlar");
  if (skorEl) {
    const skorKeys = [
      ["1) Sektör F/K Oranına Göre",                    "Sektör F/K'ya Göre"],
      ["2) Endeks F/K Oranına Göre",                    "Endeks F/K'ya Göre"],
      ["3) Sektör Future's F/K Oranına Göre",           "Sektör Gelecek F/K'ya Göre"],
      ["4) Endeks Future's F/K Oranına Göre",           "Endeks Gelecek F/K'ya Göre"],
      ["5) Sektör PD/DD Oranına Göre",                  "Sektör PD/DD'ye Göre"],
      ["6) Endeks PD/DD Oranına Göre",                  "Endeks PD/DD'ye Göre"],
      ["7) Ödenmiş Sermayeye Göre",                     "Ödenmiş Sermayeye Göre"],
      ["8) Potansiyel Piyasa Değerine Göre",            "Potansiyel PD'ye Göre"],
      ["9) Yıl Sonu Tahmini Özsermaye Kârlılığına Göre","Özsermaye Kârlılığına Göre"],
    ];
    const rowStyle = "border-top:1px solid var(--border)";
    const validScores = skorKeys.filter(([k]) => ta[k] != null && ta[k] !== 0);
    if (validScores.length === 0) {
      skorEl.innerHTML = `<div class="muted" style="padding:10px 12px;font-size:12px">Veri yok</div>`;
    } else {
      skorEl.innerHTML = `<table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:6px 10px;text-align:left;color:var(--muted);font-size:11px">Yöntem</th>
          <th style="padding:6px 10px;text-align:right;color:var(--muted);font-size:11px">Potansiyel (%)</th>
        </tr></thead>
        <tbody>${skorKeys.map(([k, label]) => {
          const v = ta[k];
          if (v == null) return "";
          const cls = colorClass(v);
          return `<tr style="${rowStyle}">
            <td style="padding:5px 10px;font-size:12px;color:var(--text-muted)">${escapeHtml(label)}</td>
            <td style="padding:5px 10px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums" class="${cls}">${v > 0 ? "+" : ""}${fmtNum(v,2)}%</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }
  }

  // Notes
  const notesArea = document.getElementById("ov-notes");
  if (notesArea) {
    notesArea.value = getNotes(sym);
    let saveTimer = null;
    notesArea.addEventListener("input", () => {
      setNotes(sym, notesArea.value);
      const badge = document.getElementById("ov-notes-saved");
      if (badge) {
        badge.classList.remove("show");
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => badge.classList.add("show"), 500);
        setTimeout(() => badge.classList.remove("show"), 2500);
      }
    });
  }

  // Chart
  let res = "D", chartType = "line";
  const ctLine = document.getElementById("ov-ct-line");
  const ctCandle = document.getElementById("ov-ct-candle");
  if (ctLine) ctLine.onclick = () => { chartType = "line"; ctLine.classList.add("active"); if (ctCandle) ctCandle.classList.remove("active"); drawChart(); };
  if (ctCandle) ctCandle.onclick = () => { chartType = "candle"; ctCandle.classList.add("active"); if (ctLine) ctLine.classList.remove("active"); drawChart(); };

  $$("#ov-res .btn").forEach(b => b.onclick = () => {
    res = b.dataset.r;
    $$("#ov-res .btn").forEach(x => x.classList.toggle("active", x === b));
    drawChart();
  });
  async function drawChart() {
    const slot = $("#ov-chart");
    if (!slot) return;
    slot.innerHTML = `<div class="loading">grafik…</div>`;
    try {
      const r = await API(`/api/v1/ohlcv?sembol=${encodeURIComponent(sym)}&resolution=${res}&countback=120&user_id=${USER_ID}`);
      const slot2 = $("#ov-chart");
      if (!slot2) return;
      const o = r?.ohlcv || {};
      const t = o.t || [], c = o.c || [], op = o.o || [], h = o.h || [], l = o.l || [];
      if (!t.length) { slot2.innerHTML = `<div class="muted">Veri yok.</div>`; return; }
      slot2.innerHTML = chartType === "candle" && op.length
        ? svgCandleChart(t, op, h, l, c)
        : svgLineChart(t, c);
    } catch {
      const slot3 = $("#ov-chart");
      if (slot3) slot3.innerHTML = `<div class="error-box">Grafik verisi alınamadı.</div>`;
    }
  }
  drawChart();
}

function svgLineChart(t, c) {
  const W = 800, H = 320, padL = 50, padR = 20, padT = 20, padB = 28;
  const min = Math.min(...c), max = Math.max(...c);
  const range = (max - min) || 1;
  const xs = t.map((_, i) => padL + i * (W - padL - padR) / (c.length - 1));
  const ys = c.map(v => padT + (1 - (v - min) / range) * (H - padT - padB));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill = `${path} L${xs[xs.length-1].toFixed(1)},${(H-padB).toFixed(1)} L${xs[0].toFixed(1)},${(H-padB).toFixed(1)} Z`;
  const last = c[c.length-1], first = c[0];
  const colorUp = last >= first;
  const stroke = colorUp ? "#2ec27e" : "#ff4757";
  const grad = `<linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
  </linearGradient>`;
  // y-axis labels (5 levels)
  const labels = [];
  for (let i = 0; i <= 4; i++) {
    const v = max - (range * i / 4);
    const y = padT + (i / 4) * (H - padT - padB);
    labels.push(`<text x="${padL-6}" y="${y+4}" fill="#5b6573" font-size="10" text-anchor="end" font-family="ui-monospace">${v.toFixed(2)}</text>
                 <line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="#1b232f" stroke-dasharray="2,3"/>`);
  }
  // x labels (first, mid, last)
  const fmtDate = (ts) => new Date(ts*1000).toLocaleDateString("tr-TR", { day:"2-digit", month:"short" });
  const xLabels = [0, Math.floor(t.length/2), t.length-1].map(i =>
    `<text x="${xs[i]}" y="${H-8}" fill="#5b6573" font-size="10" text-anchor="middle" font-family="ui-monospace">${fmtDate(t[i])}</text>`
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>${grad}</defs>
    ${labels.join("")}
    <path d="${fill}" fill="url(#g1)"/>
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.6"/>
    ${xLabels}
  </svg>`;
}

async function renderTechnicalTab(body, sym) {
  try {
    const r = await API(`/api/v1/teknik_analiz?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const ind = r?.indikatorler || {};
    const dr  = r?.destek_direnc || {};
    const ema = ind.ema || {};
    const sig = (r?.sinyaller || []).concat(r?.firsatlar || []);
    const uy  = r?.uyarilar || [];
    body.innerHTML = `
      <div class="grid g-4">
        <div class="kpi"><div class="kpi-label">Skor</div><div class="kpi-val">${r.skor ?? "—"}</div><div class="kpi-sub muted">${escapeHtml(r.aksiyon || "")}</div></div>
        <div class="kpi"><div class="kpi-label">Trend</div><div class="kpi-val" style="font-size:18px">${escapeHtml(r.trend || "—")}</div><div class="kpi-sub muted">Güç: ${r.trend_guc ?? "—"}/5</div></div>
        <div class="kpi"><div class="kpi-label">Volatilite</div><div class="kpi-val">${fmtNum(r.volatilite,2)}</div></div>
        <div class="kpi"><div class="kpi-label">Hacim Oranı</div><div class="kpi-val">${fmtNum(r.hacim_oran,1)}%</div></div>
      </div>
      <div style="height:14px"></div>
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">İndikatörler</div></div>
          <div class="chip-grid">
            <div class="chip"><div class="lab">RSI</div><div class="val">${fmtNum(ind.rsi?.deger,1)} <span class="muted">${escapeHtml(ind.rsi?.durum||"")}</span></div></div>
            <div class="chip"><div class="lab">MACD</div><div class="val">${fmtNum(ind.macd?.deger,2)} <span class="muted">${escapeHtml(ind.macd?.durum||"")}</span></div></div>
            <div class="chip"><div class="lab">Bollinger</div><div class="val">${fmtNum(ind.bollinger?.orta,2)} <span class="muted">${escapeHtml(ind.bollinger?.durum||"")}</span></div></div>
            <div class="chip"><div class="lab">Stochastic</div><div class="val">${fmtNum(ind.stochastic?.k,1)} / ${fmtNum(ind.stochastic?.d,1)}</div></div>
            <div class="chip"><div class="lab">ATR</div><div class="val">${fmtNum(ind.atr,2)}</div></div>
            ${Object.keys(ema).map(k => `<div class="chip"><div class="lab">EMA ${k}</div><div class="val">${fmtNum(ema[k],2)}</div></div>`).join("")}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Destek / Direnç</div></div>
          <div class="chip-grid">
            <div class="chip"><div class="lab">Pivot</div><div class="val">${fmtNum(dr.pivot,2)}</div></div>
            <div class="chip"><div class="lab">R1</div><div class="val up">${fmtNum(dr.r1,2)}</div></div>
            <div class="chip"><div class="lab">R2</div><div class="val up">${fmtNum(dr.r2,2)}</div></div>
            <div class="chip"><div class="lab">R3</div><div class="val up">${fmtNum(dr.r3,2)}</div></div>
            <div class="chip"><div class="lab">S1</div><div class="val down">${fmtNum(dr.s1,2)}</div></div>
            <div class="chip"><div class="lab">S2</div><div class="val down">${fmtNum(dr.s2,2)}</div></div>
            <div class="chip"><div class="lab">S3</div><div class="val down">${fmtNum(dr.s3,2)}</div></div>
          </div>
        </div>
      </div>
      ${sig.length ? `<div style="height:14px"></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Sinyaller / Fırsatlar</div></div>
      <ul style="margin:0;padding-left:18px">${sig.map(s => `<li class="up">${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
      ${uy.length ? `<div style="height:14px"></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Uyarılar</div></div>
      <ul style="margin:0;padding-left:18px">${uy.map(s => `<li class="down">${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Teknik analiz alınamadı.</div>`;
  }
}

async function renderAkdTab(body, sym) {
  body.innerHTML = `<div class="loading">AKD hesaplanıyor…</div>`;
  try {
    const r = await APIPOST(`/api/v1/akd_bulk`, { semboller: [sym], user_id: USER_ID });
    const arr = r?.sonuclar || r?.results || r?.data || [];
    const list = Array.isArray(arr) ? arr : Object.values(arr);
    const a = list.find(x => (x?.sembol || "").toUpperCase() === sym.toUpperCase()) || list[0] || {};

    if (!a || (!a.akd_alanlar_full?.length && !a.top10_akd?.length && !a.son_girisler?.length)) {
      body.innerHTML = `<div class="muted">AKD verisi yok.</div>`; return;
    }

    const sm = a.smart_money || {};
    const fd = a.fiyat_degisimleri || {};
    const skor = a.skor;
    const skorColor = skor >= 70 ? "var(--green)" : skor >= 40 ? "var(--yellow)" : "var(--red)";

    const kpiBar = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi">
          <div class="kpi-label">Skor</div>
          <div class="kpi-val" style="color:${skorColor}">${fmtNum(skor,1)}</div>
          <div class="kpi-sub muted">Periyot Δ: <span class="${colorClass(a.periyod_degisim)}">${fmtPct(a.periyod_degisim)}</span></div>
        </div>
        <div class="kpi">
          <div class="kpi-label">En Büyük Alıcı</div>
          <div class="kpi-val" style="font-size:20px">${escapeHtml(a.top_kurum||"-")}</div>
          <div class="kpi-sub muted">Pay <b style="color:var(--text)">${fmtNum(a.top_oran,1)}%</b> · Top3 ${fmtNum(a.top3_oran,1)}%</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Alan / Satan Kurum</div>
          <div class="kpi-val" style="font-size:22px"><span style="color:var(--green)">${a.alan_sayi||0}</span> <span class="muted">/</span> <span style="color:var(--red)">${a.satan_sayi||0}</span></div>
          <div class="kpi-sub muted">TL konsant: ${fmtNum(a.tl_konsant,1)}%</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Smart Money (Net)</div>
          <div class="kpi-val ${colorClass(sm.toplam_net)}" style="font-size:20px">${fmtVol(sm.toplam_net)}</div>
          <div class="kpi-sub muted">AKD mal: ${fmtCurr(sm.akd_maliyet,2)} · Takas: ${fmtCurr(sm.takas_maliyet,2)}</div>
        </div>
      </div>`;

    const periyodBar = (fd.d7!=null || fd.d30!=null || fd.d90!=null) ? `
      <div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Fiyat Değişimi</div></div>
        <div style="display:flex;gap:28px;padding:10px 14px;font-size:13px">
          <div><span class="muted">7G:</span> <b class="${colorClass(fd.d7)}">${fmtPct(fd.d7)}</b></div>
          <div><span class="muted">30G:</span> <b class="${colorClass(fd.d30)}">${fmtPct(fd.d30)}</b></div>
          <div><span class="muted">90G:</span> <b class="${colorClass(fd.d90)}">${fmtPct(fd.d90)}</b></div>
          <div style="margin-left:auto"><span class="muted">Virman oranı:</span> <b>${fmtNum(a.virman_oran,1)}%</b></div>
        </div>
      </div>` : "";

    const top10 = (a.top10_akd || []);
    const top10Tbl = top10.length ? `
      <div class="panel">
        <div class="panel-head"><div class="panel-title">TOP 10 AKD (NET)</div><div class="muted small">net pozisyon · maliyet · takas teyidi</div></div>
        <table class="tbl">
          <tr><th>Kurum</th><th class="num">AKD Net</th><th class="num">Pay %</th><th class="num">Maliyet</th><th class="num">Takas Net</th><th>Yorum</th></tr>
          ${top10.map(c => `<tr>
            <td class="sym">${escapeHtml(c.kurum)}</td>
            <td class="num ${colorClass(c.akd_net)}">${fmtVol(c.akd_net)}</td>
            <td class="num">${fmtNum(c.oran,2)}%</td>
            <td class="num">${fmtCurr(c.maliyet,2)}</td>
            <td class="num ${colorClass(c.takas_net)}">${fmtVol(c.takas_net)}</td>
            <td>${escapeHtml(c.yorum||"-")}</td>
          </tr>`).join("")}
        </table>
      </div>` : "";

    const buyersTbl = (a.akd_alanlar_full || []).length ? `
      <div class="panel">
        <div class="panel-head"><div class="panel-title" style="color:var(--green)">ALAN KURUMLAR</div><div class="muted small">${a.akd_alanlar_full.length} kurum</div></div>
        <div style="max-height:380px;overflow:auto"><table class="tbl">
          <tr><th>Kurum</th><th class="num">Adet</th><th class="num">Pay %</th><th class="num">Maliyet</th></tr>
          ${a.akd_alanlar_full.map(c => `<tr>
            <td class="sym">${escapeHtml(c.kurum)}</td>
            <td class="num">${fmtVol(c.adet)}</td>
            <td class="num">${fmtNum(c.oran,2)}%</td>
            <td class="num">${fmtCurr(c.maliyet,2)}</td>
          </tr>`).join("")}
        </table></div>
      </div>` : "";

    const sellersTbl = (a.akd_satanlar_full || []).length ? `
      <div class="panel">
        <div class="panel-head"><div class="panel-title" style="color:var(--red)">SATAN KURUMLAR</div><div class="muted small">${a.akd_satanlar_full.length} kurum</div></div>
        <div style="max-height:380px;overflow:auto"><table class="tbl">
          <tr><th>Kurum</th><th class="num">Adet</th><th class="num">Pay %</th><th class="num">Maliyet</th></tr>
          ${a.akd_satanlar_full.map(c => `<tr>
            <td class="sym">${escapeHtml(c.kurum)}</td>
            <td class="num">${fmtVol(c.adet)}</td>
            <td class="num">${fmtNum(c.oran,2)}%</td>
            <td class="num">${fmtCurr(c.maliyet,2)}</td>
          </tr>`).join("")}
        </table></div>
      </div>` : "";

    const compareTbl = (a.akd_takas_karsilastirma || []).length ? `
      <div class="panel" style="margin-top:12px">
        <div class="panel-head"><div class="panel-title">AKD ↔ TAKAS KARŞILAŞTIRMA</div><div class="muted small">eşleşme tespiti</div></div>
        <div style="max-height:300px;overflow:auto"><table class="tbl">
          <tr><th>Kurum</th><th>Kod</th><th class="num">AKD Net</th><th class="num">Takas Fark</th><th class="num">Takas Oran %</th><th>Eşleşme</th><th>Kaynak</th></tr>
          ${a.akd_takas_karsilastirma.map(c => `<tr>
            <td class="sym">${escapeHtml(c.kurum)}</td>
            <td class="muted small">${escapeHtml(c.kurum_kod||"")}</td>
            <td class="num ${colorClass(c.akd_net)}">${fmtVol(c.akd_net)}</td>
            <td class="num ${colorClass(c.takas_fark)}">${fmtVol(c.takas_fark)}</td>
            <td class="num">${fmtNum(c.takas_oran,1)}%</td>
            <td>${c.eslesme ? '<span class="tag green">✓ eşleşti</span>' : '<span class="tag gray">—</span>'}</td>
            <td class="muted small">${escapeHtml(c.kaynak||"")}</td>
          </tr>`).join("")}
        </table></div>
      </div>` : "";

    const cakal = (a.cakal_kurumlar || []);
    const cakalTbl = cakal.length ? `
      <div class="panel" style="margin-top:12px">
        <div class="panel-head"><div class="panel-title" style="color:var(--yellow)">⚠ ÇAKAL KURUMLAR</div></div>
        <table class="tbl">
          <tr><th>Kurum</th><th class="num">Detay</th></tr>
          ${cakal.map(c => `<tr><td class="sym">${escapeHtml(c.kurum||c.name||"-")}</td><td class="num">${escapeHtml(JSON.stringify(c))}</td></tr>`).join("")}
        </table>
      </div>` : "";

    body.innerHTML = `
      ${kpiBar}
      ${periyodBar}
      ${top10Tbl}
      <div style="height:14px"></div>
      <div class="grid g-2">
        ${buyersTbl}
        ${sellersTbl}
      </div>
      ${compareTbl}
      ${cakalTbl}
    `;
  } catch (e) {
    console.error("AKD error:", e);
    body.innerHTML = `<div class="error-box">AKD alınamadı: ${escapeHtml(String(e?.message||e))}</div>`;
  }
}

async function renderTakasTab(body, sym, mode = "takas") {
  const label = mode === "realtakas" ? "Gerçek Takas (R.Takas)" : "Resmi Takas";
  body.innerHTML = `<div class="loading">${label} çekiliyor…</div>`;
  const son = new Date();
  const ilk = new Date(son.getTime() - 7*86400000);
  const fmt = (d) => d.toISOString().slice(0,10);
  try {
    const r = await API(`/api/v1/${mode}?sembol=${encodeURIComponent(sym)}&ilk=${fmt(ilk)}&son=${fmt(son)}&user_id=${USER_ID}`);
    const list = (r?.takas || []).filter(x => x.kurum && x.kurum !== "TOPLAM").slice(0, 60);
    if (!list.length) { body.innerHTML = `<div class="muted">Takas verisi yok.</div>`; return; }
    const head = `<tr>
      <th>Kurum</th>
      <th class="num">İlk Lot</th>
      <th class="num">Son Lot</th>
      <th class="num">Fark Lot</th>
      <th class="num">Oran %</th>
      <th class="num">Toplam %</th>
      <th class="num">Son TL</th>
    </tr>`;
    const rows = list.map(t => `<tr>
      <td class="sym">${escapeHtml(t.kurum)}</td>
      <td class="num">${fmtVol(t.ilk_lot)}</td>
      <td class="num">${fmtVol(t.son_lot)}</td>
      <td class="num pct ${colorClass(t.fark_lot)}">${fmtVol(t.fark_lot)}</td>
      <td class="num pct ${colorClass(t.oran_lot)}">${fmtPct(t.oran_lot)}</td>
      <td class="num">${fmtNum(t.total_oran,2)}%</td>
      <td class="num">${fmtVol(t.son_tl)}</td>
    </tr>`).join("");
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">${escapeHtml(sym)} — ${escapeHtml(label)} (${fmt(ilk)} → ${fmt(son)})</div>
          <div class="muted">Dolaşımdaki: ${fmtVol(r?.dolasim)} lot · Fiyat ${fmtCurr(r?.fiyat,2)} (${fmtPct(r?.degisim)})</div>
        </div>
        <table class="tbl">${head}${rows}</table>
      </div>`;
  } catch {
    body.innerHTML = `<div class="error-box">${escapeHtml(label)} alınamadı.</div>`;
  }
}

function renderAnalizTab(body, sym, analiz) {
  if (!analiz || !analiz.analiz) {
    body.innerHTML = `<div class="muted">Analiz verisi yok.</div>`;
    return;
  }
  const a = analiz.analiz || {};
  const t = analiz.temel_analiz || {};
  const karne = analiz.karne || {};

  // sinyaller: array of {veri, yon, tarih, gun} objects
  const sinList = (a.sinyaller || []);
  const sinHtml = sinList.length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Sinyaller (${sinList.length})</div></div>
    <table class="tbl">
      <tr><th>Sinyal</th><th>Yön</th><th>Tarih</th><th>Süre</th></tr>
      ${sinList.map(s => {
        const isAl = (s.yon||"").toLowerCase().includes("buy") || (s.yon||"").toLowerCase().includes("high");
        return `<tr>
          <td>${escapeHtml(s.veri || String(s))}</td>
          <td class="${isAl?'up':'down'}">${escapeHtml(s.yon||"")}</td>
          <td class="muted">${escapeHtml(s.tarih||"")}</td>
          <td class="muted">${escapeHtml(s.gun||"")}</td>
        </tr>`;
      }).join("")}
    </table></div>` : "";

  // tahmin: single forecast object {yorum, tarih, fiyat}
  const tahmin = a.tahmin || {};
  const tahminHtml = tahmin.yorum ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Analiz Yorumu</div><div class="muted">${escapeHtml(tahmin.tarih||"")}</div></div>
    <div style="padding:0 14px 14px;font-size:13px;line-height:1.7">${escapeHtml(tahmin.yorum)}</div>
    ${tahmin.fiyat ? `<div style="padding:0 14px 14px"><span class="muted">Tahmin Fiyat: </span><b class="up">${escapeHtml(tahmin.fiyat)}</b></div>` : ""}
    </div>` : "";

  // tahminler: dict {uc_ay: {fiyat, oran}, bi_sene: {fiyat, oran}}
  const tahminler = a.tahminler || {};
  const tahminlerHtml = (tahminler.uc_ay || tahminler.bi_sene) ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Fiyat Tahminleri</div></div>
    <div class="chip-grid">
      ${tahminler.uc_ay ? `<div class="chip"><div class="lab">3 Aylık</div><div class="val up">${escapeHtml(tahminler.uc_ay.fiyat||"—")}</div><div class="muted" style="font-size:11px">${escapeHtml(tahminler.uc_ay.oran||"")}</div></div>` : ""}
      ${tahminler.bi_sene ? `<div class="chip"><div class="lab">1 Yıllık</div><div class="val up">${escapeHtml(tahminler.bi_sene.fiyat||"—")}</div><div class="muted" style="font-size:11px">${escapeHtml(tahminler.bi_sene.oran||"")}</div></div>` : ""}
    </div></div>` : "";

  // direncler: dict {fibonacci: [...], hacim: [...]}
  const direncler = a.direncler || {};
  const fibList = direncler.fibonacci || [];
  const hacList = direncler.hacim || [];
  const dirHtml = (fibList.length || hacList.length) ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Destek / Direnç Seviyeleri</div></div>
    <div class="grid g-2">
      ${fibList.length ? `<div>
        <div class="panel-sub-title muted" style="padding:6px 14px 4px;font-size:11px">Fibonacci</div>
        <table class="tbl">${fibList.map(l => {
          const isDestek = (l.tur||l.type||"").toLowerCase().includes("destek");
          return `<tr>
            <td class="${isDestek?'down':'up'}">${escapeHtml(l.tur||l.type||"")}</td>
            <td class="num"><b>${fmtNum(l.fiyat,2)}</b></td>
            <td class="num muted">${escapeHtml(l.degisim||"")}</td>
          </tr>`;
        }).join("")}</table></div>` : ""}
      ${hacList.length ? `<div>
        <div class="panel-sub-title muted" style="padding:6px 14px 4px;font-size:11px">Hacim Seviyeleri</div>
        <table class="tbl">${hacList.map(l => {
          const isDestek = (l.tur||l.type||"").toLowerCase().includes("destek");
          return `<tr>
            <td class="${isDestek?'down':'up'}">${escapeHtml(l.tur||l.type||"")}</td>
            <td class="num"><b>${fmtNum(l.fiyat,2)}</b></td>
            <td class="num muted">${escapeHtml(l.degisim||"")}</td>
          </tr>`;
        }).join("")}</table></div>` : ""}
    </div></div>` : "";

  // temel_analiz: flat dict of key→value pairs
  const temelKeys = Object.keys(t).filter(k => !k.includes("Bilgi") && !k.includes("Bilgi"));
  const temelHtml = temelKeys.length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Temel Analiz & Değerleme</div></div>
    <div class="chip-grid">${temelKeys.map(k => {
      const v = t[k];
      if (v == null || v === "" || v === 0) return "";
      return `<div class="chip"><div class="lab" style="font-size:10px">${escapeHtml(k)}</div><div class="val">${escapeHtml(typeof v==='object'?JSON.stringify(v).slice(0,40):String(v).slice(0,40))}</div></div>`;
    }).filter(Boolean).join("")}</div></div>` : "";

  body.innerHTML = `
    <div class="grid g-4">
      <div class="kpi"><div class="kpi-label">Risk</div><div class="kpi-val" style="font-size:20px">${escapeHtml(a.risk || "—")}</div></div>
      <div class="kpi"><div class="kpi-label">Pivot</div><div class="kpi-val" style="font-size:20px">${escapeHtml(a.pivot || "—")}</div><div class="kpi-sub muted">${escapeHtml(a.pivot_zaman || "")}</div></div>
      <div class="kpi"><div class="kpi-label">Stop</div><div class="kpi-val" style="font-size:20px">${escapeHtml(String(a.stop || "—"))}</div></div>
      <div class="kpi"><div class="kpi-label">Puan</div><div class="kpi-val">${fmtNum(a.puan,2)}</div></div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Trend</div></div>
        <div style="white-space:pre-line;font-size:13px;line-height:1.7;padding:0 14px 14px">${escapeHtml(a.trend || a.gunluk || a.yorum || "—")}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Hareket / Sinyal</div></div>
        <div class="chip-grid">
          <div class="chip"><div class="lab">Hareket</div><div class="val">${escapeHtml(a.hareket||"—")}</div></div>
          <div class="chip"><div class="lab">Sinyal</div><div class="val">${escapeHtml(a.sinyal||"—")}</div></div>
          <div class="chip"><div class="lab">Hacim</div><div class="val">${fmtVol(a.hacim)}</div></div>
          <div class="chip"><div class="lab">Yukarı %</div><div class="val">${a.upwards != null ? fmtNum(a.upwards,1)+"%" : "—"}</div></div>
          <div class="chip"><div class="lab">7G %</div><div class="val ${colorClass(a['7_degisim'])}">${fmtPct(a['7_degisim'])}</div></div>
          <div class="chip"><div class="lab">30G %</div><div class="val ${colorClass(a['30_degisim'])}">${fmtPct(a['30_degisim'])}</div></div>
        </div>
      </div>
    </div>
    ${tahminHtml}
    ${tahminlerHtml}
    ${sinHtml}
    ${dirHtml}
    ${temelHtml}
  `;
}

/* ───────────── CANLI (avwap'tan canlı snapshot) ───────────── */
async function renderCanliTab(body, sym) {
  body.innerHTML = `<div class="loading">Canlı veri çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/avwap?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const tb = r.top_buyers || [];
    const ts = r.top_sellers || [];
    const ta = r.takas_artanlar || [];
    const td = r.takas_azalanlar || [];
    const sm = r.smart_analysis || {};
    const pc = r.price_changes || [];
    const ratingColor = r.rating_color || "var(--accent)";
    body.innerHTML = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">Rating</div><div class="kpi-val" style="font-size:20px;color:${escapeHtml(ratingColor)}">${escapeHtml(r.rating||"—")}</div><div class="kpi-sub muted">Skor ${fmtNum(r.score,1)}</div></div>
        <div class="kpi"><div class="kpi-label">RSI</div><div class="kpi-val">${fmtNum(r.rsi?.value,1)}</div><div class="kpi-sub muted">${escapeHtml(r.rsi?.status||"")}</div></div>
        <div class="kpi"><div class="kpi-label">EMA Üstü</div><div class="kpi-val">${r.ema_above_count ?? 0}/${(r.ema_list||[]).length}</div><div class="kpi-sub muted">Skor ${r.ema_score ?? "—"}</div></div>
        <div class="kpi"><div class="kpi-label">Hacim Oranı</div><div class="kpi-val">${fmtNum(r.vol_ratio,2)}x</div><div class="kpi-sub muted">F.Float ${fmtNum(r.free_float,1)}%</div></div>
      </div>
      ${pc.length ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Anlık Değişim</div></div>
        <div class="chip-grid">${pc.map(p=>`<div class="chip"><div class="lab">${escapeHtml(p.label)}</div><div class="val ${colorClass(p.value)}">${fmtPct(p.value)}</div></div>`).join("")}</div>
      </div>` : ""}
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Top Alıcılar (Bugün)</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Lot</th><th class="num">Oran %</th><th class="num">Maliyet</th></tr>
          ${tb.map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num">${fmtVol(b.lot)}</td><td class="num">${fmtNum(b.oran,2)}%</td><td class="num">${fmtCurr(b.maliyet,2)}</td></tr>`).join("")}</table>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Top Satıcılar (Bugün)</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Lot</th><th class="num">Oran %</th><th class="num">Maliyet</th></tr>
          ${ts.map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num">${fmtVol(b.lot)}</td><td class="num">${fmtNum(b.oran,2)}%</td><td class="num">${fmtCurr(b.maliyet,2)}</td></tr>`).join("")}</table>
        </div>
      </div>
      <div style="height:14px"></div>
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Takas Artanlar (Dönem)</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Fark Lot</th><th class="num">Fark TL</th><th class="num">DF</th></tr>
          ${ta.map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num up">${fmtVol(b.fark_lot)}</td><td class="num up">${escapeHtml(b.fark_tl_short||fmtVol(b.fark_tl))}</td><td class="num">${fmtNum(b.df_oran,2)}x</td></tr>`).join("")}</table>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Takas Azalanlar (Dönem)</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Fark Lot</th><th class="num">Fark TL</th><th class="num">DF</th></tr>
          ${td.map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num down">${fmtVol(b.fark_lot)}</td><td class="num down">${escapeHtml(b.fark_tl_short||fmtVol(b.fark_tl))}</td><td class="num">${fmtNum(b.df_oran,2)}x</td></tr>`).join("")}</table>
        </div>
      </div>
      ${Object.keys(sm).length ? `<div style="height:14px"></div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Akıllı Analiz</div><div class="muted">Genel skor: ${sm.overall_score ?? "—"}</div></div>
        <div class="chip-grid">${Object.entries(sm).filter(([k])=>k!=='overall_score').map(([k,v]) => `<div class="chip"><div class="lab">${escapeHtml(k.replace(/_/g,' '))}</div><div class="val" style="font-size:11px;white-space:normal;line-height:1.4">${escapeHtml(typeof v==='object'?JSON.stringify(v).slice(0,160):String(v).slice(0,160))}</div></div>`).join("")}</div>
      </div>` : ""}
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Canlı veri alınamadı.</div>`;
  }
}

/* ───────────── DERİNLİK (Order Book) tab — canlı akış ───────────── */
async function renderDerinlikTab(body, sym) {
  body.innerHTML = `
    <div class="grid g-4" id="dr-kpis" style="margin-bottom:14px"></div>
    <div class="grid g-2" style="gap:14px">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Emir Defteri (Kademe)</div>
          <div class="panel-actions"><span class="muted" id="dr-tick">canlı</span> <span class="dot ok" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-left:6px;animation:blink 1.2s infinite"></span></div>
        </div>
        <div id="dr-book"><div class="loading">…</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Son İşlemler</div></div>
        <div id="dr-trades" style="max-height:520px;overflow:auto"><div class="loading">…</div></div>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-3" style="gap:14px">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Bugün Alanlar</div></div>
        <div id="dr-bulls"><div class="loading">…</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Bugün Satanlar</div></div>
        <div id="dr-bears"><div class="loading">…</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Toplam Pozisyon</div></div>
        <div id="dr-totals"><div class="loading">…</div></div>
      </div>
    </div>
  `;

  let prevPrice = null, prevTradeTime = null, firstLoad = true;

  async function refresh() {
    if (!$("#dr-kpis")) return;
    let r;
    try {
      r = await API(`/api/v1/derinlik?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    } catch {
      if (!$("#dr-kpis")) return;
      if (firstLoad) $("#dr-book").innerHTML = `<div class="error-box">Derinlik verisi alınamadı.</div>`;
      return;
    }
    // Re-check after async fetch — user may have navigated away
    if (!$("#dr-kpis")) return;
    if (!r || r.hata) {
      if (firstLoad && $("#dr-book")) $("#dr-book").innerHTML = `<div class="error-box">Derinlik bulunamadı: ${escapeHtml(r?.hata||'?')}</div>`;
      return;
    }

    const bids = r?.derinlik?.depth?.bids || [];
    const asks = r?.derinlik?.depth?.asks || [];
    const stats = r?.derinlik?.depthstats || {};
    const trades = r?.emirler || [];
    const akd = r?.mini_akd || {};

    // KPI bar
    const flashClass = (prevPrice != null && r.fiyat !== prevPrice)
      ? (r.fiyat > prevPrice ? "flash-up" : "flash-down") : "";
    $("#dr-kpis").innerHTML = `
      <div class="kpi"><div class="kpi-label">Fiyat</div><div class="kpi-val ${flashClass}">${fmtCurr(r.fiyat,2)}</div><div class="kpi-sub ${colorClass(r.degisim)}">${arrowFor(r.degisim)} ${fmtPct(r.degisim)}</div></div>
      <div class="kpi"><div class="kpi-label">Toplam Alış</div><div class="kpi-val up">${fmtVol(stats.totalBidQuantity)}</div><div class="kpi-sub muted">Ağr.Ort: ${fmtNum(stats.totalBidWAvg,3)}</div></div>
      <div class="kpi"><div class="kpi-label">Toplam Satış</div><div class="kpi-val down">${fmtVol(stats.totalAskQuantity)}</div><div class="kpi-sub muted">Ağr.Ort: ${fmtNum(stats.totalAskWAvg,3)}</div></div>
      <div class="kpi"><div class="kpi-label">Denge (Alış/Satış)</div>
        ${(() => {
          const tot = (stats.totalBidQuantity || 0) + (stats.totalAskQuantity || 0);
          const bidPct = tot ? (stats.totalBidQuantity / tot * 100) : 50;
          const askPct = 100 - bidPct;
          const cls = bidPct >= 50 ? "up" : "down";
          return `<div class="kpi-val ${cls}">${fmtNum(bidPct,1)}% / ${fmtNum(askPct,1)}%</div>
                  <div class="depth-bar" style="height:6px;border-radius:3px;background:#1c2230;margin-top:6px;overflow:hidden;display:flex">
                    <div style="width:${bidPct}%;background:rgba(34,197,94,.6)"></div>
                    <div style="width:${askPct}%;background:rgba(239,68,68,.6)"></div>
                  </div>`;
        })()}
      </div>
    `;
    prevPrice = r.fiyat;

    // Order book ladder — bids on top (best bid first), asks below (best ask first)
    const maxBidQty = Math.max(...bids.map(b => b.quantity || 0), 1);
    const maxAskQty = Math.max(...asks.map(a => a.quantity || 0), 1);
    const maxQty = Math.max(maxBidQty, maxAskQty);
    const askRows = asks.slice().reverse().map(a => `
      <tr class="ob-row">
        <td class="num muted">${a.orderCount}</td>
        <td class="num">${fmtVol(a.quantity)}</td>
        <td class="num down" style="position:relative">
          <div class="ob-fill ob-fill-ask" style="width:${(a.quantity/maxQty*100).toFixed(1)}%"></div>
          <span style="position:relative">${fmtNum(a.price,2)}</span>
        </td>
        <td></td><td></td><td></td>
      </tr>`).join("");
    const bidRows = bids.map(b => `
      <tr class="ob-row">
        <td></td><td></td>
        <td class="num up" style="position:relative;text-align:right">
          <div class="ob-fill ob-fill-bid" style="width:${(b.quantity/maxQty*100).toFixed(1)}%"></div>
          <span style="position:relative">${fmtNum(b.price,2)}</span>
        </td>
        <td class="num">${fmtVol(b.quantity)}</td>
        <td class="num muted">${b.orderCount}</td>
        <td></td>
      </tr>`).join("");
    $("#dr-book").innerHTML = `
      <table class="tbl ob-table" style="width:100%">
        <tr>
          <th class="num">Em</th><th class="num">Lot</th><th class="num">Satış</th>
          <th class="num">Alış</th><th class="num">Lot</th><th class="num">Em</th>
        </tr>
        ${askRows}
        <tr><td colspan="6" style="padding:6px 0;border-top:1px dashed var(--border)"></td></tr>
        ${bidRows}
      </table>
    `;

    // Trades
    const newestTime = trades[0]?.time;
    const flashTrade = (prevTradeTime && newestTime && newestTime !== prevTradeTime);
    prevTradeTime = newestTime;
    $("#dr-trades").innerHTML = `
      <table class="tbl" style="width:100%">
        <tr><th>Saat</th><th class="num">Fiyat</th><th class="num">Lot</th><th>Alıcı</th><th>Satıcı</th></tr>
        ${trades.slice(0, 50).map((t, i) => `
          <tr class="${i===0 && flashTrade ? 'flash-row' : ''}">
            <td class="muted">${escapeHtml(t.time||"")}</td>
            <td class="num ${t.color==='positive'?'up':t.color==='negative'?'down':''}">${fmtNum(t.price,2)}</td>
            <td class="num">${fmtVol(t.quantity)}</td>
            <td>${escapeHtml(t.buyer||"")}</td>
            <td>${escapeHtml(t.seller||"")}</td>
          </tr>`).join("")}
      </table>
    `;

    // Mini AKD tables
    const akdTbl = (rows) => `
      <table class="tbl" style="width:100%">
        <tr><th>Kurum</th><th class="num">Lot</th><th class="num">%</th><th class="num">Mal.</th></tr>
        ${(rows||[]).map(b => `
          <tr><td class="sym">${escapeHtml(b.kurum||"")}</td>
            <td class="num">${fmtVol(b.adet)}</td>
            <td class="num">${fmtNum(b.oran,2)}%</td>
            <td class="num">${fmtNum(b.maliyet,2)}</td>
          </tr>`).join("")}
      </table>`;
    $("#dr-bulls").innerHTML  = akdTbl(akd.alanlar);
    $("#dr-bears").innerHTML  = akdTbl(akd.satanlar);
    $("#dr-totals").innerHTML = akdTbl(akd.toplamlar);

    // tick indicator
    const tick = $("#dr-tick");
    if (tick) {
      tick.textContent = `güncellendi · ${new Date().toLocaleTimeString('tr-TR')}`;
    }
    firstLoad = false;
  }

  addPoller(refresh, 4_000);
}

/* ───────────── AVWAP tab (anchor VWAP grafiği + EMA listesi) ───────────── */
async function renderAvwapTab(body, sym) {
  body.innerHTML = `<div class="loading">AVWAP çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/avwap?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const aw = r.avwaps || [];
    const ay = r.avwap_yorum || {};
    const em = r.ema_list || [];
    const reasons = r.reasons || [];
    const ratingColor = r.rating_color || "var(--accent)";
    body.innerHTML = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">Fiyat</div><div class="kpi-val">${fmtCurr(r.price,2)}</div></div>
        <div class="kpi"><div class="kpi-label">Rating</div><div class="kpi-val" style="font-size:20px;color:${escapeHtml(ratingColor)}">${escapeHtml(r.rating||"—")}</div></div>
        <div class="kpi"><div class="kpi-label">Confluence</div><div class="kpi-val" style="font-size:14px">${escapeHtml(r.confluence_status||"—")}</div></div>
        <div class="kpi"><div class="kpi-label">Mesafe</div><div class="kpi-val">${escapeHtml(r.dist||"—")}</div></div>
      </div>
      ${r.chart_image ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">AVWAP Grafiği</div><div class="muted">${escapeHtml(r.gen_date||"")}</div></div>
        <div style="padding:10px"><img src="${escapeHtml(r.chart_image)}" style="width:100%;border-radius:6px;display:block"></div>
      </div>` : ""}
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Anchor VWAP'lar</div></div>
          <table class="tbl">
            <tr><th>Tip</th><th>Tarih</th><th class="num">Değer</th></tr>
            ${aw.map(a => `<tr><td>${escapeHtml(a.type)}</td><td>${escapeHtml(a.date)}</td><td class="num">${fmtCurr(a.value,2)}</td></tr>`).join("")}
          </table>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">EMA Seviyeleri</div></div>
          <table class="tbl">
            <tr><th>Periyod</th><th class="num">Değer</th><th>Üstü</th></tr>
            ${em.map(e => `<tr><td>EMA ${e.period}</td><td class="num">${fmtCurr(e.value,2)}</td><td>${e.above?'<span class="tag green">Üstünde</span>':'<span class="tag red">Altında</span>'}</td></tr>`).join("")}
          </table>
        </div>
      </div>
      ${reasons.length ? `<div style="height:14px"></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Skor Gerekçeleri</div></div>
      <ul class="bullet-list">${reasons.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
      ${(ay.yorumlar||[]).length ? `<div style="height:14px"></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">AVWAP Yorumu</div><div class="muted">${escapeHtml(ay.sonuc||"")}</div></div>
      <ul class="bullet-list">${ay.yorumlar.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
    `;
  } catch {
    body.innerHTML = `<div class="error-box">AVWAP alınamadı.</div>`;
  }
}

/* ───────────── FİNANSALLAR (bilanco oranları) ───────────── */
async function renderFinansalTab(body, sym) {
  body.innerHTML = `<div class="loading">Finansallar çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/bilanco?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const b = r.bilanco || {};
    const rt = b.ratio_types || [];
    const periods = (b.periods || []).slice(0, 10);
    const values = (b.values || []).slice(0, 10);
    if (!rt.length) { body.innerHTML = `<div class="muted">Finansal veri yok.</div>`; return; }

    const cats = rt.map((g,i) => `<div class="tab ${i===0?'active':''}" data-fin-cat="${escapeHtml(g.key)}">${escapeHtml(g.name)}</div>`).join("");
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Finansal Oranlar — Son 10 Dönem</div></div>
        <div class="tabs scrollx" id="fin-cats">${cats}</div>
        <div id="fin-body" style="padding:14px"></div>
      </div>
    `;

    const renderCat = (key) => {
      const cat = rt.find(x => x.key === key);
      if (!cat) return;
      const head = `<tr><th>Oran</th>${periods.map(p => `<th class="num">${p.year}/${String(p.month).padStart(2,'0')}</th>`).join("")}</tr>`;
      const rows = (cat.data || []).map(d => {
        return `<tr><td class="sym">${escapeHtml(d.name)}</td>${periods.map((_,i) => {
          const v = (d.allowed && Array.isArray(d.values)) ? d.values[i] : (d.allowed && i===0 ? values[i] : null);
          return `<td class="num">${v != null ? fmtVol(v) : '—'}</td>`;
        }).join("")}</tr>`;
      }).join("");
      $("#fin-body").innerHTML = `<table class="tbl">${head}${rows}</table>`;
    };

    $$("#fin-cats .tab").forEach(t => t.onclick = () => {
      $$("#fin-cats .tab").forEach(x => x.classList.toggle("active", x === t));
      renderCat(t.dataset.finCat);
    });
    renderCat(rt[0].key);
  } catch {
    body.innerHTML = `<div class="error-box">Finansallar alınamadı.</div>`;
  }
}

/* ───────────── ŞİRKET (sirket + sektorel + rakip) ───────────── */
async function renderSirketTab(body, sym) {
  body.innerHTML = `<div class="loading">Şirket bilgileri çekiliyor…</div>`;
  try {
    const [sR, secR, rakR] = await Promise.all([
      API(`/api/v1/sirket?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`).catch(() => null),
      API(`/api/v1/sektorel?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`).catch(() => null),
      API(`/api/v1/rakip?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`).catch(() => null),
    ]);
    const c = sR?.sirket || {};
    const sec = secR?.veriler || {};
    const rk = rakR?.rakip_analizi || {};
    const ratios = (rk.ratios || []).slice(0, 12);
    const avg = rk.average || [];

    body.innerHTML = `
      ${c.cover ? `<div class="cover-banner" style="background-image:url(${escapeHtml(c.cover)})"></div>` : ""}
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">Kod</div><div class="kpi-val">${escapeHtml(c.code||sym)}</div></div>
        <div class="kpi"><div class="kpi-label">Para Birimi</div><div class="kpi-val">${escapeHtml(c.functional_currency||"TRY")}</div></div>
        <div class="kpi"><div class="kpi-label">Şablon</div><div class="kpi-val" style="font-size:14px">${escapeHtml(c.sectoral_template||c.sheet_template||"—")}</div></div>
        <div class="kpi"><div class="kpi-label">Sektör</div><div class="kpi-val" style="font-size:14px">${escapeHtml(sec.title||"—")}</div></div>
      </div>
      ${c.description ? `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><div class="panel-title">Hakkında</div></div><div style="padding:0 14px 14px;line-height:1.7;font-size:13px">${escapeHtml(c.description)}</div></div>` : ""}
      ${ratios.length ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Rakip Analizi — F/K, PD/DD, FD/FAVÖK</div></div>
        <table class="tbl">
          <tr><th>Şirket</th><th class="num">F/K</th><th class="num">PD/DD</th><th class="num">FD/FAVÖK</th><th class="num">Piy.Değ.</th><th class="num">Yıl.Net Kâr</th></tr>
          ${ratios.map(x => {
            const isMe = x.code === sym;
            return `<tr class="${isMe?'highlight':''}" onclick="navTo('symbol','${escapeHtml(x.code)}')" style="cursor:pointer">
              <td class="sym">${escapeHtml(x.code)}${isMe?' ★':''}</td>
              <td class="num">${fmtNum(x.fk,2)}</td>
              <td class="num">${fmtNum(x.pddd,2)}</td>
              <td class="num">${fmtNum(x.fd_favok,2)}</td>
              <td class="num">${fmtVol(x.piyasa_degeri)}</td>
              <td class="num">${fmtVol(x.yilliklandirilmis_net_kar)}</td>
            </tr>`;
          }).join("")}
          ${avg.map(a => `<tr class="muted">
            <td class="sym">⌀ ${escapeHtml(a.title||a.oran)}</td>
            <td class="num">${a.fk==="-"?"—":fmtNum(a.fk,2)}</td>
            <td class="num">${a.pddd==="-"?"—":fmtNum(a.pddd,2)}</td>
            <td class="num">${a.fd_favok==="-"?"—":fmtNum(a.fd_favok,2)}</td>
            <td class="num">—</td><td class="num">—</td>
          </tr>`).join("")}
        </table>
      </div>` : ""}
      ${(sec.summary||[]).length ? `<div class="panel">
        <div class="panel-head"><div class="panel-title">Sektörel Veriler — ${escapeHtml(sec.title||"")}</div></div>
        <div class="chip-grid">${(sec.summary).flatMap(s => (s.columns||[])).slice(0,12).map(col => `
          <div class="chip" style="white-space:normal">
            <div class="lab">${escapeHtml(col.title)}</div>
            <div class="val" style="font-size:11px;line-height:1.4">${escapeHtml((col.note||"").slice(0,140))}</div>
            <div class="muted" style="font-size:10px;margin-top:4px">Güncelleme: ${escapeHtml(col.updated_at||"")}</div>
          </div>`).join("")}</div>
      </div>` : ""}
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Şirket bilgileri alınamadı.</div>`;
  }
}

/* ───────────── HABERLER (twitter feed) ───────────── */
async function renderHaberlerTab(body, sym) {
  body.innerHTML = `<div class="loading">Haberler çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/twitter?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const items = (r.veriler || []).slice(0, 50);
    if (!items.length) { body.innerHTML = `<div class="muted">Haber yok.</div>`; return; }
    body.innerHTML = `<div class="panel"><div class="panel-head"><div class="panel-title">${escapeHtml(sym)} — Sosyal Akış (${items.length})</div></div>
      <div class="news-list">${items.map(t => `
        <div class="news-card">
          <div class="news-head">
            <img class="news-avatar" src="${escapeHtml(t.profileImageUrl||'')}" onerror="this.style.display='none'">
            <div class="news-meta">
              <div class="news-author"><b>${escapeHtml(t.name||t.username||'')}</b> <span class="muted">@${escapeHtml(t.username||'')}</span></div>
              <div class="muted" style="font-size:11px">${escapeHtml(t.createdAt||'')}</div>
            </div>
            <a class="btn" href="${escapeHtml(t.tweetUrl||'#')}" target="_blank">Aç ↗</a>
          </div>
          <div class="news-body">${escapeHtml(t.tweetText||'').replace(/\n/g,'<br>')}</div>
          ${(t.mediaImages||[]).length ? `<div class="news-media">${t.mediaImages.slice(0,4).map(u => `<img src="${escapeHtml(u)}" onerror="this.style.display='none'">`).join("")}</div>` : ""}
          <div class="news-foot muted">💬 ${t.replyCount||0} · 🔁 ${t.retweetCount||0} · ❤ ${t.likeCount||0} · 👁 ${fmtVol(t.viewCount||0)}</div>
        </div>`).join("")}
      </div></div>`;
  } catch {
    body.innerHTML = `<div class="error-box">Haberler alınamadı.</div>`;
  }
}

/* ───────────── ZİNCİR (destek/direnç + akd) ───────────── */
async function renderZincirTab(body, sym) {
  body.innerHTML = `<div class="loading">Zincir analizi çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/zincir?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const l = r.ladder || {};
    const a = l.analysis || {};
    const akd = r.akd || {};
    body.innerHTML = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">Fiyat</div><div class="kpi-val">${fmtCurr(r.price,2)}</div><div class="kpi-sub muted">${escapeHtml(r.timestamp||"")}</div></div>
        <div class="kpi"><div class="kpi-label">Destek</div><div class="kpi-val down">${fmtCurr(l.support,2)}</div><div class="kpi-sub muted">-${fmtNum(l.dist_support,2)}%</div></div>
        <div class="kpi"><div class="kpi-label">Direnç</div><div class="kpi-val up">${fmtCurr(l.resistance,2)}</div><div class="kpi-sub muted">+${fmtNum(l.dist_resistance,2)}%</div></div>
        <div class="kpi"><div class="kpi-label">Sonraki Hedef</div><div class="kpi-val up">${fmtCurr(l.next_target,2)}</div></div>
      </div>
      ${l.chain_str ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Basamak Zinciri</div></div>
        <div style="padding:14px;font-family:var(--font-mono);font-size:13px;line-height:1.8">${escapeHtml(l.chain_str)}</div>
        <div style="padding:0 14px 14px"><div style="background:var(--panel-2);border-radius:6px;height:8px;position:relative">
          <div style="position:absolute;left:0;top:0;height:100%;width:${Math.max(0,Math.min(100,l.position_pct||0))}%;background:linear-gradient(90deg,var(--green),var(--accent));border-radius:6px"></div>
        </div><div class="muted" style="font-size:11px;margin-top:6px">Destek-Direnç arası konum: %${fmtNum(l.position_pct,1)}</div></div>
      </div>` : ""}
      ${Object.keys(a).length ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Strateji</div></div>
        <div style="padding:14px;display:grid;gap:10px;font-size:13px;line-height:1.6">
          ${a.konum ? `<div><b class="muted">Konum:</b><br>${escapeHtml(a.konum)}</div>`:""}
          ${a.destek ? `<div><b class="down">Destek:</b><br>${escapeHtml(a.destek)}</div>`:""}
          ${a.direnc ? `<div><b class="up">Direnç:</b><br>${escapeHtml(a.direnc)}</div>`:""}
          ${a.strateji_al ? `<div><b class="up">Alım Stratejisi:</b><br>${escapeHtml(a.strateji_al)}</div>`:""}
          ${a.strateji_stop ? `<div><b class="down">Stop:</b><br>${escapeHtml(a.strateji_stop)}</div>`:""}
        </div>
      </div>` : ""}
      ${(akd.top5_buyers||[]).length || (akd.top5_sellers||[]).length ? `
      <div class="grid g-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Top 5 Alıcı</div><div class="muted">Net: ${fmtVol(akd.net)} ${escapeHtml(akd.emoji||"")}</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Adet</th><th class="num">Oran %</th><th class="num">Maliyet</th></tr>
          ${(akd.top5_buyers||[]).map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num">${fmtVol(b.adet)}</td><td class="num">${fmtNum(b.oran,2)}%</td><td class="num">${fmtCurr(b.maliyet,2)}</td></tr>`).join("")}</table>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Top 5 Satıcı</div><div class="muted">${escapeHtml(akd.status||"")}</div></div>
          <table class="tbl"><tr><th>Kurum</th><th class="num">Adet</th><th class="num">Oran %</th><th class="num">Maliyet</th></tr>
          ${(akd.top5_sellers||[]).map(b => `<tr><td class="sym">${escapeHtml(b.kurum)}</td><td class="num">${fmtVol(b.adet)}</td><td class="num">${fmtNum(b.oran,2)}%</td><td class="num">${fmtCurr(b.maliyet,2)}</td></tr>`).join("")}</table>
        </div>
      </div>` : ""}
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Zincir verisi alınamadı.</div>`;
  }
}

/* ───────────── TEMETTÜ ───────────── */
async function renderTemettuTab(body, sym) {
  body.innerHTML = `<div class="loading">Temettü geçmişi çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/temettu?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const items = (r.veriler?.dividends || r.dividends || []);
    if (!items.length) { body.innerHTML = `<div class="muted">Temettü kaydı yok.</div>`; return; }
    body.innerHTML = `<div class="panel">
      <div class="panel-head"><div class="panel-title">${escapeHtml(sym)} — Temettü Geçmişi (${items.length})</div></div>
      <table class="tbl">
        <tr><th>Tarih</th><th class="num">Verim %</th><th class="num">Brüt/Hisse</th><th class="num">Net/Hisse</th><th class="num">Toplam Nakit</th><th class="num">Payout %</th><th>Ödendi</th></tr>
        ${items.map(d => `<tr>
          <td class="sym">${escapeHtml(d.date||"")}</td>
          <td class="num up">${fmtNum(d.dividend_yield,2)}%</td>
          <td class="num">${fmtCurr(d.gross_cash_per_share,4)}</td>
          <td class="num">${fmtCurr(d.net_cash_per_share,4)}</td>
          <td class="num">${fmtVol(d.cash_dividend)}</td>
          <td class="num">${fmtNum(d.payout_ratio,1)}%</td>
          <td>${d.paid?'<span class="tag green">Ödendi</span>':'<span class="tag amber">Bekliyor</span>'}</td>
        </tr>`).join("")}
      </table>
    </div>`;
  } catch {
    body.innerHTML = `<div class="error-box">Temettü alınamadı.</div>`;
  }
}

/* ───────────── KAP — İçeriden Alım/Satım Bildirimleri ───────────── */
async function renderKapTab(body, sym) {
  body.innerHTML = `<div class="loading">KAP bildirimleri çekiliyor…</div>`;
  try {
    const [payR, sirketR] = await Promise.all([
      API(`/api/v1/pay_alim_satim?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`).catch(() => null),
      API(`/api/v1/sirket_bilgileri?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`).catch(() => null),
    ]);
    const islemler = (payR?.islemler || payR?.veriler || payR?.data || []).slice(0, 80);
    const sb = sirketR?.sirket_bilgileri || sirketR?.bilgiler || sirketR || {};
    body.innerHTML = `
      ${Object.keys(sb).length > 3 ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Şirket Bilgileri (KAP)</div></div>
        <div class="kv">
          ${sb.ticaret_unvani ? `<div class="k">Unvan</div><div class="v">${escapeHtml(sb.ticaret_unvani)}</div>` : ""}
          ${sb.merkez ? `<div class="k">Merkez</div><div class="v">${escapeHtml(sb.merkez)}</div>` : ""}
          ${sb.faaliyet_alani ? `<div class="k">Faaliyet</div><div class="v">${escapeHtml(sb.faaliyet_alani)}</div>` : ""}
          ${sb.borsaya_giris_tarihi ? `<div class="k">Borsa'ya Giriş</div><div class="v">${escapeHtml(sb.borsaya_giris_tarihi)}</div>` : ""}
          ${sb.lot_buyuklugu != null ? `<div class="k">Lot Büyüklüğü</div><div class="v">${fmtVol(sb.lot_buyuklugu)}</div>` : ""}
          ${sb.toplam_hisse != null ? `<div class="k">Toplam Hisse</div><div class="v">${fmtVol(sb.toplam_hisse)}</div>` : ""}
          ${sb.piyasa_degeri != null ? `<div class="k">Piyasa Değeri</div><div class="v">${fmtVol(sb.piyasa_degeri)}</div>` : ""}
          ${sb.sermaye != null ? `<div class="k">Sermaye</div><div class="v">${fmtVol(sb.sermaye)}</div>` : ""}
          ${sb.halka_aciklik_orani != null ? `<div class="k">Halka Açıklık</div><div class="v">${fmtNum(sb.halka_aciklik_orani,2)}%</div>` : ""}
        </div>
      </div>` : ""}
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">İçeriden Pay Alım/Satım Bildirimleri (${islemler.length})</div>
        </div>
        ${islemler.length ? `<table class="tbl">
          <tr><th>Tarih</th><th>Kişi / Kurum</th><th>Unvan</th><th>İşlem</th><th class="num">Lot</th><th class="num">Fiyat</th><th class="num">Tutar</th><th class="num">Pay %</th></tr>
          ${islemler.map(x => {
            const isSat = (x.islem_turu||x.tip||"").toLowerCase().includes("sat");
            return `<tr>
              <td class="muted">${escapeHtml((x.tarih||x.bildirim_tarihi||"").replace("T"," ").slice(0,16))}</td>
              <td class="sym">${escapeHtml(x.kisi||x.ad_soyad||x.kurum||"")}</td>
              <td class="muted" style="font-size:10px">${escapeHtml(x.unvan||x.pozisyon||"")}</td>
              <td><span class="tag ${isSat?'red':'green'}">${escapeHtml(x.islem_turu||x.tip||"")}</span></td>
              <td class="num">${fmtVol(x.lot||x.adet||x.miktar)}</td>
              <td class="num">${fmtCurr(x.fiyat,2)}</td>
              <td class="num">${fmtVol(x.tutar||x.toplam_tutar)}</td>
              <td class="num">${x.pay_orani!=null?fmtNum(x.pay_orani,4)+"%":"—"}</td>
            </tr>`;
          }).join("")}
        </table>` : `<div class="muted" style="padding:14px">KAP bildirimi bulunamadı.</div>`}
      </div>
    `;
  } catch {
    body.innerHTML = `<div class="error-box">KAP verisi alınamadı.</div>`;
  }
}

/* ───────────── ANALİST — Hedef Fiyat & Tavsiyeler ───────────── */
async function renderAnalistTab(body, sym) {
  body.innerHTML = `<div class="loading">Analist tavsiyeleri çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/analist?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const hedefler = (r?.hedefler || r?.analist_hedefleri || r?.veriler || []).slice(0, 50);
    const ozet = r?.ozet || r?.tavsiye_ozeti || {};
    const consensus = r?.consensus || r?.konsensus || {};
    body.innerHTML = `
      ${(ozet.al != null || consensus.ortalama_hedef != null) ? `<div class="grid g-4" style="margin-bottom:14px">
        ${ozet.al != null ? `<div class="kpi"><div class="kpi-label">Al</div><div class="kpi-val up">${ozet.al}</div></div>` : ""}
        ${ozet.tut != null ? `<div class="kpi"><div class="kpi-label">Tut</div><div class="kpi-val muted">${ozet.tut}</div></div>` : ""}
        ${ozet.sat != null ? `<div class="kpi"><div class="kpi-label">Sat</div><div class="kpi-val down">${ozet.sat}</div></div>` : ""}
        ${consensus.ortalama_hedef != null ? `<div class="kpi"><div class="kpi-label">Ort. Hedef</div><div class="kpi-val up">${fmtCurr(consensus.ortalama_hedef,2)}</div><div class="kpi-sub muted">Upside ${fmtPct(consensus.upside)}</div></div>` : ""}
      </div>` : ""}
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Analist Hedef Fiyatları (${hedefler.length})</div></div>
        ${hedefler.length ? `<table class="tbl">
          <tr><th>Tarih</th><th>Kurum / Analist</th><th>Tavsiye</th><th class="num">Hedef Fiyat</th><th class="num">Önceki Hedef</th><th class="num">Upside %</th></tr>
          ${hedefler.map(x => {
            const isAl = (x.tavsiye||x.tavsiye_turu||"").toLowerCase().includes("al")||["buy","strong buy","outperform"].includes((x.tavsiye||"").toLowerCase());
            const isSat = (x.tavsiye||x.tavsiye_turu||"").toLowerCase().includes("sat")||["sell","underperform","reduce"].includes((x.tavsiye||"").toLowerCase());
            return `<tr>
              <td class="muted">${escapeHtml((x.tarih||x.rapor_tarihi||"").slice(0,10))}</td>
              <td class="sym">${escapeHtml(x.kurum||x.analist_kurum||x.kaynak||"")}</td>
              <td><span class="tag ${isAl?'green':isSat?'red':'amber'}">${escapeHtml(x.tavsiye||x.tavsiye_turu||"Tut")}</span></td>
              <td class="num up">${fmtCurr(x.hedef_fiyat||x.fiyat,2)}</td>
              <td class="num muted">${x.onceki_hedef!=null?fmtCurr(x.onceki_hedef,2):"—"}</td>
              <td class="num ${colorClass(x.upside)}">${x.upside!=null?fmtPct(x.upside):"—"}</td>
            </tr>`;
          }).join("")}
        </table>` : `<div class="muted" style="padding:14px">Analist tavsiyesi bulunamadı.</div>`}
      </div>
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Analist verisi alınamadı.</div>`;
  }
}

/* ───────────── GERİ ALIM — Hisse Geri Alım Programları ───────────── */
async function renderGeriAlimTab(body, sym) {
  body.innerHTML = `<div class="loading">Geri alım verileri çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/geri_alimlar?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const aktif = r?.aktif_program || r?.program || {};
    const gecmis = (r?.gecmis_islemler || r?.islemler || r?.veriler || []).slice(0, 60);
    const istatistik = r?.istatistik || r?.ozet || {};
    body.innerHTML = `
      ${(aktif.baslangic || aktif.hedef_adet) ? `<div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><div class="panel-title">Aktif Geri Alım Programı</div></div>
        <div class="kv">
          ${aktif.baslangic ? `<div class="k">Başlangıç</div><div class="v">${escapeHtml(aktif.baslangic)}</div>` : ""}
          ${aktif.bitis ? `<div class="k">Bitiş</div><div class="v">${escapeHtml(aktif.bitis)}</div>` : ""}
          ${aktif.hedef_adet != null ? `<div class="k">Hedef Adet</div><div class="v">${fmtVol(aktif.hedef_adet)}</div>` : ""}
          ${aktif.alınan_adet != null ? `<div class="k">Alınan Adet</div><div class="v">${fmtVol(aktif.alinan_adet||aktif.alınan_adet)}</div>` : ""}
          ${aktif.butce != null ? `<div class="k">Bütçe</div><div class="v">${fmtVol(aktif.butce)}</div>` : ""}
          ${aktif.harcanan != null ? `<div class="k">Harcanan</div><div class="v">${fmtVol(aktif.harcanan)}</div>` : ""}
        </div>
      </div>` : ""}
      ${Object.keys(istatistik).length > 0 ? `<div class="grid g-4" style="margin-bottom:14px">
        ${istatistik.toplam_adet != null ? `<div class="kpi"><div class="kpi-label">Toplam Alınan</div><div class="kpi-val">${fmtVol(istatistik.toplam_adet)}</div></div>` : ""}
        ${istatistik.toplam_tutar != null ? `<div class="kpi"><div class="kpi-label">Toplam Tutar</div><div class="kpi-val">${fmtVol(istatistik.toplam_tutar)}</div></div>` : ""}
        ${istatistik.ort_maliyet != null ? `<div class="kpi"><div class="kpi-label">Ort. Maliyet</div><div class="kpi-val">${fmtCurr(istatistik.ort_maliyet,2)}</div></div>` : ""}
        ${istatistik.portfoy_pct != null ? `<div class="kpi"><div class="kpi-label">Portföy %</div><div class="kpi-val">${fmtNum(istatistik.portfoy_pct,2)}%</div></div>` : ""}
      </div>` : ""}
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Geri Alım İşlemleri (${gecmis.length})</div></div>
        ${gecmis.length ? `<table class="tbl">
          <tr><th>Tarih</th><th class="num">Adet</th><th class="num">Fiyat (Ort.)</th><th class="num">Tutar</th><th class="num">Birikimli %</th></tr>
          ${gecmis.map(x => `<tr>
            <td class="muted">${escapeHtml((x.tarih||x.islem_tarihi||"").slice(0,10))}</td>
            <td class="num">${fmtVol(x.adet||x.lot)}</td>
            <td class="num">${fmtCurr(x.fiyat||x.ort_fiyat,2)}</td>
            <td class="num">${fmtVol(x.tutar||x.toplam)}</td>
            <td class="num muted">${x.birikimli_pct!=null?fmtNum(x.birikimli_pct,3)+"%":"—"}</td>
          </tr>`).join("")}
        </table>` : `<div class="muted" style="padding:14px">Geri alım işlemi bulunamadı.</div>`}
      </div>
    `;
  } catch {
    body.innerHTML = `<div class="error-box">Geri alım verisi alınamadı.</div>`;
  }
}

/* ───────────── AKIŞ — Sembol Aktivite Akışı ───────────── */
async function renderAkisTab(body, sym) {
  body.innerHTML = `<div class="loading">Akış verisi çekiliyor…</div>`;
  try {
    const r = await API(`/api/v1/akis?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    const items = (r?.veriler || r?.akis || r?.items || r?.data || []).slice(0, 60);
    if (!items.length) {
      body.innerHTML = `<div class="muted" style="padding:14px">Akış verisi yok.</div>`;
      return;
    }
    const typeIcon = (t) => {
      const tl = (t||"").toLowerCase();
      if (tl.includes("haber") || tl.includes("news")) return "📰";
      if (tl.includes("kap") || tl.includes("bildirim")) return "📋";
      if (tl.includes("analist") || tl.includes("hedef")) return "🎯";
      if (tl.includes("temett") || tl.includes("temettu")) return "💰";
      if (tl.includes("genel kurul") || tl.includes("gk")) return "🏛";
      if (tl.includes("faaliyet") || tl.includes("rapor")) return "📊";
      return "📌";
    };
    body.innerHTML = `<div class="panel">
      <div class="panel-head"><div class="panel-title">${escapeHtml(sym)} — Aktivite Akışı (${items.length})</div></div>
      <div class="news-list">${items.map(item => {
        const baslik = item.baslik || item.title || item.konu || item.subject || "";
        const icerik = item.icerik || item.content || item.ozet || item.summary || "";
        const tarih  = item.tarih || item.date || item.created_at || "";
        const tip    = item.tip || item.type || item.kategori || "";
        const kaynak = item.kaynak || item.source || "";
        const url    = item.url || item.link || "";
        return `<div class="news-card">
          <div class="news-head">
            <div class="news-meta">
              <div class="news-author"><b>${typeIcon(tip)} ${escapeHtml(tip||"Etkinlik")}</b> ${kaynak ? `<span class="muted" style="font-size:11px">— ${escapeHtml(kaynak)}</span>` : ""}</div>
              <div class="muted" style="font-size:11px">${escapeHtml(tarih.replace("T"," ").slice(0,16))}</div>
            </div>
            ${url ? `<a class="btn" href="${escapeHtml(url)}" target="_blank">Aç ↗</a>` : ""}
          </div>
          ${baslik ? `<div class="news-body" style="font-weight:600;margin-bottom:4px">${escapeHtml(baslik)}</div>` : ""}
          ${icerik ? `<div class="news-body muted" style="font-size:12px">${escapeHtml(icerik.slice(0,400))}${icerik.length>400?"…":""}</div>` : ""}
        </div>`;
      }).join("")}</div>
    </div>`;
  } catch {
    body.innerHTML = `<div class="error-box">Akış verisi alınamadı.</div>`;
  }
}

/* ───────────── KURUMSAL AKD (Piyasa AKD + Kurum Detay) ───────────── */
async function renderKurumsal(el) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="tabs scrollx" id="kur-tabs" style="margin-bottom:14px">
      <span class="tab active" data-kurtab="piyasa">Piyasa AKD</span>
      <span class="tab" data-kurtab="kurum">Kurum Detay</span>
    </div>
    <div id="kur-body"></div>
  `;
  let activeKurTab = "piyasa";
  $$(".tab", $("#kur-tabs")).forEach(t => t.onclick = () => {
    activeKurTab = t.dataset.kurtab;
    $$(".tab", $("#kur-tabs")).forEach(x => x.classList.toggle("active", x === t));
    renderKurTab();
  });

  function renderKurTab() {
    if (activeKurTab === "piyasa") renderPiyasaAkd($("#kur-body"));
    else renderKurumDetay($("#kur-body"));
  }
  renderKurTab();
}

async function renderPiyasaAkd(el) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">Piyasa Geneli AKD</div>
        <div class="panel-actions">
          <input type="date" id="pakd-ilk" value="${ago30}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <input type="date" id="pakd-son" value="${today}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <button class="btn primary" id="pakd-go">Getir</button>
        </div>
      </div>
    </div>
    <div id="pakd-results"><div class="muted" style="padding:14px">Tarih aralığı seçip "Getir"e tıklayın.</div></div>
  `;
  $("#pakd-go").onclick = async () => {
    const ilk = $("#pakd-ilk").value;
    const son = $("#pakd-son").value;
    const res = $("#pakd-results");
    res.innerHTML = `<div class="loading">Piyasa AKD verileri alınıyor…</div>`;
    try {
      const r = await API(`/api/v1/piyasa_akd?ilk=${ilk}&son=${son}&user_id=${USER_ID}`);
      const kurumlar = r?.kurumlar || r?.veriler || r?.data || [];
      if (!kurumlar.length) { res.innerHTML = `<div class="muted" style="padding:14px">Bu aralık için veri yok.</div>`; return; }
      res.innerHTML = `<div class="panel">
        <div class="panel-head">
          <div class="panel-title">Piyasa AKD — ${escapeHtml(r?.ilk||ilk)} / ${escapeHtml(r?.son||son)}</div>
          <div class="muted small">${kurumlar.length} kurum</div>
        </div>
        <table class="tbl">
          <tr>
            <th>Kurum</th>
            <th class="num">Net (TL)</th>
            <th class="num">Alış (TL)</th>
            <th class="num">Satış (TL)</th>
            <th class="num">Hisse Sayısı</th>
            <th class="num">Oran %</th>
          </tr>
          ${kurumlar.map(k => {
            const net = k.net ?? k.net_tl ?? k.net_lot ?? 0;
            return `<tr>
              <td class="sym">${escapeHtml(k.kurum||k.kod||k.kodu||"")}</td>
              <td class="num ${colorClass(net)}">${fmtVol(net)}</td>
              <td class="num up">${fmtVol(k.alis||k.alis_tl||k.alish||0)}</td>
              <td class="num down">${fmtVol(k.satis||k.satis_tl||k.satish||0)}</td>
              <td class="num">${k.hisse_sayisi??k.hisse_sayi??k.sayi??"-"}</td>
              <td class="num">${k.oran!=null?fmtNum(k.oran,2)+"%":"—"}</td>
            </tr>`;
          }).join("")}
        </table>
      </div>`;
    } catch {
      res.innerHTML = `<div class="error-box">Piyasa AKD verisi alınamadı.</div>`;
    }
  };
}

async function renderKurumDetay(el) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">Aracı Kurum Detay</div>
        <div class="panel-actions" style="flex-wrap:wrap;gap:6px">
          <input id="kd-kurum" placeholder="Kurum kodu (örn. IS)" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px;width:120px">
          <input type="date" id="kd-ilk" value="${ago30}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <input type="date" id="kd-son" value="${today}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <button class="btn primary" id="kd-go">Getir</button>
        </div>
      </div>
    </div>
    <div id="kd-results"><div class="muted" style="padding:14px">Kurum kodu ve tarih aralığı seçip "Getir"e tıklayın.</div></div>
  `;
  $("#kd-go").onclick = async () => {
    const kurum = $("#kd-kurum").value.trim().toUpperCase();
    const ilk = $("#kd-ilk").value;
    const son = $("#kd-son").value;
    const res = $("#kd-results");
    if (!kurum) { res.innerHTML = `<div class="error-box">Kurum kodu giriniz.</div>`; return; }
    res.innerHTML = `<div class="loading">Kurum AKD verisi alınıyor…</div>`;
    try {
      const r = await API(`/api/v1/kurum_akd?kurum=${encodeURIComponent(kurum)}&ilk=${ilk}&son=${son}&user_id=${USER_ID}`);
      const veriler = r?.veriler || r?.data || [];
      const grafik  = r?.grafik  || [];
      res.innerHTML = `
        <div class="grid g-4" style="margin-bottom:14px">
          <div class="kpi"><div class="kpi-label">Kurum</div><div class="kpi-val">${escapeHtml(r?.kurum_ad||r?.kurum||kurum)}</div></div>
          <div class="kpi"><div class="kpi-label">Dönem</div><div class="kpi-val" style="font-size:12px">${escapeHtml(r?.ilk||ilk)} – ${escapeHtml(r?.son||son)}</div></div>
          <div class="kpi"><div class="kpi-label">Hisse Sayısı</div><div class="kpi-val">${r?.hisse_sayisi??"-"}</div></div>
          <div class="kpi"><div class="kpi-label">Kayıt Sayısı</div><div class="kpi-val">${veriler.length}</div></div>
        </div>
        ${veriler.length ? `<div class="panel">
          <div class="panel-head"><div class="panel-title">${escapeHtml(r?.kurum_ad||kurum)} — Hisse Pozisyonları</div></div>
          <div style="max-height:480px;overflow:auto"><table class="tbl">
            <tr><th>Sembol</th><th class="num">Net (Lot)</th><th class="num">Alış</th><th class="num">Satış</th><th class="num">Maliyet</th><th class="num">Pay %</th></tr>
            ${veriler.map(v => {
              const net = v.net??v.net_lot??v.net_tl??0;
              return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(v.sembol||"")}')">
                <td class="sym">${escapeHtml(v.sembol||"")}</td>
                <td class="num ${colorClass(net)}">${fmtVol(net)}</td>
                <td class="num up">${fmtVol(v.alis??v.alis_lot??0)}</td>
                <td class="num down">${fmtVol(v.satis??v.satis_lot??0)}</td>
                <td class="num">${v.maliyet!=null?fmtCurr(v.maliyet,2):"—"}</td>
                <td class="num">${v.oran!=null?fmtNum(v.oran,2)+"%":"—"}</td>
              </tr>`;
            }).join("")}
          </table></div>
        </div>` : `<div class="muted" style="padding:14px">Bu kurum için veri yok.</div>`}
      `;
    } catch {
      res.innerHTML = `<div class="error-box">Kurum AKD verisi alınamadı.</div>`;
    }
  };
}

/* ───────────── TAKAS TARAMA (analiztakas) ───────────── */
async function renderTakasAnaliz(el) {
  const today = new Date().toISOString().slice(0, 10);
  const ago7  = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">Piyasa Geneli Kurum Takas Taraması</div>
        <div class="panel-actions" style="flex-wrap:wrap;gap:6px">
          <input type="date" id="ta-ilk" value="${ago7}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <input type="date" id="ta-son" value="${today}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <button class="btn primary" id="ta-go">Tara</button>
        </div>
      </div>
      <div style="padding:0 14px 10px">
        <input id="ta-filter" placeholder="Sembol filtrele…" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:5px 8px;color:var(--text);font-size:11px;width:200px">
      </div>
    </div>
    <div id="ta-results"><div class="muted" style="padding:14px">Tarih aralığı seçip "Tara"ya tıklayın.</div></div>
  `;
  let taAllData = [];
  $("#ta-go").onclick = async () => {
    const ilk = $("#ta-ilk").value;
    const son = $("#ta-son").value;
    const res = $("#ta-results");
    res.innerHTML = `<div class="loading">Takas taraması yapılıyor…</div>`;
    try {
      const r = await API(`/api/v1/analiztakas?ilk=${ilk}&son=${son}&user_id=${USER_ID}`);
      taAllData = Array.isArray(r) ? r : (r?.veriler || r?.data || r?.semboller || []);
      renderTaFiltered();
    } catch {
      res.innerHTML = `<div class="error-box">Takas tarama verisi alınamadı.</div>`;
    }
  };
  $("#ta-filter").addEventListener("input", renderTaFiltered);

  function renderTaFiltered() {
    const res = $("#ta-results");
    if (!res) return;
    if (!taAllData.length) { res.innerHTML = `<div class="muted" style="padding:14px">Veri yok.</div>`; return; }
    const filterEl = $("#ta-filter");
    const q = (filterEl ? filterEl.value : "").toUpperCase().trim();
    const rows = taAllData.filter(x => !q || (x.sembol||"").toUpperCase().includes(q));
    res.innerHTML = `<div class="panel">
      <div class="panel-head">
        <div class="panel-title">Takas Tarama Sonuçları</div>
        <div class="muted small">${rows.length} sembol</div>
      </div>
      <div style="max-height:600px;overflow:auto"><table class="tbl">
        <tr>
          <th>Sembol</th>
          <th class="num">Fiyat</th>
          <th class="num">Değ %</th>
          <th class="num">Hacim</th>
          <th class="num">Puan</th>
          <th>Trend</th>
          <th>Sinyal</th>
          <th>Risk</th>
          <th>Hareket</th>
        </tr>
        ${rows.map(x => {
          const a = x.analiz || x;
          const sinyal = a.sinyal || a.sinyaller?.[0] || "";
          const trend  = a.trend  || "";
          const risk   = a.risk   || "";
          const hareket = a.hareket;
          const puan   = a.puan ?? a.skor ?? null;
          return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(x.sembol||"")}')">
            <td class="sym">${escapeHtml(x.sembol||"")}</td>
            <td class="num">${fmtCurr(x.fiyat,2)}</td>
            <td class="num pct ${colorClass(x.degisim)}">${fmtPct(x.degisim)}</td>
            <td class="num">${fmtVol(x.hacim)}</td>
            <td class="num">${puan!=null?fmtNum(puan,1):"—"}</td>
            <td><span class="tag ${trend.toLowerCase().includes("yük")||trend.toLowerCase().includes("al")?"green":trend.toLowerCase().includes("düş")||trend.toLowerCase().includes("sat")?"red":"amber"}">${escapeHtml(trend||"—")}</span></td>
            <td style="font-size:11px">${escapeHtml(String(sinyal||"—").slice(0,30))}</td>
            <td><span class="tag ${risk.toLowerCase().includes("yük")?"red":risk.toLowerCase().includes("düş")?"green":"amber"}">${escapeHtml(risk||"—")}</span></td>
            <td class="num ${colorClass(hareket)}">${hareket!=null?fmtPct(hareket):"—"}</td>
          </tr>`;
        }).join("")}
      </table></div>
    </div>`;
  }
}

/* ───────────── KAP PAY (Tüm Piyasa İçeriden Alım/Satım) ───────────── */
async function renderKapPay(el) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div class="panel-title">KAP Pay Bildirimleri — Tüm Piyasa</div>
        <div class="panel-actions" style="flex-wrap:wrap;gap:6px">
          <input type="date" id="kp-ilk" value="${ago30}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <input type="date" id="kp-son" value="${today}" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:4px 8px;color:var(--text);font-size:11px">
          <button class="btn primary" id="kp-go">Getir</button>
        </div>
      </div>
      <div style="padding:0 14px 10px;display:flex;gap:8px;flex-wrap:wrap">
        <input id="kp-filter" placeholder="Sembol / kişi filtrele…" style="background:var(--panel-2);border:1px solid var(--border-2);border-radius:5px;padding:5px 8px;color:var(--text);font-size:11px;width:220px">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim)">
          <input type="checkbox" id="kp-only-buy"> Sadece Alış
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim)">
          <input type="checkbox" id="kp-only-sell"> Sadece Satış
        </label>
      </div>
    </div>
    <div id="kp-results"><div class="muted" style="padding:14px">Tarih aralığı seçip "Getir"e tıklayın.</div></div>
  `;
  let kpAllData = [];
  $("#kp-go").onclick = async () => {
    const ilk = $("#kp-ilk").value;
    const son = $("#kp-son").value;
    const res = $("#kp-results");
    res.innerHTML = `<div class="loading">KAP bildirimleri alınıyor…</div>`;
    try {
      const r = await API(`/api/v1/tum_pay_alim_satim?ilk=${ilk}&son=${son}&user_id=${USER_ID}`);
      kpAllData = r?.veriler || r?.islemler || r?.data || [];
      if (!kpAllData.length && Array.isArray(r)) kpAllData = r;
      renderKpFiltered();
    } catch {
      res.innerHTML = `<div class="error-box">KAP verisi alınamadı.</div>`;
    }
  };
  $("#kp-filter").addEventListener("input", renderKpFiltered);
  $("#kp-only-buy").addEventListener("change", renderKpFiltered);
  $("#kp-only-sell").addEventListener("change", renderKpFiltered);

  function renderKpFiltered() {
    const res = $("#kp-results");
    if (!res) return;
    if (!kpAllData.length) { res.innerHTML = `<div class="muted" style="padding:14px">Veri yok.</div>`; return; }
    const kpFilter = $("#kp-filter"), kpBuy = $("#kp-only-buy"), kpSell = $("#kp-only-sell");
    const q     = (kpFilter ? kpFilter.value : "").toUpperCase().trim();
    const onBuy  = kpBuy ? kpBuy.checked : false;
    const onSell = kpSell ? kpSell.checked : false;
    let rows = kpAllData.filter(x => {
      if (q) {
        const sym  = (x.sembol||x.hisse||"").toUpperCase();
        const kisi = (x.kisi||x.ad_soyad||x.ad||"").toUpperCase();
        if (!sym.includes(q) && !kisi.includes(q)) return false;
      }
      const isSat = (x.islem_turu||x.tip||"").toLowerCase().includes("sat");
      if (onBuy  && isSat)  return false;
      if (onSell && !isSat) return false;
      return true;
    }).slice(0, 500);
    const totalAlis = kpAllData.filter(x => !(x.islem_turu||x.tip||"").toLowerCase().includes("sat")).length;
    const totalSat  = kpAllData.length - totalAlis;
    res.innerHTML = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="kpi-label">Toplam Bildirim</div><div class="kpi-val">${kpAllData.length}</div></div>
        <div class="kpi"><div class="kpi-label">Alış</div><div class="kpi-val up">${totalAlis}</div></div>
        <div class="kpi"><div class="kpi-label">Satış</div><div class="kpi-val down">${totalSat}</div></div>
        <div class="kpi"><div class="kpi-label">Gösterilen</div><div class="kpi-val">${rows.length}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">İçeriden Pay Alım/Satım Bildirimleri</div></div>
        ${rows.length ? `<div style="max-height:560px;overflow:auto"><table class="tbl">
          <tr><th>Tarih</th><th>Sembol</th><th>Kişi / Kurum</th><th>Unvan</th><th>İşlem</th><th class="num">Lot</th><th class="num">Fiyat</th><th class="num">Tutar</th><th class="num">Pay %</th></tr>
          ${rows.map(x => {
            const isSat = (x.islem_turu||x.tip||"").toLowerCase().includes("sat");
            return `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(x.sembol||x.hisse||"")}')">
              <td class="muted">${escapeHtml((x.tarih||x.bildirim_tarihi||x.islem_tarihi||"").replace("T"," ").slice(0,16))}</td>
              <td class="sym">${escapeHtml(x.sembol||x.hisse||"")}</td>
              <td class="sym">${escapeHtml(x.kisi||x.ad_soyad||x.ad||x.kurum||"")}</td>
              <td class="muted" style="font-size:10px">${escapeHtml(x.unvan||x.pozisyon||x.gorev||"")}</td>
              <td><span class="tag ${isSat?"red":"green"}">${escapeHtml(x.islem_turu||x.tip||"")}</span></td>
              <td class="num">${fmtVol(x.lot||x.adet||x.miktar)}</td>
              <td class="num">${fmtCurr(x.fiyat,2)}</td>
              <td class="num">${fmtVol(x.tutar||x.toplam_tutar||x.toplam)}</td>
              <td class="num">${x.pay_orani!=null?fmtNum(x.pay_orani,4)+"%":x.oran!=null?fmtNum(x.oran,4)+"%":"—"}</td>
            </tr>`;
          }).join("")}
        </table></div>` : `<div class="muted" style="padding:14px">Eşleşen bildirim yok.</div>`}
      </div>
    `;
  }
}

/* ───────────── GLOBAL SEARCH ───────────── */
function setupSearch() {
  const inp = $("#global-search"), res = $("#search-results");
  let timer, activeIdx = -1;

  inp.addEventListener("input", () => {
    activeIdx = -1;
    clearTimeout(timer);
    timer = setTimeout(doSearch, 80);
  });
  inp.addEventListener("focus", doSearch);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) { res.classList.add("hidden"); activeIdx = -1; }
  });

  function doSearch() {
    const q = inp.value.toUpperCase().trim();
    if (!q) { res.classList.add("hidden"); return; }
    const syms = state.symbols;
    // prioritise prefix matches, then include any contains match
    const prefix  = syms.filter(s => s.startsWith(q));
    const contain = syms.filter(s => !s.startsWith(q) && s.includes(q));
    const matches = [...prefix, ...contain].slice(0, 40);
    if (!matches.length) {
      res.innerHTML = `<div class="row"><span class="muted">Sembol bulunamadı: <b>${escapeHtml(q)}</b></span></div>`;
      res.classList.remove("hidden");
      return;
    }
    res.innerHTML = matches.map((s, i) => {
      const pData = state.prices[s];
      const priceHtml = pData?.fiyat != null
        ? `<span class="mono" style="font-size:11.5px;color:var(--text-dim)">${fmtCurr(pData.fiyat,2)} <span class="${colorClass(pData.degisim)}">${fmtPct(pData.degisim)}</span></span>`
        : `<span class="muted" style="font-size:11px">↗</span>`;
      return `<div class="row${i===activeIdx?' active':''}" data-sr-idx="${i}"
        onclick="navTo('symbol','${escapeHtml(s)}');document.getElementById('global-search').value='';document.getElementById('search-results').classList.add('hidden')">
        <span class="sym">${escapeHtml(s)}</span>
        ${priceHtml}
      </div>`;
    }).join("");
    res.classList.remove("hidden");
  }

  inp.addEventListener("keydown", (e) => {
    const rows = $$(".row", res);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("active", i === activeIdx));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("active", i === activeIdx));
    } else if (e.key === "Enter") {
      const q = inp.value.toUpperCase().trim();
      const activeRow = rows[activeIdx];
      if (activeRow) { activeRow.click(); }
      else if (q) { navTo("symbol", q); inp.value = ""; res.classList.add("hidden"); }
    } else if (e.key === "Escape") {
      res.classList.add("hidden"); inp.blur();
    }
  });

  // "/" shortcut to focus search from anywhere
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== inp &&
        !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      inp.focus();
      inp.select();
    }
  });
}

/* ═══════════════════════════════════════════════════════
   LOCALSTORAGE HELPERS
   ═══════════════════════════════════════════════════════ */

// ── Portfolio ──
function getPortfolio() { try { return JSON.parse(localStorage.getItem("hp.portfolio") || "[]"); } catch { return []; } }
function savePortfolio(p) { localStorage.setItem("hp.portfolio", JSON.stringify(p)); updatePortfolioBadge(); }
function updatePortfolioBadge() {
  const p = getPortfolio();
  const badge = document.getElementById("portfolio-badge");
  if (!badge) return;
  if (p.length) { badge.textContent = p.length; badge.style.display = ""; }
  else badge.style.display = "none";
}

// ── Recent Symbols ──
function trackRecent(sym) {
  try {
    let recent = JSON.parse(localStorage.getItem("hp.recent") || "[]");
    recent = [sym, ...recent.filter(s => s !== sym)].slice(0, 10);
    localStorage.setItem("hp.recent", JSON.stringify(recent));
    updateRecentSidebar();
  } catch {/**/}
}
function getRecent() { try { return JSON.parse(localStorage.getItem("hp.recent") || "[]"); } catch { return []; } }
function updateRecentSidebar() {
  const recent = getRecent();
  const section = document.getElementById("recent-section");
  const list = document.getElementById("recent-list");
  if (!section || !list) return;
  if (!recent.length) { section.style.display = "none"; return; }
  section.style.display = "";
  list.innerHTML = recent.map(s => {
    const p = state.prices[s];
    const px = p?.fiyat != null ? fmtCurr(p.fiyat, 2) : "";
    const chg = p?.degisim != null
      ? `<span class="${colorClass(p.degisim)}" style="font-size:9px">${fmtPct(p.degisim)}</span>` : "";
    return `<div class="recent-sym-item" onclick="navTo('symbol','${escapeHtml(s)}')">
      <span class="sym">${escapeHtml(s)}</span>
      <span class="rpx">${px} ${chg}</span>
    </div>`;
  }).join("");
}

// ── Notes ──
function getNotes(sym) { return localStorage.getItem(`hp.notes.${sym}`) || ""; }
function setNotes(sym, txt) { localStorage.setItem(`hp.notes.${sym}`, txt); }

// ── Local Alarms ──
function getLocalAlarms() { try { return JSON.parse(localStorage.getItem("hp.alarms") || "[]"); } catch { return []; } }
function saveLocalAlarms(a) { localStorage.setItem("hp.alarms", JSON.stringify(a)); updateAlarmsBadge(); }
function addLocalAlarm(sembol, tip, fiyat, note) {
  const alarms = getLocalAlarms();
  alarms.push({ id: Date.now(), sembol: sembol.toUpperCase(), tip, fiyat: parseFloat(fiyat), note: note || "", aktif: true, triggered: false, createdAt: new Date().toISOString() });
  saveLocalAlarms(alarms);
}
function removeLocalAlarm(id) { saveLocalAlarms(getLocalAlarms().filter(a => a.id !== id)); }
function updateAlarmsBadge() {
  const active = getLocalAlarms().filter(a => a.aktif && !a.triggered).length;
  const badge = document.getElementById("alarms-badge");
  if (!badge) return;
  if (active) { badge.textContent = active; badge.style.display = ""; }
  else badge.style.display = "none";
}

/* ═══════════════════════════════════════════════════════
   MARKET STATUS
   ═══════════════════════════════════════════════════════ */
function getMarketStatus() {
  const istanbul = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  const day  = istanbul.getDay(); // 0=Sun, 6=Sat
  const mins = istanbul.getHours() * 60 + istanbul.getMinutes();
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday)                        return { status: "closed", label: "KAPALI" };
  if (mins >= 570  && mins < 600)        return { status: "pre",    label: "SEANS ÖNCESİ" };
  if (mins >= 600  && mins < 1080)       return { status: "open",   label: "AÇIK" };
  if (mins >= 1080 && mins < 1090)       return { status: "pre",    label: "KAPANIYOR" };
  return { status: "closed", label: "KAPALI" };
}
function updateMarketBadge() {
  const badge = document.getElementById("market-status");
  if (!badge) return;
  const { status, label } = getMarketStatus();
  badge.className = `market-badge ${status}`;
  badge.textContent = `BIST ${label}`;
}

/* ═══════════════════════════════════════════════════════
   ALARM CHECKER (runs every 30s in background)
   ═══════════════════════════════════════════════════════ */
async function checkAlarms() {
  const alarms = getLocalAlarms().filter(a => a.aktif && !a.triggered);
  if (!alarms.length) return;
  const syms = [...new Set(alarms.map(a => a.sembol))];
  try {
    const r = await API(`/api/v1/fiyatlar?semboller=${syms.join(",")}&user_id=${USER_ID}`);
    const fiyatlar = r?.fiyatlar || {};
    const all = getLocalAlarms();
    let changed = false;
    all.forEach(alarm => {
      if (!alarm.aktif || alarm.triggered) return;
      const fiyat = fiyatlar[alarm.sembol]?.fiyat;
      if (fiyat == null) return;
      const triggered = alarm.tip === "above" ? fiyat >= alarm.fiyat : fiyat <= alarm.fiyat;
      if (triggered) {
        alarm.triggered = true;
        alarm.triggeredAt = new Date().toISOString();
        alarm.triggeredPrice = fiyat;
        changed = true;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`Alarm: ${alarm.sembol}`, {
            body: `${alarm.sembol} ${alarm.tip === "above" ? "≥" : "≤"} ₺${alarm.fiyat} — Güncel: ₺${fiyat.toFixed(2)}`,
            icon: "/favicon.ico",
          });
        }
      }
    });
    if (changed) saveLocalAlarms(all);
  } catch {/**/}
}

/* ═══════════════════════════════════════════════════════
   CANDLESTICK CHART
   ═══════════════════════════════════════════════════════ */
function svgCandleChart(t, o, h, l, c) {
  const W = 800, H = 320, padL = 52, padR = 20, padT = 16, padB = 28;
  const min = Math.min(...l), max = Math.max(...h);
  const range = (max - min) || 1;
  const n = t.length;
  const chartW = W - padL - padR;
  const barW = Math.max(1, Math.floor(chartW / n * 0.65));
  const toY = v => padT + (1 - (v - min) / range) * (H - padT - padB);
  const toX = i => padL + (i + 0.5) * chartW / n;
  const labels = [];
  for (let i = 0; i <= 4; i++) {
    const v = max - (range * i / 4);
    const y = padT + (i / 4) * (H - padT - padB);
    labels.push(`<text x="${padL-6}" y="${y+4}" fill="#5b6573" font-size="10" text-anchor="end" font-family="ui-monospace">${v.toFixed(2)}</text>
                 <line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="#1b232f" stroke-dasharray="2,3"/>`);
  }
  const fmtDate = ts => new Date(ts*1000).toLocaleDateString("tr-TR", { day:"2-digit", month:"short" });
  const xIdxs = [0, Math.floor(n/4), Math.floor(n/2), Math.floor(n*3/4), n-1];
  const xLabels = xIdxs.map(i => `<text x="${toX(i)}" y="${H-8}" fill="#5b6573" font-size="10" text-anchor="middle" font-family="ui-monospace">${fmtDate(t[i])}</text>`).join("");
  const candles = t.map((_, i) => {
    const x = toX(i);
    const isUp = c[i] >= o[i];
    const color = isUp ? "#2ec27e" : "#ff4757";
    const openY = toY(o[i]), closeY = toY(c[i]), highY = toY(h[i]), lowY = toY(l[i]);
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(openY - closeY));
    return `<line x1="${x}" x2="${x}" y1="${highY}" y2="${lowY}" stroke="${color}" stroke-width="1"/>
            <rect x="${x - barW/2}" y="${bodyTop}" width="${barW}" height="${bodyH}" fill="${color}" rx="0.5"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${labels.join("")}
    ${candles}
    ${xLabels}
  </svg>`;
}

/* ═══════════════════════════════════════════════════════
   PORTFOLIO PAGE
   ═══════════════════════════════════════════════════════ */
async function renderPortfolio(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Pozisyon Ekle</div></div>
      <div style="padding:12px 16px">
        <div class="pf-add-form">
          <input id="pf-sym"   type="text"   placeholder="Sembol" maxlength="10" class="sym-inp">
          <input id="pf-adet"  type="number" placeholder="Adet"   min="0.0001" step="any" class="num-inp">
          <input id="pf-fiyat" type="number" placeholder="Alış Fiyatı (₺)" step="0.0001" class="num-inp">
          <input id="pf-not"   type="text"   placeholder="Not (opsiyonel)" style="flex:1;min-width:120px">
          <button class="btn primary" onclick="pfAdd()">+ Ekle</button>
        </div>
        <div id="pf-form-err" style="color:var(--red);font-size:12px;min-height:16px"></div>
      </div>
    </div>
    <div id="pf-summary" class="pf-kpi-row" style="margin-bottom:14px"></div>
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Pozisyonlar</div>
        <div class="panel-actions"><button class="btn" id="pf-refresh-btn">↻ Güncelle</button></div>
      </div>
      <div id="pf-body" class="loading">…</div>
    </div>
  `;
  const pfSymInp = document.getElementById("pf-sym");
  if (pfSymInp) pfSymInp.addEventListener("keyup", e => { e.target.value = e.target.value.toUpperCase(); });
  document.getElementById("pf-refresh-btn").onclick = () => loadPf();

  async function loadPf() {
    const positions = getPortfolio();
    const pfBody = document.getElementById("pf-body");
    const pfSum  = document.getElementById("pf-summary");
    if (!pfBody) return;
    if (!positions.length) {
      pfBody.innerHTML = `<div class="muted" style="padding:16px 20px">Henüz pozisyon eklenmemiş. Yukarıdan ekleyebilirsiniz.</div>`;
      if (pfSum) pfSum.innerHTML = "";
      return;
    }
    pfBody.innerHTML = `<div class="loading" style="padding:16px">Fiyatlar alınıyor…</div>`;
    const syms = [...new Set(positions.map(p => p.sembol))];
    let fiyatlar = {};
    try {
      const r = await API(`/api/v1/fiyatlar?semboller=${syms.join(",")}&user_id=${USER_ID}`);
      fiyatlar = r?.fiyatlar || {};
    } catch {/**/}
    if (!document.getElementById("pf-body")) return;

    let totalCost = 0, totalValue = 0;
    const rows = positions.map(pos => {
      const fData = fiyatlar[pos.sembol] || {};
      const guncel = fData.fiyat ?? null;
      const maliyet = pos.adet * pos.alisFiyati;
      const guncelDeger = guncel != null ? pos.adet * guncel : null;
      const kz  = guncelDeger != null ? guncelDeger - maliyet : null;
      const kzPct = kz != null ? (kz / maliyet) * 100 : null;
      totalCost += maliyet;
      if (guncelDeger != null) totalValue += guncelDeger;
      return { pos, guncel, maliyet, guncelDeger, kz, kzPct, degisim: fData.degisim };
    });

    const totalKZ = totalValue - totalCost;
    const totalKZPct = totalCost > 0 ? (totalKZ / totalCost) * 100 : 0;
    if (pfSum) pfSum.innerHTML = [
      ["Toplam Maliyet",  fmtCurr(totalCost,0),  ""],
      ["Güncel Değer",    fmtCurr(totalValue,0), ""],
      ["Kâr / Zarar",    `${totalKZ>=0?"+":""}${fmtCurr(totalKZ,0)}`, colorClass(totalKZ)],
      ["K/Z %",           fmtPct(totalKZPct),    colorClass(totalKZPct)],
    ].map(([lab,val,cls]) => `<div class="kpi"><div class="kpi-label">${lab}</div><div class="kpi-val ${cls}">${val}</div></div>`).join("");

    const head = `<tr>
      <th>Sembol</th><th>Not</th><th class="num">Adet</th>
      <th class="num">Alış</th><th class="num">Güncel</th><th class="num">Gün Değ</th>
      <th class="num">Maliyet</th><th class="num">G.Değer</th>
      <th class="num">K/Z (₺)</th><th class="num">K/Z %</th><th class="num">Ağırlık</th>
      <th></th>
    </tr>`;
    const tbody = rows.map(({ pos, guncel, maliyet, guncelDeger, kz, kzPct, degisim }) => {
      const weight = totalValue > 0 && guncelDeger != null ? (guncelDeger / totalValue * 100) : null;
      return `<tr>
        <td class="sym clickable" onclick="navTo('symbol','${escapeHtml(pos.sembol)}')">${escapeHtml(pos.sembol)}</td>
        <td class="muted" style="font-size:11px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(pos.not||"")}</td>
        <td class="num">${fmtNum(pos.adet, pos.adet % 1 !== 0 ? 4 : 0)}</td>
        <td class="num">${fmtCurr(pos.alisFiyati, 2)}</td>
        <td class="num">${guncel!=null ? fmtCurr(guncel,2) : "—"}</td>
        <td class="num ${colorClass(degisim)}">${degisim!=null ? fmtPct(degisim) : "—"}</td>
        <td class="num">${fmtCurr(maliyet,0)}</td>
        <td class="num">${guncelDeger!=null ? fmtCurr(guncelDeger,0) : "—"}</td>
        <td class="num ${colorClass(kz)}">${kz!=null ? (kz>=0?"+":"")+fmtCurr(kz,0) : "—"}</td>
        <td class="num ${colorClass(kzPct)}">${kzPct!=null ? fmtPct(kzPct) : "—"}</td>
        <td class="num">${weight!=null ? fmtNum(weight,1)+"%" : "—"}</td>
        <td><button class="btn danger" style="padding:2px 8px;font-size:11px" onclick="pfRemove('${pos.id}')">Sil</button></td>
      </tr>`;
    }).join("");
    pfBody.innerHTML = `<table class="tbl">${head}${tbody}</table>`;
  }
  loadPf();

  window.pfAdd = function() {
    const sym   = (document.getElementById("pf-sym")?.value   || "").toUpperCase().trim();
    const adet  = parseFloat(document.getElementById("pf-adet")?.value  || "");
    const fiyat = parseFloat(document.getElementById("pf-fiyat")?.value || "");
    const not   = document.getElementById("pf-not")?.value || "";
    const errEl = document.getElementById("pf-form-err");
    if (!sym)               { if (errEl) errEl.textContent = "Sembol gerekli"; return; }
    if (!adet  || adet<=0)  { if (errEl) errEl.textContent = "Geçerli adet girin"; return; }
    if (!fiyat || fiyat<=0) { if (errEl) errEl.textContent = "Geçerli alış fiyatı girin"; return; }
    if (errEl) errEl.textContent = "";
    const positions = getPortfolio();
    positions.push({ id: Date.now().toString(), sembol: sym, adet, alisFiyati: fiyat, not, tarih: new Date().toISOString() });
    savePortfolio(positions);
    ["pf-sym","pf-adet","pf-fiyat","pf-not"].forEach(id => { const i = document.getElementById(id); if (i) i.value = ""; });
    loadPf();
  };
  window.pfRemove = function(id) {
    savePortfolio(getPortfolio().filter(p => p.id !== id));
    loadPf();
  };
}

/* ═══════════════════════════════════════════════════════
   COMPARE PAGE
   ═══════════════════════════════════════════════════════ */
async function renderCompare(el) {
  const paramSyms = state.routeParam ? state.routeParam.split(",").slice(0,3) : [];
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Hisse Karşılaştırma</div></div>
      <div style="padding:12px 16px">
        <div class="compare-inputs">
          <input id="cmp-s1" type="text" placeholder="Sembol 1" maxlength="10" value="${escapeHtml(paramSyms[0]||"")}">
          <input id="cmp-s2" type="text" placeholder="Sembol 2" maxlength="10" value="${escapeHtml(paramSyms[1]||"")}">
          <input id="cmp-s3" type="text" placeholder="Sembol 3 (opsiyonel)" maxlength="10" value="${escapeHtml(paramSyms[2]||"")}">
          <button class="btn primary" onclick="doCompare()">Karşılaştır</button>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Ör: SASA, EREGL, AKBNK</div>
      </div>
    </div>
    <div id="cmp-result"></div>
  `;
  ["cmp-s1","cmp-s2","cmp-s3"].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) inp.addEventListener("keyup", e => { e.target.value = e.target.value.toUpperCase(); });
  });

  window.doCompare = async function() {
    const syms = ["cmp-s1","cmp-s2","cmp-s3"]
      .map(id => (document.getElementById(id)?.value || "").toUpperCase().trim())
      .filter(Boolean);
    const result = document.getElementById("cmp-result");
    if (!result) return;
    if (syms.length < 2) { result.innerHTML = `<div class="error-box">En az 2 sembol girin.</div>`; return; }
    result.innerHTML = `<div class="loading" style="padding:20px">Veriler alınıyor…</div>`;
    try {
      const [analizArr, fiyatRes] = await Promise.all([
        Promise.all(syms.map(s => API(`/api/v1/analiz?sembol=${encodeURIComponent(s)}&user_id=${USER_ID}`).catch(() => null))),
        API(`/api/v1/fiyatlar?semboller=${syms.join(",")}&user_id=${USER_ID}`).catch(() => ({})),
      ]);
      if (!document.getElementById("cmp-result")) return;
      const fiyatlar = fiyatRes?.fiyatlar || {};
      const metrics = [
        { label: "Fiyat",              fn: (a,f) => fmtCurr(f?.fiyat??a?.fiyat, 2) },
        { label: "Değişim (Günlük)",   fn: (a,f) => { const v=f?.degisim; return `<span class="${colorClass(v)}">${arrowFor(v)} ${fmtPct(v)}</span>`; } },
        { label: "Hacim (TL)",         fn: (a,f) => fmtVol(f?.hacim) },
        { label: "1 Hafta Getiri",     fn: (a,f) => `<span class="${colorClass(f?.getiri_1h)}">${fmtPct(f?.getiri_1h)}</span>` },
        { label: "1 Ay Getiri",        fn: (a,f) => `<span class="${colorClass(f?.getiri_1a)}">${fmtPct(f?.getiri_1a)}</span>` },
        { label: "3 Ay Getiri",        fn: (a,f) => `<span class="${colorClass(f?.getiri_3a)}">${fmtPct(f?.getiri_3a)}</span>` },
        { label: "1 Yıl Getiri",       fn: (a,f) => `<span class="${colorClass(f?.getiri_1y)}">${fmtPct(f?.getiri_1y)}</span>` },
        { label: "HP Puan",            fn: a    => a?.analiz?.puan != null ? fmtNum(a.analiz.puan,3) : "—" },
        { label: "Risk",               fn: a    => escapeHtml(a?.analiz?.risk||"—") },
        { label: "Pivot",              fn: a    => escapeHtml(a?.analiz?.pivot||"—") },
        { label: "Stop",               fn: a    => a?.analiz?.stop!=null ? fmtCurr(a.analiz.stop,2) : "—" },
        { label: "Yön",                fn: a    => a?.analiz?.upwards!=null ? (a.analiz.upwards?"<span class='up'>▲ Yukarı</span>":"<span class='down'>▼ Aşağı</span>") : "—" },
        { label: "F/K Oranı",          fn: a    => a?.temel_analiz?.["Hisse F/K Oranı"]!=null ? fmtNum(a.temel_analiz["Hisse F/K Oranı"],2) : "—" },
        { label: "PD/DD Oranı",        fn: a    => a?.temel_analiz?.["Hisse PD/DD Oranı"]!=null ? fmtNum(a.temel_analiz["Hisse PD/DD Oranı"],2) : "—" },
        { label: "Sektör F/K",         fn: a    => a?.temel_analiz?.["Sektör F/K Oranı"]!=null ? fmtNum(a.temel_analiz["Sektör F/K Oranı"],2) : "—" },
        { label: "Prim Potansiyeli",   fn: a    => { const v=a?.temel_analiz?.["Hissenin Prim Potansiyeli (%)"]; return v!=null?`<span class="${colorClass(v)}">${fmtPct(v)}</span>`:"—"; } },
        { label: "Değerleme Fiyatı",   fn: a    => fmtCurr(a?.temel_analiz?.["Hissenin Değerleme Fiyatı (₺)"],2) },
        { label: "Piyasa Değeri",      fn: a    => a?.temel_analiz?.["Güncel Piyasa Değeri"]!=null ? fmtVol(a.temel_analiz["Güncel Piyasa Değeri"]) : "—" },
        { label: "12A Net Kâr",        fn: a    => a?.temel_analiz?.["12 Aylık Net Kâr"]!=null ? fmtVol(a.temel_analiz["12 Aylık Net Kâr"]) : "—" },
        { label: "Sektör",             fn: a    => escapeHtml(a?.temel_analiz?.["Sektör"]||"—") },
      ];
      const thS = "padding:8px 14px;text-align:right;font-size:11px;color:var(--text-dim);white-space:nowrap";
      const tdS = "padding:7px 14px;text-align:right;font-size:12.5px";
      const tlS = "padding:7px 14px;text-align:left;font-size:12px;color:var(--text-dim)";
      const rS  = "border-top:1px solid var(--border)";
      const header = `<tr>
        <th style="${thS};text-align:left">Metrik</th>
        ${syms.map((s,i) => `<th style="${thS}">
          <a href="#symbol/${encodeURIComponent(s)}" style="color:var(--accent);font-family:var(--mono);font-size:13px">${escapeHtml(s)}</a>
          ${analizArr[i]?.aciklama ? `<div style="font-size:10px;color:var(--text-dim);font-weight:400;margin-top:2px">${escapeHtml((analizArr[i].aciklama||"").slice(0,35))}</div>` : ""}
        </th>`).join("")}
      </tr>`;
      const trows = metrics.map(m => `<tr style="${rS}">
        <td style="${tlS}">${m.label}</td>
        ${syms.map((s,i) => `<td style="${tdS}">${m.fn(analizArr[i], fiyatlar[s])}</td>`).join("")}
      </tr>`).join("");
      result.innerHTML = `<div class="panel"><table style="width:100%;border-collapse:collapse"><thead>${header}</thead><tbody>${trows}</tbody></table></div>`;
    } catch(e) {
      const r = document.getElementById("cmp-result");
      if (r) r.innerHTML = `<div class="error-box">Veri alınamadı.</div>`;
    }
  };
  if (paramSyms.length >= 2) window.doCompare();
}

/* ═══════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════ */
function setupKeyboardShortcuts() {
  let gPending = false;
  let gTimer = null;
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (["INPUT","TEXTAREA","SELECT"].includes(tag)) return;
    const modal = document.getElementById("shortcuts-modal");

    if (e.key === "?") {
      e.preventDefault();
      if (modal) modal.style.display = modal.style.display === "none" ? "flex" : "none";
      return;
    }
    if (e.key === "Escape") {
      if (modal && modal.style.display !== "none") { modal.style.display = "none"; return; }
      return;
    }
    if (e.key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      clearPollers(); render(); refreshTicker();
      return;
    }
    if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      gPending = true;
      clearTimeout(gTimer);
      gTimer = setTimeout(() => { gPending = false; }, 1500);
      return;
    }
    if (gPending) {
      const map = { d: "dashboard", w: "watchlist", m: "markets", p: "portfolio", c: "compare", s: "screener", a: "alarms" };
      if (map[e.key]) {
        e.preventDefault();
        gPending = false;
        clearTimeout(gTimer);
        navTo(map[e.key]);
      }
    }
  });
  const btn = document.getElementById("btn-shortcuts");
  if (btn) btn.onclick = () => {
    const modal = document.getElementById("shortcuts-modal");
    if (modal) modal.style.display = modal.style.display === "none" ? "flex" : "none";
  };
}

/* ───────────── INIT ───────────── */
$$(".nav-item").forEach(el => el.addEventListener("click", () => navTo(el.dataset.route)));
$("#btn-refresh").onclick = () => { clearPollers(); render(); refreshTicker(); };

window.navTo = navTo;
window.addToWatchlist = addToWatchlist;
window.removeFromWatchlist = removeFromWatchlist;
window.addToWatchlistPrompt = addToWatchlistPrompt;
window.clearWatchlist = clearWatchlist;

// Badges
updatePortfolioBadge();
updateAlarmsBadge();

// Market status: update now + every minute
updateMarketBadge();
setInterval(updateMarketBadge, 60_000);

// Alarm checker: every 30s
setInterval(checkAlarms, 30_000);

// Recent sidebar: update on price refresh
setInterval(updateRecentSidebar, 10_000);

// Keyboard shortcuts
setupKeyboardShortcuts();

setupSearch();
bootstrap();
