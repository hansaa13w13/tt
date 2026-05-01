<script>
(function() {
    var PREFIX = 'tgcs_';
    var themeParams = {
        bg_color: '#08080f', text_color: '#ffffff', hint_color: '#aaaaaa',
        link_color: '#5a8dee', button_color: '#5a8dee',
        button_text_color: '#ffffff', secondary_bg_color: '#05050c'
    };
    var fakeUser = {
        id: 424232285, first_name: 'Hisse', last_name: 'Plus',
        username: 'hisseplus', language_code: 'tr', allows_write_to_pm: true
    };
    // Gerçek Telegram initData kontrolü: hash'te gerçek veri varsa sahte veri ENJEKTE ETME
    var _hasRealTelegramData = false;
    (function() {
        try {
            var rawHash = window.location.hash.replace(/^#/, '');
            var hp = new URLSearchParams(rawHash);
            var twd = hp.get('tgWebAppData');
            if (twd) {
                var twdDecoded = decodeURIComponent(twd);
                var twdParams = new URLSearchParams(twdDecoded);
                var existingHash = twdParams.get('hash') || '';
                if (existingHash && !existingHash.startsWith('aabb') && existingHash.length === 64) {
                    // Gerçek Telegram verisi var — sahte veriyle ezme
                    _hasRealTelegramData = true;
                }
            }
        } catch(e) {}
    })();

    if (!_hasRealTelegramData) {
        // Sadece gerçek veri yoksa (Replit önizleme) sahte veri enjekte et
        var authDate = Math.floor(Date.now() / 1000);
        var fakeInitData = 'query_id=AAHdF6IQAAAAAN0XohDhrOrc'
            + '&user=' + encodeURIComponent(JSON.stringify(fakeUser))
            + '&auth_date=' + authDate
            + '&hash=aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

        var hashStr = 'tgWebAppData=' + encodeURIComponent(fakeInitData)
            + '&tgWebAppVersion=7.10'
            + '&tgWebAppPlatform=web'
            + '&tgWebAppThemeParams=' + encodeURIComponent(JSON.stringify(themeParams));
        try { history.replaceState(null, '', location.pathname + location.search + '#' + hashStr); } catch(e) {}
    }

    function handleStorageMethod(method, params) {
        var result = null;
        if (method === 'getStorageValues') {
            result = {};
            (params.keys || []).forEach(function(k) {
                try { result[k] = localStorage.getItem(PREFIX + k); } catch(e) { result[k] = null; }
            });
        } else if (method === 'saveStorageValue') {
            try { localStorage.setItem(PREFIX + params.key, params.value); } catch(e) {}
            result = true;
        } else if (method === 'deleteStorageValues') {
            (params.keys || []).forEach(function(k) { try { localStorage.removeItem(PREFIX + k); } catch(e) {} });
            result = true;
        } else if (method === 'getStorageKeys') {
            result = [];
            try { for (var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(PREFIX)===0)result.push(k.slice(PREFIX.length));} } catch(e) {}
        }
        return result;
    }

    var _wrappedHandlers = [];
    var _fakeParent;

    _fakeParent = {
        postMessage: function(rawData) {
            try {
                var msg = JSON.parse(rawData);
                if (!msg || !msg.eventType) return;
                var t = msg.eventType, d = msg.eventData || {};
                if (t === 'iframe_ready') {
                    setTimeout(function(){ dispatchToSDK({eventType:'theme_changed',eventData:{theme_params:themeParams}}); }, 0);
                    setTimeout(function(){ dispatchToSDK({eventType:'viewport_changed',eventData:{height:window.innerHeight||812,width:window.innerWidth||390,is_state_stable:true,is_expanded:true}}); }, 10);
                    setTimeout(function(){ dispatchToSDK({eventType:'safe_area_changed',eventData:{safe_area:{top:0,bottom:0,left:0,right:0}}}); }, 20);
                    setTimeout(function(){ dispatchToSDK({eventType:'content_safe_area_changed',eventData:{content_safe_area:{top:0,bottom:0,left:0,right:0}}}); }, 30);
                } else if (t === 'web_app_invoke_custom_method') {
                    var reqId=d.req_id, method=d.method, params=d.params||{};
                    var result=handleStorageMethod(method,params);
                    setTimeout(function(){ dispatchToSDK({eventType:'custom_method_invoked',eventData:{req_id:reqId,result:result}}); },0);
                } else if (t === 'web_app_request_theme') {
                    setTimeout(function(){ dispatchToSDK({eventType:'theme_changed',eventData:{theme_params:themeParams}}); },0);
                } else if (t === 'web_app_request_viewport') {
                    setTimeout(function(){ dispatchToSDK({eventType:'viewport_changed',eventData:{height:window.innerHeight||812,width:window.innerWidth||390,is_state_stable:true,is_expanded:true}}); },0);
                } else if (t === 'web_app_request_safe_area') {
                    setTimeout(function(){ dispatchToSDK({eventType:'safe_area_changed',eventData:{safe_area:{top:0,bottom:0,left:0,right:0}}}); },0);
                } else if (t === 'web_app_request_content_safe_area') {
                    setTimeout(function(){ dispatchToSDK({eventType:'content_safe_area_changed',eventData:{content_safe_area:{top:0,bottom:0,left:0,right:0}}}); },0);
                }
            } catch(e) {}
        }
    };

    function dispatchToSDK(dataObj) {
        var json = JSON.stringify(dataObj);
        _wrappedHandlers.forEach(function(h) {
            try { h({data:json,source:_fakeParent,origin:'https://web.telegram.org'}); } catch(e) {}
        });
    }

    var _origAEL = window.addEventListener.bind(window);
    window.addEventListener = function(type, handler, opts) {
        if (type === 'message') {
            _wrappedHandlers.push(function(fakeEvent) { try { handler.call(window, fakeEvent); } catch(e) {} });
            _origAEL('message', function(event) {
                if (event.source !== _fakeParent) handler.call(window, event);
            }, opts);
        } else {
            _origAEL(type, handler, opts);
        }
    };

    try {
        Object.defineProperty(window, 'parent', {
            get: function() { return _fakeParent; },
            configurable: true
        });
    } catch(e) {}

    window.TelegramGameProxy = { receiveEvent: function() {} };

    setTimeout(function() {
        var s = document.getElementById('splashScreen');
        if (s) {
            s.style.transition = 'opacity 0.5s';
            s.style.opacity = '0';
            setTimeout(function() { if (s.parentNode) s.parentNode.removeChild(s); }, 500);
        }
    }, 1500);

    // --- Sırala (Teknik Skor) Keşfet Kartı ---
    (function() {
        var siralaRender = null;

        function getAuthHeader() {
            try {
                var token = localStorage.getItem('token') || localStorage.getItem('tgcs_token') || '';
                if (!token) {
                    for (var i = 0; i < localStorage.length; i++) {
                        var k = localStorage.key(i);
                        var v = localStorage.getItem(k);
                        if (v && v.length > 20 && (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))) {
                            token = v; break;
                        }
                    }
                }
                return token ? 'Bearer ' + token : '';
            } catch(e) { return ''; }
        }

        function fetchNoStoreWithTimeout(url, timeoutMs) {
            return new Promise(function(resolve) {
                var done = false;
                var controller = window.AbortController ? new AbortController() : null;
                var timer = setTimeout(function() {
                    if (done) return;
                    done = true;
                    try { if (controller) controller.abort(); } catch(e) {}
                    resolve(null);
                }, timeoutMs || 8000);

                fetch(url, {
                    cache: 'no-store',
                    signal: controller ? controller.signal : undefined
                }).then(function(r) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(r);
                }).catch(function() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(null);
                });
            });
        }

        function siralaLoadCache(mode) {
            return fetchNoStoreWithTimeout('/api/v1/sirala_cache?mode=' + encodeURIComponent(mode), 8000)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(obj) {
                if (!obj || !Array.isArray(obj.data) || !obj.data.length) return null;
                return obj;
            })
            .catch(function() { return null; });
        }

        function siralaSaveCache(mode, data) {
            if (!Array.isArray(data) || !data.length) return Promise.resolve(null);
            return fetch('/api/v1/sirala_cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ mode: mode, data: data, ts: Date.now() })
            }).catch(function() { return null; });
        }

        function siralaClearCache(mode) {
            return fetch('/api/v1/sirala_cache?mode=' + encodeURIComponent(mode), {
                method: 'DELETE',
                headers: { 'Accept': 'application/json' }
            }).catch(function() { return null; });
        }

        function siralaAgeText(ts) {
            var age = Date.now() - (ts || 0);
            if (age < 60000)      return 'az önce';
            if (age < 3600000)    return Math.floor(age / 60000) + ' dk önce';
            if (age < 86400000)   return Math.floor(age / 3600000) + ' saat önce';
            return Math.floor(age / 86400000) + ' gün önce';
        }

        function showSiralaCacheInfo(ts) {
            var b = document.getElementById('sirala-body');
            if (!b) return;
            var infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'color:#555;font-size:11px;text-align:center;padding:4px 0 0;';
            infoDiv.textContent = 'JSON ön bellek · ' + siralaAgeText(ts);
            b.insertBefore(infoDiv, b.firstChild);
        }

        function createSiralaModal() {
            if (document.getElementById('sirala-modal')) return;

            var style = document.createElement('style');
            style.textContent = `
                #sirala-modal {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: #08080f; z-index: 99999;
                    display: flex; flex-direction: column;
                    font-family: inherit;
                }
                #sirala-modal .sm-header {
                    display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px 0;
                    background: #08080f;
                }
                #sirala-modal .sm-back {
                    background: rgba(255,255,255,0.08); border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; color: #fff; font-size: 18px; flex-shrink: 0;
                }
                #sirala-modal .sm-title {
                    font-size: 17px; font-weight: 700; color: #fff; flex: 1;
                }
                #sirala-modal .sm-tabs {
                    display: flex; gap: 8px;
                    padding: 12px 16px 0;
                    background: #08080f;
                }
                #sirala-modal .sm-tab {
                    flex: 1; padding: 8px 4px; border: none; border-radius: 10px;
                    font-size: 12px; font-weight: 600; cursor: pointer;
                    background: rgba(255,255,255,0.07); color: #aaa;
                    transition: all 0.15s;
                }
                #sirala-modal .sm-tab.active {
                    color: #fff;
                }
                #sirala-modal .sm-tab.active.teknik {
                    background: rgba(90,141,238,0.25); color: #7eb3ff;
                }
                #sirala-modal .sm-tab.active.analiz {
                    background: rgba(139,92,246,0.25); color: #a78bfa;
                }
                #sirala-modal .sm-tab.active.birleshik {
                    background: rgba(16,185,129,0.25); color: #34d399;
                }
                #sirala-modal .sm-tab.active.diptakas {
                    background: rgba(251,146,60,0.25); color: #fb923c;
                }
                #sirala-modal .sm-dip-filters {
                    display: none; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap;
                }
                #sirala-modal .sm-dip-filters.visible { display: flex; }
                #sirala-modal .sm-dip-chip {
                    padding: 4px 10px; border: none; border-radius: 20px;
                    font-size: 11px; font-weight: 600; cursor: pointer;
                    background: rgba(255,255,255,0.07); color: #aaa;
                    transition: all 0.15s;
                }
                #sirala-modal .sm-dip-chip.active {
                    background: rgba(251,146,60,0.25); color: #fb923c;
                }
                #sirala-modal .sm-divider {
                    height: 1px; background: rgba(255,255,255,0.08);
                    margin: 10px 0 0;
                }
                #sirala-modal .sm-body {
                    flex: 1; overflow-y: auto; padding: 8px 0;
                }
                #sirala-modal .sm-loading {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
                #sirala-modal .sm-item {
                    display: flex; align-items: center;
                    padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
                    gap: 12px;
                }
                #sirala-modal .sm-rank {
                    font-size: 13px; font-weight: 600; color: #aaa;
                    width: 24px; text-align: center; flex-shrink: 0;
                }
                #sirala-modal .sm-info { flex: 1; min-width: 0; }
                #sirala-modal .sm-sembol {
                    font-size: 15px; font-weight: 700; color: #fff;
                }
                #sirala-modal .sm-ad {
                    font-size: 12px; color: #aaa; margin-top: 2px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                #sirala-modal .sm-skor {
                    font-size: 15px; font-weight: 800;
                    padding: 5px 10px; border-radius: 10px;
                    background: rgba(139,92,246,0.15);
                    color: #a78bfa; flex-shrink: 0; min-width: 52px; text-align: center;
                }
                #sirala-modal .sm-skor.high { background: rgba(34,197,94,0.15); color: #4ade80; }
                #sirala-modal .sm-skor.mid  { background: rgba(234,179,8,0.15);  color: #facc15; }
                #sirala-modal .sm-skor.low  { background: rgba(239,68,68,0.15);  color: #f87171; }
                #sirala-modal .sm-empty {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
            `;
            document.head.appendChild(style);

            var modal = document.createElement('div');
            modal.id = 'sirala-modal';
            modal.innerHTML =
                '<div class="sm-header">' +
                '  <button class="sm-back" id="sirala-back">&#8592;</button>' +
                '  <div class="sm-title">Sıralama</div>' +
                '  <button id="sirala-yenile-btn" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;color:#60a5fa;cursor:pointer;flex-shrink:0;" title="Aktif sekme cache temizle ve yeniden yükle">&#8635;</button>' +
                '</div>' +
                '<div class="sm-tabs">' +
                '  <button class="sm-tab teknik active" id="sm-tab-teknik">Teknik</button>' +
                '  <button class="sm-tab analiz" id="sm-tab-analiz">Analiz</button>' +
                '  <button class="sm-tab birleshik" id="sm-tab-birleshik">Birle\u015fik</button>' +
                '  <button class="sm-tab diptakas" id="sm-tab-diptakas">Dip Takas</button>' +
                '</div>' +
                '<div class="sm-dip-filters" id="sm-dip-filters">' +
                '  <span style="font-size:11px;color:#888;line-height:26px;">Maks art\u0131\u015f:</span>' +
                '  <button class="sm-dip-chip" data-thr="999" id="dip-chip-tumumu">T\u00fcm\u00fc</button>' +
                '  <button class="sm-dip-chip active" data-thr="10" id="dip-chip-10">+%10</button>' +
                '  <button class="sm-dip-chip" data-thr="20" id="dip-chip-20">+%20</button>' +
                '  <button class="sm-dip-chip" data-thr="30" id="dip-chip-30">+%30</button>' +
                '</div>' +
                '<div class="sm-divider"></div>' +
                '<div class="sm-body" id="sirala-body">' +
                '  <div class="sm-loading">Veriler y\u00fckleniyor...</div>' +
                '</div>';
            document.body.appendChild(modal);

            var activeMode = 'teknik';
            var dipThreshold = 10;
            var cache = { teknik: null, analiz: null, birleshik: null, diptakas: null };
            var siralaPageSize = 50;
            var siralaPages = { teknik: 0, analiz: 0, birleshik: 0, diptakas: 0 };

            function getSiralaVisibleItems(mode, items) {
                items = Array.isArray(items) ? items : [];
                if (mode !== 'diptakas') return items;
                return items.filter(function(s) {
                    if (s.periyod_degisim === null || s.periyod_degisim === undefined) return true;
                    return s.periyod_degisim <= dipThreshold;
                });
            }

            function buildSiralaPageTabs(totalItems, currentPage) {
                var totalPages = Math.ceil(totalItems / siralaPageSize);
                if (totalPages <= 1) return '';
                var html = '<div id="sirala-page-tabs" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:8px 0 4px;">';
                for (var p = 0; p < totalPages; p++) {
                    var isActive = p === currentPage;
                    var start = p * siralaPageSize + 1;
                    var end = Math.min((p + 1) * siralaPageSize, totalItems);
                    html += '<button class="sirala-page-tab" data-page="' + p + '" style="'
                        + 'background:' + (isActive ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)') + ';'
                        + 'color:' + (isActive ? '#a5b4fc' : '#888') + ';'
                        + 'border:1px solid ' + (isActive ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)') + ';'
                        + 'border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;'
                        + '">' + start + '-' + end + '</button>';
                }
                html += '</div>';
                return html;
            }

            function renderSirala(mode, items, done, total) {
                var b = document.getElementById('sirala-body');
                if (!b) return;
                var visible = getSiralaVisibleItems(mode, items);
                var maxPage = Math.max(0, Math.ceil(visible.length / siralaPageSize) - 1);
                var page = Math.min(siralaPages[mode] || 0, maxPage);
                siralaPages[mode] = page;
                var loading = total && done < total;
                var pct = total ? Math.round(done / total * 100) : 100;
                var status = '<div style="color:#aaa;font-size:12px;text-align:center;padding:8px 0;">';
                if (loading) {
                    status += done + '/' + total + ' hisse analiz edildi (%' + pct + ') · ' + visible.length + ' sonuç';
                } else {
                    status += (total || visible.length) + ' hisse tarandı · ' + visible.length + ' sonuç';
                }
                if (mode === 'diptakas') {
                    status += ' · maks +%' + (dipThreshold >= 999 ? '&infin;' : dipThreshold);
                }
                status += '</div>';

                if (!visible.length) {
                    b.innerHTML = loading
                        ? '<div class="sm-loading">Analiz ediliyor... ' + done + '/' + total + '</div>'
                        : '<div class="sm-empty">Veri bulunamadı.</div>';
                    return;
                }

                var startIdx = page * siralaPageSize;
                var pageItems = visible.slice(startIdx, startIdx + siralaPageSize);
                b.innerHTML = status
                    + buildSiralaPageTabs(visible.length, page)
                    + (mode === 'diptakas'
                        ? buildDipTakasHtml(pageItems, dipThreshold, startIdx, true)
                        : buildListHtml(pageItems, mode, startIdx));

                b.querySelectorAll('.sirala-page-tab').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        siralaPages[mode] = parseInt(this.getAttribute('data-page'), 10) || 0;
                        renderSirala(mode, cache[mode] || items, total || visible.length, total || visible.length);
                        b.scrollTop = 0;
                    });
                });
            }
            siralaRender = renderSirala;

            function fetchSiralaMode(mode, forceRefresh) {
                var b = document.getElementById('sirala-body');
                if (b) b.innerHTML = '<div class="sm-loading">Veriler yükleniyor...</div>';

                function startFetch() {
                    if (mode === 'birleshik') {
                        fetchBirleshik(cache);
                    } else if (mode === 'diptakas') {
                        fetchDipTakas(cache);
                    } else {
                        fetchAndDisplay(mode, cache);
                    }
                }

                if (forceRefresh) {
                    siralaClearCache(mode).then(startFetch);
                    return;
                }

                siralaLoadCache(mode).then(function(cached) {
                    if (cached && cached.data.length) {
                        cache[mode] = cached.data;
                        if (siralaRender) siralaRender(mode, cached.data, cached.data.length, cached.data.length);
                        showSiralaCacheInfo(cached.ts);
                    } else {
                        startFetch();
                    }
                });
            }

            function setActiveTab(mode) {
                activeMode = mode;
                document.getElementById('sm-tab-teknik').className    = 'sm-tab teknik'    + (mode === 'teknik'    ? ' active' : '');
                document.getElementById('sm-tab-analiz').className    = 'sm-tab analiz'    + (mode === 'analiz'    ? ' active' : '');
                document.getElementById('sm-tab-birleshik').className  = 'sm-tab birleshik'  + (mode === 'birleshik'  ? ' active' : '');
                document.getElementById('sm-tab-diptakas').className   = 'sm-tab diptakas'   + (mode === 'diptakas'   ? ' active' : '');
                var filterRow = document.getElementById('sm-dip-filters');
                if (filterRow) filterRow.className = 'sm-dip-filters' + (mode === 'diptakas' ? ' visible' : '');
                if (cache[mode]) {
                    renderSirala(mode, cache[mode], cache[mode].length, cache[mode].length);
                } else {
                    fetchSiralaMode(mode, false);
                }
            }

            document.getElementById('sirala-back').onclick     = function() { modal.remove(); };
            document.getElementById('sm-tab-teknik').onclick    = function() { setActiveTab('teknik'); };
            document.getElementById('sm-tab-analiz').onclick    = function() { setActiveTab('analiz'); };
            document.getElementById('sm-tab-birleshik').onclick  = function() { setActiveTab('birleshik'); };
            document.getElementById('sm-tab-diptakas').onclick   = function() { setActiveTab('diptakas'); };
            document.getElementById('sirala-yenile-btn').onclick = function() {
                var btn = this;
                cache[activeMode] = null;
                siralaPages[activeMode] = 0;
                btn.style.opacity = '0.5';
                btn.disabled = true;
                fetchSiralaMode(activeMode, true);
                setTimeout(function() {
                    btn.style.opacity = '1';
                    btn.disabled = false;
                }, 1200);
            };

            // Dip filter chips
            ['tumumu','10','20','30'].forEach(function(id) {
                var chip = document.getElementById('dip-chip-' + id);
                if (!chip) return;
                chip.onclick = function() {
                    dipThreshold = parseInt(chip.getAttribute('data-thr'));
                    ['tumumu','10','20','30'].forEach(function(cid) {
                        var c = document.getElementById('dip-chip-' + cid);
                        if (c) c.className = 'sm-dip-chip' + (cid === id ? ' active' : '');
                    });
                    if (cache['diptakas']) {
                        siralaPages['diptakas'] = 0;
                        renderSirala('diptakas', cache['diptakas'], cache['diptakas'].length, cache['diptakas'].length);
                    }
                };
            });

            fetchSiralaMode('teknik', false);
        }

        function fetchAndDisplay(mode, cache) {
            var authHeader = getAuthHeader();
            var reqHeaders = { 'Accept': 'application/json' };
            if (authHeader) reqHeaders['Authorization'] = authHeader;

            var results = [];
            var total = 0;
            var done = 0;
            var endpoint = mode === 'teknik' ? '/api/v1/teknik_bulk' : '/api/v1/analiz_bulk';
            var savedToCache = false;

            function updateProgress() {
                var b = document.getElementById('sirala-body');
                if (!b) return;
                var sorted = results.slice().sort(function(a, b) { return b.skor - a.skor; });
                if (done < total) {
                    if (siralaRender) siralaRender(mode, sorted, done, total);
                } else if (sorted.length > 0) {
                    cache[mode] = sorted;
                    if (!savedToCache) {
                        savedToCache = true;
                        siralaSaveCache(mode, sorted);
                    }
                    if (siralaRender) siralaRender(mode, sorted, total, total);
                } else {
                    b.innerHTML = '<div class="sm-empty">Veri bulunamadı.</div>';
                }
            }

            function fetchBulk(semboller) {
                return fetch(endpoint, {
                    method: 'POST',
                    headers: Object.assign({}, reqHeaders, {'Content-Type': 'application/json'}),
                    body: JSON.stringify({ semboller: semboller })
                })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && Array.isArray(data.sonuclar)) {
                        data.sonuclar.forEach(function(s) {
                            if (mode === 'teknik') {
                                results.push({ sembol: s.sembol, skor: s.skor, aksiyon: s.aksiyon || '', fiyat: s.fiyat || 0, degisim: s.degisim || 0 });
                            } else {
                                results.push({ sembol: s.sembol, skor: s.puan, aksiyon: s.upwards === true ? 'YÜK' : (s.upwards === false ? 'DÜŞ' : ''), fiyat: s.fiyat || 0, degisim: s.degisim || 0 });
                            }
                        });
                    }
                    done += semboller.length;
                    updateProgress();
                })
                .catch(function() { done += semboller.length; updateProgress(); });
            }

            function chunkArray(arr, size) {
                var chunks = [];
                for (var i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
                return chunks;
            }

            function runPool(chunks, concurrency, onComplete) {
                if (!chunks.length) { onComplete(); return; }
                var idx = 0;
                var completed = 0;
                var totalChunks = chunks.length;
                function runNext() {
                    if (idx >= totalChunks) return;
                    var chunk = chunks[idx++];
                    fetchBulk(chunk).then(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    }).catch(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    });
                }
                var workers = Math.min(concurrency, totalChunks);
                for (var i = 0; i < workers; i++) runNext();
            }

            fetch('/api/v1/semboller', { headers: reqHeaders })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var liste = data.semboller || data.liste || data || [];
                    if (!Array.isArray(liste)) liste = [];
                    liste = liste.filter(function(s) { return typeof s === 'string' && s.length > 0; });
                    total = liste.length;
                    if (total === 0) {
                        var b = document.getElementById('sirala-body');
                        if (b) b.innerHTML = '<div class="sm-empty">Hisse listesi alınamadı.</div>';
                        return;
                    }
                    updateProgress();
                    runPool(chunkArray(liste, 50), 2, updateProgress);
                })
                .catch(function() {
                    var b = document.getElementById('sirala-body');
                    if (b) b.innerHTML = '<div class="sm-empty">Veri alınamadı. Lütfen tekrar deneyin.</div>';
                });
        }

        function fetchBirleshik(cache) {
            var authHeader = getAuthHeader();
            var reqHeaders = { 'Accept': 'application/json' };
            if (authHeader) reqHeaders['Authorization'] = authHeader;

            function chunkArray(arr, size) {
                var chunks = [];
                for (var i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
                return chunks;
            }

            function postBulk(endpoint, semboller) {
                return fetch(endpoint, {
                    method: 'POST',
                    headers: Object.assign({}, reqHeaders, {'Content-Type': 'application/json'}),
                    body: JSON.stringify({ semboller: semboller })
                }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
            }

            function runPool(chunks, concurrency, worker, onComplete) {
                if (!chunks.length) { onComplete(); return; }
                var idx = 0;
                var completed = 0;
                var totalChunks = chunks.length;
                function runNext() {
                    if (idx >= totalChunks) return;
                    var chunk = chunks[idx++];
                    worker(chunk).then(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    }).catch(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    });
                }
                var workers = Math.min(concurrency, totalChunks);
                for (var i = 0; i < workers; i++) runNext();
            }

            var b = document.getElementById('sirala-body');
            if (b) b.innerHTML = '<div class="sm-loading">İki analiz birleştiriliyor...</div>';

            fetch('/api/v1/semboller', { headers: reqHeaders })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var liste = data.semboller || data.liste || data || [];
                    if (!Array.isArray(liste)) liste = [];
                    liste = liste.filter(function(s) { return typeof s === 'string' && s.length > 0; });
                    if (!liste.length) {
                        var b2 = document.getElementById('sirala-body');
                        if (b2) b2.innerHTML = '<div class="sm-empty">Hisse listesi alınamadı.</div>';
                        return;
                    }

                    var chunks = chunkArray(liste, 50);

                    var teknikMap = {};
                    var analizMap = {};
                    var done = 0;
                    var total = liste.length;

                    function updateBirleshikProgress() {
                        var b2 = document.getElementById('sirala-body');
                        if (!b2) return;
                        var pct = total ? Math.round(done / total * 100) : 0;
                        b2.innerHTML = '<div class="sm-loading">Birleştiriliyor... ' + done + '/' + total + ' (%' + pct + ')</div>';
                    }

                    updateBirleshikProgress();

                    runPool(chunks, 2, function(chunk) {
                        return Promise.all([
                            postBulk('/api/v1/teknik_bulk', chunk).then(function(d) {
                                if (d && d.sonuclar) d.sonuclar.forEach(function(s) {
                                    teknikMap[s.sembol] = { skor: s.skor, aksiyon: s.aksiyon || '', fiyat: s.fiyat || 0, degisim: s.degisim || 0 };
                                });
                            }),
                            postBulk('/api/v1/analiz_bulk', chunk).then(function(d) {
                                if (d && d.sonuclar) d.sonuclar.forEach(function(s) {
                                    analizMap[s.sembol] = { puan: s.puan };
                                });
                            })
                        ]).then(function() {
                            done += chunk.length;
                            updateBirleshikProgress();
                        });
                    }, function() {
                        var puanlar = Object.keys(analizMap).map(function(k) { return analizMap[k].puan; });
                        var minP = Math.min.apply(null, puanlar);
                        var maxP = Math.max.apply(null, puanlar);
                        var rangeP = maxP - minP || 1;

                        var sonuclar = [];
                        Object.keys(teknikMap).forEach(function(sembol) {
                            if (!analizMap[sembol]) return;
                            var t = teknikMap[sembol];
                            var normPuan = (analizMap[sembol].puan - minP) / rangeP * 100;
                            var birleshik = Math.round(t.skor * 0.5 + normPuan * 0.5);
                            sonuclar.push({
                                sembol:    sembol,
                                skor:      birleshik,
                                teknikSkor: t.skor,
                                analizPuan: analizMap[sembol].puan,
                                aksiyon:   t.aksiyon,
                                fiyat:     t.fiyat,
                                degisim:   t.degisim
                            });
                        });

                        sonuclar.sort(function(a, b) { return b.skor - a.skor; });
                        cache['birleshik'] = sonuclar;
                        siralaSaveCache('birleshik', sonuclar);

                        if (siralaRender) siralaRender('birleshik', sonuclar, total, total);
                    });
                })
                .catch(function() {
                    var b2 = document.getElementById('sirala-body');
                    if (b2) b2.innerHTML = '<div class="sm-empty">Veri alınamadı.</div>';
                });
        }

        function computePeriodChanges(miniGrafik) {
            var vals = Array.isArray(miniGrafik) ? miniGrafik.map(Number).filter(function(v) { return isFinite(v) && v > 0; }) : [];
            if (vals.length < 2) return { d7: null, d30: null, d90: null };
            var cur = vals[vals.length - 1];
            function pct(idx) {
                if (idx < 0 || idx >= vals.length) return null;
                var base = vals[idx];
                return base > 0 ? Math.round((cur - base) / base * 10000) / 100 : null;
            }
            return {
                d7:  pct(Math.max(0, vals.length - 8)),
                d30: pct(Math.max(0, vals.length - 31)),
                d90: pct(0)
            };
        }

        function fetchDipTakas(cache) {
            var authHeader = getAuthHeader();
            var reqHeaders = { 'Accept': 'application/json' };
            if (authHeader) reqHeaders['Authorization'] = authHeader;

            function chunkArray(arr, size) {
                var chunks = [];
                for (var i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
                return chunks;
            }

            var results = [];
            var total = 0;
            var done = 0;
            var savedToCache = false;

            function updateProgress() {
                var b = document.getElementById('sirala-body');
                if (!b) return;
                var sorted = results.slice().sort(function(a, b) { return b.skor - a.skor; });
                if (done < total) {
                    if (siralaRender) siralaRender('diptakas', sorted, done, total);
                } else {
                    cache['diptakas'] = sorted;
                    if (!savedToCache) {
                        savedToCache = true;
                        siralaSaveCache('diptakas', sorted);
                    }
                    if (siralaRender) siralaRender('diptakas', sorted, total, total);
                }
            }

            function fetchChunk(semboller) {
                var akdReq = fetch('/api/v1/akd_bulk', {
                    method: 'POST',
                    headers: Object.assign({}, reqHeaders, {'Content-Type': 'application/json'}),
                    body: JSON.stringify({ semboller: semboller })
                }).then(function(r) { return r.ok ? r.json() : null; });

                var teknikReq = fetch('/api/v1/teknik_bulk', {
                    method: 'POST',
                    headers: Object.assign({}, reqHeaders, {'Content-Type': 'application/json'}),
                    body: JSON.stringify({ semboller: semboller })
                }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

                return Promise.all([akdReq, teknikReq])
                .then(function(pair) {
                    var data = pair[0];
                    var teknik = pair[1];
                    var teknikMap = {};
                    if (teknik && Array.isArray(teknik.sonuclar)) {
                        teknik.sonuclar.forEach(function(t) { teknikMap[t.sembol] = t; });
                    }
                    if (data && Array.isArray(data.sonuclar)) {
                        data.sonuclar.forEach(function(s) {
                            var pd = s.periyod_degisim !== undefined && s.periyod_degisim !== null
                                ? Number(s.periyod_degisim) : null;
                            var tn = s.smart_money ? Number(s.smart_money.takas_net || 0) : 0;
                            var t = teknikMap[s.sembol] || {};
                            var pc = computePeriodChanges(t.mini_grafik);
                            results.push({
                                sembol:          s.sembol,
                                skor:            Number(s.skor  || 0),
                                fiyat:           Number(s.fiyat || 0),
                                degisim:         Number(s.degisim || 0),
                                periyod_degisim: pd,
                                top_kurum:       s.top_kurum || '',
                                top_oran:        Number(s.top_oran || 0),
                                top3_oran:       Number(s.top3_oran || 0),
                                takas_net:       tn,
                                akd_maliyet:     s.smart_money ? Number(s.smart_money.akd_maliyet || 0) : 0,
                                takas_maliyet:   s.smart_money ? Number(s.smart_money.takas_maliyet || 0) : 0,
                                virman_sayi:     Number(s.virman_sayi || 0),
                                alan_sayi:       Number(s.alan_sayi || 0),
                                satan_sayi:      Number(s.satan_sayi || 0),
                                donemsel:        pc
                            });
                        });
                    }
                    done += semboller.length;
                    updateProgress();
                })
                .catch(function() { done += semboller.length; updateProgress(); });
            }

            function runPool(chunks, concurrency, onComplete) {
                if (!chunks.length) { onComplete(); return; }
                var idx = 0;
                var completed = 0;
                var totalChunks = chunks.length;
                function runNext() {
                    if (idx >= totalChunks) return;
                    var chunk = chunks[idx++];
                    fetchChunk(chunk).then(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    }).catch(function() {
                        completed++;
                        runNext();
                        if (completed === totalChunks) onComplete();
                    });
                }
                var workers = Math.min(concurrency, totalChunks);
                for (var i = 0; i < workers; i++) runNext();
            }

            fetch('/api/v1/semboller', { headers: reqHeaders })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var liste = data.semboller || data.liste || data || [];
                    if (!Array.isArray(liste)) liste = [];
                    liste = liste.filter(function(s) { return typeof s === 'string' && s.length > 0; });
                    total = liste.length;
                    if (!total) {
                        var b = document.getElementById('sirala-body');
                        if (b) b.innerHTML = '<div class="sm-empty">Hisse listesi al\u0131namad\u0131.</div>';
                        return;
                    }
                    updateProgress();
                    runPool(chunkArray(liste, 8), 2, updateProgress);
                })
                .catch(function() {
                    var b = document.getElementById('sirala-body');
                    if (b) b.innerHTML = '<div class="sm-empty">Veri al\u0131namad\u0131.</div>';
                });
        }

        function buildDipTakasHtml(allItems, threshold, rankOffset, alreadyFiltered) {
            rankOffset = rankOffset || 0;
            var filtered = alreadyFiltered ? allItems : allItems.filter(function(s) {
                if (s.periyod_degisim === null || s.periyod_degisim === undefined) return true;
                return s.periyod_degisim <= threshold;
            });

            if (!filtered.length) {
                return '<div class="sm-empty">'
                    + 'Bu e\u015fikteki hisse bulunamad\u0131.<br>'
                    + '<span style="font-size:12px;color:#666;">Maks art\u0131\u015f e\u015fi\u011fini y\u00fckseltmeyi deneyin.</span>'
                    + '</div>';
            }

            var html = alreadyFiltered ? '' : '<div style="color:#888;font-size:11px;text-align:center;padding:6px 16px 2px;">'
                + filtered.length + ' hisse &mdash; maks +%' + (threshold >= 999 ? '&infin;' : threshold) + ' art\u0131\u015f filtresinde'
                + '</div>';

            for (var i = 0; i < filtered.length; i++) {
                var s = filtered[i];
                var pd = s.periyod_degisim;
                var pdStr = pd !== null && pd !== undefined
                    ? ((pd >= 0 ? '+' : '') + pd.toFixed(1) + '%') : '';
                var pdColor = pd !== null && pd !== undefined
                    ? (pd >= 0 ? '#4ade80' : '#f87171') : '#aaa';

                // Accumulation score badge color
                var skor = s.skor;
                var skorClass = skor >= 70 ? 'high' : (skor >= 40 ? 'mid' : 'low');

                // Takas net direction indicator
                var tnStr = '';
                if (s.takas_net !== 0) {
                    var tnAbs = Math.abs(s.takas_net);
                    var tnLabel = tnAbs >= 1000000 ? (tnAbs/1000000).toFixed(1)+'M' : (tnAbs >= 1000 ? (tnAbs/1000).toFixed(0)+'K' : tnAbs);
                    tnStr = ' <span style="color:' + (s.takas_net > 0 ? '#4ade80' : '#f87171') + ';font-size:10px;">'
                        + (s.takas_net > 0 ? '▲' : '▼') + tnLabel + ' lot</span>';
                }

                // Sub info: top broker, alan/satan ratio, virman warning, maliyet
                var subParts = [];
                if (s.top_kurum) subParts.push('<span style="color:#7eb3ff;">' + s.top_kurum + ' ' + s.top3_oran.toFixed(0) + '%</span>');
                if (s.alan_sayi > 0 && s.satan_sayi > 0) subParts.push(s.alan_sayi + '\u2191' + s.satan_sayi + '\u2193');
                if (s.virman_sayi > 0) subParts.push('<span style="color:#f59e0b;">Vrm:' + s.virman_sayi + '</span>');
                if (s.akd_maliyet > 0.01) subParts.push('<span style="color:#94a3b8;">AKDm:\u20ba' + s.akd_maliyet.toFixed(2) + '</span>');
                if (s.takas_maliyet > 0.01) subParts.push('<span style="color:#94a3b8;">Tkm:\u20ba' + s.takas_maliyet.toFixed(2) + '</span>');
                var subInfo = subParts.length ? '<div class="sm-ad">' + subParts.join(' &middot; ') + '</div>' : '';

                // Dönemsel getiri row (7/30/90 day price changes)
                var donemselHtml = '';
                var pc = s.donemsel;
                if (pc && (pc.d7 !== null || pc.d30 !== null || pc.d90 !== null)) {
                    function fmtP(v) {
                        if (v === null) return '<span style="color:#555;">—</span>';
                        return '<span style="color:' + (v >= 0 ? '#4ade80' : '#f87171') + ';">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</span>';
                    }
                    donemselHtml = '<div class="sm-ad" style="margin-top:3px;display:flex;gap:8px;font-size:10px;">'
                        + '<span style="color:#555;">7G</span>' + fmtP(pc.d7)
                        + ' <span style="color:#555;">30G</span>' + fmtP(pc.d30)
                        + ' <span style="color:#555;">90G</span>' + fmtP(pc.d90)
                        + '</div>';
                }

                html += '<div class="sm-item">'
                    + '<div class="sm-rank">' + (rankOffset + i + 1) + '</div>'
                    + '<div class="sm-info">'
                    + '<div class="sm-sembol">' + s.sembol
                    + (pdStr ? ' <span style="font-size:10px;color:' + pdColor + ';font-weight:600;">' + pdStr + '</span>' : '')
                    + tnStr
                    + '</div>'
                    + (s.fiyat ? '<div class="sm-ad">\u20ba' + s.fiyat.toFixed(2)
                        + (s.degisim !== undefined ? ' <span style="color:' + (s.degisim >= 0 ? '#4ade80' : '#f87171') + ';">'
                            + (s.degisim >= 0 ? '+' : '') + s.degisim.toFixed(2) + '%</span>' : '')
                        + '</div>' : '')
                    + donemselHtml
                    + subInfo
                    + '</div>'
                    + '<div class="sm-skor ' + skorClass + '">' + skor + '</div>'
                    + '</div>';
            }
            return html;
        }

        function buildListHtml(liste, mode, rankOffset) {
            rankOffset = rankOffset || 0;
            if (!liste.length) return '<div class="sm-empty">Veri bulunamadı.</div>';
            var html = '';
            for (var i = 0; i < liste.length; i++) {
                var s = liste[i];
                var skor = s.skor;
                var skorClass, skorStr, aksiyonColor, subInfo = '';

                if (mode === 'teknik') {
                    skorClass = skor >= 70 ? 'high' : (skor >= 40 ? 'mid' : 'low');
                    skorStr = skor;
                    aksiyonColor = s.aksiyon === 'AL' ? '#4ade80' : (s.aksiyon === 'SAT' ? '#f87171' : '#facc15');
                } else if (mode === 'analiz') {
                    skorClass = skor > 0 ? 'high' : (skor > -5 ? 'mid' : 'low');
                    skorStr = (skor >= 0 ? '+' : '') + skor.toFixed(2);
                    aksiyonColor = s.aksiyon === 'YÜK' ? '#4ade80' : (s.aksiyon === 'DÜŞ' ? '#f87171' : '#facc15');
                } else {
                    skorClass = skor >= 70 ? 'high' : (skor >= 40 ? 'mid' : 'low');
                    skorStr = skor;
                    aksiyonColor = s.aksiyon === 'AL' ? '#4ade80' : (s.aksiyon === 'SAT' ? '#f87171' : '#facc15');
                    var pStr = s.analizPuan !== undefined ? ((s.analizPuan >= 0 ? '+' : '') + s.analizPuan.toFixed(2)) : '';
                    subInfo = '<div class="sm-ad" style="margin-top:3px;">'
                        + '<span style="color:#7eb3ff;font-size:10px;">T:' + s.teknikSkor + '</span>'
                        + '&nbsp;&nbsp;'
                        + '<span style="color:#a78bfa;font-size:10px;">A:' + pStr + '</span>'
                        + '</div>';
                }

                html += '<div class="sm-item">'
                    + '<div class="sm-rank">' + (rankOffset + i + 1) + '</div>'
                    + '<div class="sm-info">'
                    + '<div class="sm-sembol">' + s.sembol + (s.aksiyon ? ' <span style="font-size:10px;color:' + aksiyonColor + ';font-weight:600;">' + s.aksiyon + '</span>' : '') + '</div>'
                    + (s.fiyat ? '<div class="sm-ad">&#8378;' + s.fiyat.toFixed(2) + (s.degisim !== undefined ? ' &nbsp;<span style="color:' + (s.degisim >= 0 ? '#4ade80' : '#f87171') + ';">' + (s.degisim >= 0 ? '+' : '') + s.degisim.toFixed(2) + '%</span>' : '') + '</div>' : '')
                    + subInfo
                    + '</div>'
                    + '<div class="sm-skor ' + skorClass + '">' + skorStr + '</div>'
                    + '</div>';
            }
            return html;
        }


        function createAkdModal() {
            if (document.getElementById('akd-modal')) return;

            var style = document.createElement('style');
            style.id = 'akd-modal-style';
            style.textContent = `
                #akd-modal {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: #08080f; z-index: 99999;
                    display: flex; flex-direction: column;
                    font-family: inherit;
                }
                #akd-modal .akd-header {
                    display: flex; align-items: center; gap: 10px;
                    padding: 14px 16px 0;
                    background: #08080f;
                }
                #akd-modal .akd-back {
                    background: rgba(255,255,255,0.08); border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; color: #fff; font-size: 18px; flex-shrink: 0;
                }
                #akd-modal .akd-title {
                    font-size: 17px; font-weight: 700; color: #fff; flex: 1;
                }
                #akd-modal .akd-divider {
                    height: 1px; background: rgba(255,255,255,0.08);
                    margin: 10px 0 0;
                }
                #akd-modal .akd-body {
                    flex: 1; overflow-y: auto; padding: 8px 0;
                }
                #akd-modal .akd-loading {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
                #akd-modal .akd-item {
                    display: flex; flex-direction: column;
                    padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
                    gap: 12px;
                }
                #akd-modal .akd-item-top {
                    display: flex; align-items: flex-start; gap: 12px;
                }
                #akd-modal .akd-rank {
                    font-size: 13px; font-weight: 600; color: #aaa;
                    width: 24px; text-align: center; flex-shrink: 0;
                }
                #akd-modal .akd-info { flex: 1; min-width: 0; }
                #akd-modal .akd-sembol {
                    font-size: 16px; font-weight: 700; color: #fff;
                }
                #akd-modal .akd-sub {
                    font-size: 12px; color: #aaa; margin-top: 4px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                #akd-modal .akd-pct {
                    font-size: 15px; font-weight: 800;
                    padding: 6px 10px; border-radius: 10px;
                    flex-shrink: 0; min-width: 60px; text-align: center;
                }
                #akd-modal .akd-pct.pos { background: rgba(34,197,94,0.15); color: #4ade80; }
                #akd-modal .akd-pct.neg { background: rgba(239,68,68,0.15); color: #f87171; }
                #akd-modal .akd-pct.neu { background: rgba(234,179,8,0.15); color: #facc15; }
                #akd-modal .akd-empty {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
                #akd-modal .akd-pasta-wrap {
                    display: flex; flex-direction: column; gap: 6px; margin-top: 4px;
                }
                #akd-modal .akd-section-row {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
                }
                #akd-modal .akd-section-row-akd {
                    border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;
                }
                #akd-modal .akd-pasta-box {
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 12px; padding: 9px;
                }
                #akd-modal .akd-pasta-head {
                    display: flex; align-items: center; justify-content: space-between;
                    font-size: 10px; font-weight: 700; margin-bottom: 8px;
                }
                #akd-modal .akd-pasta-head.buy    { color: #4ade80; }
                #akd-modal .akd-pasta-head.sell   { color: #f87171; }
                #akd-modal .akd-pasta-head.akdBuy  { color: #60a5fa; }
                #akd-modal .akd-pasta-head.akdSell { color: #fb923c; }
                #akd-modal .akd-toplam-wrap {
                    display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
                    padding: 5px 8px; margin-top: 2px;
                    background: rgba(255,255,255,0.02); border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.04);
                }
                #akd-modal .akd-toplam-label {
                    font-size: 9px; font-weight: 700; color: #64748b; flex-shrink: 0;
                }
                #akd-modal .akd-toplam-chip {
                    font-size: 9px; color: #94a3b8;
                    background: rgba(255,255,255,0.04); border-radius: 5px;
                    padding: 2px 5px; display: inline-flex; gap: 3px; align-items: center;
                }
                #akd-modal .akd-pie {
                    width: 46px; height: 46px; border-radius: 50%;
                    flex-shrink: 0; position: relative;
                    display: flex; align-items: center; justify-content: center;
                }
                #akd-modal .akd-pie-inner {
                    width: 32px; height: 32px; border-radius: 50%;
                    background: #101016; display: flex; align-items: center; justify-content: center;
                    flex-direction: column; z-index: 2;
                }
                #akd-modal .akd-pie-top-val {
                    font-size: 9px; font-weight: 800; color: #fff;
                }
                #akd-modal .akd-pasta-main {
                    display: flex; gap: 8px; align-items: center;
                }
                #akd-modal .akd-pasta-legend {
                    min-width: 0; flex: 1; display: grid; grid-template-columns: 1fr; gap: 4px;
                }
                #akd-modal .akd-pasta-row {
                    display: flex; align-items: center; gap: 4px;
                    font-size: 9px; line-height: 1.25; color: #ccc;
                    min-width: 0;
                }
                #akd-modal .akd-pasta-dot {
                    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
                }
                #akd-modal .akd-pasta-name {
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    min-width: 0; flex: 1; font-weight: 500;
                }
                #akd-modal .akd-pasta-val {
                    color: #fff; flex-shrink: 0; font-weight: 600; font-variant-numeric: tabular-nums;
                }
                #akd-modal .akd-mini-chart {
                    background: linear-gradient(180deg, rgba(15,23,42,0.85), rgba(15,23,42,0.6));
                    border: 1px solid rgba(96,165,250,0.22);
                    border-radius: 14px; padding: 10px 12px 8px;
                    min-width: 0; position: relative; overflow: hidden;
                }
                #akd-modal .akd-chart-head {
                    display: flex; align-items: center; justify-content: space-between;
                    font-size: 10px; font-weight: 700; color: #93c5fd; margin-bottom: 4px;
                }
                #akd-modal .akd-chart-ticker {
                    font-size: 11px; font-weight: 800; color: #e2e8f0; letter-spacing: 0.3px;
                }
                #akd-modal .akd-chart-change {
                    font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums;
                    padding: 1px 6px; border-radius: 6px;
                    background: rgba(255,255,255,0.07);
                }
                #akd-modal .akd-chart-svg {
                    width: 100%; height: 72px; display: block; margin-top: 2px;
                }
                #akd-modal .akd-chart-price-row {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-top: 5px;
                }
                #akd-modal .akd-chart-price-cur {
                    font-size: 10px; font-weight: 700; color: #e2e8f0; font-variant-numeric: tabular-nums;
                }
                #akd-modal .akd-chart-minmax {
                    font-size: 8.5px; color: #64748b; font-variant-numeric: tabular-nums;
                    display: flex; gap: 6px;
                }
                #akd-modal .akd-sm-row {
                    display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
                    padding: 5px 8px; margin-top: 4px;
                    background: rgba(96,165,250,0.04); border-radius: 8px;
                    border: 1px solid rgba(96,165,250,0.08);
                }
                #akd-modal .akd-sm-chip {
                    font-size: 10px; color: #94a3b8; display: inline-flex; gap: 4px;
                    align-items: center; padding: 2px 6px; border-radius: 5px;
                    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
                }
                #akd-modal .akd-cakal-wrap,
                #akd-modal .akd-virman-wrap {
                    display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
                    padding: 4px 8px; margin-top: 3px;
                    border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);
                    background: rgba(255,255,255,0.02);
                }
                #akd-modal .akd-cakal-label {
                    font-size: 9px; font-weight: 700; flex-shrink: 0;
                }
                #akd-modal .akd-detail-block {
                    margin-top: 4px; border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.05);
                    background: rgba(255,255,255,0.015); padding: 4px 8px;
                }
                #akd-modal .akd-detail-block summary {
                    user-select: none; outline: none; list-style: none;
                }
                #akd-modal .akd-detail-block summary::-webkit-details-marker { display: none; }
                #akd-modal .akd-full-table-wrap {
                    overflow-x: auto; margin-top: 4px;
                }
                #akd-modal .akd-full-table {
                    width: 100%; border-collapse: collapse;
                    font-size: 10px; color: #94a3b8;
                }
                #akd-modal .akd-full-table th {
                    font-size: 9px; color: #64748b; font-weight: 600;
                    padding: 3px 4px; border-bottom: 1px solid rgba(255,255,255,0.06);
                    text-align: left;
                }
                #akd-modal .akd-full-table td {
                    padding: 3px 4px; border-bottom: 1px solid rgba(255,255,255,0.03);
                    font-variant-numeric: tabular-nums;
                }
                #akd-modal .akd-full-table tr:last-child td { border-bottom: none; }
                @media (max-width: 420px) {
                    #akd-modal .akd-section-row { grid-template-columns: 1fr; }
                    #akd-modal .akd-pasta-legend { grid-template-columns: repeat(2, 1fr); }
                    #akd-modal .akd-chart-svg { height: 58px; }
                }
            `;
            document.head.appendChild(style);

            var modal = document.createElement('div');
            modal.id = 'akd-modal';
            modal.innerHTML =
                '<div class="akd-header">' +
                '  <button class="akd-back" id="akd-back">&#8592;</button>' +
                '  <div class="akd-title">AKD Toplu (3A)</div>' +
                '  <button id="akd-yenile-btn" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;color:#60a5fa;cursor:pointer;flex-shrink:0;" title="Cache\'i temizle ve yeniden y\u00fcde">&#8635;</button>' +
                '  <button id="akd-filter-btn" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;color:#aaa;cursor:pointer;flex-shrink:0;">Filtrele</button>' +
                '  <button id="akd-90neg-btn" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;color:#aaa;cursor:pointer;flex-shrink:0;" title="90 g\u00fcnl\u00fck fiyat getirisi negatif olanlar">90G -</button>' +
                '  <button id="akd-katlama-btn" style="background:rgba(255,255,255,0.07);border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;color:#aaa;cursor:pointer;flex-shrink:0;" title="Ayn\u0131 kurum grubunun toplad\u0131\u011f\u0131 hisseler, katlad\u0131 ve katlamad\u0131 birlikte s\u0131ral\u0131">Katlama</button>' +
                '</div>' +
                '<div style="padding:6px 16px 0;font-size:12px;color:#888;">Top 3/5 al\u0131c\u0131 yo\u011funlu\u011fu + al\u0131c\u0131/sat\u0131c\u0131 da\u011f\u0131l\u0131m\u0131na g\u00f6re skor</div>' +
                '<div class="akd-divider"></div>' +
                '<div class="akd-body" id="akd-body">' +
                '  <div class="akd-loading">Veriler y\u00fckleniyor...</div>' +
                '</div>';
            document.body.appendChild(modal);

            var filterActive = false;
            var filter90NegActive = false;
            var akdKatalamaMode = 'normal';
            var filterThreshold = 20;
            var allResults = [];

            function akdLoadCache() {
                return fetchNoStoreWithTimeout('/api/v1/akd_cache', 8000)
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(obj) {
                    if (!obj || !Array.isArray(obj.data) || !obj.data.length) return null;
                    return obj;
                })
                .catch(function() { return null; });
            }

            function akdSaveCache(data) {
                return fetch('/api/v1/akd_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ data: data, ts: Date.now() })
                }).catch(function() { return null; });
            }

            function akdMergeCache(data) {
                if (!Array.isArray(data) || !data.length) return Promise.resolve(null);
                return fetch('/api/v1/akd_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        data: data,
                        scanned: data.map(function(r) { return r && r.sembol ? r.sembol : ''; }).filter(Boolean),
                        merge: true,
                        ts: Date.now()
                    })
                }).catch(function() { return null; });
            }

            function akdClearCache() {
                return fetch('/api/v1/akd_cache', {
                    method: 'DELETE',
                    headers: { 'Accept': 'application/json' }
                }).catch(function() { return null; });
            }

            function akdAgeText(ts) {
                var age = Date.now() - (ts || 0);
                if (age < 60000)      return 'az \u00f6nce';
                if (age < 3600000)    return Math.floor(age / 60000) + ' dk \u00f6nce';
                if (age < 86400000)   return Math.floor(age / 3600000) + ' saat \u00f6nce';
                return Math.floor(age / 86400000) + ' g\u00fcn \u00f6nce';
            }

            function escAkd(v) {
                return String(v === undefined || v === null ? '' : v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }

            function buildPieBlock(title, liste, colors, type) {
                if (!Array.isArray(liste) || !liste.length) return '';
                var total = 0;
                for (var i = 0; i < liste.length; i++) total += Math.abs(Number(liste[i].oran || 0));
                if (total <= 0) return '';
                var start = 0;
                var gradient = [];
                var rows = '';
                var topVal = 0;
                for (var j = 0; j < liste.length; j++) {
                    var item = liste[j];
                    var val = Math.abs(Number(item.oran || 0));
                    if (val <= 0) continue;
                    if (val > topVal) topVal = val;
                    var pct = val / total * 100;
                    var end = start + pct;
                    var color = colors[j % colors.length];
                    gradient.push(color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
                    if (j < 4) {
                        rows += '<div class="akd-pasta-row">'
                            + '<span class="akd-pasta-dot" style="background:' + color + ';"></span>'
                            + '<span class="akd-pasta-name">' + escAkd(item.kurum) + '</span>'
                            + '<span class="akd-pasta-val">%' + val.toFixed(1) + '</span>'
                            + '</div>';
                    }
                    start = end;
                }
                if (!gradient.length) return '';
                return '<div class="akd-pasta-box">'
                    + '<div class="akd-pasta-head ' + type + '"><span>' + title + '</span></div>'
                    + '<div class="akd-pasta-main">'
                    + '<div class="akd-pie" style="background:conic-gradient(' + gradient.join(',') + ');">'
                    + '<div class="akd-pie-inner"><div class="akd-pie-top-val">%' + topVal.toFixed(0) + '</div></div>'
                    + '</div>'
                    + '<div class="akd-pasta-legend">' + rows + '</div>'
                    + '</div>'
                    + '</div>';
            }

            function buildMiniChart(s) {
                var values = Array.isArray(s.mini_grafik) ? s.mini_grafik.map(function(v) { return Number(v); }).filter(function(v) { return isFinite(v) && v > 0; }) : [];
                if (values.length < 2) return '';
                var min = Math.min.apply(null, values);
                var max = Math.max.apply(null, values);
                var span = max - min;
                if (span <= 0) span = Math.max(1, max * 0.01);
                var w = 200;
                var h = 72;
                var padX = 2;
                var padY = 6;
                var pts = values.map(function(v, idx) {
                    var x = padX + (idx / Math.max(1, values.length - 1)) * (w - padX * 2);
                    var y = padY + (1 - ((v - min) / span)) * (h - padY * 2);
                    return [x, y];
                });
                var path = pts.map(function(p, idx) { return (idx ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
                var area = path + ' L' + (w - padX) + ' ' + h + ' L' + padX + ' ' + h + ' Z';
                var up = Number(s.periyod_degisim || s.degisim || 0) >= 0;
                var lineColor = up ? '#4ade80' : '#f87171';
                var gradId = 'cg' + (s.hisse_kodu || '').replace(/[^a-z0-9]/gi, '');
                var gradTop = up ? 'rgba(74,222,128,0.30)' : 'rgba(248,113,113,0.30)';
                var gradBot = up ? 'rgba(74,222,128,0.00)' : 'rgba(248,113,113,0.00)';
                var change = s.periyod_degisim !== null && s.periyod_degisim !== undefined ? Number(s.periyod_degisim) : Number(s.degisim || 0);
                var changeText = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
                var curPrice = values[values.length - 1];
                var lastPt = pts[pts.length - 1];
                return '<div class="akd-mini-chart">'
                    + '<div class="akd-chart-head">'
                    + '<span class="akd-chart-ticker">' + escAkd(s.hisse_kodu || 'Fiyat') + '</span>'
                    + '<span class="akd-chart-change" style="color:' + lineColor + ';">' + changeText + '</span>'
                    + '</div>'
                    + '<svg class="akd-chart-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
                    + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
                    + '<stop offset="0%" stop-color="' + gradTop + '"/>'
                    + '<stop offset="100%" stop-color="' + gradBot + '"/>'
                    + '</linearGradient></defs>'
                    + '<path d="' + area + '" fill="url(#' + gradId + ')"></path>'
                    + '<path d="' + path + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
                    + '<circle cx="' + lastPt[0].toFixed(1) + '" cy="' + lastPt[1].toFixed(1) + '" r="3" fill="' + lineColor + '" stroke="rgba(15,23,42,0.9)" stroke-width="1.5"></circle>'
                    + '</svg>'
                    + '<div class="akd-chart-price-row">'
                    + '<span class="akd-chart-price-cur">\u20ba' + curPrice.toFixed(2) + '</span>'
                    + '<span class="akd-chart-minmax"><span>D\u00fc\u015f\u00fck: \u20ba' + min.toFixed(2) + '</span><span>Y\u00fcksek: \u20ba' + max.toFixed(2) + '</span></span>'
                    + '</div>'
                    + '</div>';
            }

            function buildPastaHtml(s) {
                var chart = buildMiniChart(s);
                var takasBuy  = buildPieBlock('Takas Al\u0131c\u0131', s.alicilar_pasta,  ['#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d'], 'buy');
                var takasSell = buildPieBlock('Takas Sat\u0131c\u0131', s.saticilar_pasta, ['#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d'], 'sell');
                var akdBuy    = buildPieBlock('AKD Al\u0131c\u0131',   s.akd_al_pasta,    ['#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a'], 'akdBuy');
                var akdSell   = buildPieBlock('AKD Sat\u0131c\u0131',  s.akd_sat_pasta,   ['#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12'], 'akdSell');
                if (!chart && !takasBuy && !takasSell && !akdBuy && !akdSell) return '';
                var row1 = (takasBuy || takasSell) ? '<div class="akd-section-row">' + takasBuy + takasSell + '</div>' : '';
                var row2 = (akdBuy   || akdSell)   ? '<div class="akd-section-row akd-section-row-akd">' + akdBuy + akdSell + '</div>' : '';
                return '<div class="akd-pasta-wrap">' + chart + row1 + row2 + '</div>';
            }

            function buildToplamSatir(toplam_top5) {
                if (!toplam_top5 || !toplam_top5.length) return '';
                var html = '<div class="akd-toplam-wrap"><span class="akd-toplam-label">K\u00fcm. AKD:</span>';
                for (var i = 0; i < toplam_top5.length; i++) {
                    var t = toplam_top5[i];
                    html += '<span class="akd-toplam-chip">' + escAkd(t.kurum)
                        + ' <span style="color:#aaa;">%' + t.oran.toFixed(1) + '</span>'
                        + (t.maliyet ? ' <span style="color:#64748b;">@\u20ba' + t.maliyet.toFixed(0) + '</span>' : '')
                        + '</span>';
                }
                html += '</div>';
                return html;
            }

            function fmtLot(n) {
                var v = Math.abs(n);
                var s = n < 0 ? '-' : '+';
                if (v >= 1e6)  return s + (v / 1e6).toFixed(1)  + 'Mn';
                if (v >= 1000) return s + (v / 1000).toFixed(0) + 'B';
                return s + v.toFixed(0);
            }

            function buildSmartMoneyRow(s) {
                var sm = s.smart_money;
                if (!sm) return '';
                var akdNet   = Number(sm.akd_net   || 0);
                var takasNet = Number(sm.takas_net || 0);
                var net      = Number(sm.toplam_net || (akdNet + takasNet));
                var akdMal   = Number(sm.akd_maliyet   || 0);
                var takasMal = Number(sm.takas_maliyet || 0);
                var cakalSayi = Number(sm.cakal_sayi   || 0);

                var netColor  = net  >= 0 ? '#4ade80' : '#f87171';
                var akdColor  = akdNet  >= 0 ? '#4ade80' : '#f87171';
                var takasColor= takasNet>= 0 ? '#60a5fa' : '#f87171';

                var html = '<div class="akd-sm-row">';
                html += '<span class="akd-sm-chip" title="AKD Net"><span style="color:#aaa;">AKD</span> <span style="color:' + akdColor + ';">' + fmtLot(akdNet) + '</span></span>';
                html += '<span class="akd-sm-chip" title="Takas Net"><span style="color:#aaa;">Takas</span> <span style="color:' + takasColor + ';">' + fmtLot(takasNet) + '</span></span>';
                html += '<span class="akd-sm-chip" title="Toplam Net" style="font-weight:600;"><span style="color:#aaa;">\u03a3</span> <span style="color:' + netColor + ';">' + fmtLot(net) + '</span></span>';
                if (akdMal > 0.01) {
                    html += '<span class="akd-sm-chip" title="AKD Maliyet"><span style="color:#aaa;">AKDm</span> <span style="color:#94a3b8;">\u20ba' + akdMal.toFixed(2) + '</span></span>';
                }
                if (takasMal > 0.01) {
                    html += '<span class="akd-sm-chip" title="Takas Maliyet"><span style="color:#aaa;">Tkm</span> <span style="color:#94a3b8;">\u20ba' + takasMal.toFixed(2) + '</span></span>';
                }
                if (cakalSayi > 0) {
                    html += '<span class="akd-sm-chip" style="background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.3);" title="\u00c7akal Kurum Sayisi">'
                          + '<span style="color:#f87171;">\uD83E\uDD8A ' + cakalSayi + ' \u00e7akal</span></span>';
                }
                html += '</div>';
                return html;
            }

            function buildCakalRow(s) {
                var ck = s.cakal_kurumlar;
                if (!ck || !ck.length) return '';
                var html = '<div class="akd-cakal-wrap"><span class="akd-cakal-label">\uD83E\uDD8A \u00c7akal:</span>';
                for (var i = 0; i < Math.min(ck.length, 3); i++) {
                    var c = ck[i];
                    var frkColor = Number(c.fark_pct) >= 0 ? '#4ade80' : '#f87171';
                    html += '<span class="akd-toplam-chip" style="border-color:rgba(239,68,68,0.3);">'
                        + escAkd(c.kurum)
                        + ' <span style="color:#aaa;">Al:' + fmtLot(Number(c.akd_alim || 0)) + '</span>'
                        + ' <span style="color:' + frkColor + ';">' + (Number(c.fark_pct) >= 0 ? '+' : '') + Number(c.fark_pct || 0).toFixed(1) + '%</span>'
                        + (c.virman ? ' <span style="color:#f59e0b;font-size:9px;">V</span>' : '')
                        + '</span>';
                }
                html += '</div>';
                return html;
            }

            function buildVirmanRow(s) {
                var vd = s.virman_detay;
                if (!vd || !vd.length) return '';
                var html = '<div class="akd-virman-wrap"><span class="akd-cakal-label" style="color:#f59e0b;">\u26a0 Virman:</span>';
                for (var i = 0; i < Math.min(vd.length, 4); i++) {
                    var v = vd[i];
                    html += '<span class="akd-toplam-chip" style="border-color:rgba(245,158,11,0.3);color:#f59e0b;">'
                        + escAkd(v.kurum)
                        + ' <span style="color:#aaa;">' + fmtLot(Number(v.takas_al || 0)) + '</span>'
                        + (v.kaynak ? ' <span style="color:#64748b;font-size:9px;">' + escAkd(v.kaynak) + '</span>' : '')
                        + '</span>';
                }
                html += '</div>';
                return html;
            }

            function buildFullAkdTable(title, liste, colorClass) {
                if (!liste || !liste.length) return '';
                var color = colorClass === 'buy' ? '#4ade80' : '#f87171';
                var html = '<details class="akd-detail-block"><summary style="color:' + color + ';font-size:11px;cursor:pointer;padding:4px 0;">'
                    + title + ' (' + liste.length + ')</summary>'
                    + '<div class="akd-full-table-wrap"><table class="akd-full-table">'
                    + '<thead><tr><th>Kurum</th><th>Adet</th><th>Maliyet</th><th>Oran%</th></tr></thead><tbody>';
                for (var i = 0; i < liste.length; i++) {
                    var r = liste[i];
                    html += '<tr><td>' + escAkd(r.kurum) + '</td>'
                        + '<td style="text-align:right;">' + fmtLot(Number(r.adet || 0)) + '</td>'
                        + '<td style="text-align:right;">' + (r.maliyet ? '\u20ba' + Number(r.maliyet).toFixed(2) : '-') + '</td>'
                        + '<td style="text-align:right;color:' + color + ';">%' + Number(r.oran || 0).toFixed(1) + '</td>'
                        + '</tr>';
                }
                html += '</tbody></table></div></details>';
                return html;
            }

            function buildTop10Row(title, liste, netKey, color) {
                if (!liste || !liste.length) return '';
                var html = '<details class="akd-detail-block"><summary style="color:' + color + ';font-size:11px;cursor:pointer;padding:4px 0;">'
                    + title + ' (Top ' + Math.min(liste.length, 10) + ')</summary>'
                    + '<div class="akd-full-table-wrap"><table class="akd-full-table">'
                    + '<thead><tr><th>Kurum</th><th>' + (netKey === 'akd_net' ? 'AKD Net' : 'Takas Net') + '</th><th>Maliyet</th>'
                    + (netKey === 'akd_net' ? '<th>Takas</th><th>Yorum</th>' : '<th>AKD Net</th>')
                    + '</tr></thead><tbody>';
                for (var i = 0; i < Math.min(liste.length, 10); i++) {
                    var r = liste[i];
                    var netVal = Number(r[netKey] || 0);
                    var c2 = netVal >= 0 ? color : '#f87171';
                    html += '<tr><td>' + escAkd(r.kurum) + '</td>'
                        + '<td style="text-align:right;color:' + c2 + ';">' + fmtLot(netVal) + '</td>'
                        + '<td style="text-align:right;">' + (r.maliyet ? '\u20ba' + Number(r.maliyet).toFixed(2) : '-') + '</td>';
                    if (netKey === 'akd_net') {
                        var tkNet = Number(r.takas_net || 0);
                        html += '<td style="text-align:right;color:' + (tkNet >= 0 ? '#60a5fa' : '#f87171') + ';">' + fmtLot(tkNet) + '</td>'
                            + '<td style="text-align:right;color:#64748b;font-size:10px;">' + escAkd(r.yorum || '') + '</td>';
                    } else {
                        var akdN = Number(r.akd_net || 0);
                        html += '<td style="text-align:right;color:' + (akdN >= 0 ? '#4ade80' : '#f87171') + ';">' + fmtLot(akdN) + '</td>';
                    }
                    html += '</tr>';
                }
                html += '</tbody></table></div></details>';
                return html;
            }

            function buildKarsilastirmaRow(s) {
                var ks = s.akd_takas_karsilastirma;
                if (!ks || !ks.length) return '';
                var html = '<details class="akd-detail-block"><summary style="color:#a78bfa;font-size:11px;cursor:pointer;padding:4px 0;">'
                    + 'AKD\u2013Takas K\u0131yas\u0131 (' + ks.length + ')</summary>'
                    + '<div class="akd-full-table-wrap"><table class="akd-full-table">'
                    + '<thead><tr><th>Kurum</th><th>AKD Net</th><th>Takas</th><th>E\u015fle\u015fme</th></tr></thead><tbody>';
                for (var i = 0; i < Math.min(ks.length, 15); i++) {
                    var r = ks[i];
                    var akdN2 = Number(r.akd_net || 0);
                    var tkN2  = Number(r.takas_fark || 0);
                    var esColor = r.eslesme ? '#4ade80' : '#f87171';
                    var esIcon  = r.eslesme ? '\u2713' : '\u26a0';
                    html += '<tr><td>' + escAkd(r.kurum) + '</td>'
                        + '<td style="text-align:right;color:' + (akdN2 >= 0 ? '#4ade80' : '#f87171') + ';">' + fmtLot(akdN2) + '</td>'
                        + '<td style="text-align:right;color:' + (tkN2  >= 0 ? '#60a5fa' : '#f87171') + ';">' + fmtLot(tkN2) + '</td>'
                        + '<td style="text-align:center;color:' + esColor + ';">' + esIcon + (r.kaynak ? ' <span style="color:#555;font-size:9px;">' + escAkd(r.kaynak) + '</span>' : '') + '</td>'
                        + '</tr>';
                }
                html += '</tbody></table></div></details>';
                return html;
            }

            function buildTlSaklamaRow(s) {
                var tl = s.tl_saklama_liste;
                if (!tl || !tl.length) return '';
                var hasPuan = tl.some(function(r) { return r.puan && r.puan !== 0; });
                var hasIlk  = tl.some(function(r) { return r.ilk_pct && r.ilk_pct !== 0; });
                if (!hasIlk && !hasPuan) return '';
                var html = '<details class="akd-detail-block"><summary style="color:#e2e8f0;font-size:11px;cursor:pointer;padding:4px 0;">'
                    + 'TL Saklama (' + tl.length + ')</summary>'
                    + '<div class="akd-full-table-wrap"><table class="akd-full-table">'
                    + '<thead><tr><th>Kurum</th>'
                    + (hasIlk ? '<th>\u0130lk%</th><th>Son%</th>' : '')
                    + '<th>De\u011fi\u015fim%</th>'
                    + (hasPuan ? '<th>Puan</th>' : '')
                    + '</tr></thead><tbody>';
                var shown = 0;
                for (var i = 0; i < tl.length && shown < 15; i++) {
                    var r2 = tl[i];
                    if (r2.degisim_pct === 0 && r2.ilk_pct === 0) continue;
                    var dColor = Number(r2.degisim_pct) >= 0 ? '#4ade80' : '#f87171';
                    html += '<tr><td>' + escAkd(r2.kurum) + '</td>'
                        + (hasIlk ? '<td style="text-align:right;color:#aaa;">%' + Number(r2.ilk_pct || 0).toFixed(2) + '</td>'
                                  + '<td style="text-align:right;color:#aaa;">%' + Number(r2.son_pct || 0).toFixed(2) + '</td>' : '')
                        + '<td style="text-align:right;color:' + dColor + ';">' + (Number(r2.degisim_pct) >= 0 ? '+' : '') + Number(r2.degisim_pct || 0).toFixed(2) + '%</td>'
                        + (hasPuan ? '<td style="text-align:right;color:#a78bfa;">' + Number(r2.puan || 0).toFixed(0) + '</td>' : '')
                        + '</tr>';
                    shown++;
                }
                html += '</tbody></table></div></details>';
                return html;
            }

            function buildLotTakasRow(s) {
                var lt = s.lot_takas_liste;
                if (!lt || !lt.length) return '';
                var hasChange = lt.some(function(r) { return r.fark_lot !== 0; });
                if (!hasChange) return '';
                var html = '<details class="akd-detail-block"><summary style="color:#38bdf8;font-size:11px;cursor:pointer;padding:4px 0;">'
                    + 'Lot Takas De\u011fi\u015fim (' + lt.length + ')</summary>'
                    + '<div class="akd-full-table-wrap"><table class="akd-full-table">'
                    + '<thead><tr><th>Kurum</th><th>\u0130lk Lot</th><th>Son Lot</th><th>Fark</th><th>De\u011fi\u015fim%</th><th>Pay%</th></tr></thead><tbody>';
                var shown = 0;
                for (var i = 0; i < lt.length && shown < 20; i++) {
                    var r = lt[i];
                    if (r.fark_lot === 0) continue;
                    var fColor = r.fark_lot >= 0 ? '#4ade80' : '#f87171';
                    var dColor = (r.degisim_pct !== null && r.degisim_pct !== undefined) ? (r.degisim_pct >= 0 ? '#4ade80' : '#f87171') : '#aaa';
                    html += '<tr><td>' + escAkd(r.kurum) + '</td>'
                        + '<td style="text-align:right;color:#aaa;">' + fmtLot(r.ilk) + '</td>'
                        + '<td style="text-align:right;color:#aaa;">' + fmtLot(r.son) + '</td>'
                        + '<td style="text-align:right;color:' + fColor + ';">' + fmtLot(r.fark_lot) + '</td>'
                        + '<td style="text-align:right;color:' + dColor + ';">'
                            + (r.degisim_pct !== null && r.degisim_pct !== undefined ? (r.degisim_pct >= 0 ? '+' : '') + Number(r.degisim_pct).toFixed(1) + '%' : '-')
                        + '</td>'
                        + '<td style="text-align:right;color:#64748b;">%' + Number(r.total_oran || 0).toFixed(1) + '</td>'
                        + '</tr>';
                    shown++;
                }
                html += '</tbody></table></div></details>';
                return html;
            }

            function buildAlRaporRow(s) {
                var liste = s.al_rapor;
                if (!liste || !liste.length) return '';
                var rows = '';
                for (var i = 0; i < liste.length; i++) {
                    var r        = liste[i];
                    var virman   = Number(r.virman_olasiligi || 0);
                    var gecis    = Number(r.takas_gecisi     || 0);
                    var beh      = String(r.behavior || '');
                    var virColor = virman >= 60 ? '#f87171' : virman >= 40 ? '#facc15' : '#4ade80';
                    var virLabel = virman >= 60 ? 'Y\u00fcksek' : virman >= 40 ? 'Orta' : 'D\u00fc\u015f\u00fck';
                    var gecisW   = Math.min(100, Math.abs(gecis));
                    var gecisColor = gecis >= 50 ? '#4ade80' : gecis >= 25 ? '#facc15' : '#94a3b8';
                    var behColor = beh.indexOf('\u00c7akal') >= 0 ? '#f87171'
                                 : beh.indexOf('Virman')  >= 0 ? '#facc15'
                                 : beh.indexOf('izle')    >= 0 ? '#94a3b8'
                                 : '#64748b';
                    rows += '<tr>'
                        + '<td style="padding:4px 6px;font-size:11px;color:#e2e8f0;white-space:nowrap;">' + escAkd(r.kurum) + '</td>'
                        + '<td style="padding:4px 6px;font-size:11px;text-align:right;">'
                          + '<span style="color:' + virColor + ';font-weight:600;">' + virman.toFixed(1) + '%</span>'
                          + ' <span style="color:' + virColor + ';font-size:10px;opacity:.8;">(' + virLabel + ')</span>'
                          + '</td>'
                        + '<td style="padding:4px 8px;min-width:80px;">'
                          + '<div style="position:relative;background:rgba(255,255,255,0.07);border-radius:4px;height:10px;width:100%;">'
                          + '<div style="position:absolute;left:0;top:0;height:10px;width:' + gecisW.toFixed(0) + '%;background:' + gecisColor + ';border-radius:4px;"></div>'
                          + '</div>'
                          + '<div style="font-size:10px;color:' + gecisColor + ';text-align:center;margin-top:2px;">' + gecis.toFixed(1) + '%</div>'
                          + '</td>'
                        + '<td style="padding:4px 6px;font-size:10px;color:' + behColor + ';white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis;" title="' + escAkd(beh) + '">' + escAkd(beh) + '</td>'
                        + '</tr>';
                }
                return '<details class="akd-detail-block">'
                    + '<summary style="color:#38bdf8;font-size:11px;cursor:pointer;padding:4px 0;margin-top:10px;">Al Rapor (' + liste.length + ')</summary>'
                    + '<div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;">'
                    + '<thead><tr>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:left;">KURUM</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:right;">V\u0130RMAN OLAS.</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:center;">TAKAS GE\u00c7\u0130\u015e\u0130</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:left;">ETK\u0130</th>'
                    + '</tr></thead>'
                    + '<tbody>' + rows + '</tbody>'
                    + '</table></div></details>';
            }

            function buildSonGirislerRow(s) {
                var liste = s.son_girisler;
                if (!liste || !liste.length) return '';
                var rows = '';
                for (var i = 0; i < liste.length; i++) {
                    var r       = liste[i];
                    var sonAkd  = Number(r.son_akd    || 0);
                    var malyet  = Number(r.maliyet    || 0);
                    var farkPct = Number(r.fark_pct   || 0);
                    var onces   = Number(r.onceki_akd || 0);
                    var flag    = String(r.isaretci || r.flag || '');
                    var fColor  = farkPct > 0 ? '#4ade80' : farkPct < 0 ? '#f87171' : '#94a3b8';
                    var flagColor = flag === 'yeni' ? '#60a5fa' : flag === 'artis' ? '#4ade80' : flag === 'azalis' ? '#f87171' : '#f59e0b';
                    rows += '<tr>'
                        + '<td style="padding:4px 6px;font-size:11px;color:#e2e8f0;white-space:nowrap;">' + escAkd(r.kurum) + '</td>'
                        + '<td style="padding:4px 6px;font-size:11px;color:#4ade80;text-align:right;white-space:nowrap;">' + fmtLot(sonAkd) + '</td>'
                        + '<td style="padding:4px 6px;font-size:11px;color:#94a3b8;text-align:right;white-space:nowrap;">' + (malyet > 0 ? '\u20ba' + malyet.toFixed(2) : '—') + '</td>'
                        + '<td style="padding:4px 6px;font-size:11px;text-align:right;white-space:nowrap;color:' + fColor + ';">' + (farkPct !== 0 ? (farkPct > 0 ? '+' : '') + farkPct.toFixed(1) + '%' : '—') + '</td>'
                        + '<td style="padding:4px 6px;font-size:11px;color:#64748b;text-align:right;white-space:nowrap;">' + (onces !== 0 ? fmtLot(onces) : '—') + '</td>'
                        + (flag ? '<td style="padding:4px 6px;font-size:10px;text-align:center;"><span style="color:' + flagColor + ';background:rgba(255,255,255,0.05);padding:2px 5px;border-radius:4px;">' + escAkd(flag) + '</span></td>' : '<td></td>')
                        + '</tr>';
                }
                return '<div class="akd-section-label" style="margin-top:10px;">Son 2 G\u00fcn Giri\u015f</div>'
                    + '<div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;">'
                    + '<thead><tr>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:left;">KURUM</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:right;">SON 2G AKD</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:right;">MAL\u0130YET</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:right;">FARK%</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:right;">\u00d6NCES\u0130</th>'
                    + '<th style="padding:3px 6px;font-size:10px;color:#64748b;text-align:center;">\u0130\u015e</th>'
                    + '</tr></thead>'
                    + '<tbody>' + rows + '</tbody>'
                    + '</table></div>';
            }

            function buildTakasOzetRow(s) {
                var oz = s.takas_ozet;
                if (!oz) return '';
                var netLot = Number(oz.net_fark_lot || 0);
                var netTl  = Number(oz.net_fark_tl  || 0);
                var hacim  = Number(oz.toplam_hacim  || 0);
                var fiili  = Number(oz.fiili_dolasim || 0);
                if (!netLot && !netTl && !hacim && !fiili) return '';
                var netColor = netLot >= 0 ? '#4ade80' : '#f87171';
                function fmtK(n) {
                    var a = Math.abs(n), s2 = n < 0 ? '-' : '';
                    if (a >= 1e9)  return s2 + (a/1e9).toFixed(2) + 'Bn';
                    if (a >= 1e6)  return s2 + (a/1e6).toFixed(2) + 'Mn';
                    if (a >= 1000) return s2 + (a/1000).toFixed(0) + 'K';
                    return s2 + a.toFixed(0);
                }
                var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 2px;">';
                if (netLot !== 0) html += '<span class="akd-sm-chip" title="Net Takas Lot"><span style="color:#aaa;">Net Lot</span> <span style="color:' + netColor + ';">' + fmtLot(netLot) + '</span></span>';
                if (netTl  !== 0) html += '<span class="akd-sm-chip" title="Net Takas TL"><span style="color:#aaa;">Net TL</span> <span style="color:' + netColor + ';">\u20ba' + fmtK(netTl) + '</span></span>';
                if (hacim  > 0)   html += '<span class="akd-sm-chip" title="Toplam Takas Hacmi"><span style="color:#aaa;">Hacim</span> <span style="color:#94a3b8;">' + fmtK(hacim) + '</span></span>';
                if (fiili  > 0)   html += '<span class="akd-sm-chip" title="Fiili Dola\u015f\u0131m"><span style="color:#aaa;">Fiili</span> <span style="color:#94a3b8;">' + fmtK(fiili) + '</span></span>';
                html += '</div>';
                return html;
            }

            function numOrNull(v) {
                if (v === null || v === undefined || v === '') return null;
                var n = Number(v);
                return isFinite(n) ? n : null;
            }

            function getPeriodChanges(s) {
                var apiPc = s && s.fiyat_degisimleri ? s.fiyat_degisimleri : {};
                var d7 = numOrNull(apiPc.d7);
                if (d7 === null) d7 = numOrNull(apiPc['7gun']);
                if (d7 === null) d7 = numOrNull(apiPc['7_gun']);
                var d30 = numOrNull(apiPc.d30);
                if (d30 === null) d30 = numOrNull(apiPc['30gun']);
                if (d30 === null) d30 = numOrNull(apiPc['30_gun']);
                var d90 = numOrNull(apiPc.d90);
                if (d90 === null) d90 = numOrNull(apiPc['90gun']);
                if (d90 === null) d90 = numOrNull(apiPc['90_gun']);
                if (d7 === null || d30 === null || d90 === null) {
                    var pc = computePeriodChanges(s ? s.mini_grafik : null);
                    if (d7 === null) d7 = pc.d7;
                    if (d30 === null) d30 = pc.d30;
                    if (d90 === null) d90 = pc.d90;
                }
                return { d7: d7, d30: d30, d90: d90 };
            }

            function buildAkdHtml(liste) {
                if (!liste.length) return '<div class="akd-empty">Veri bulunamad\u0131.</div>';
                var html = '';
                for (var i = 0; i < liste.length; i++) {
                    var s = liste[i];
                    var pct = s.skor !== undefined ? s.skor : (s.top_oran !== undefined ? s.top_oran : s.oran);
                    var pctStr = '%' + pct.toFixed(2);

                    var fiyatLine = '';
                    if (s.fiyat) {
                        fiyatLine = '&#8378;' + s.fiyat.toFixed(2);
                        if (s.degisim !== undefined) {
                            fiyatLine += ' <span style="color:' + (s.degisim >= 0 ? '#4ade80' : '#f87171') + ';">'
                                + (s.degisim >= 0 ? '+' : '') + s.degisim.toFixed(2) + '%</span>';
                        }
                        if (s.periyod_degisim !== null && s.periyod_degisim !== undefined) {
                            var pd = s.periyod_degisim;
                            fiyatLine += ' <span style="color:' + (pd >= 20 ? '#f87171' : pd >= 5 ? '#facc15' : '#aaa') + ';font-size:10px;margin-left:6px;padding:2px 6px;background:rgba(255,255,255,0.05);border-radius:6px;">3A Al\u0131m: ' + (pd >= 0 ? '+' : '') + pd.toFixed(1) + '%</span>';
                        }
                        if (s.akd_sat_maliyet !== null && s.akd_sat_maliyet !== undefined) {
                            var sm2 = s.akd_sat_maliyet;
                            fiyatLine += ' <span style="color:' + (sm2 <= -10 ? '#4ade80' : sm2 >= 10 ? '#f87171' : '#94a3b8') + ';font-size:10px;padding:2px 6px;background:rgba(255,255,255,0.04);border-radius:6px;">Sat. Mal: ' + (sm2 >= 0 ? '+' : '') + sm2.toFixed(1) + '%</span>';
                        }
                        var pc2 = getPeriodChanges(s);
                        if (pc2.d7 !== null || pc2.d30 !== null || pc2.d90 !== null) {
                            function fmtP2(label, v) {
                                if (v === null) return '';
                                return '<span style="font-size:10px;padding:2px 5px;border-radius:5px;background:rgba(255,255,255,0.04);">'
                                    + '<span style="color:#555;">' + label + '</span> '
                                    + '<span style="color:' + (v >= 0 ? '#4ade80' : '#f87171') + ';">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</span>'
                                    + '</span>';
                            }
                            fiyatLine += ' ' + [fmtP2('7G', pc2.d7), fmtP2('30G', pc2.d30), fmtP2('90G', pc2.d90)].filter(Boolean).join(' ');
                        }
                    }

                    var kurumLine = '';
                    if (s.top_kurum) {
                        var sayiInfo = (s.alan_sayi > 0 || s.satan_sayi > 0)
                            ? '<span style="color:#555;font-size:10px;">' + s.alan_sayi + 'A\u2022' + s.satan_sayi + 'S</span>'
                            : '';
                        var virmanBadge = s.virman_sayi > 0
                            ? '<span style="color:#f59e0b;font-size:10px;background:rgba(245,158,11,0.1);padding:2px 5px;border-radius:4px;">'
                              + s.virman_sayi + ' virman</span>'
                            : '';
                        var topInfo = (s.top3_oran !== undefined)
                            ? '<span style="color:#64748b;font-size:10px;">T3:%' + (s.top3_oran || 0).toFixed(1) + ' T5:%' + (s.top5_oran || 0).toFixed(1) + '</span>'
                            : '';
                        var konsantBadge = s.tl_konsant > 0
                            ? '<span style="color:#a78bfa;font-size:10px;background:rgba(167,139,250,0.08);padding:2px 5px;border-radius:4px;">TL\u2605' + s.tl_konsant.toFixed(0) + '%</span>'
                            : '';

                        kurumLine = '<div class="akd-sub" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;">'
                            + '<span style="color:#34d399;font-weight:600;background:rgba(52,211,153,0.1);padding:2px 6px;border-radius:4px;">' + escAkd(s.top_kurum) + '</span>'
                            + sayiInfo + virmanBadge + konsantBadge + topInfo
                            + '</div>';
                    }

                    var pastaLine       = buildPastaHtml(s);
                    var toplamLine      = buildToplamSatir(s.toplam_top5);
                    var smRow           = buildSmartMoneyRow(s);
                    var cakalRow        = buildCakalRow(s);
                    var virmanRow       = buildVirmanRow(s);
                    var alRaporRow      = buildAlRaporRow(s);
                    var sonGirislerRow  = buildSonGirislerRow(s);
                    var takasOzet       = buildTakasOzetRow(s);
                    var alFull          = buildFullAkdTable('AKD Al\u0131c\u0131lar', s.akd_alanlar_full, 'buy');
                    var satFull         = buildFullAkdTable('AKD Sat\u0131c\u0131lar', s.akd_satanlar_full, 'sell');
                    var top10TakasRow   = buildTop10Row('Top 10 Takas Toplay\u0131c\u0131', s.top10_takas, 'takas_net', '#60a5fa');
                    var top10AkdRow     = buildTop10Row('Top 10 AKD Toplay\u0131c\u0131', s.top10_akd, 'akd_net', '#4ade80');
                    var karsilastirma   = buildKarsilastirmaRow(s);
                    var lotTakas        = buildLotTakasRow(s);
                    var tlSaklama       = buildTlSaklamaRow(s);

                    var pctClass = pct >= 70 ? 'pos' : (pct >= 40 ? 'neu' : 'neg');
                    html += '<div class="akd-item">'
                        + '<div class="akd-item-top">'
                        + '<div class="akd-rank">' + (i + 1) + '</div>'
                        + '<div class="akd-info">'
                        + '<div class="akd-sembol">' + escAkd(s.sembol) + '</div>'
                        + (fiyatLine ? '<div class="akd-sub">' + fiyatLine + '</div>' : '')
                        + kurumLine
                        + '</div>'
                        + '<div class="akd-pct ' + pctClass + '">' + pctStr + '</div>'
                        + '</div>'
                        + takasOzet
                        + smRow
                        + cakalRow
                        + virmanRow
                        + alRaporRow
                        + sonGirislerRow
                        + pastaLine
                        + toplamLine
                        + alFull
                        + satFull
                        + top10TakasRow
                        + top10AkdRow
                        + karsilastirma
                        + lotTakas
                        + tlSaklama
                        + '</div>';
                }
                return html;
            }

            function getAkdCollectors(s) {
                var byName = {};
                function ignoredKurum(kurum) {
                    var k = String(kurum || '').trim().toLocaleUpperCase('tr-TR');
                    return !k || k === 'DİĞER' || k === 'DIĞER' || k === 'FARK';
                }
                function addCollector(kurum, oran, kaynak, minOran) {
                    if (ignoredKurum(kurum)) return;
                    var val = Number(oran || 0);
                    if (!isFinite(val) || val < minOran) return;
                    var key = String(kurum).trim().toLocaleUpperCase('tr-TR');
                    if (!byName[key]) byName[key] = { kurum: String(kurum).trim(), oran: 0, kaynak: kaynak || '' };
                    if (val > byName[key].oran) {
                        byName[key].oran = val;
                        byName[key].kaynak = kaynak || byName[key].kaynak;
                    }
                }
                function addList(list, maxItems, kaynak, minOran) {
                    if (!Array.isArray(list)) return;
                    for (var i = 0; i < list.length && i < maxItems; i++) {
                        var r = list[i] || {};
                        addCollector(r.kurum, r.oran !== undefined ? r.oran : r.total_oran, kaynak, minOran);
                    }
                }
                addList(s.akd_al_pasta, 3, 'AKD', 12);
                addList(s.toplam_top5, 3, 'Küm.', 12);
                addList(s.alicilar_pasta, 2, 'Takas', 18);
                if (s.top_kurum) addCollector(s.top_kurum, s.top_oran, 'Top', 12);
                return Object.keys(byName).map(function(k) { return byName[k]; });
            }

            function getAkdCollectorGroups(s) {
                var collectors = getAkdCollectors(s).filter(function(c) {
                    return c && c.kurum && isFinite(Number(c.oran || 0)) && Number(c.oran || 0) > 0;
                }).sort(function(a, b) {
                    return Number(b.oran || 0) - Number(a.oran || 0);
                }).slice(0, 5);
                var groups = [];
                for (var i = 0; i < collectors.length; i++) {
                    for (var j = i + 1; j < collectors.length; j++) {
                        for (var k = j + 1; k < collectors.length; k++) {
                            var trio = [collectors[i], collectors[j], collectors[k]].sort(function(a, b) {
                                return String(a.kurum).localeCompare(String(b.kurum), 'tr');
                            });
                            var key = trio.map(function(c) { return String(c.kurum).toLocaleUpperCase('tr-TR'); }).join('|');
                            groups.push({
                                key: key,
                                kurum: trio.map(function(c) { return c.kurum; }).join(' + '),
                                oran: Number(trio[0].oran || 0) + Number(trio[1].oran || 0) + Number(trio[2].oran || 0)
                            });
                        }
                    }
                }
                return groups;
            }

            function buildAkdKatalamaHtml(liste) {
                // 1) Build groups and collect items
                var groups = {};
                var stockMeta = {};
                for (var i = 0; i < liste.length; i++) {
                    var s = liste[i];
                    var d90 = getD90Change(s);
                    if (d90 === null || !isFinite(d90)) continue;
                    var cgs = getAkdCollectorGroups(s);
                    if (!cgs.length) continue;
                    var sembol = s.sembol;
                    stockMeta[sembol] = {
                        sembol: sembol,
                        d90: d90,
                        doubled: d90 >= 100,
                        skor: Number(s.skor !== undefined ? s.skor : s.oran || 0),
                        fiyat: Number(s.fiyat || 0),
                        top3: Number(s.top3_oran || 0),
                        top5: Number(s.top5_oran || 0)
                    };
                    cgs.forEach(function(c) {
                        if (!groups[c.key]) groups[c.key] = { kurum: c.kurum, doubled: [], pending: [] };
                        if (d90 >= 100) {
                            groups[c.key].doubled.push(sembol);
                        } else {
                            groups[c.key].pending.push(sembol);
                        }
                    });
                }

                // 2) Only proven groups (≥1 katlayan)
                var provenGroups = {};
                Object.keys(groups).forEach(function(k) {
                    if (groups[k].doubled.length >= 1) provenGroups[k] = groups[k];
                });

                if (!Object.keys(provenGroups).length) {
                    return '<div class="akd-empty">Hen\u00fcz kanıtlanm\u0131\u015f kurum grubu bulunamad\u0131 (en az 1 katlayan hisse gerekli).</div>';
                }

                // 3) For each pending stock, collect supporting proven groups
                var stockSignals = {};
                Object.keys(provenGroups).forEach(function(k) {
                    var g = provenGroups[k];
                    g.pending.forEach(function(sembol) {
                        if (!stockSignals[sembol]) stockSignals[sembol] = { groups: [], totalKatlama: 0 };
                        stockSignals[sembol].groups.push({ kurum: g.kurum, katlayanlar: g.doubled.slice() });
                        stockSignals[sembol].totalKatlama += g.doubled.length;
                    });
                });

                // 4) Sort opportunity stocks: more supporting groups → higher totalKatlama → lower d90 (most upside)
                var opportunities = Object.keys(stockSignals).map(function(sem) {
                    var sig = stockSignals[sem];
                    var meta = stockMeta[sem] || {};
                    var fiyat = meta.fiyat || 0;

                    // Collect all unique katlayan stock d90 values from supporting groups
                    var katlayanD90s = [];
                    var seenKatlayan = {};
                    sig.groups.forEach(function(g) {
                        g.katlayanlar.forEach(function(k) {
                            if (!seenKatlayan[k]) {
                                seenKatlayan[k] = true;
                                var kd = (stockMeta[k] || {}).d90;
                                if (kd !== undefined && isFinite(kd)) katlayanD90s.push(kd);
                            }
                        });
                    });
                    var avgKatlama = katlayanD90s.length ? katlayanD90s.reduce(function(s, v) { return s + v; }, 0) / katlayanD90s.length : null;
                    var minKatlama = katlayanD90s.length ? Math.min.apply(null, katlayanD90s) : null;
                    var maxKatlama = katlayanD90s.length ? Math.max.apply(null, katlayanD90s) : null;
                    var targetPrice = (fiyat > 0 && avgKatlama !== null) ? fiyat * (1 + avgKatlama / 100) : null;
                    var targetMin   = (fiyat > 0 && minKatlama !== null) ? fiyat * (1 + minKatlama / 100) : null;
                    var targetMax   = (fiyat > 0 && maxKatlama !== null) ? fiyat * (1 + maxKatlama / 100) : null;

                    return {
                        sembol: sem,
                        d90: meta.d90 !== undefined ? meta.d90 : 0,
                        skor: meta.skor || 0,
                        fiyat: fiyat,
                        top3: meta.top3 || 0,
                        top5: meta.top5 || 0,
                        grupSayisi: sig.groups.length,
                        totalKatlama: sig.totalKatlama,
                        groups: sig.groups,
                        avgKatlama: avgKatlama,
                        minKatlama: minKatlama,
                        maxKatlama: maxKatlama,
                        targetPrice: targetPrice,
                        targetMin: targetMin,
                        targetMax: targetMax
                    };
                }).sort(function(a, b) {
                    if (b.grupSayisi !== a.grupSayisi) return b.grupSayisi - a.grupSayisi;
                    if (b.totalKatlama !== a.totalKatlama) return b.totalKatlama - a.totalKatlama;
                    var as = (a.skor || 0) + (a.top3 || 0) * 0.5;
                    var bs = (b.skor || 0) + (b.top3 || 0) * 0.5;
                    if (Math.abs(bs - as) > 0.5) return bs - as;
                    return a.d90 - b.d90;
                });

                // 5) Also collect unique katlayanlar for reference
                var katlayanSet = {};
                Object.keys(provenGroups).forEach(function(k) {
                    provenGroups[k].doubled.forEach(function(sem) { katlayanSet[sem] = true; });
                });
                var katlayanList = Object.keys(katlayanSet).map(function(sem) {
                    return stockMeta[sem] || { sembol: sem, d90: 0 };
                }).sort(function(a, b) { return b.d90 - a.d90; });

                // 6) Render
                var html = '<div style="padding:8px 0 6px;">'
                    + '<div style="color:#e2e8f0;font-size:13px;font-weight:700;text-align:center;">\ud83d\udd0d Fırsat Listesi</div>'
                    + '<div style="color:#64748b;font-size:11px;text-align:center;margin-top:3px;">'
                    + 'Kanıtlı 3\'l\u00fc kurum grubunun toplad\u0131\u011f\u0131, hen\u00fcz katlamam\u0131\u015f hisseler \u2014 en g\u00fc\u00e7l\u00fc sinyal \u00f6nce.'
                    + '</div></div>';

                if (!opportunities.length) {
                    html += '<div class="akd-empty">Kanıtlı gruplarda bekleyen fırsat hissesi bulunamad\u0131.</div>';
                } else {
                    for (var oi = 0; oi < opportunities.length; oi++) {
                        var op = opportunities[oi];
                        var d90Color = op.d90 >= 100 ? '#4ade80' : op.d90 >= 0 ? '#facc15' : '#f87171';
                        var signalStrength = op.grupSayisi >= 3 ? '\ud83d\udd34\ud83d\udd34\ud83d\udd34' : op.grupSayisi === 2 ? '\ud83d\udd34\ud83d\udd34' : '\ud83d\udd34';
                        var isToplu = (op.skor || 0) >= 20 || (op.top3 || 0) >= 50;
                        var topluBadge = isToplu ? '<span style="background:rgba(249,115,22,0.2);color:#fb923c;border:1px solid rgba(249,115,22,0.3);border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700;margin-left:4px;">\ud83d\udd25 Toplu AKD/Takas</span>' : '';
                        var itemBorderColor = isToplu ? 'rgba(249,115,22,0.6)' : 'rgba(99,102,241,0.5)';

                        // Target price block
                        var targetBlock = '';
                        if (op.targetPrice !== null) {
                            var gainNeeded = op.avgKatlama - op.d90; // remaining gain needed
                            targetBlock = '<div style="margin-top:6px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:6px 10px;">'
                                + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">'
                                + '<div>'
                                + '<div style="font-size:10px;color:#94a3b8;margin-bottom:2px;">Tahmini hedef (benzer katlama ge\u00e7mi\u015fi \u00f6rnek al\u0131narak)</div>'
                                + '<div style="font-size:14px;font-weight:800;color:#fbbf24;">&#8378;' + op.targetPrice.toFixed(2)
                                + (op.avgKatlama !== null ? '<span style="font-size:11px;font-weight:600;color:#f59e0b;margin-left:6px;">(ort. +' + op.avgKatlama.toFixed(0) + '% &uarr;)</span>' : '')
                                + '</div>'
                                + (gainNeeded > 0
                                    ? '<div style="font-size:10px;color:#64748b;margin-top:1px;">Buradan +' + gainNeeded.toFixed(0) + '% daha y\u00fckselmesi beklenir</div>'
                                    : '')
                                + '</div>'
                                + '<div style="text-align:right;">'
                                + (op.targetMin !== null && op.targetMax !== null && op.targetMin !== op.targetMax
                                    ? '<div style="font-size:10px;color:#64748b;">Aral\u0131k: <span style="color:#94a3b8;">&#8378;' + op.targetMin.toFixed(2) + ' \u2013 &#8378;' + op.targetMax.toFixed(2) + '</span></div>'
                                    : '')
                                + '<div style="font-size:10px;color:#64748b;margin-top:1px;">Mevcut: <span style="color:#e2e8f0;">&#8378;' + op.fiyat.toFixed(2) + '</span></div>'
                                + '</div>'
                                + '</div>'
                                + '</div>';
                        }

                        html += '<div class="akd-item" style="border-left:3px solid ' + itemBorderColor + ';margin-bottom:10px;">'
                            + '<div class="akd-item-top">'
                            + '<div class="akd-rank">' + (oi + 1) + '</div>'
                            + '<div class="akd-info" style="flex:1;">'
                            + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
                            + '<span style="font-size:15px;font-weight:800;color:#e2e8f0;">' + escAkd(op.sembol) + '</span>'
                            + '<span style="font-size:11px;color:' + d90Color + ';font-weight:700;">' + (op.d90 >= 0 ? '+' : '') + op.d90.toFixed(1) + '% 90G</span>'
                            + (op.fiyat > 0 ? '<span style="font-size:11px;color:#94a3b8;">&#8378;' + op.fiyat.toFixed(2) + '</span>' : '')
                            + topluBadge
                            + '</div>'
                            + '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">'
                            + signalStrength + ' ' + op.grupSayisi + ' kan\u0131tl\u0131 grup \u00b7 ' + op.totalKatlama + ' toplam katlama ge\u00e7mi\u015fi'
                            + ' \u00b7 Skor %' + op.skor.toFixed(1) + ' \u00b7 T3/T5 %' + op.top3.toFixed(0) + '/%' + op.top5.toFixed(0)
                            + '</div>'
                            + targetBlock
                            + '</div>'
                            + '</div>';

                        // Supporting groups
                        html += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">';
                        for (var gi2 = 0; gi2 < op.groups.length; gi2++) {
                            var grp = op.groups[gi2];
                            html += '<div style="background:rgba(99,102,241,0.1);border-radius:6px;padding:4px 8px;">'
                                + '<div style="font-size:10px;color:#a5b4fc;font-weight:600;">' + escAkd(grp.kurum) + '</div>'
                                + '<div style="font-size:10px;color:#64748b;margin-top:1px;">'
                                + 'Katlad\u0131: ' + grp.katlayanlar.map(function(k) {
                                    var km = stockMeta[k] || {};
                                    var kd = km.d90 !== undefined ? km.d90 : 0;
                                    return '<span style="color:#4ade80;font-weight:700;">' + escAkd(k) + '</span>'
                                        + '<span style="color:#64748b;"> +' + kd.toFixed(0) + '%</span>';
                                }).join(', ')
                                + '</div>'
                                + '</div>';
                        }
                        html += '</div></div>';
                    }
                }

                // Reference: katlayan hisseler
                if (katlayanList.length) {
                    html += '<div style="margin-top:14px;padding:8px;background:rgba(74,222,128,0.05);border-radius:10px;border:1px solid rgba(74,222,128,0.15);">'
                        + '<div style="font-size:11px;font-weight:700;color:#4ade80;margin-bottom:6px;">\u2705 Katlayan Hisseler (referans) \u2014 ' + katlayanList.length + ' hisse</div>'
                        + '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
                    katlayanList.forEach(function(km) {
                        var kd = km.d90 !== undefined ? km.d90 : 0;
                        html += '<span style="background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.2);border-radius:6px;padding:3px 7px;font-size:11px;">'
                            + '<span style="color:#e2e8f0;font-weight:700;">' + escAkd(km.sembol) + '</span>'
                            + '<span style="color:#4ade80;margin-left:4px;">+' + kd.toFixed(0) + '%</span>'
                            + '</span>';
                    });
                    html += '</div></div>';
                }

                return html;
            }

            function getD90Change(s) {
                var pc = getPeriodChanges(s);
                return pc.d90 !== null && pc.d90 !== undefined ? Number(pc.d90) : null;
            }

            function hasD90Source(s) {
                if (!s) return false;
                var apiPc = s.fiyat_degisimleri || {};
                if (numOrNull(apiPc.d90) !== null) return true;
                if (numOrNull(apiPc['90gun']) !== null) return true;
                if (numOrNull(apiPc['90_gun']) !== null) return true;
                return Array.isArray(s.mini_grafik) && s.mini_grafik.length >= 2;
            }

            function applyFilter(liste) {
                return liste.filter(function(s) {
                    if (filterActive) {
                        if (s.periyod_degisim !== null && s.periyod_degisim !== undefined && s.periyod_degisim >= filterThreshold) return false;
                    }
                    if (filter90NegActive) {
                        var d90 = getD90Change(s);
                        if (d90 === null || d90 >= 0) return false;
                    }
                    return true;
                });
            }

            var akdCurrentPage = 0;
            var AKD_PAGE_SIZE = 50;

            function buildPageTabs(totalItems, currentPage) {
                var totalPages = Math.ceil(totalItems / AKD_PAGE_SIZE);
                if (totalPages <= 1) return '';
                var html = '<div id="akd-page-tabs" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:8px 0 4px;">';
                for (var p = 0; p < totalPages; p++) {
                    var isActive = p === currentPage;
                    var start = p * AKD_PAGE_SIZE + 1;
                    var end = Math.min((p + 1) * AKD_PAGE_SIZE, totalItems);
                    html += '<button data-page="' + p + '" style="'
                        + 'background:' + (isActive ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)') + ';'
                        + 'color:' + (isActive ? '#a5b4fc' : '#888') + ';'
                        + 'border:1px solid ' + (isActive ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)') + ';'
                        + 'border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;'
                        + '">' + start + '-' + end + '</button>';
                }
                html += '</div>';
                return html;
            }

            function renderAkdPage(filtered, done, total, page) {
                akdCurrentPage = page;
                var b = document.getElementById('akd-body');
                if (!b) return;

                var pageItems = filtered.slice(page * AKD_PAGE_SIZE, (page + 1) * AKD_PAGE_SIZE);
                var totalPages = Math.ceil(filtered.length / AKD_PAGE_SIZE);

                var loading = done < total;
                var pct = total > 0 ? Math.round(done / total * 100) : 0;

                var statusLine = '<div style="color:#aaa;font-size:12px;text-align:center;padding:6px 0;">';
                if (loading) {
                    statusLine += done + '/' + total + ' tarandı (%' + pct + ') · ' + filtered.length + ' AKD verisi';
                } else {
                    statusLine += total + ' hisse tarandı · ' + filtered.length + ' AKD verisi bulundu';
                }
                if (filtered.length !== allResults.length) statusLine += ' · filtre aktif';
                statusLine += '</div>';

                if (!filtered.length) {
                    b.innerHTML = loading
                        ? '<div class="akd-loading">Analiz ediliyor... ' + done + '/' + total + ' tarandı</div>'
                        : '<div class="akd-empty">Veri bulunamad\u0131.</div>';
                    return;
                }

                if (akdKatalamaMode === 'katlama') {
                    b.innerHTML = statusLine + buildAkdKatalamaHtml(filtered);
                    return;
                }

                b.innerHTML = statusLine + buildPageTabs(filtered.length, page) + buildAkdHtml(pageItems);

                b.querySelectorAll('#akd-page-tabs button').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var p = parseInt(this.getAttribute('data-page'), 10);
                        renderAkdPage(applyFilter(allResults), done, total, p);
                        b.scrollTop = 0;
                    });
                });
            }

            function refreshDisplay(sorted, done, total) {
                allResults = sorted;
                var filtered = applyFilter(sorted);
                var maxPage = Math.max(0, Math.ceil(filtered.length / AKD_PAGE_SIZE) - 1);
                var page = akdKatalamaMode === 'normal' ? Math.min(akdCurrentPage, maxPage) : 0;
                renderAkdPage(filtered, done, total, page);
            }

            function updateKatalamaButtons() {
                var katlamaBtn = document.getElementById('akd-katlama-btn');
                if (katlamaBtn) {
                    katlamaBtn.style.background = akdKatalamaMode === 'katlama' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)';
                    katlamaBtn.style.color = akdKatalamaMode === 'katlama' ? '#a5b4fc' : '#aaa';
                }
            }

            var filterBtn = document.getElementById('akd-filter-btn');
            filterBtn.onclick = function() {
                filterActive = !filterActive;
                filterBtn.style.background = filterActive ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)';
                filterBtn.style.color      = filterActive ? '#f87171' : '#aaa';
                if (allResults.length) {
                    akdCurrentPage = 0;
                    renderAkdPage(applyFilter(allResults), allResults.length, allResults.length, 0);
                }
            };

            var filter90Btn = document.getElementById('akd-90neg-btn');
            filter90Btn.onclick = function() {
                filter90NegActive = !filter90NegActive;
                filter90Btn.style.background = filter90NegActive ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.07)';
                filter90Btn.style.color      = filter90NegActive ? '#f87171' : '#aaa';
                if (allResults.length) {
                    akdCurrentPage = 0;
                    renderAkdPage(applyFilter(allResults), allResults.length, allResults.length, 0);
                }
            };

            var katlamaBtn = document.getElementById('akd-katlama-btn');
            katlamaBtn.onclick = function() {
                akdKatalamaMode = akdKatalamaMode === 'katlama' ? 'normal' : 'katlama';
                akdCurrentPage = 0;
                updateKatalamaButtons();
                if (allResults.length) renderAkdPage(applyFilter(allResults), allResults.length, allResults.length, 0);
            };

            var yenileBtn = document.getElementById('akd-yenile-btn');
            yenileBtn.onclick = function() {
                allResults = [];
                akdCurrentPage = 0;
                var b = document.getElementById('akd-body');
                if (b) b.innerHTML = '<div class="akd-loading">Veriler y\u00fckleniyor...</div>';
                yenileBtn.style.opacity = '0.5';
                yenileBtn.disabled = true;
                akdClearCache().then(function() {
                    fetchAndDisplayAkd(function(sorted, done, total) {
                        if (done >= total) {
                            yenileBtn.style.opacity = '1';
                            yenileBtn.disabled = false;
                        }
                        refreshDisplay(sorted, done, total);
                    });
                });
            };

            document.getElementById('akd-back').onclick = function() {
                modal.remove();
                var s = document.getElementById('akd-modal-style');
                if (s) s.remove();
            };

            var AKD_CACHE_FRESH_MS = 4 * 3600 * 1000; // 4 saat

            akdLoadCache().then(function(cached) {
                if (cached && cached.data.length) {
                    refreshDisplay(cached.data, cached.data.length, cached.data.length);
                    var cacheAge = Date.now() - (cached.ts || 0);
                    var isFresh = cacheAge < AKD_CACHE_FRESH_MS;
                    var b = document.getElementById('akd-body');
                    if (b) {
                        var infoDiv = document.createElement('div');
                        infoDiv.style.cssText = 'color:#555;font-size:11px;text-align:center;padding:4px 0 0;';
                        infoDiv.textContent = '\uD83D\uDCE6 \u00d6nbellekten y\u00fcklendi \u00b7 ' + akdAgeText(cached.ts)
                            + (isFresh ? '' : ' \u00b7 G\u00fcncelleniyor...');
                        b.insertBefore(infoDiv, b.firstChild);
                    }

                    if (isFresh) {
                        // Cache yeterince taze, arka plan taraması atla
                        return;
                    }

                    // Cache eskimiş: sadece eksik/güncellenmemiş sembolleri tara
                    var scannedSet = {};
                    if (Array.isArray(cached.scanned)) {
                        cached.scanned.forEach(function(s) { scannedSet[String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')] = true; });
                    }

                    var authHeader = getAuthHeader();
                    var reqHeaders = { 'Accept': 'application/json' };
                    if (authHeader) reqHeaders['Authorization'] = authHeader;

                    fetch('/api/v1/semboller', { headers: reqHeaders })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            var liste = data.semboller || data.liste || data || [];
                            if (!Array.isArray(liste)) liste = [];
                            liste = liste.filter(function(s) { return typeof s === 'string' && s.length > 0; });
                            var totalCount = liste.length;
                            var cachedBySymbol = {};
                            cached.data.forEach(function(r) {
                                if (r && r.sembol) cachedBySymbol[String(r.sembol).toUpperCase().replace(/[^A-Z0-9]/g, '')] = r;
                            });
                            var missing = liste.filter(function(s) {
                                var sym = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
                                return !scannedSet[sym];
                            });
                            if (!missing.length) {
                                refreshDisplay(allResults, totalCount, totalCount);
                                return;
                            }

                            var alreadyScanned = totalCount - missing.length;
                            fetchAndDisplayAkd(function(sorted, done, total) {
                                var effectiveDone = alreadyScanned + done;
                                if (done >= total) {
                                    refreshDisplay(sorted, totalCount, totalCount);
                                } else {
                                    refreshDisplay(sorted, effectiveDone, totalCount);
                                }
                            }, missing);
                        })
                        .catch(function() {});
                } else {
                    fetchAndDisplayAkd(refreshDisplay);
                }
            });
        }

        function fetchAndDisplayAkd(onUpdate, symbolsOverride) {
            var authHeader = getAuthHeader();
            var reqHeaders = { 'Accept': 'application/json' };
            if (authHeader) reqHeaders['Authorization'] = authHeader;

            function chunkArray(arr, size) {
                var chunks = [];
                for (var i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
                return chunks;
            }

            var resultsMap = {};
            if (Array.isArray(symbolsOverride) && symbolsOverride.length && allResults.length) {
                allResults.forEach(function(r) { if (r && r.sembol) resultsMap[r.sembol] = r; });
            }
            var results = [];
            var total = 0;
            var done = 0;

            var _notifyTimer = null;
            var _notifyInterval = 400;

            function notify(force) {
                if (force) {
                    if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
                    _doNotify();
                    return;
                }
                if (_notifyTimer) return;
                _notifyTimer = setTimeout(function() {
                    _notifyTimer = null;
                    _doNotify();
                }, _notifyInterval);
            }

            function _doNotify() {
                var mergedMap = {};
                Object.keys(resultsMap).forEach(function(k) { mergedMap[k] = resultsMap[k]; });
                results.forEach(function(r) { if (r && r.sembol) mergedMap[r.sembol] = r; });
                var merged = Object.keys(mergedMap).map(function(k) { return mergedMap[k]; });
                var sorted = merged.sort(function(a, b) {
                    var as = a.skor !== undefined ? a.skor : a.oran;
                    var bs = b.skor !== undefined ? b.skor : b.oran;
                    return bs - as;
                });
                onUpdate(sorted, done, total);
            }

            function fetchWithRetry(url, options, maxRetries, delay) {
                maxRetries = maxRetries || 3;
                delay = delay || 2000;
                return new Promise(function(resolve, reject) {
                    function attempt(n) {
                        fetch(url, options)
                        .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
                        .then(resolve)
                        .catch(function(err) {
                            if (n < maxRetries) {
                                setTimeout(function() { attempt(n + 1); }, delay * n);
                            } else {
                                reject(err);
                            }
                        });
                    }
                    attempt(1);
                });
            }

            function processAkdData(data, teknikMap) {
                if (!data || !Array.isArray(data.sonuclar)) return false;
                var hadData = false;
                var chunkRows = [];
                data.sonuclar.forEach(function(s) {
                    if (!s || !s.sembol) return;
                    hadData = true;
                    var t = teknikMap[s.sembol] || {};
                    var row = {
                        sembol:          s.sembol,
                        oran:            s.oran            !== undefined ? s.oran            : 0,
                        skor:            s.skor            !== undefined ? s.skor            : 0,
                        top_kurum:       s.top_kurum       || '',
                        top_oran:        s.top_oran        !== undefined ? s.top_oran        : 0,
                        top3_oran:       s.top3_oran       !== undefined ? s.top3_oran       : 0,
                        top5_oran:       s.top5_oran       !== undefined ? s.top5_oran       : 0,
                        top_adet:        s.top_adet        !== undefined ? s.top_adet        : 0,
                        alicilar_pasta:           Array.isArray(s.alicilar_pasta)           ? s.alicilar_pasta           : [],
                        saticilar_pasta:          Array.isArray(s.saticilar_pasta)          ? s.saticilar_pasta          : [],
                        akd_al_pasta:             Array.isArray(s.akd_al_pasta)             ? s.akd_al_pasta             : [],
                        akd_sat_pasta:            Array.isArray(s.akd_sat_pasta)            ? s.akd_sat_pasta            : [],
                        toplam_top5:              Array.isArray(s.toplam_top5)              ? s.toplam_top5              : [],
                        alan_sayi:                s.alan_sayi              !== undefined ? s.alan_sayi              : 0,
                        satan_sayi:               s.satan_sayi             !== undefined ? s.satan_sayi             : 0,
                        alici_kurum_sayi:         s.alici_kurum_sayi       !== undefined ? s.alici_kurum_sayi       : 0,
                        satici_kurum_sayi:        s.satici_kurum_sayi      !== undefined ? s.satici_kurum_sayi      : 0,
                        virman_sayi:              s.virman_sayi            !== undefined ? s.virman_sayi            : 0,
                        virman_oran:              s.virman_oran            !== undefined ? s.virman_oran            : 0,
                        virman_liste:             Array.isArray(s.virman_liste)             ? s.virman_liste             : [],
                        virman_detay:             Array.isArray(s.virman_detay)             ? s.virman_detay             : [],
                        tl_konsant:               s.tl_konsant             !== undefined ? s.tl_konsant             : 0,
                        fiyat:                    s.fiyat                  || 0,
                        degisim:                  s.degisim                !== undefined ? s.degisim                : 0,
                        periyod_degisim:          s.periyod_degisim        !== undefined ? s.periyod_degisim        : null,
                        akd_sat_maliyet:          s.akd_sat_maliyet        !== undefined ? s.akd_sat_maliyet        : null,
                        smart_money:              s.smart_money            || null,
                        cakal_kurumlar:           Array.isArray(s.cakal_kurumlar)           ? s.cakal_kurumlar           : [],
                        akd_alanlar_full:         Array.isArray(s.akd_alanlar_full)         ? s.akd_alanlar_full         : [],
                        akd_satanlar_full:        Array.isArray(s.akd_satanlar_full)        ? s.akd_satanlar_full        : [],
                        lot_takas_liste:          Array.isArray(s.lot_takas_liste)          ? s.lot_takas_liste          : [],
                        tl_saklama_liste:         Array.isArray(s.tl_saklama_liste)         ? s.tl_saklama_liste         : [],
                        akd_takas_karsilastirma:  Array.isArray(s.akd_takas_karsilastirma)  ? s.akd_takas_karsilastirma  : [],
                        top10_takas:              Array.isArray(s.top10_takas)              ? s.top10_takas              : [],
                        top10_akd:                Array.isArray(s.top10_akd)                ? s.top10_akd                : [],
                        takas_ozet:               s.takas_ozet             || null,
                        al_rapor:                 Array.isArray(s.al_rapor)                 ? s.al_rapor                 : [],
                        son_girisler:             Array.isArray(s.son_girisler)             ? s.son_girisler             : [],
                        fiyat_degisimleri:        s.fiyat_degisimleri       || {},
                        mini_grafik:              Array.isArray(s.mini_grafik) ? s.mini_grafik : (Array.isArray(t.mini_grafik) ? t.mini_grafik : [])
                    };
                    results.push(row);
                    chunkRows.push(row);
                });
                return chunkRows;
            }

            function fetchAkdBulk(semboller, countDone) {
                var postOpts = { method: 'POST', headers: Object.assign({}, reqHeaders, {'Content-Type': 'application/json'}) };
                var akdReq = fetchWithRetry('/api/v1/akd_bulk',
                    Object.assign({}, postOpts, { body: JSON.stringify({ semboller: semboller }) }), 2, 1000)
                .catch(function() { return null; });
                var teknikReq = fetchWithRetry('/api/v1/teknik_bulk',
                    Object.assign({}, postOpts, { body: JSON.stringify({ semboller: semboller }) }), 2, 1000)
                .catch(function() { return null; });

                return Promise.all([akdReq, teknikReq])
                .then(function(pair) {
                    var data = pair[0];
                    var teknik = pair[1];
                    var teknikMap = {};
                    if (teknik && Array.isArray(teknik.sonuclar)) {
                        teknik.sonuclar.forEach(function(t) { teknikMap[t.sembol] = t; });
                    }
                    var chunkRows = processAkdData(data, teknikMap);
                    if (chunkRows && chunkRows.length) akdMergeCache(chunkRows);
                    if (countDone) { done += semboller.length; notify(); }
                    return !!(chunkRows && chunkRows.length);
                })
                .catch(function() {
                    if (countDone) { done += semboller.length; notify(); }
                    return false;
                });
            }

            function runPool(chunks, concurrency, countDone, onComplete) {
                if (!chunks.length) { onComplete([]); return; }
                var idx = 0;
                var failedSymbols = [];
                var completed = 0;
                var total_ = chunks.length;

                function runNext() {
                    if (idx >= total_) return;
                    var chunk = chunks[idx++];
                    fetchAkdBulk(chunk, countDone)
                        .then(function(gotData) {
                            if (!gotData) failedSymbols = failedSymbols.concat(chunk);
                            completed++;
                            runNext();
                            if (completed === total_) onComplete(failedSymbols);
                        })
                        .catch(function() {
                            failedSymbols = failedSymbols.concat(chunk);
                            completed++;
                            runNext();
                            if (completed === total_) onComplete(failedSymbols);
                        });
                }

                var workers = Math.min(concurrency, total_);
                for (var i = 0; i < workers; i++) { runNext(); }
            }

            function runWithList(liste) {
                liste = liste.filter(function(s) { return typeof s === 'string' && s.length > 0; });
                total = liste.length;
                if (total === 0) { onUpdate([], 0, 0); return; }
                notify();

                var CHUNK_SIZE = 8;
                var CONCURRENCY = 2;
                var MAX_RETRY_PASSES = 3;

                var chunks = chunkArray(liste, CHUNK_SIZE);

                runPool(chunks, CONCURRENCY, true, function(failed) {
                    notify(true);
                    if (!failed.length) return;

                    function retryPass(symbols, passNum) {
                        if (!symbols.length || passNum > MAX_RETRY_PASSES) return;
                        setTimeout(function() {
                            var retryChunks = chunkArray(symbols, CHUNK_SIZE);
                            runPool(retryChunks, CONCURRENCY, false, function(stillFailed) {
                                notify(true);
                                if (stillFailed.length && passNum < MAX_RETRY_PASSES) {
                                    retryPass(stillFailed, passNum + 1);
                                }
                            });
                        }, passNum * 2000);
                    }

                    retryPass(failed, 1);
                });
            }

            if (Array.isArray(symbolsOverride) && symbolsOverride.length) {
                runWithList(symbolsOverride);
            } else {
                fetch('/api/v1/semboller', { headers: reqHeaders })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var liste = data.semboller || data.liste || data || [];
                        if (!Array.isArray(liste)) liste = [];
                        runWithList(liste);
                    })
                    .catch(function() {
                        var b = document.getElementById('akd-body');
                        if (b) b.innerHTML = '<div class="akd-empty">Veri al\u0131namad\u0131. L\u00fctfen tekrar deneyin.</div>';
                    });
            }
        }

        function createAlarmTakipModal() {
            if (document.getElementById('alarm-takip-modal')) {
                document.getElementById('alarm-takip-modal').style.display = 'flex';
                return;
            }

            var style = document.createElement('style');
            style.textContent = `
                #alarm-takip-modal {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: #08080f; z-index: 99999;
                    display: flex; flex-direction: column;
                    font-family: inherit;
                }
                #alarm-takip-modal .at-header {
                    display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px 0;
                    background: #08080f;
                }
                #alarm-takip-modal .at-back {
                    background: rgba(255,255,255,0.08); border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; color: #fff; font-size: 18px; flex-shrink: 0;
                }
                #alarm-takip-modal .at-title {
                    font-size: 17px; font-weight: 700; color: #fff; flex: 1;
                }
                #alarm-takip-modal .at-search-row {
                    display: flex; gap: 8px; padding: 12px 16px 0;
                }
                #alarm-takip-modal .at-input {
                    flex: 1; padding: 10px 14px;
                    background: rgba(255,255,255,0.07);
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 12px; color: #fff;
                    font-size: 14px; outline: none;
                    font-family: inherit;
                }
                #alarm-takip-modal .at-input::placeholder { color: #666; }
                #alarm-takip-modal .at-btn {
                    padding: 10px 18px;
                    background: rgba(251,146,60,0.2);
                    border: 1px solid rgba(251,146,60,0.35);
                    border-radius: 12px; color: #fb923c;
                    font-size: 14px; font-weight: 700;
                    cursor: pointer; white-space: nowrap;
                    font-family: inherit;
                }
                #alarm-takip-modal .at-btn:active { opacity: 0.7; }
                #alarm-takip-modal .at-divider {
                    height: 1px; background: rgba(255,255,255,0.08);
                    margin: 12px 0 0;
                }
                #alarm-takip-modal .at-body {
                    flex: 1; overflow-y: auto; padding: 8px 0;
                }
                #alarm-takip-modal .at-loading {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
                #alarm-takip-modal .at-empty {
                    text-align: center; color: #aaa;
                    padding: 40px 20px; font-size: 14px;
                }
                #alarm-takip-modal .at-item {
                    display: flex; flex-direction: column;
                    padding: 12px 16px;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                    gap: 4px;
                }
                #alarm-takip-modal .at-item-top {
                    display: flex; align-items: center; gap: 8px;
                }
                #alarm-takip-modal .at-sembol {
                    font-size: 15px; font-weight: 700; color: #fff;
                }
                #alarm-takip-modal .at-type {
                    font-size: 11px; font-weight: 600;
                    padding: 2px 8px; border-radius: 8px;
                    background: rgba(251,146,60,0.15); color: #fb923c;
                }
                #alarm-takip-modal .at-item-bottom {
                    display: flex; align-items: center; gap: 12px;
                    font-size: 12px; color: #888;
                }
                #alarm-takip-modal .at-fiyat {
                    font-size: 13px; font-weight: 600; color: #fff;
                }
                #alarm-takip-modal .at-degisim.pos { color: #4ade80; }
                #alarm-takip-modal .at-degisim.neg { color: #f87171; }
                #alarm-takip-modal .at-premium-row {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 8px 16px 4px;
                    font-size: 12px; color: #888;
                }
                #alarm-takip-modal .at-premium-badge {
                    font-size: 11px; font-weight: 700;
                    padding: 2px 8px; border-radius: 8px;
                }
                #alarm-takip-modal .at-premium-badge.yes {
                    background: rgba(251,191,36,0.15); color: #fbbf24;
                }
                #alarm-takip-modal .at-premium-badge.no {
                    background: rgba(255,255,255,0.07); color: #aaa;
                }
            `;
            document.head.appendChild(style);

            var modal = document.createElement('div');
            modal.id = 'alarm-takip-modal';
            modal.innerHTML =
                '<div class="at-header">' +
                '  <button class="at-back" id="at-back">&#8592;</button>' +
                '  <div class="at-title">Alarm Takip</div>' +
                '</div>' +
                '<div class="at-search-row">' +
                '  <input class="at-input" id="at-user-id" type="number" placeholder="User ID girin..." />' +
                '  <button class="at-btn" id="at-gor-btn">G\u00f6r</button>' +
                '</div>' +
                '<div class="at-divider"></div>' +
                '<div class="at-body" id="at-body">' +
                '  <div class="at-empty">Kullan\u0131c\u0131 ID girerek alarmlara bak\u0131n.</div>' +
                '</div>';
            document.body.appendChild(modal);

            document.getElementById('at-back').onclick = function() { modal.remove(); };

            document.getElementById('at-gor-btn').onclick = function() {
                var userId = document.getElementById('at-user-id').value.trim();
                if (!userId) {
                    document.getElementById('at-body').innerHTML = '<div class="at-empty">L\u00fctfen bir User ID girin.</div>';
                    return;
                }
                document.getElementById('at-body').innerHTML = '<div class="at-loading">Y\u00fckleniyor...</div>';

                var alarmHeaders = { 'Accept': 'application/json' };
                try {
                    var tgInitData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';
                    if (tgInitData) alarmHeaders['X-Client-Init-Data'] = tgInitData;
                } catch(e) {}
                fetch('/api/v1/alarm_liste?user_id=' + encodeURIComponent(userId), {
                    headers: alarmHeaders
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var body = document.getElementById('at-body');
                    if (!body) return;
                    var alarmlar = data.alarmlar || [];
                    var isPremium = data.is_premium || false;

                    if (alarmlar.length === 0) {
                        body.innerHTML = '<div class="at-empty">Bu kullan\u0131c\u0131ya ait alarm bulunamad\u0131.</div>';
                        return;
                    }

                    var typeLabels = {
                        gunluk_ozet: 'G\u00fcnl\u00fck \u00d6zet',
                        kurum_akd: 'Kurum AKD',
                        zincir: 'Zincir',
                        hedef: 'Hedef',
                        degisim: 'De\u011fi\u015fim',
                        vwap_kirilim: 'VWAP K\u0131r\u0131l\u0131m',
                        hacim: 'Hacim',
                        takas_anomali: 'Takas Anomali',
                        sermaye_oran: 'Sermaye Oran',
                        alis_baskisi: 'Al\u0131\u015f Bask\u0131s\u0131',
                        kademe_sikisma: 'Kademe S\u0131k\u0131\u015fma',
                        sinyal: 'Sinyal',
                        teknik_skor: 'Teknik Skor',
                        rsi_bosalma: 'RSI Bo\u015falma',
                        bb_sikisma: 'BB S\u0131k\u0131\u015fma',
                        kap: 'KAP',
                        temettu: 'Temett\u00fc'
                    };

                    var html = '<div class="at-premium-row">' +
                        '<span>' + alarmlar.length + ' alarm bulundu</span>' +
                        '<span class="at-premium-badge ' + (isPremium ? 'yes' : 'no') + '">' +
                        (isPremium ? 'Premium' : 'Free') + '</span>' +
                        '</div>';

                    if (alarmlar.length > 0) {
                        html += '<div style="padding:8px 16px 4px;font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;">Alarmlar</div>';
                    }

                    alarmlar.forEach(function(alarm) {
                        var sembol = alarm.sembol === '__PORTFOLIO__' ? '\uD83D\uDCC1 Portf\u00f6y' : alarm.sembol;
                        var typeLabel = typeLabels[alarm.alarm_type] || alarm.alarm_type;
                        var tarih = alarm.tarih ? alarm.tarih.substring(0, 10) : '';
                        var fiyat = alarm.guncel_fiyat != null ? alarm.guncel_fiyat.toFixed(2) : (alarm.fiyat != null ? alarm.fiyat.toFixed(2) : '');
                        var degisim = alarm.degisim != null ? alarm.degisim : null;
                        var degisimHtml = '';
                        if (degisim !== null) {
                            var cls = degisim >= 0 ? 'pos' : 'neg';
                            var sign = degisim >= 0 ? '+' : '';
                            degisimHtml = '<span class="at-degisim ' + cls + '">' + sign + degisim.toFixed(2) + '%</span>';
                        }
                        html += '<div class="at-item">' +
                            '<div class="at-item-top">' +
                            '<span class="at-sembol">' + sembol + '</span>' +
                            '<span class="at-type">' + typeLabel + '</span>' +
                            '</div>' +
                            '<div class="at-item-bottom">' +
                            (fiyat ? '<span class="at-fiyat">' + fiyat + ' \u20BA</span>' : '') +
                            degisimHtml +
                            (tarih ? '<span>' + tarih + '</span>' : '') +
                            '</div>' +
                            '</div>';
                    });

                    var limitler = data.limitler || {};
                    var limitKeys = Object.keys(limitler);
                    if (limitKeys.length > 0) {
                        var limitLabels = {
                            gunluk_ozet: 'G\u00fcnl\u00fck \u00d6zet',
                            kurum_akd: 'Kurum AKD',
                            zincir: 'Zincir',
                            hedef: 'Hedef',
                            degisim: 'De\u011fi\u015fim',
                            vwap_kirilim: 'VWAP K\u0131r\u0131l\u0131m',
                            hacim: 'Hacim',
                            takas_anomali: 'Takas Anomali',
                            sermaye_oran: 'Sermaye Oran',
                            alis_baskisi: 'Al\u0131\u015f Bask\u0131s\u0131',
                            kademe_sikisma: 'Kademe S\u0131k\u0131\u015fma',
                            sinyal: 'Sinyal',
                            teknik_skor: 'Teknik Skor',
                            rsi_bosalma: 'RSI Bo\u015falma',
                            bb_sikisma: 'BB S\u0131k\u0131\u015fma',
                            kap: 'KAP',
                            temettu: 'Temett\u00fc'
                        };
                        html += '<div style="height:1px;background:rgba(255,255,255,0.08);margin:8px 0;"></div>';
                        html += '<div style="padding:8px 16px 4px;font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;">Alarm Limitleri</div>';
                        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px 16px 16px;">';
                        limitKeys.forEach(function(key) {
                            var label = limitLabels[key] || key;
                            var val = limitler[key];
                            html += '<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">' +
                                '<span style="font-size:12px;color:#aaa;">' + label + '</span>' +
                                '<span style="font-size:14px;font-weight:700;color:#fb923c;">' + val + '</span>' +
                                '</div>';
                        });
                        html += '</div>';
                    }

                    body.innerHTML = html;
                })
                .catch(function(err) {
                    var body = document.getElementById('at-body');
                    if (body) body.innerHTML = '<div class="at-empty">Veri al\u0131namad\u0131. L\u00fctfen tekrar deneyin.</div>';
                });
            };

            document.getElementById('at-user-id').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') document.getElementById('at-gor-btn').click();
            });
        }

        function injectSiralaCard() {
            var grid = document.querySelector('.kesfet-grid');
            if (!grid) return;
            if (grid.querySelector('#sirala-kesfet-card')) return;

            var card = document.createElement('button');
            card.id = 'sirala-kesfet-card';
            card.className = 'kesfet-item';
            card.type = 'button';
            card.innerHTML = '<div class="kesfet-icon" style="background:rgba(139,92,246,0.15);color:#a78bfa;font-size:20px;font-weight:bold;line-height:1;">S</div>'
                + '<span>S\u0131rala</span>';
            card.addEventListener('click', function(e) { e.stopPropagation(); createSiralaModal(); });
            grid.appendChild(card);
        }

        function injectAkdCard() {
            var grid = document.querySelector('.kesfet-grid');
            if (!grid) return;
            if (grid.querySelector('#akd-kesfet-card')) return;

            var card = document.createElement('button');
            card.id = 'akd-kesfet-card';
            card.className = 'kesfet-item';
            card.type = 'button';
            card.innerHTML = '<div class="kesfet-icon" style="background:rgba(16,185,129,0.15);color:#34d399;font-size:20px;font-weight:bold;line-height:1;">A</div>'
                + '<span>AKD Toplu</span>';
            card.addEventListener('click', function(e) { e.stopPropagation(); createAkdModal(); });
            grid.appendChild(card);
        }

        function injectAlarmTakipCard() {
            var grid = document.querySelector('.kesfet-grid');
            if (!grid) return;
            if (grid.querySelector('#alarm-takip-kesfet-card')) return;

            var card = document.createElement('button');
            card.id = 'alarm-takip-kesfet-card';
            card.className = 'kesfet-item';
            card.type = 'button';
            card.innerHTML = '<div class="kesfet-icon" style="background:rgba(251,146,60,0.15);color:#fb923c;font-size:20px;font-weight:bold;line-height:1;">\uD83D\uDD14</div>'
                + '<span>Alarm Takip</span>';
            card.addEventListener('click', function(e) { e.stopPropagation(); createAlarmTakipModal(); });
            grid.appendChild(card);
        }

        function createHarUpdateModal() {
            if (document.getElementById('har-update-modal')) {
                document.getElementById('har-update-modal').style.display = 'flex';
                return;
            }
            var style = document.createElement('style');
            style.textContent = `
                #har-update-modal {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: #08080f; z-index: 99999;
                    display: flex; flex-direction: column;
                    font-family: inherit;
                }
                #har-update-modal .hm-header {
                    display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px 0; background: #08080f;
                }
                #har-update-modal .hm-back {
                    background: rgba(255,255,255,0.08); border: none;
                    border-radius: 50%; width: 36px; height: 36px;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; color: #fff; font-size: 18px; flex-shrink: 0;
                }
                #har-update-modal .hm-title {
                    font-size: 17px; font-weight: 700; color: #fff; flex: 1;
                }
                #har-update-modal .hm-body {
                    flex: 1; overflow-y: auto; padding: 20px 16px;
                    display: flex; flex-direction: column; gap: 16px;
                }
                #har-update-modal .hm-info {
                    background: rgba(255,255,255,0.05); border-radius: 12px;
                    padding: 14px 16px; color: #94a3b8; font-size: 13px; line-height: 1.6;
                }
                #har-update-modal .hm-info b { color: #e2e8f0; }
                #har-update-modal .hm-drop-zone {
                    border: 2px dashed rgba(99,102,241,0.5);
                    border-radius: 16px; padding: 40px 20px;
                    display: flex; flex-direction: column; align-items: center;
                    gap: 12px; cursor: pointer; transition: all 0.2s;
                    background: rgba(99,102,241,0.05);
                }
                #har-update-modal .hm-drop-zone:hover,
                #har-update-modal .hm-drop-zone.drag-over {
                    border-color: rgba(99,102,241,0.9);
                    background: rgba(99,102,241,0.12);
                }
                #har-update-modal .hm-drop-icon {
                    font-size: 40px; line-height: 1;
                }
                #har-update-modal .hm-drop-text {
                    font-size: 14px; font-weight: 600; color: #c4b5fd;
                    text-align: center;
                }
                #har-update-modal .hm-drop-sub {
                    font-size: 12px; color: #64748b; text-align: center;
                }
                #har-update-modal .hm-result {
                    border-radius: 12px; padding: 14px 16px;
                    font-size: 14px; font-weight: 600; line-height: 1.5;
                    display: none; text-align: center;
                }
                #har-update-modal .hm-result.ok {
                    background: rgba(16,185,129,0.15); color: #34d399;
                    border: 1px solid rgba(16,185,129,0.3);
                }
                #har-update-modal .hm-result.err {
                    background: rgba(239,68,68,0.15); color: #f87171;
                    border: 1px solid rgba(239,68,68,0.3);
                }
                #har-update-modal .hm-result.warn {
                    background: rgba(251,191,36,0.15); color: #fbbf24;
                    border: 1px solid rgba(251,191,36,0.3);
                }
                #har-update-modal .hm-loading {
                    display: none; align-items: center; justify-content: center;
                    gap: 10px; color: #6366f1; font-size: 14px;
                }
                #har-update-modal .hm-spinner {
                    width: 20px; height: 20px;
                    border: 2px solid rgba(99,102,241,0.3);
                    border-top-color: #6366f1;
                    border-radius: 50%;
                    animation: hm-spin 0.7s linear infinite;
                }
                @keyframes hm-spin { to { transform: rotate(360deg); } }
                #har-update-modal .hm-current {
                    background: rgba(255,255,255,0.04); border-radius: 12px;
                    padding: 12px 16px;
                }
                #har-update-modal .hm-current-label {
                    font-size: 11px; color: #64748b; text-transform: uppercase;
                    letter-spacing: 0.05em; margin-bottom: 6px;
                }
                #har-update-modal .hm-current-val {
                    font-size: 13px; color: #94a3b8; font-family: monospace;
                }
            `;
            document.head.appendChild(style);

            var modal = document.createElement('div');
            modal.id = 'har-update-modal';
            modal.innerHTML = `
                <div class="hm-header">
                    <button class="hm-back" id="hm-back-btn">&#8592;</button>
                    <div class="hm-title">HAR ile initData Güncelle</div>
                </div>
                <div class="hm-body">
                    <div class="hm-info">
                        <b>Nasıl kullanılır?</b><br>
                        1. Telegram Web'i açın (<b>web.telegram.org</b>)<br>
                        2. Chrome DevTools → Network sekmesini açın<br>
                        3. <b>Hisse Plus</b> mini uygulamasını açın<br>
                        4. HAR olarak dışa aktarın ve aşağıya yükleyin
                    </div>
                    <div class="hm-current" id="hm-current-box">
                        <div class="hm-current-label">Mevcut initData Durumu</div>
                        <div class="hm-current-val" id="hm-current-val">Yükleniyor...</div>
                    </div>
                    <div class="hm-drop-zone" id="hm-drop-zone">
                        <div class="hm-drop-icon">📂</div>
                        <div class="hm-drop-text">HAR dosyasını buraya sürükleyin<br>veya tıklayın</div>
                        <div class="hm-drop-sub">.har uzantılı dosya seçin</div>
                        <input type="file" id="hm-file-input" accept=".har,application/json" style="display:none">
                    </div>
                    <div class="hm-loading" id="hm-loading">
                        <div class="hm-spinner"></div>
                        <span>İşleniyor...</span>
                    </div>
                    <div class="hm-result" id="hm-result"></div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('hm-back-btn').addEventListener('click', function() {
                modal.style.display = 'none';
            });

            function showResult(msg, type) {
                var el = document.getElementById('hm-result');
                el.textContent = msg;
                el.className = 'hm-result ' + type;
                el.style.display = 'block';
                document.getElementById('hm-loading').style.display = 'none';
            }

            function uploadHar(file) {
                if (!file) return;
                document.getElementById('hm-result').style.display = 'none';
                document.getElementById('hm-loading').style.display = 'flex';
                var reader = new FileReader();
                reader.onload = function(e) {
                    var text = e.target.result;
                    var har;
                    try { har = JSON.parse(text); } catch(ex) {
                        showResult('❌ Dosya geçerli bir JSON değil', 'err');
                        return;
                    }
                    fetch('/api/v1/update_init_from_har', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(har)
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        if (d.ok) {
                            showResult(d.message, d.expired ? 'warn' : 'ok');
                            loadCurrentStatus();
                        } else {
                            showResult('❌ ' + (d.reason || 'Hata'), 'err');
                        }
                    })
                    .catch(function() { showResult('❌ Sunucu hatası', 'err'); });
                };
                reader.readAsText(file);
            }

            function loadCurrentStatus() {
                var el = document.getElementById('hm-current-val');
                fetch('/api/v1/init_data_status')
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        if (d.ok) {
                            el.textContent = d.date_str + ' — ' + d.age_hours + ' saat önce' + (d.expired ? ' (⚠️ Süresi dolmuş)' : ' (✅ Geçerli)');
                            el.style.color = d.expired ? '#fbbf24' : '#34d399';
                        } else {
                            el.textContent = 'Kayıtlı initData yok — fallback kullanılıyor';
                            el.style.color = '#64748b';
                        }
                    })
                    .catch(function() { el.textContent = 'Durum alınamadı'; });
            }
            loadCurrentStatus();

            var dz = document.getElementById('hm-drop-zone');
            var fi = document.getElementById('hm-file-input');
            dz.addEventListener('click', function() { fi.click(); });
            fi.addEventListener('change', function() { if (fi.files[0]) uploadHar(fi.files[0]); });
            dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
            dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
            dz.addEventListener('drop', function(e) {
                e.preventDefault(); dz.classList.remove('drag-over');
                if (e.dataTransfer.files[0]) uploadHar(e.dataTransfer.files[0]);
            });
        }

        function injectHarUpdateCard() {
            var grid = document.querySelector('.kesfet-grid');
            if (!grid) return;
            if (grid.querySelector('#har-update-kesfet-card')) return;

            var card = document.createElement('button');
            card.id = 'har-update-kesfet-card';
            card.className = 'kesfet-item';
            card.type = 'button';
            card.innerHTML = '<div class="kesfet-icon" style="background:rgba(99,102,241,0.15);color:#818cf8;font-size:20px;font-weight:bold;line-height:1;">&#128279;</div>'
                + '<span>HAR G\u00FCncelle</span>';
            card.addEventListener('click', function(e) { e.stopPropagation(); createHarUpdateModal(); });
            grid.appendChild(card);
        }

        setInterval(function() {
            var grid = document.querySelector('.kesfet-grid');
            if (grid) {
                if (!grid.querySelector('#sirala-kesfet-card')) injectSiralaCard();
                if (!grid.querySelector('#akd-kesfet-card')) injectAkdCard();
                if (!grid.querySelector('#alarm-takip-kesfet-card')) injectAlarmTakipCard();
                if (!grid.querySelector('#har-update-kesfet-card')) injectHarUpdateCard();
            }
        }, 300);

        var observer = new MutationObserver(function() {
            var grid = document.querySelector('.kesfet-grid');
            if (grid) {
                if (!grid.querySelector('#sirala-kesfet-card')) injectSiralaCard();
                if (!grid.querySelector('#akd-kesfet-card')) injectAkdCard();
                if (!grid.querySelector('#alarm-takip-kesfet-card')) injectAlarmTakipCard();
                if (!grid.querySelector('#har-update-kesfet-card')) injectHarUpdateCard();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    })();
    // --- End Sırala ---
})();
</script>
