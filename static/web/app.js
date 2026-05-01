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
    case "akd":       return renderAkd(el);
    case "alarms":    return renderAlarms(el);
    case "settings":  return renderSettings(el);
    case "symbol":    return renderSymbol(el, state.routeParam);
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
        <div class="panel-head"><div class="panel-title">Yükselenler</div></div>
        <div id="dash-yuk-body" class="loading">…</div>
      </div>
      <div class="panel" id="dash-dus">
        <div class="panel-head"><div class="panel-title">Düşenler</div></div>
        <div id="dash-dus-body" class="loading">…</div>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel" id="dash-hac">
        <div class="panel-head"><div class="panel-title">Hacim Liderleri</div></div>
        <div id="dash-hac-body" class="loading">…</div>
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
      state.marketSummary = piyasa;
      state.indices = indices?.endeksler || [];

      // KPIs (3 endeks + işlem hacmi toplamı)
      const kpis = [];
      (state.indices || []).slice(0, 3).forEach(ix => {
        kpis.push({
          label: ix.label || ix.code,
          val: fmtNum(ix.value, 2),
          sub: `<span class="${colorClass(ix.change)} arrow">${arrowFor(ix.change)}</span><span class="${colorClass(ix.change)}">${fmtPct(ix.change)}</span>`,
        });
      });
      // 4. KPI: yukselenler/düşenler oran
      const upN = (piyasa?.yukselenler || []).length;
      const dnN = (piyasa?.dusenler || []).length;
      kpis.push({
        label: "Piyasa Geneli",
        val: `${upN}↑ / ${dnN}↓`,
        sub: `<span class="muted">Top yükselen-düşen</span>`,
      });
      $("#dash-kpis").innerHTML = kpis.map(k => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(k.label)}</div>
          <div class="kpi-val">${k.val}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>`).join("");

      $("#dash-yuk-body").innerHTML = renderMoverTable(piyasa?.yukselenler || [], "up");
      $("#dash-dus-body").innerHTML = renderMoverTable(piyasa?.dusenler  || [], "down");
      $("#dash-hac-body").innerHTML = renderMoverTable(piyasa?.hacim_liderleri || piyasa?.en_hacimli || piyasa?.hacim || [], "vol");

      // İzlem listem (mini) — fiyatRes zaten yukarıda paralel olarak alındı
      const wbody = $("#dash-watch-body");
      if (wbody) {
        if (wlPre.length) {
          wbody.innerHTML = renderPriceTable(wlPre, fiyatRes?.fiyatlar || {});
        } else {
          wbody.innerHTML = `<div class="muted">Henüz izlem listenize sembol eklemediniz.</div>`;
        }
      }
    } catch (e) {
      // leave previous content
    }
  }
  addPoller(refresh, 10_000);
}

function renderMoverTable(rows, kind) {
  if (!rows || !rows.length) return `<div class="muted">Veri yok.</div>`;
  const lim = rows.slice(0, 8);
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
      $("#wl-body").innerHTML = `<div class="muted">Boş. Üst arama çubuğundan sembol bulup detayda ★ ile ekleyebilirsiniz.</div>`;
      return;
    }
    try {
      const r = await API(`/api/v1/fiyatlar?semboller=${state.watchlist.join(",")}&user_id=${USER_ID}`);
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
      $("#wl-body").innerHTML = `<table class="tbl">${head}${body}</table>`;
    } catch (e) {
      $("#wl-body").innerHTML = `<div class="error-box">Yüklenemedi.</div>`;
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
    <div class="grid g-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Yükselenler</div></div>
        <div id="m-yuk" class="loading">…</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Düşenler</div></div>
        <div id="m-dus" class="loading">…</div>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Hacim Liderleri</div></div>
      <div id="m-hac" class="loading">…</div>
    </div>
  `;

  async function refresh() {
    try {
      const [idx, piyasa] = await Promise.all([
        API(`/api/v1/endeksler?user_id=${USER_ID}`),
        API(`/api/v1/piyasa_ozeti?user_id=${USER_ID}`),
      ]);
      const ie = idx?.endeksler || [];
      $("#m-idx").innerHTML = `
        <table class="tbl">
          <tr><th>Endeks</th><th class="num">Değer</th><th class="num">Önceki</th><th class="num">Değişim</th></tr>
          ${ie.map(e => `<tr>
            <td class="sym">${escapeHtml(e.label || e.code)} <span class="muted" style="font-weight:400">${escapeHtml(e.code)}</span></td>
            <td class="num">${fmtNum(e.value,2)}</td>
            <td class="num">${fmtNum(e.prev,2)}</td>
            <td class="num pct ${colorClass(e.change)}">${fmtPct(e.change)}</td>
          </tr>`).join("")}
        </table>`;
      $("#m-yuk").innerHTML = renderMoverTable(piyasa?.yukselenler || [], "up");
      $("#m-dus").innerHTML = renderMoverTable(piyasa?.dusenler  || [], "down");
      $("#m-hac").innerHTML = renderMoverTable(piyasa?.hacim_liderleri || piyasa?.en_hacimli || piyasa?.hacim || [], "vol");
    } catch {/**/}
  }
  addPoller(refresh, 10_000);
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
      const out = r?.sonuclar || r?.results || r?.data || r || {};
      const arr = [];
      Object.keys(out).forEach(s => arr.push({ sembol: s, ...(out[s] || {}) }));
      if (!arr.length) { $("#akd-results").innerHTML = `<div class="muted">Sonuç yok.</div>`; return; }
      const html = arr.map(a => {
        const son = (a.son_girisler || a.cards || []).slice(0, 6);
        return `<div class="panel" style="margin-bottom:10px">
          <div class="panel-head"><div class="panel-title">${escapeHtml(a.sembol)}</div>
            <div class="panel-actions"><button class="btn" onclick="navTo('symbol','${escapeHtml(a.sembol)}')">Detay →</button></div>
          </div>
          ${son.length ? `<table class="tbl">
            <tr><th>Kurum</th><th class="num">Son AKD</th><th class="num">Önceki</th><th class="num">Maliyet</th><th class="num">Fark %</th></tr>
            ${son.map(c => `<tr>
              <td class="sym">${escapeHtml(c.kurum)}</td>
              <td class="num">${fmtNum(c.son_akd, 2)}</td>
              <td class="num">${fmtNum(c.onceki_akd, 2)}</td>
              <td class="num">${fmtCurr(c.maliyet, 2)}</td>
              <td class="num pct ${colorClass(c.fark_pct)}">${fmtPct(c.fark_pct)}</td>
            </tr>`).join("")}
          </table>` : `<div class="muted">Veri yok.</div>`}
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
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Alarmlar</div>
        <div class="panel-actions"><button class="btn" id="al-refresh">Yenile</button></div>
      </div>
      <div id="al-body" class="loading">…</div>
    </div>
    <div style="height:14px"></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Limitler</div></div>
      <div id="al-lim" class="loading">…</div>
    </div>
  `;
  $("#al-refresh").onclick = refresh;
  async function refresh() {
    try {
      const r = await API(`/api/v1/alarm_liste?user_id=${USER_ID}`);
      const list = r?.alarmlar || [];
      if (!list.length) {
        $("#al-body").innerHTML = `<div class="muted">Aktif alarm yok.</div>`;
      } else {
        const head = `<tr><th>Sembol</th><th>Tip</th><th class="num">Tetik Fiyat</th><th class="num">Güncel</th><th class="num">Çarpan</th><th>Tarih</th></tr>`;
        const body = list.map(a => `<tr class="clickable" onclick="navTo('symbol','${escapeHtml(a.sembol)}')">
          <td class="sym">${escapeHtml(a.sembol)}</td>
          <td><span class="tag violet">${escapeHtml(a.alarm_type)}</span></td>
          <td class="num">${a.fiyat == null ? "—" : fmtNum(a.fiyat,2)}</td>
          <td class="num">${a.guncel_fiyat == null ? "—" : fmtNum(a.guncel_fiyat,2)}</td>
          <td class="num">${a.carpan ?? "—"}</td>
          <td class="muted" style="font-size:11px">${escapeHtml((a.tarih||"").replace("T"," ").slice(0,16))}</td>
        </tr>`).join("");
        $("#al-body").innerHTML = `<table class="tbl">${head}${body}</table>`;
      }
      const lim = r?.limitler || {};
      const li = Object.keys(lim);
      $("#al-lim").innerHTML = li.length ? `<div class="chip-grid">${li.map(k => `
        <div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val">${escapeHtml(String(lim[k]))}</div></div>`).join("")}</div>` :
        `<div class="muted">—</div>`;
    } catch {
      $("#al-body").innerHTML = `<div class="error-box">Alarm listesi alınamadı.</div>`;
    }
  }
  refresh();
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
    $("#se-tg").innerHTML = `
      <div class="k">Telegram Oturumu</div><div class="v">${s.logged_in ? "<span class='tag green'>Açık</span>" : "<span class='tag red'>Kapalı</span>"}</div>
      <div class="k">Bot</div><div class="v">@${escapeHtml(s.bot_username || "—")}</div>
      <div class="k">init_data Yaşı</div><div class="v">${s.init_age_hours == null ? "—" : (s.init_age_hours + " saat" + (s.init_expired ? " (DOLMUŞ)" : ""))}</div>
      <div class="k">Son Yenileme</div><div class="v">${s.last_refresh_ts ? new Date(s.last_refresh_ts*1000).toLocaleString("tr-TR") : "—"}</div>
      <div class="k">Son Hata</div><div class="v">${escapeHtml(s.last_refresh_error || "—")}</div>
    `;
  } catch {
    $("#se-tg").innerHTML = `<div class="muted">Durum alınamadı.</div>`;
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
    $("#se-kanal").innerHTML = `
      <div class="k">Kanal Üyeliği</div><div class="v">${k?.uye ? "<span class='tag green'>Üye</span>" : "<span class='tag red'>Üye değil</span>"}</div>
      <div class="k">Kanal Adı</div><div class="v">${escapeHtml(k?.kanal || "—")}</div>
      <div class="k">Sponsor</div><div class="v">${sp?.katildi ? "<span class='tag green'>Katıldı</span>" : "<span class='tag amber'>Katılmadı</span>"}</div>
      <div class="k">Sponsor Linki</div><div class="v">${sp?.link ? `<a href="${escapeHtml(sp.link)}" target="_blank">${escapeHtml(sp.link)}</a>` : "—"}</div>
    `;
  } catch {/**/}

  $("#se-wl").innerHTML = state.watchlist.length
    ? state.watchlist.map(s => `<span class="tag gray" style="margin:2px 4px 2px 0;cursor:pointer" onclick="navTo('symbol','${escapeHtml(s)}')">${escapeHtml(s)}</span>`).join("")
    : "Boş.";
}

/* ───────────── SYMBOL DETAIL ───────────── */
async function renderSymbol(el, sym) {
  if (!sym) { el.innerHTML = `<div class="error-box">Sembol belirtilmemiş.</div>`; return; }
  sym = sym.toUpperCase();
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

  let analiz = null, prices = null;
  try {
    [analiz, prices] = await Promise.all([
      API(`/api/v1/analiz?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`),
      API(`/api/v1/fiyatlar?semboller=${encodeURIComponent(sym)}&user_id=${USER_ID}`),
    ]);
  } catch {
    $("#sym-head").innerHTML = `<div class="error-box">Sembol bilgisi alınamadı.</div>`;
    return;
  }
  const f = (prices?.fiyatlar || {})[sym] || {};
  const inWl = inWatchlist(sym);
  const logoUrl = analiz?.logo ? analiz.logo : null;
  $("#sym-head").innerHTML = `
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
  }
  renderTab();
}

async function renderOverviewTab(body, sym, analiz, f) {
  body.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div class="panel-title">Fiyat Grafiği — Günlük</div>
        <div class="panel-actions" id="ov-res">
          <button class="btn active" data-r="D">D</button>
          <button class="btn" data-r="W">W</button>
        </div>
      </div>
      <div id="ov-chart" class="chart-wrap"><div class="loading">grafik…</div></div>
    </div>
    <div class="grid g-4" id="ov-stats"></div>
    <div style="height:14px"></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Getiriler</div></div>
      <div class="chip-grid" id="ov-returns"></div>
    </div>
  `;
  // KPIs
  const stats = [
    ["Fiyat", fmtCurr(f.fiyat ?? analiz?.fiyat, 2)],
    ["Hacim (TL)", fmtVol(f.hacim ?? analiz?.hacim)],
    ["Hacim (Lot)", fmtVol(f.hacim_lot)],
    ["Alış / Satış", `${fmtNum(f.alis,2)} / ${fmtNum(f.satis,2)}`],
  ];
  $("#ov-stats").innerHTML = stats.map(([k,v]) => `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(k)}</div>
      <div class="kpi-val">${v}</div>
    </div>`).join("");
  const ret = [
    ["1 Hafta", f.getiri_1h], ["1 Ay", f.getiri_1a], ["3 Ay", f.getiri_3a],
    ["6 Ay", f.getiri_6a], ["YTD", f.getiri_ytd], ["1 Yıl", f.getiri_1y],
  ];
  $("#ov-returns").innerHTML = ret.map(([k,v]) => `
    <div class="chip">
      <div class="lab">${escapeHtml(k)}</div>
      <div class="val ${colorClass(v)}">${fmtPct(v)}</div>
    </div>`).join("");
  // chart
  let res = "D";
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
      const t = o.t || [], c = o.c || [];
      if (!t.length) { slot2.innerHTML = `<div class="muted">Veri yok.</div>`; return; }
      slot2.innerHTML = svgLineChart(t, c);
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
  const fin = analiz.finansallar || {};
  const trend = a.trend || a.gunluk || a.yorum || "—";
  const sinList = a.sinyaller || [];
  const tahList = a.tahminler || [];
  const dirList = a.direncler || [];
  body.innerHTML = `
    <div class="grid g-4">
      <div class="kpi"><div class="kpi-label">Risk</div><div class="kpi-val" style="font-size:20px">${escapeHtml(a.risk || "—")}</div></div>
      <div class="kpi"><div class="kpi-label">Pivot</div><div class="kpi-val" style="font-size:20px">${escapeHtml(a.pivot || "—")}</div><div class="kpi-sub muted">${escapeHtml(a.pivot_zaman || "")}</div></div>
      <div class="kpi"><div class="kpi-label">Stop</div><div class="kpi-val" style="font-size:20px">${escapeHtml(a.stop || "—")}</div></div>
      <div class="kpi"><div class="kpi-label">Puan</div><div class="kpi-val">${fmtNum(a.puan,2)}</div></div>
    </div>
    <div style="height:14px"></div>
    <div class="grid g-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Trend Yorumu</div></div>
        <div style="white-space:pre-line;font-size:13px;line-height:1.7;padding:0 14px 14px">${escapeHtml(trend)}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Hareket / Sinyal</div></div>
        <div class="chip-grid">
          <div class="chip"><div class="lab">Hareket</div><div class="val">${escapeHtml(a.hareket||"—")}</div></div>
          <div class="chip"><div class="lab">Sinyal</div><div class="val">${escapeHtml(a.sinyal||"—")}</div></div>
          <div class="chip"><div class="lab">Hacim</div><div class="val">${fmtVol(a.hacim)}</div></div>
          <div class="chip"><div class="lab">Yukarı %</div><div class="val">${fmtNum(a.upwards,1)}%</div></div>
          <div class="chip"><div class="lab">7G %</div><div class="val ${colorClass(a['7_degisim'])}">${fmtPct(a['7_degisim'])}</div></div>
          <div class="chip"><div class="lab">30G %</div><div class="val ${colorClass(a['30_degisim'])}">${fmtPct(a['30_degisim'])}</div></div>
        </div>
      </div>
    </div>
    ${sinList.length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Sinyaller</div></div>
    <ul class="bullet-list up">${sinList.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
    ${tahList.length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Tahminler</div></div>
    <ul class="bullet-list">${tahList.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
    ${dirList.length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Direnç Bölgeleri</div></div>
    <ul class="bullet-list">${dirList.map(s => `<li>${escapeHtml(typeof s==='object'?JSON.stringify(s):s)}</li>`).join("")}</ul></div>` : ""}
    ${Object.keys(t).length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Temel Analiz</div></div>
    <div class="chip-grid">${Object.entries(t).slice(0,12).map(([k,v]) => `<div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val">${escapeHtml(typeof v==='object'?JSON.stringify(v).slice(0,40):String(v).slice(0,40))}</div></div>`).join("")}</div></div>` : ""}
    ${Object.keys(fin).length ? `<div style="height:14px"></div>
    <div class="panel"><div class="panel-head"><div class="panel-title">Finansallar (özet)</div></div>
    <div class="chip-grid">${Object.entries(fin).slice(0,12).map(([k,v]) => `<div class="chip"><div class="lab">${escapeHtml(k)}</div><div class="val">${escapeHtml(typeof v==='object'?JSON.stringify(v).slice(0,40):String(v).slice(0,40))}</div></div>`).join("")}</div></div>` : ""}
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
    let r;
    try {
      r = await API(`/api/v1/derinlik?sembol=${encodeURIComponent(sym)}&user_id=${USER_ID}`);
    } catch {
      if (firstLoad) $("#dr-book").innerHTML = `<div class="error-box">Derinlik verisi alınamadı.</div>`;
      return;
    }
    if (!r || r.hata) {
      if (firstLoad) $("#dr-book").innerHTML = `<div class="error-box">Derinlik bulunamadı: ${escapeHtml(r?.hata||'?')}</div>`;
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

/* ───────────── GLOBAL SEARCH ───────────── */
function setupSearch() {
  const inp = $("#global-search"), res = $("#search-results");
  let timer;
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(doSearch, 120);
  });
  inp.addEventListener("focus", doSearch);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) res.classList.add("hidden");
  });
  function doSearch() {
    const q = inp.value.toUpperCase().trim();
    if (!q) { res.classList.add("hidden"); return; }
    const matches = state.symbols.filter(s => s.startsWith(q)).slice(0, 50);
    if (!matches.length) { res.innerHTML = `<div class="row muted">Eşleşme yok.</div>`; res.classList.remove("hidden"); return; }
    res.innerHTML = matches.map(s => `<div class="row" onclick="navTo('symbol','${escapeHtml(s)}');document.getElementById('global-search').value='';document.getElementById('search-results').classList.add('hidden')">
      <span class="sym">${escapeHtml(s)}</span><span class="muted">↗</span>
    </div>`).join("");
    res.classList.remove("hidden");
  }
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = inp.value.toUpperCase().trim();
      if (q) { navTo("symbol", q); inp.value = ""; res.classList.add("hidden"); }
    }
  });
}

/* ───────────── INIT ───────────── */
$$(".nav-item").forEach(el => el.addEventListener("click", () => navTo(el.dataset.route)));
$("#btn-refresh").onclick = () => { clearPollers(); render(); refreshTicker(); };

window.navTo = navTo;
window.addToWatchlist = addToWatchlist;
window.removeFromWatchlist = removeFromWatchlist;
window.addToWatchlistPrompt = addToWatchlistPrompt;
window.clearWatchlist = clearWatchlist;

setupSearch();
bootstrap();
