import json
import os
import re
import time
import threading
from datetime import datetime, timedelta
from urllib.parse import urlencode, parse_qs, urlparse, quote

import requests
from flask import Flask, request, Response, jsonify, abort
from concurrent.futures import ThreadPoolExecutor

import telegram_session

BASE_HOST = "webapi.hisseplus.com"
BASE_URL = f"https://{BASE_HOST}"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
INJECT_PATH = os.path.join(BASE_DIR, "static", "inject.js")
INIT_DATA_FILE = os.path.join(DATA_DIR, "real_init_data.txt")
AKD_CACHE_FILE = os.path.join(DATA_DIR, "akd_toplu_cache.json")
AKD_CACHE_LOCK_FILE = os.path.join(DATA_DIR, "akd_toplu_cache.json.lock")
SIRALA_CACHE_FILE = os.path.join(DATA_DIR, "sirala_cache.json")

FALLBACK_INIT_DATA = (
    "user=%7B%22id%22%3A1761040158%2C%22first_name%22%3A%22%E1%85%A0X%22%2C%22last_name%22%3A%22%22%2C"
    "%22username%22%3A%22zZz09yyu%22%2C%22language_code%22%3A%22en%22%2C%22allows_write_to_pm%22%3Atrue%2C"
    "%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2F"
    "ZAQbljqSItCM1DipIWDSACUHSq_dqX2NxcQkO275aLY.svg%22%7D"
    "&chat_instance=4241063522082100594&chat_type=sender&start_param=IDGYO-canli-r1761040158"
    "&auth_date=1776098327"
    "&signature=yo3vQ2ae0yH0W_MPPtBs_YzzGibfELqFHdTdeqMVS-cDGOt41c8XrxCGctKSOjyZqecbWwSVZhd4TeCksPZQCw"
    "&hash=333bcb8f5594e251ba6601ed20e989e9bd8a5f5adc317090f0fe54fa70e2a35a"
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/144.0.0.0 Safari/537.36"
)

os.makedirs(DATA_DIR, exist_ok=True)

_AKD_LOCK = threading.Lock()
_SIRALA_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()

app = Flask(__name__)


# ─────────────────────────── Utility ───────────────────────────

def _parse_qs_flat(s):
    parsed = parse_qs(s, keep_blank_values=True)
    return {k: v[0] if v else "" for k, v in parsed.items()}


def _now_ms():
    return int(round(time.time() * 1000))


def _clean_symbol(s):
    if s is None:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(s).strip().upper())


def get_real_init_data():
    """Read saved real init data from disk if still valid; otherwise fallback."""
    if os.path.isfile(INIT_DATA_FILE):
        try:
            with open(INIT_DATA_FILE, "r", encoding="utf-8") as f:
                saved = f.read().strip()
            if saved:
                params = _parse_qs_flat(saved)
                saved_hash = params.get("hash", "")
                saved_auth = int(params.get("auth_date", 0) or 0)
                if saved_hash and not saved_hash.startswith("aabb") and (time.time() - saved_auth) < 86400:
                    return saved
        except Exception:
            pass
    return FALLBACK_INIT_DATA


def build_headers(extra=None):
    base = [
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"),
        ("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8,tr;q=0.7"),
        ("Referer", "https://web.telegram.org/"),
        ("Sec-Ch-Ua", '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"'),
        ("Sec-Ch-Ua-Mobile", "?0"),
        ("Sec-Ch-Ua-Platform", '"Windows"'),
        ("Sec-Fetch-Site", "cross-site"),
        ("Sec-Fetch-User", "?1"),
        ("Upgrade-Insecure-Requests", "1"),
        ("User-Agent", USER_AGENT),
    ]
    out = {}
    for k, v in base:
        out[k] = v
    if extra:
        if isinstance(extra, dict):
            for k, v in extra.items():
                out[k] = v
        else:
            for item in extra:
                if isinstance(item, str) and ":" in item:
                    k, v = item.split(":", 1)
                    out[k.strip()] = v.strip()
                elif isinstance(item, (list, tuple)) and len(item) == 2:
                    out[item[0]] = item[1]
    return out


def proxy_request(url, method, headers, body=b""):
    """Mirror of PHP proxyRequest using requests."""
    try:
        r = requests.request(
            method=method,
            url=url,
            headers=headers,
            data=body if body else None,
            timeout=60,
            allow_redirects=True,
        )
        return {
            "httpCode": r.status_code,
            "respHeaders": dict(r.headers),
            "respBody": r.content,
            "error": "",
        }
    except requests.RequestException as e:
        return {
            "httpCode": 0,
            "respHeaders": {},
            "respBody": b"",
            "error": str(e),
        }


# ─────────────────────────── AKD Cache ───────────────────────────

def akd_read_cache_payload():
    if not os.path.isfile(AKD_CACHE_FILE):
        return None
    try:
        with open(AKD_CACHE_FILE, "r", encoding="utf-8") as f:
            cached = json.load(f)
    except Exception:
        return None
    if not isinstance(cached, dict) or not isinstance(cached.get("data"), list):
        return None

    data_symbols = {}
    period_ready_symbols = {}
    for row in cached["data"]:
        if isinstance(row, dict) and row.get("sembol"):
            sym = _clean_symbol(row.get("sembol"))
            if sym:
                data_symbols[sym] = True
                fd = row.get("fiyat_degisimleri") if isinstance(row.get("fiyat_degisimleri"), dict) else {}
                has_d90 = (
                    isinstance(fd.get("d90"), (int, float))
                    or isinstance(fd.get("90gun"), (int, float))
                    or isinstance(fd.get("90_gun"), (int, float))
                )
                mini = row.get("mini_grafik")
                has_mini = isinstance(mini, list) and len(mini) >= 2
                if has_d90 or has_mini:
                    period_ready_symbols[sym] = True

    scanned = []
    raw_scanned = cached.get("scanned")
    if isinstance(raw_scanned, list):
        for sym in raw_scanned:
            sym = _clean_symbol(sym)
            if sym and sym in data_symbols:
                scanned.append(sym)
    if not scanned:
        scanned = list(data_symbols.keys())

    return {
        "data": list(cached["data"]),
        "scanned": list(dict.fromkeys(scanned)),
        "ts": cached.get("ts"),
    }


def akd_write_cache_payload(data, ts=None, scanned=None):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        if scanned is None:
            scanned = []
        scanned_clean = list({str(s).upper() for s in scanned if s})
        payload = {
            "data": list(data),
            "scanned": scanned_clean,
            "ts": ts or _now_ms(),
        }
        tmp = AKD_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, AKD_CACHE_FILE)
        return True
    except Exception:
        return False


def akd_merge_cache_results(new_rows, scanned_symbols=None):
    if not new_rows and not scanned_symbols:
        return
    scanned_symbols = scanned_symbols or []

    with _AKD_LOCK:
        current = akd_read_cache_payload()
        row_map = {}
        scanned_map = {}
        if current and isinstance(current.get("data"), list):
            for row in current["data"]:
                if not isinstance(row, dict) or not row.get("sembol"):
                    continue
                row_map[str(row["sembol"]).upper()] = row
        if current and isinstance(current.get("scanned"), list):
            for sym in current["scanned"]:
                sym = _clean_symbol(sym)
                if sym:
                    scanned_map[sym] = True

        for row in new_rows:
            if not isinstance(row, dict) or not row.get("sembol"):
                continue
            sym = _clean_symbol(row.get("sembol"))
            if not sym:
                continue
            row_map[sym] = row
            scanned_map[sym] = True

        for sym in scanned_symbols:
            sym = _clean_symbol(sym)
            if sym:
                scanned_map[sym] = True

        rows = list(row_map.values())

        def _sort_key(r):
            for k in ("skor", "oran", "top_oran"):
                if k in r and isinstance(r[k], (int, float)):
                    return -float(r[k])
            return 0

        rows.sort(key=_sort_key)
        akd_write_cache_payload(rows, None, list(scanned_map.keys()))


# ─────────────────────────── Sirala Cache ───────────────────────────

def sirala_normalize_mode(mode):
    mode = re.sub(r"[^a-z]", "", str(mode or "").strip().lower())
    return mode if mode in ("teknik", "analiz", "birleshik", "diptakas") else ""


def sirala_read_cache_payload(mode=None):
    if not os.path.isfile(SIRALA_CACHE_FILE):
        return None
    try:
        with open(SIRALA_CACHE_FILE, "r", encoding="utf-8") as f:
            cached = json.load(f)
    except Exception:
        return None
    if not isinstance(cached, dict):
        return None
    if mode is not None:
        mode = sirala_normalize_mode(mode)
        if not mode or not isinstance(cached.get(mode), dict):
            return None
        entry = cached[mode]
        if not isinstance(entry.get("data"), list):
            return None
        return {"data": list(entry["data"]), "ts": entry.get("ts")}
    return cached


def sirala_write_cache_payload(mode, data, ts=None):
    mode = sirala_normalize_mode(mode)
    if not mode:
        return False
    with _SIRALA_LOCK:
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            cached = sirala_read_cache_payload() or {}
            cached[mode] = {"data": list(data), "ts": ts or _now_ms()}
            tmp = SIRALA_CACHE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cached, f, ensure_ascii=False)
            os.replace(tmp, SIRALA_CACHE_FILE)
            return True
        except Exception:
            return False


def sirala_delete_cache_payload(mode=None):
    with _SIRALA_LOCK:
        if not mode:
            try:
                if os.path.isfile(SIRALA_CACHE_FILE):
                    os.unlink(SIRALA_CACHE_FILE)
                return True
            except Exception:
                return False
        mode = sirala_normalize_mode(mode)
        if not mode:
            return False
        if not os.path.isfile(SIRALA_CACHE_FILE):
            return True
        try:
            with open(SIRALA_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if not isinstance(cached, dict):
                cached = {}
            cached.pop(mode, None)
            if not cached:
                os.unlink(SIRALA_CACHE_FILE)
                return True
            with open(SIRALA_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(cached, f, ensure_ascii=False)
            return True
        except Exception:
            return False


# ─────────────────────────── HTML Inject ───────────────────────────

def _load_inject_script():
    try:
        with open(INJECT_PATH, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


INJECT_SCRIPT = _load_inject_script()


# ─────────────────────────── Mock Data ───────────────────────────

MOCK_SEMBOLLER = [
    'A1CAP','ACSEL','ADEL','ADESE','ADFGY','ADGYO','ADNAC','AEFES','AGESA','AGROT',
    'AGYO','AHGAZ','AHSGY','AKBNK','AKCNS','AKFGY','AKFIN','AKGRT','AKGUÇ','AKLEASE',
    'AKSA','AKSEN','AKTIF','AKYHO','ALARK','ALBRK','ALFAS','ALGYO','ALKIM','ALMAD',
    'ALTINS','ALTIN','ANGEN','ANHYT','ANELE','ANSGR','ARASE','ARCLK','ARDYZ','ARENA',
    'ARMADA','ARSAN','ARYES','ASGYO','ASELS','ASLAN','ASTOR','ATAKP','ATATP','ATEKS',
    'ATLAS','ATSYH','AVGYO','AVHOL','AVOD','AVTUR','AYCES','AYDEM','AYEN','AYES',
    'AZTEK','BAGFS','BAKAB','BALAT','BANVT','BASCM','BASGZ','BERA','BEYAZ','BIGCH',
    'BIMAS','BIOEN','BIZIM','BJKAS','BLCYT','BNTAS','BOSSA','BRISA','BRMEN','BRKVY',
    'BRLSM','BRYAT','BSOKE','BTCIM','BUCIM','BURCE','BURVA','BVSAN','CANTE','CARFA',
    'CASA','CCHOL','CCOLA','CELHA','CEMTS','CIMSA','CLEBI','CMBTN','CMENT','COKAL',
    'COSMO','CRDFA','CRFSA','CUSAN','CWENE','DAGHL','DAGI','DAPGM','DARDL','DENGE',
    'DERHL','DERIM','DESA','DESPC','DEVA','DGATE','DGNMO','DITAS','DMSAS','DNISI',
    'DOAS','DOFER','DOHOL','DOKTA','DORE','DREDE','DTRND','DURAN','DYOBY','DZGYO',
    'EAPRO','ECILC','ECZYT','EDIP','EGEEN','EGEPO','EGGUB','EGPRO','EGSER','EKGYO',
    'EKIZ','EKSUN','ELITE','EMKEL','EMNIS','EMPAT','ENDAE','ENERY','ENGYO','ENJSA',
    'ENKAI','ENSRI','EONMG','EPLAS','ERBOS','ERCB','ERGL','EREGL','ERSU','ESCAR',
    'ESCOM','ESEN','ETGGY','ETYAT','EUHOL','EUPWR','EUREN','EUYO','FAAC','FADE',
    'FENER','FMIZP','FONET','FORMT','FORTE','FROTO','GARFA','GARAN','GENTS','GEREL',
    'GESAN','GIPTA','GLBMD','GLCVY','GLRYH','GLYHO','GMTAS','GOLDS','GOLTS','GOODY',
    'GOZDE','GRSEL','GRTRK','GSDDE','GSDHO','GSRAY','GUBRF','GUSGR','GWIND','GZNMI',
    'HALKB','HATEK','HATSN','HEDEF','HEKTS','HKTM','HLGYO','HTTBT','HUBVC','HUNER',
    'HURGZ','HZNDR','ICBCT','ICUGS','IDEAS','IDGYO','IDOSA','IEYHO','IGDAS','IHEVA',
    'IHLGM','IHLAS','IHYAY','IMASM','INDES','INFO','INGRM','INTEM','INVEO','IPEKE',
    'ISBIR','ISCTR','ISFIN','ISGSY','ISGYO','ISKPL','ISKUR','ISMEN','ISSEN','ISYAT',
    'ITTFH','IZFAS','IZMDC','JANTS','KAPLM','KAREL','KARSN','KARYE','KATMR','KAYSE',
    'KAZMO','KBORU','KCHOL','KCVGY','KERVT','KEREVT','KFEIN','KGYO','KIMMR','KLGYO',
    'KLKIM','KLMSN','KLRHO','KLSYN','KMPUR','KNFRT','KONTR','KONYA','KORDS','KOTAM',
    'KOTON','KOZAA','KOZAL','KRDMA','KRDMB','KRDMD','KRPLS','KRSTL','KRTEK','KRVGD',
    'KSGYO','KTLEV','KTSKR','KURTL','KUYAS','KZBGY','LIDER','LIDFA','LINK','LKMNH',
    'LOGO','LRSHO','LUKSK','LVENT','MAALT','MAGEN','MAKIM','MAKTK','MANAS','MARBL',
    'MARKA','MARTI','MASDL','MAVI','MEGAP','MEGMT','MEKAG','MEPET','METUR','MGROS',
    'MHRGY','MIATK','MIPAZ','MMCAS','MNDRS','MNDTR','MOBTL','MOGAN','MPARK','MRGYO',
    'MRSHL','MSGYO','MTRKS','MZHLD','NATEN','NCTS','NETAS','NIBAS','NILYT','NKOLAS',
    'NTGAZ','NTHOL','NTTUR','NUROL','OBAMS','ODAS','OFSYM','ONCSM','ONRYT','ORCAY',
    'ORGE','ORMA','ORMGE','OSMEN','OSTIM','OTKAR','OYAKC','OYAYO','OYLUM','OZGYO',
    'OZKGY','PAGYO','PAMEL','PAPIL','PARSN','PASEU','PCILT','PEHOL','PEKGY','PENGD',
    'PETKM','PETUN','PGSUS','PHNMG','PINSU','PKART','PKENT','PLTUR','POLHO','POLTK',
    'PRDCH','PRTAS','PRZMA','PSDTC','PSGYO','PTOFS','PYGYO','QUAGR','RALYH','RAYSG',
    'RLYHO','RODRG','ROYAL','RTALB','RUBNS','RYGYO','RYSAS','SAHOL','SAMAT','SARKY',
    'SASA','SAYAS','SEKFK','SEKUR','SELEC','SELVA','SEYKM','SILVR','SKBNK','SKTAS',
    'SKYMD','SMART','SMRTG','SNGYO','SNKRN','SODSN','SOKM','SOKTM','SONME','SRVGY',
    'SUMAS','SUNTK','SUWEN','TABGD','TARKM','TATGD','TAVHL','TBORG','TCELL','TDGYO',
    'TEBNK','TEKTU','TEZOL','THYAO','TIRE','TISAS','TKFEN','TKNSA','TLMAN','TMSN',
    'TMPOL','TOASO','TOGG','TRGYO','TRILC','TSPOR','TTKOM','TTRAK','TUCLK','TUKAS',
    'TUKEY','TUPRS','TUREX','TURGG','TURSG','UFUK','ULUUN','ULUSE','ULUSM','ULVAC',
    'UNAM','UNLU','USAK','VAKBN','VAKFN','VAKKO','VBTS','VERUS','VESBE','VESTL',
    'VKFYO','VKING','VRGYO','YAPRK','YAYLA','YBTAS','YGGYO','YKBNK','YKSLN','YLGYO',
    'YONGA','YYLGD','YUNSA','ZEDUR','ZGNYO','ZOREN','ZRGYO','ZRKGK',
]

ALARM_LIMITLER = {
    'zincir': 100, 'hedef': 100, 'degisim': 100, 'vwap_kirilim': 100,
    'hacim': 100, 'takas_anomali': 100, 'sermaye_oran': 100, 'alis_baskisi': 100,
    'kademe_sikisma': 100, 'sinyal': 100, 'teknik_skor': 100, 'rsi_bosalma': 100,
    'bb_sikisma': 100, 'kap': 100, 'kurum_akd': 100, 'temettu': 100,
    'gunluk_ozet': 100,
}

MOCK_RESPONSES = {
    '/api/v1/kanal_kontrol':  {'uye': True, 'zorunlu': False, 'ok': True},
    '/api/v1/sponsor/durum':  {'aktif': False, 'sponsor': None, 'ok': True},
    '/api/v1/kullanici': {
        'ok': True, 'user_id': 424232285, 'id': 424232285,
        'ad': 'Hisse', 'soyad': 'Plus', 'kullanici_adi': 'hisseplus',
        'premium': True, 'is_premium': True, 'bitis': '2099-12-31',
        'seviye': 1, 'puan': 0, 'kayit_tarihi': '2024-01-01',
        'abonelik': {
            'plan': 'premium', 'baslangic': '2024-01-01',
            'bitis': '2099-12-31', 'aktif': True,
        },
    },
    '/api/v1/alarm_liste': {
        'ok': True, 'alarmlar': [], 'is_premium': True,
        'limitler': dict(ALARM_LIMITLER),
    },
    '/api/v1/portfoy':       {'ok': True, 'portfoy': []},
    '/api/v1/portfoy_liste': {'ok': True, 'liste': []},
    '/api/v1/favoriler':     {'ok': True, 'liste': []},
    '/api/v1/alarm_kur':     {'ok': True},
    '/api/v1/alarm_sil':     {'ok': True},
    '/api/v1/favori_ekle':   {'ok': True},
    '/api/v1/favori_sil':    {'ok': True},
    '/api/v1/portfoy_ekle':  {'ok': True},
    '/api/v1/portfoy_sil':   {'ok': True},
    '/api/v1/liste_olustur': {'ok': True},
    '/api/v1/liste_sil':     {'ok': True},
    '/api/v1/liste_sembol':  {'ok': True},
    '/api/v1/semboller':     {'ok': True, 'semboller': MOCK_SEMBOLLER},
}


def _json_response(data, status=200):
    resp = jsonify(data) if not isinstance(data, str) else Response(data, status=status, mimetype="application/json; charset=utf-8")
    if isinstance(data, str):
        return resp
    resp.status_code = status
    resp.headers["Content-Type"] = "application/json; charset=utf-8"
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


# ─────────────────────────── Local API Endpoints ───────────────────────────

@app.route("/api/v1/init_data_status", methods=["GET"])
def init_data_status():
    if os.path.isfile(INIT_DATA_FILE):
        try:
            with open(INIT_DATA_FILE, "r", encoding="utf-8") as f:
                saved = f.read().strip()
            sp = _parse_qs_flat(saved)
            auth_date = int(sp.get("auth_date", 0) or 0)
            hsh = sp.get("hash", "")
            if hsh and auth_date > 0:
                age = int(time.time()) - auth_date
                return _json_response({
                    "ok": True,
                    "source": "saved",
                    "auth_date": auth_date,
                    "date_str": datetime.fromtimestamp(auth_date).strftime("%d.%m.%Y %H:%M"),
                    "age_hours": round(age / 3600, 1),
                    "expired": age >= 86400,
                })
        except Exception:
            pass

    fp = _parse_qs_flat(FALLBACK_INIT_DATA)
    auth_date = int(fp.get("auth_date", 0) or 0)
    age = int(time.time()) - auth_date
    return _json_response({
        "ok": True,
        "source": "fallback",
        "auth_date": auth_date,
        "date_str": datetime.fromtimestamp(auth_date).strftime("%d.%m.%Y %H:%M") if auth_date else "",
        "age_hours": round(age / 3600, 1),
        "expired": age >= 86400,
    })


@app.route("/api/v1/update_init_from_har", methods=["POST"])
def update_init_from_har():
    try:
        har = json.loads(request.get_data(as_text=True) or "null")
    except Exception:
        har = None

    if not har or "log" not in har or "entries" not in har.get("log", {}):
        return _json_response({"ok": False, "reason": "Geçerli bir HAR dosyası değil"})

    found_init_data = ""
    found_auth_date = 0
    for entry in har["log"]["entries"]:
        for h in (entry.get("request", {}).get("headers") or []):
            if str(h.get("name", "")).lower() == "x-telegram-init-data":
                val = h.get("value", "")
                if val:
                    parsed = _parse_qs_flat(val)
                    auth_date = int(parsed.get("auth_date", 0) or 0)
                    hsh = parsed.get("hash", "")
                    if hsh and auth_date > 0:
                        if not found_init_data or auth_date > found_auth_date:
                            found_init_data = val
                            found_auth_date = auth_date
                break
        if found_init_data:
            break

    if not found_init_data:
        return _json_response({
            "ok": False,
            "reason": "HAR dosyasında initData bulunamadı. Hisse Plus mini uygulamasının HAR'ını yükleyin.",
        })

    fp = _parse_qs_flat(found_init_data)
    auth_date = int(fp.get("auth_date", 0) or 0)
    hsh = fp.get("hash", "")
    if not hsh or hsh.startswith("aabb"):
        return _json_response({"ok": False, "reason": "initData geçersiz (hash hatalı)"})

    age = int(time.time()) - auth_date
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(INIT_DATA_FILE, "w", encoding="utf-8") as f:
            f.write(found_init_data)
    except Exception:
        pass

    date_str = datetime.fromtimestamp(auth_date).strftime("%d.%m.%Y %H:%M")
    if age < 86400:
        message = f"✅ initData güncellendi! Tarih: {date_str} (yaş: {round(age/3600,1)} saat)"
    else:
        message = f"⚠️ initData kaydedildi ama süresi dolmuş ({date_str}). Yeni bir HAR alın."

    return _json_response({
        "ok": True,
        "auth_date": auth_date,
        "date_str": date_str,
        "age_hours": round(age / 3600, 1),
        "expired": age >= 86400,
        "message": message,
    })


@app.route("/api/v1/save_init_data", methods=["POST"])
def save_init_data():
    try:
        body = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        body = {}
    init_data_raw = body.get("initData", "")
    if not init_data_raw:
        return _json_response({"ok": False, "reason": "empty"})

    params = _parse_qs_flat(init_data_raw)
    hsh = params.get("hash", "")
    auth_date = int(params.get("auth_date", 0) or 0)
    if hsh and not hsh.startswith("aabb") and (time.time() - auth_date) < 86400:
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(INIT_DATA_FILE, "w", encoding="utf-8") as f:
                f.write(init_data_raw)
            return _json_response({"ok": True})
        except Exception:
            return _json_response({"ok": False, "reason": "write_failed"})
    return _json_response({"ok": False, "reason": "invalid"})


@app.route("/api/v1/akd_cache", methods=["GET", "POST", "DELETE", "OPTIONS"])
def akd_cache():
    if request.method == "OPTIONS":
        resp = _json_response({"ok": True})
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    if request.method == "GET":
        cached = akd_read_cache_payload()
        if not cached:
            return _json_response({"ok": False, "data": [], "ts": None})
        return _json_response({
            "ok": True,
            "data": cached["data"],
            "scanned": cached["scanned"],
            "scanned_count": len(cached["scanned"]),
            "ts": cached.get("ts"),
        })

    if request.method == "POST":
        try:
            payload = json.loads(request.get_data(as_text=True) or "null") or {}
        except Exception:
            payload = {}
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list) or not data:
            return _json_response({"ok": False, "error": "Cache verisi boş veya geçersiz."}, status=400)

        ts = payload.get("ts") if isinstance(payload.get("ts"), (int, float)) else None
        if payload.get("merge"):
            scanned = payload.get("scanned") if isinstance(payload.get("scanned"), list) else [
                row.get("sembol") for row in data if isinstance(row, dict)
            ]
            akd_merge_cache_results(data, scanned)
            return _json_response({"ok": True, "merged": True, "ts": ts or _now_ms()})

        scanned = payload.get("scanned") if isinstance(payload.get("scanned"), list) else []
        if not akd_write_cache_payload(data, ts, scanned):
            return _json_response({"ok": False, "error": "Cache dosyasına yazılamadı."}, status=500)
        return _json_response({"ok": True, "ts": ts or _now_ms()})

    if request.method == "DELETE":
        try:
            if os.path.isfile(AKD_CACHE_FILE):
                os.unlink(AKD_CACHE_FILE)
            return _json_response({"ok": True})
        except Exception:
            return _json_response({"ok": False, "error": "Cache dosyası silinemedi."}, status=500)

    return _json_response({"ok": False, "error": "Desteklenmeyen metot."}, status=405)


@app.route("/api/v1/sirala_cache", methods=["GET", "POST", "DELETE", "OPTIONS"])
def sirala_cache():
    if request.method == "OPTIONS":
        resp = _json_response({"ok": True})
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    if request.method == "GET":
        mode = sirala_normalize_mode(request.args.get("mode", ""))
        if not mode:
            return _json_response({"ok": False, "error": "Geçersiz cache modu."}, status=400)
        cached = sirala_read_cache_payload(mode)
        if not cached:
            return _json_response({"ok": False, "data": [], "ts": None})
        return _json_response({
            "ok": True, "mode": mode,
            "data": cached["data"], "ts": cached.get("ts"),
        })

    if request.method == "POST":
        try:
            payload = json.loads(request.get_data(as_text=True) or "null") or {}
        except Exception:
            payload = {}
        mode = sirala_normalize_mode(payload.get("mode", ""))
        data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), list) else []
        if not mode or not data:
            return _json_response({"ok": False, "error": "Cache verisi boş veya modu geçersiz."}, status=400)
        ts = payload.get("ts") if isinstance(payload.get("ts"), (int, float)) else None
        if not sirala_write_cache_payload(mode, data, ts):
            return _json_response({"ok": False, "error": "Sırala cache dosyasına yazılamadı."}, status=500)
        return _json_response({"ok": True, "mode": mode, "ts": ts or _now_ms()})

    if request.method == "DELETE":
        mode = sirala_normalize_mode(request.args.get("mode", ""))
        if not sirala_delete_cache_payload(mode or None):
            return _json_response({"ok": False, "error": "Sırala cache silinemedi."}, status=500)
        return _json_response({"ok": True})

    return _json_response({"ok": False, "error": "Desteklenmeyen metot."}, status=405)


# ─────────────────────────── Bulk Endpoints ───────────────────────────

def _bulk_base_headers():
    headers = {
        "Accept": "application/json",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,tr;q=0.7",
        "Origin": f"https://{BASE_HOST}",
        "Referer": f"https://{BASE_HOST}/tma",
        "User-Agent": USER_AGENT,
        "X-Telegram-Init-Data": get_real_init_data(),
    }
    auth = request.headers.get("Authorization")
    if auth:
        headers["Authorization"] = auth
    return headers


def _http_get(url, headers, timeout=15):
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        return r.content
    except Exception:
        return None


def _parallel_get(urls_by_key, headers, timeout=15, max_workers=8):
    out = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_http_get, url, headers, timeout): key for key, url in urls_by_key.items()}
        for fut in futures:
            key = futures[fut]
            try:
                out[key] = fut.result()
            except Exception:
                out[key] = None
    return out


@app.route("/api/v1/teknik_bulk", methods=["POST"])
def teknik_bulk():
    try:
        payload = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        payload = {}
    semboller = payload.get("semboller") or []
    if not isinstance(semboller, list) or not semboller:
        return _json_response({"ok": False, "sonuclar": []})

    headers = _bulk_base_headers()

    teknik_urls = {}
    ohlcv_urls = {}
    for s in semboller:
        sym = _clean_symbol(s)
        if not sym:
            continue
        teknik_urls[sym] = f"{BASE_URL}/api/v1/teknik_analiz?sembol={quote(sym)}"
        ohlcv_urls[sym] = f"{BASE_URL}/api/v1/ohlcv?sembol={quote(sym)}&resolution=D&countback=90"

    teknik_raw = _parallel_get(teknik_urls, headers, timeout=15, max_workers=8)
    ohlcv_raw = _parallel_get(ohlcv_urls, headers, timeout=15, max_workers=8)

    sonuclar = []
    for sym, raw_t in teknik_raw.items():
        try:
            data = json.loads(raw_t) if raw_t else None
        except Exception:
            data = None
        if not data or not isinstance(data.get("skor"), (int, float)):
            continue
        mini_grafik = []
        raw_o = ohlcv_raw.get(sym)
        if raw_o:
            try:
                ohlcv = json.loads(raw_o)
                closes = ((ohlcv or {}).get("ohlcv") or {}).get("c") or []
                for c in closes:
                    if isinstance(c, (int, float)) and float(c) > 0:
                        mini_grafik.append(round(float(c), 4))
            except Exception:
                pass
        if not mini_grafik and isinstance(data.get("fiyat"), (int, float)) and float(data["fiyat"]) > 0:
            mini_grafik.append(round(float(data["fiyat"]), 4))
        sonuclar.append({
            "sembol": sym,
            "skor": int(data["skor"]),
            "aksiyon": data.get("aksiyon", ""),
            "fiyat": data.get("fiyat", 0),
            "degisim": data.get("degisim", 0),
            "mini_grafik": mini_grafik,
        })

    return _json_response({"ok": True, "sonuclar": sonuclar})


@app.route("/api/v1/analiz_bulk", methods=["POST"])
def analiz_bulk():
    try:
        payload = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        payload = {}
    semboller = payload.get("semboller") or []
    if not isinstance(semboller, list) or not semboller:
        return _json_response({"ok": False, "sonuclar": []})

    headers = _bulk_base_headers()

    urls = {}
    for s in semboller:
        sym = _clean_symbol(s)
        if not sym:
            continue
        urls[sym] = f"{BASE_URL}/api/v1/analiz?sembol={quote(sym)}"

    raw_results = _parallel_get(urls, headers, timeout=15, max_workers=8)
    sonuclar = []
    for sym, raw in raw_results.items():
        try:
            data = json.loads(raw) if raw else None
        except Exception:
            data = None
        if not data:
            continue
        analiz = data.get("analiz") if isinstance(data.get("analiz"), dict) else None
        if not analiz or not isinstance(analiz.get("puan"), (int, float)):
            continue
        sonuclar.append({
            "sembol": sym,
            "puan": float(analiz["puan"]),
            "fiyat": data.get("fiyat", 0),
            "degisim": data.get("degisim", 0),
            "upwards": analiz.get("upwards"),
        })

    return _json_response({"ok": True, "sonuclar": sonuclar})


def _period_changes_from_mini(vals):
    cleaned = []
    for v in vals or []:
        try:
            f = float(v)
            if f > 0 and f == f and f != float("inf") and f != float("-inf"):
                cleaned.append(f)
        except Exception:
            continue
    if len(cleaned) < 2:
        return {"d7": None, "d30": None, "d90": None}
    cur = cleaned[-1]

    def pct(idx):
        if idx < 0 or idx >= len(cleaned):
            return None
        base = cleaned[idx]
        return round((cur - base) / base * 100, 2) if base > 0 else None

    return {
        "d7": pct(max(0, len(cleaned) - 8)),
        "d30": pct(max(0, len(cleaned) - 31)),
        "d90": pct(0),
    }


def _to_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def _akd_process_symbol(sym, data, mini_grafik):
    takas_arr = data.get("takas") if isinstance(data.get("takas"), list) else []
    capraz_arr = data.get("capraz") if isinstance(data.get("capraz"), list) else []
    tl_veriler = []
    if isinstance(data.get("tl_saklama"), dict):
        v = data["tl_saklama"].get("veriler")
        if isinstance(v, list):
            tl_veriler = v
    toplamlar_arr = []
    akd_alanlar = []
    akd_satanlar = []
    if isinstance(data.get("akd"), dict):
        if isinstance(data["akd"].get("toplamlar"), list):
            toplamlar_arr = data["akd"]["toplamlar"]
        if isinstance(data["akd"].get("alanlar"), list):
            akd_alanlar = data["akd"]["alanlar"]
        if isinstance(data["akd"].get("satanlar"), list):
            akd_satanlar = data["akd"]["satanlar"]

    takas_arr = [r for r in takas_arr if str(r.get("kurum", "")).upper() != "TOPLAM"]

    if not takas_arr and not akd_alanlar:
        return None

    capraz_map = {}
    for c in capraz_arr:
        k = str(c.get("kurum", ""))
        if not k:
            continue
        capraz_map[k] = {
            "akd_net": _to_float(c.get("akd_net", 0)),
            "eslesme": bool(c.get("eslesme", True)),
            "takas_fark": _to_float(c.get("takas_fark", 0)),
            "takas_oran": _to_float(c.get("takas_oran", 0)),
            "akd_giris": _to_float(c.get("akd_giriş", c.get("akd_giris", 0))),
            "kaynak": str(c.get("kaynak", "")),
            "kurum_kod": str(c.get("kurum_kod", "")),
            "virman_olasiligi": c.get("virman_olasiligi", c.get("virman_probability")),
            "takas_gecisi": c.get("takas_gecisi", c.get("takas_transition")),
            "behavior": str(c.get("behavior", c.get("label", ""))),
            "son_giris": c.get("son_giris", c.get("son_2g", c.get("recent_entry"))),
            "onceki_giris": c.get("onceki_giris", c.get("prev_entry")),
            "son_giris_pct": c.get("son_giris_pct", c.get("recent_pct")),
            "son_giris_maliyet": _to_float(c.get("son_giris_maliyet", c.get("son_maliyet", 0))),
        }

    tl_map = {}
    tl_full_map = {}
    for v in tl_veriler:
        name = str(v.get("custodian_name", ""))
        if not name:
            continue
        pct_change = _to_float(v.get("percentage_change", 0))
        tl_map[name] = pct_change
        tl_full_map[name] = {
            "kurum": name,
            "tl_fark": _to_float(v.get("tl_fark", v.get("change_amount", 0))),
            "ilk_pct": _to_float(v.get("initial_percentage", v.get("ilk_pct", 0))),
            "son_pct": _to_float(v.get("final_percentage", v.get("son_pct", 0))),
            "degisim_pct": pct_change,
            "puan": _to_float(v.get("puan", v.get("score", 0))),
        }

    toplam_map = {}
    for t in toplamlar_arr:
        k = str(t.get("kurum", ""))
        if k:
            toplam_map[k] = {
                "adet": _to_float(t.get("adet", 0)),
                "oran": _to_float(t.get("oran", 0)),
                "maliyet": _to_float(t.get("maliyet", 0)),
            }

    takas_alicilar = []
    takas_saticilar = []
    virman_liste = []

    for r in takas_arr:
        kurum = str(r.get("kurum", ""))
        fark_lot = _to_float(r.get("fark_lot", 0))
        total_oran = _to_float(r.get("total_oran", 0))
        if fark_lot == 0:
            continue

        cp = capraz_map.get(kurum)
        akd_net = cp["akd_net"] if cp else None
        eslesme = cp["eslesme"] if cp else None

        is_virman = False
        if cp is not None:
            if eslesme is False:
                is_virman = True
            elif akd_net is not None and fark_lot > 0 and akd_net < 0:
                is_virman = True
            elif akd_net is not None and fark_lot < 0 and akd_net > 0:
                is_virman = True

        if is_virman:
            virman_liste.append(kurum)
            continue

        tl_pct = tl_map.get(kurum)
        if tl_pct is not None and abs(tl_pct) > 0.0001:
            weight = abs(tl_pct) * 1e6
        elif akd_net is not None and abs(akd_net) > 0:
            weight = abs(akd_net)
        else:
            weight = abs(fark_lot)

        toplam = toplam_map.get(kurum)
        entry = {
            "kurum": kurum, "weight": weight, "total_oran": total_oran,
            "fark_lot": fark_lot, "akd_net": akd_net, "tl_pct": tl_pct,
            "toplam_oran": toplam["oran"] if toplam else None,
            "toplam_maliyet": toplam["maliyet"] if toplam else None,
        }
        if fark_lot > 0:
            takas_alicilar.append(entry)
        else:
            takas_saticilar.append(entry)

    takas_alicilar.sort(key=lambda x: -x["weight"])
    takas_saticilar.sort(key=lambda x: -x["weight"])

    total_buy_w = sum(x["weight"] for x in takas_alicilar)
    total_sell_w = sum(x["weight"] for x in takas_saticilar)

    def build_pasta(liste, total_weight, limit=5):
        items = []
        diger = 0.0
        i = 0
        for r in liste:
            oran = round(r["weight"] / total_weight * 100, 2) if total_weight > 0 else 0
            if oran <= 0:
                continue
            if i < limit:
                items.append({"kurum": r["kurum"], "oran": oran})
            else:
                diger += oran
            i += 1
        if diger > 0:
            items.append({"kurum": "Diğer", "oran": round(diger, 2)})
        return items

    alicilar_pasta = build_pasta(takas_alicilar, total_buy_w, 5)
    saticilar_pasta = build_pasta(takas_saticilar, total_sell_w, 5)

    def build_akd_pasta(arr, limit=5):
        arr = sorted(arr, key=lambda r: -_to_float((r or {}).get("adet", 0)))
        total = sum(_to_float(r.get("adet", 0)) for r in arr)
        items = []
        diger = 0.0
        i = 0
        for r in arr:
            adet = _to_float(r.get("adet", 0))
            oran = round(adet / total * 100, 2) if total > 0 else 0
            if oran <= 0:
                continue
            if i < limit:
                items.append({"kurum": r.get("kurum", ""), "oran": oran, "maliyet": _to_float(r.get("maliyet", 0))})
            else:
                diger += oran
            i += 1
        if diger > 0:
            items.append({"kurum": "Diğer", "oran": round(diger, 2)})
        return items

    akd_al_pasta = build_akd_pasta(akd_alanlar, 5)
    akd_sat_pasta = build_akd_pasta(akd_satanlar, 5)

    top_sorted = sorted(toplamlar_arr, key=lambda t: -_to_float((t or {}).get("oran", 0)))
    toplam_top5 = [
        {"kurum": t.get("kurum", ""), "oran": _to_float(t.get("oran", 0)), "maliyet": _to_float(t.get("maliyet", 0))}
        for t in top_sorted[:5]
    ]

    alan_sayi = len(takas_alicilar)
    satan_sayi = len(takas_saticilar)
    virman_sayi = len(virman_liste)
    toplam_eslesme = len(capraz_arr)
    virman_oran = round(virman_sayi / toplam_eslesme * 100, 1) if toplam_eslesme > 0 else 0

    top3_buy_w = sum(x["weight"] for x in takas_alicilar[:3])
    top5_buy_w = sum(x["weight"] for x in takas_alicilar[:5])
    top3_oran = round(top3_buy_w / total_buy_w * 100, 2) if total_buy_w > 0 else 0
    top5_oran = round(top5_buy_w / total_buy_w * 100, 2) if total_buy_w > 0 else 0

    top_kurum = takas_alicilar[0]["kurum"] if takas_alicilar else (akd_alanlar[0].get("kurum", "") if akd_alanlar else "")
    top_oran = float(alicilar_pasta[0].get("oran", 0)) if alicilar_pasta else 0

    pos_changes = {k: v for k, v in tl_map.items() if v > 0}
    pos_sorted = sorted(pos_changes.values(), reverse=True)
    tl_top3_sum = sum(pos_sorted[:3])
    tl_total_pos = sum(pos_sorted)
    tl_konsant = min(100, tl_top3_sum / tl_total_pos * 100) if tl_total_pos > 0 else 0

    virman_penalty = min(15, virman_oran * 0.3)
    top3_skor = min(top3_oran, 100) * 0.45
    top5_skor = min(top5_oran, 100) * 0.15
    tl_konsant_skor = tl_konsant * 0.15
    alici_yogun_skor = min(10, max(0, (8 - min(alan_sayi, 8)) * 1.5)) if alan_sayi > 0 else 0
    satici_daginik_skor = min(10, (satan_sayi / max(1, alan_sayi)) * 4) if satan_sayi > 0 else 0
    import math
    lot_skor = min(10, math.log10(max(10, total_buy_w)) * 1.6)
    skor = round(min(100, max(0,
        top3_skor + top5_skor + tl_konsant_skor
        + alici_yogun_skor + satici_daginik_skor + lot_skor
        - virman_penalty
    )), 2)

    fiyat = _to_float(data.get("fiyat", 0))
    toplam_adet_m = 0.0
    toplam_adet = 0.0
    for k in akd_alanlar:
        m = _to_float(k.get("maliyet", 0))
        a = _to_float(k.get("adet", 0))
        if m > 0.1 and a > 0:
            toplam_adet_m += m * a
            toplam_adet += a

    periyod_degisim = None
    if toplam_adet > 0 and fiyat > 0:
        avg_maliyet = toplam_adet_m / toplam_adet
        if avg_maliyet > 0.1:
            periyod_degisim = round((fiyat - avg_maliyet) / avg_maliyet * 100, 2)

    akd_sat_maliyet = None
    sat_adet_m = 0.0
    sat_adet = 0.0
    for k in akd_satanlar:
        m = _to_float(k.get("maliyet", 0))
        a = _to_float(k.get("adet", 0))
        if m > 0.1 and a > 0:
            sat_adet_m += m * a
            sat_adet += a
    if sat_adet > 0 and fiyat > 0:
        avg_sat = sat_adet_m / sat_adet
        if avg_sat > 0.1:
            akd_sat_maliyet = round((fiyat - avg_sat) / avg_sat * 100, 2)

    akd_al_sorted = sorted(akd_alanlar, key=lambda r: -_to_float(r.get("adet", 0)))
    akd_sat_sorted = sorted(akd_satanlar, key=lambda r: -_to_float(r.get("adet", 0)))
    total_akd_al = sum(_to_float(r.get("adet", 0)) for r in akd_al_sorted)
    total_akd_sat = sum(_to_float(r.get("adet", 0)) for r in akd_sat_sorted)

    akd_alanlar_full = []
    for r in akd_al_sorted:
        adet = _to_float(r.get("adet", 0))
        akd_alanlar_full.append({
            "kurum": str(r.get("kurum", "")),
            "adet": adet,
            "maliyet": _to_float(r.get("maliyet", 0)),
            "oran": round(adet / total_akd_al * 100, 2) if total_akd_al > 0 else 0,
        })
    akd_satanlar_full = []
    for r in akd_sat_sorted:
        adet = _to_float(r.get("adet", 0))
        akd_satanlar_full.append({
            "kurum": str(r.get("kurum", "")),
            "adet": adet,
            "maliyet": _to_float(r.get("maliyet", 0)),
            "oran": round(adet / total_akd_sat * 100, 2) if total_akd_sat > 0 else 0,
        })

    lot_takas_liste = []
    for r in takas_arr:
        kur = str(r.get("kurum", ""))
        if not kur:
            continue
        ilk = _to_float(r.get("ilk", r.get("baslangic_lot", r.get("ilk_lot", 0))))
        son = _to_float(r.get("son", r.get("bitis_lot", r.get("son_lot", 0))))
        fark = _to_float(r.get("fark_lot", son - ilk))
        deg_pct = round(fark / abs(ilk) * 100, 2) if ilk != 0 else None
        lot_takas_liste.append({
            "kurum": kur,
            "ilk": ilk,
            "son": son,
            "fark_lot": fark,
            "total_oran": _to_float(r.get("total_oran", 0)),
            "degisim_pct": deg_pct,
        })
    lot_takas_liste.sort(key=lambda x: -abs(x["fark_lot"]))

    tl_saklama_liste = list(tl_full_map.values())
    tl_saklama_liste.sort(key=lambda x: -abs(x["degisim_pct"]))

    akd_takas_karsilastirma = []
    for c in capraz_arr:
        kur = str(c.get("kurum", ""))
        if not kur:
            continue
        akd_takas_karsilastirma.append({
            "kurum": kur,
            "kurum_kod": str(c.get("kurum_kod", "")),
            "akd_net": _to_float(c.get("akd_net", 0)),
            "takas_fark": _to_float(c.get("takas_fark", 0)),
            "takas_oran": _to_float(c.get("takas_oran", 0)),
            "eslesme": bool(c.get("eslesme", True)),
            "kaynak": str(c.get("kaynak", "")),
        })
    akd_takas_karsilastirma.sort(key=lambda x: -abs(x["akd_net"]))

    virman_detay = []
    for kur in virman_liste:
        takas_entry = next((r for r in takas_arr if str(r.get("kurum", "")) == kur), None)
        fark_lot_v = _to_float(takas_entry.get("fark_lot", 0)) if takas_entry else 0
        top_m = toplam_map.get(kur)
        cp2 = capraz_map.get(kur)
        virman_detay.append({
            "kurum": kur,
            "takas_al": fark_lot_v,
            "maliyet": top_m["maliyet"] if top_m else 0,
            "kaynak": cp2["kaynak"] if cp2 else "",
            "akd_net": cp2["akd_net"] if cp2 else 0,
        })

    if isinstance(data.get("smart_money"), dict):
        sm = data["smart_money"]
        smart_money = {
            "akd_net": _to_float(sm.get("akd_net", 0)),
            "takas_net": _to_float(sm.get("takas_net", 0)),
            "toplam_net": _to_float(sm.get("toplam_net", 0)),
            "cakal_sayi": int(sm.get("cakal_sayi", 0) or 0),
            "akd_maliyet": _to_float(sm.get("akd_maliyet", 0)),
            "takas_maliyet": _to_float(sm.get("takas_maliyet", 0)),
        }
    else:
        akd_net_val = sum(_to_float(t.get("adet", 0)) for t in toplamlar_arr)
        takas_net_val = sum(x["fark_lot"] for x in takas_alicilar) + sum(x["fark_lot"] for x in takas_saticilar)
        akd_mal_val = round(toplam_adet_m / toplam_adet, 4) if toplam_adet > 0 else 0
        tm_tot_adet = 0.0
        tm_tot_m = 0.0
        for t in toplamlar_arr:
            ta = abs(_to_float(t.get("adet", 0)))
            tm = _to_float(t.get("maliyet", 0))
            if tm > 0.01 and ta > 0:
                tm_tot_m += tm * ta
                tm_tot_adet += ta
        takas_mal_val = round(tm_tot_m / tm_tot_adet, 4) if tm_tot_adet > 0 else 0
        smart_money = {
            "akd_net": akd_net_val,
            "takas_net": takas_net_val,
            "toplam_net": akd_net_val + takas_net_val,
            "cakal_sayi": 0,
            "akd_maliyet": akd_mal_val,
            "takas_maliyet": takas_mal_val,
        }

    if isinstance(data.get("cakal_kurumlar"), list):
        cakal_kurumlar = [{
            "kurum": str(c.get("kurum", "")),
            "akd_alim": _to_float(c.get("akd_alim", c.get("akd_net", 0))),
            "maliyet": _to_float(c.get("maliyet", 0)),
            "takas_net": _to_float(c.get("takas_net", c.get("takas_fark", 0))),
            "fark_pct": _to_float(c.get("fark", c.get("fark_pct", 0))),
            "virman": c.get("virman"),
        } for c in data["cakal_kurumlar"]]
        smart_money["cakal_sayi"] = len(cakal_kurumlar)
    else:
        cakal_kurumlar = []
        smart_money["cakal_sayi"] = 0

    takas_by_oran = sorted(takas_arr, key=lambda r: -abs(_to_float(r.get("total_oran", 0))))
    top10_takas = []
    for r in takas_by_oran[:10]:
        kur = str(r.get("kurum", ""))
        cp2 = capraz_map.get(kur)
        top_m2 = toplam_map.get(kur)
        top10_takas.append({
            "kurum": kur,
            "takas_net": _to_float(r.get("fark_lot", 0)),
            "total_oran": _to_float(r.get("total_oran", 0)),
            "maliyet": top_m2["maliyet"] if top_m2 else 0,
            "akd_net": cp2["akd_net"] if cp2 else (top_m2["adet"] if top_m2 else 0),
        })

    toplam_by_adet = sorted(toplamlar_arr, key=lambda t: -abs(_to_float(t.get("adet", 0))))
    top10_akd = []
    for t in toplam_by_adet[:10]:
        kur = str(t.get("kurum", ""))
        cp2 = capraz_map.get(kur)
        eslesme2 = cp2["eslesme"] if cp2 else True
        top10_akd.append({
            "kurum": kur,
            "akd_net": _to_float(t.get("adet", 0)),
            "maliyet": _to_float(t.get("maliyet", 0)),
            "takas_net": cp2["takas_fark"] if cp2 else 0,
            "oran": _to_float(t.get("oran", 0)),
            "yorum": "Normal" if eslesme2 else "Virman şüphesi",
        })

    al_rapor = []
    if isinstance(data.get("al_rapor"), list):
        for r in data["al_rapor"]:
            kur = str(r.get("kurum", ""))
            if not kur:
                continue
            al_rapor.append({
                "kurum": kur,
                "virman_olasiligi": r.get("virman_olasiligi", r.get("virman_probability")),
                "takas_gecisi": r.get("takas_gecisi", r.get("takas_transition")),
                "behavior": str(r.get("behavior", r.get("label", ""))),
                "akd_net": _to_float(r.get("akd_net", 0)),
            })
    else:
        cakal_set = [c["kurum"] for c in cakal_kurumlar]
        for c in capraz_arr:
            kur = str(c.get("kurum", ""))
            if not kur:
                continue
            eslesme3 = bool(c.get("eslesme", True))
            akd_net3 = _to_float(c.get("akd_net", 0))
            virman_olas = c.get("virman_olasiligi", c.get("virman_probability"))
            takas_gecis = c.get("takas_gecisi", c.get("takas_transition"))
            behavior3 = str(c.get("behavior", c.get("label", "")))
            if virman_olas is None:
                virman_olas = 20.0 if eslesme3 else 80.0
            if not behavior3:
                if kur in cakal_set:
                    behavior3 = "Çakalık şüphesi"
                elif not eslesme3:
                    behavior3 = "Virman şüphesi"
                elif abs(akd_net3) > 0:
                    behavior3 = "Normal, izle"
                else:
                    behavior3 = "Normal"
            al_rapor.append({
                "kurum": kur,
                "virman_olasiligi": float(virman_olas),
                "takas_gecisi": float(takas_gecis) if takas_gecis is not None else float(abs(_to_float(c.get("takas_oran", 0)))),
                "behavior": behavior3,
                "akd_net": akd_net3,
            })
        al_rapor.sort(key=lambda x: -abs(x["akd_net"]))

    son_girisler = []
    if isinstance(data.get("son_girisler"), list):
        for r in data["son_girisler"]:
            kur = str(r.get("kurum", ""))
            if not kur:
                continue
            son_girisler.append({
                "kurum": kur,
                "son_akd": _to_float(r.get("son_akd", r.get("son_giris", r.get("son_2g", 0)))),
                "maliyet": _to_float(r.get("maliyet", 0)),
                "fark_pct": _to_float(r.get("fark_pct", r.get("fark", 0))),
                "onceki_akd": _to_float(r.get("onceki_akd", r.get("onceki_giris", r.get("prev", 0)))),
                "isaretci": str(r.get("isaretci", r.get("flag", ""))),
            })
    else:
        for c in capraz_arr:
            kur = str(c.get("kurum", ""))
            if not kur:
                continue
            sg = c.get("son_giris", c.get("son_2g", c.get("recent_entry")))
            og = c.get("onceki_giris", c.get("prev_entry"))
            if sg is not None:
                son_girisler.append({
                    "kurum": kur,
                    "son_akd": _to_float(sg),
                    "maliyet": _to_float(c.get("son_giris_maliyet", 0)),
                    "fark_pct": _to_float(c.get("son_giris_pct", 0)),
                    "onceki_akd": _to_float(og or 0),
                    "isaretci": "",
                })
        if son_girisler:
            son_girisler.sort(key=lambda x: -abs(x["son_akd"]))

    if not mini_grafik and isinstance(fiyat, (int, float)) and fiyat > 0:
        mini_grafik = [round(float(fiyat), 4)]

    fiyat_degisimleri = {}
    for fk in ("fiyat_degisimleri", "performans", "donemsel_getiri"):
        if isinstance(data.get(fk), dict):
            fd = data[fk]
            fiyat_degisimleri = {
                "d7":  _to_float(fd.get("7gun",  fd.get("7_gun",  fd.get("haftalik", fd.get("week",  fd.get("d7", 0)))))),
                "d30": _to_float(fd.get("30gun", fd.get("30_gun", fd.get("aylik",    fd.get("month", fd.get("d30", 0)))))),
                "d90": _to_float(fd.get("90gun", fd.get("90_gun", fd.get("uc_aylik", fd.get("d90", 0))))),
            }
            break
    derived = _period_changes_from_mini(mini_grafik)
    if not fiyat_degisimleri:
        fiyat_degisimleri = derived
    else:
        for pk in ("d7", "d30", "d90"):
            v = fiyat_degisimleri.get(pk)
            if (v is None or not isinstance(v, (int, float)) or float(v) == 0.0) and derived.get(pk) is not None:
                fiyat_degisimleri[pk] = derived[pk]

    if isinstance(data.get("takas_ozet"), dict):
        oz = data["takas_ozet"]
        takas_ozet = {
            "fiili_dolasim": _to_float(oz.get("fiili_dolasim", oz.get("fiili", 0))),
            "toplam_hacim":  _to_float(oz.get("toplam_hacim",  oz.get("hacim", 0))),
            "net_fark_lot":  _to_float(oz.get("net_fark_lot",  oz.get("net_lot", 0))),
            "net_fark_tl":   _to_float(oz.get("net_fark_tl",   oz.get("net_tl", 0))),
        }
    else:
        all_farks = sum(_to_float(r.get("fark_lot", 0)) for r in takas_arr)
        takas_ozet = {"fiili_dolasim": 0, "toplam_hacim": 0, "net_fark_lot": all_farks, "net_fark_tl": 0}

    return {
        "sembol": sym,
        "oran": skor,
        "skor": skor,
        "top_kurum": top_kurum,
        "top_oran": top_oran,
        "top3_oran": top3_oran,
        "top5_oran": top5_oran,
        "top_adet": int(round(total_buy_w)),
        "top3_adet": int(round(top3_buy_w)),
        "top5_adet": int(round(top5_buy_w)),
        "toplam_alis_adet": int(round(total_buy_w)),
        "alicilar_pasta": alicilar_pasta,
        "saticilar_pasta": saticilar_pasta,
        "akd_al_pasta": akd_al_pasta,
        "akd_sat_pasta": akd_sat_pasta,
        "toplam_top5": toplam_top5,
        "alan_sayi": alan_sayi,
        "satan_sayi": satan_sayi,
        "alici_kurum_sayi": len(akd_alanlar_full),
        "satici_kurum_sayi": len(akd_satanlar_full),
        "virman_sayi": virman_sayi,
        "virman_oran": virman_oran,
        "virman_liste": virman_liste,
        "virman_detay": virman_detay,
        "fiyat": fiyat,
        "degisim": data.get("degisim", 0),
        "periyod_degisim": periyod_degisim,
        "akd_sat_maliyet": akd_sat_maliyet,
        "tl_konsant": round(tl_konsant, 2),
        "smart_money": smart_money,
        "cakal_kurumlar": cakal_kurumlar,
        "akd_alanlar_full": akd_alanlar_full,
        "akd_satanlar_full": akd_satanlar_full,
        "lot_takas_liste": lot_takas_liste,
        "tl_saklama_liste": tl_saklama_liste,
        "akd_takas_karsilastirma": akd_takas_karsilastirma,
        "top10_takas": top10_takas,
        "top10_akd": top10_akd,
        "takas_ozet": takas_ozet,
        "al_rapor": al_rapor,
        "son_girisler": son_girisler,
        "fiyat_degisimleri": fiyat_degisimleri,
        "mini_grafik": mini_grafik,
    }


_AKD_BULK_MEM_CACHE = {}  # sym -> (ts, result_dict)
_AKD_BULK_TTL = 60  # seconds

@app.route("/api/v1/akd_bulk", methods=["POST"])
def akd_bulk():
    try:
        payload = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        payload = {}
    semboller = payload.get("semboller") or []
    if not isinstance(semboller, list) or not semboller:
        return _json_response({"ok": False, "sonuclar": []})

    # Serve from in-memory cache when fresh
    now_ts = time.time()
    cached_results = []
    missing = []
    for s in semboller:
        c = _clean_symbol(s)
        if not c:
            continue
        entry = _AKD_BULK_MEM_CACHE.get(c)
        if entry and (now_ts - entry[0]) < _AKD_BULK_TTL:
            cached_results.append(entry[1])
        else:
            missing.append(c)
    if not missing:
        return _json_response({"ok": True, "sonuclar": cached_results, "cached": True})

    semboller = missing  # only fetch the misses
    headers = _bulk_base_headers()

    today = datetime.now()
    son = today.strftime("%Y-%m-%d")
    ilk = (today - timedelta(days=92)).strftime("%Y-%m-%d")

    clean_semboller = []
    for s in semboller:
        c = _clean_symbol(s)
        if c:
            clean_semboller.append(c)

    realtakas_urls = {
        sym: f"{BASE_URL}/api/v1/realtakas?sembol={quote(sym)}&ilk={ilk}&son={son}"
        for sym in clean_semboller
    }

    raw_results = _parallel_get(realtakas_urls, headers, timeout=45, max_workers=8)

    def has_usable(raw):
        try:
            d = json.loads(raw) if raw else None
        except Exception:
            return False
        if not isinstance(d, dict):
            return False
        takas = d.get("takas") if isinstance(d.get("takas"), list) else []
        akd_alanlar = []
        if isinstance(d.get("akd"), dict) and isinstance(d["akd"].get("alanlar"), list):
            akd_alanlar = d["akd"]["alanlar"]
        return bool(takas) or bool(akd_alanlar)

    # Retry symbols without usable data (up to 2 retries)
    for sym in clean_semboller:
        if has_usable(raw_results.get(sym)):
            continue
        for attempt in range(2):
            if attempt > 0:
                time.sleep(0.3)
            retry = _http_get(realtakas_urls[sym], headers, timeout=45)
            if has_usable(retry):
                raw_results[sym] = retry
                break

    ohlcv_urls = {
        sym: f"{BASE_URL}/api/v1/ohlcv?sembol={quote(sym)}&resolution=D&countback=90"
        for sym in clean_semboller
    }
    ohlcv_raw = _parallel_get(ohlcv_urls, headers, timeout=15, max_workers=8)

    ohlcv_by_symbol = {}
    for sym, raw in ohlcv_raw.items():
        try:
            ohlcv = json.loads(raw) if raw else None
        except Exception:
            ohlcv = None
        closes = ((ohlcv or {}).get("ohlcv") or {}).get("c") or []
        out = []
        for c in closes:
            if isinstance(c, (int, float)) and float(c) > 0:
                out.append(round(float(c), 4))
        if out:
            ohlcv_by_symbol[sym] = out

    sonuclar = []
    for sym, raw in raw_results.items():
        try:
            data = json.loads(raw) if raw else None
        except Exception:
            data = None
        if not data:
            continue
        try:
            res = _akd_process_symbol(sym, data, ohlcv_by_symbol.get(sym, []))
            if res:
                sonuclar.append(res)
        except Exception as e:
            app.logger.exception(f"akd_bulk processing error for {sym}: {e}")

    akd_merge_cache_results(sonuclar, [r["sembol"] for r in sonuclar])
    # Write fresh results to in-memory cache
    for r in sonuclar:
        sym_key = r.get("sembol")
        if sym_key:
            _AKD_BULK_MEM_CACHE[sym_key] = (now_ts, r)
    # Merge cached + fresh
    combined = list(cached_results) + list(sonuclar)
    return _json_response({"ok": True, "sonuclar": combined})


# ─────────────────────────── /cdn-cgi/* stub ───────────────────────────

@app.route("/cdn-cgi/<path:_subpath>", methods=["GET", "POST"])
def cdn_cgi_stub(_subpath):
    return Response("", status=200, mimetype="application/javascript")


# ─────────────────────────── Telegram Admin Endpoints ───────────────────────────

@app.route("/admin/telegram", methods=["GET"])
def telegram_admin_page():
    path = os.path.join(BASE_DIR, "static", "telegram_admin.html")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), status=200, mimetype="text/html; charset=utf-8")
    except Exception as e:
        return Response(f"<pre>Sayfa yüklenemedi: {e}</pre>", status=500,
                        mimetype="text/html; charset=utf-8")


@app.route("/api/v1/telegram/status", methods=["GET"])
def telegram_status_route():
    return _json_response(telegram_session.status())


@app.route("/api/v1/telegram/send_code", methods=["POST"])
def telegram_send_code_route():
    try:
        body = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        body = {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return _json_response({"ok": False, "reason": "phone_missing"}, status=400)
    return _json_response(telegram_session.send_code(phone))


@app.route("/api/v1/telegram/verify_code", methods=["POST"])
def telegram_verify_code_route():
    try:
        body = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        body = {}
    code = (body.get("code") or "").strip()
    password = body.get("password") or ""
    return _json_response(telegram_session.verify_code(code, password))


@app.route("/api/v1/telegram/config", methods=["GET", "POST"])
def telegram_config_route():
    if request.method == "GET":
        return _json_response({"ok": True, "config": telegram_session.read_config()})
    try:
        body = json.loads(request.get_data(as_text=True) or "null") or {}
    except Exception:
        body = {}
    cfg = telegram_session.read_config()
    for key in ("bot_username", "app_short_name", "start_param", "platform"):
        if key in body:
            cfg[key] = (body.get(key) or "").strip()
    if cfg.get("bot_username"):
        cfg["bot_username"] = cfg["bot_username"].lstrip("@")
    telegram_session.write_config(cfg)
    return _json_response({"ok": True, "config": cfg})


@app.route("/api/v1/telegram/refresh", methods=["POST"])
def telegram_refresh_route():
    return _json_response(telegram_session.refresh_init_data())


@app.route("/api/v1/telegram/logout", methods=["POST"])
def telegram_logout_route():
    return _json_response(telegram_session.logout())


# ─────────────────────────── TMA Root + Catch-all Proxy ───────────────────────────

SCRIPT_TAG_RE = re.compile(
    r'(<script\s+src=["\']https://telegram\.org/js/telegram-web-app\.js["\'][^>]*></script>)',
    re.IGNORECASE,
)


def _serve_tma_root():
    headers = build_headers({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Priority": "u=0, i",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Storage-Access": "active",
    })
    result = proxy_request(BASE_URL + "/tma", "GET", headers)
    if result["error"]:
        body = f"<pre>cURL Hatası: {result['error']}</pre>"
        return Response(body, status=500, mimetype="text/html; charset=utf-8")

    raw = result["respBody"]
    try:
        html = raw.decode("utf-8", errors="replace")
    except Exception:
        html = ""

    inject_block = INJECT_SCRIPT
    html = SCRIPT_TAG_RE.sub(lambda m: inject_block + "\n" + m.group(1), html, count=1)

    return Response(html, status=200, mimetype="text/html; charset=utf-8")


def _serve_proxy_passthrough(path):
    forward_headers = build_headers({
        "Accept": "application/json, text/plain, */*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Origin": f"https://{BASE_HOST}",
        "Referer": f"https://{BASE_HOST}/tma",
    })
    auth = request.headers.get("Authorization")
    if auth:
        forward_headers["Authorization"] = auth

    client_init = request.headers.get("X-Client-Init-Data", "")
    use_init = get_real_init_data()
    if client_init:
        cp = _parse_qs_flat(client_init)
        ch = cp.get("hash", "")
        ca = int(cp.get("auth_date", 0) or 0)
        if ch and not ch.startswith("aabb") and (time.time() - ca) < 86400:
            use_init = client_init
    forward_headers["X-Telegram-Init-Data"] = use_init

    content_type = request.headers.get("Content-Type")
    if content_type:
        forward_headers["Content-Type"] = content_type

    body = b""
    if request.method in ("POST", "PUT", "PATCH"):
        body = request.get_data() or b""

    qs = request.query_string.decode("utf-8") if request.query_string else ""
    target = BASE_URL + path + (("?" + qs) if qs else "")

    result = proxy_request(target, request.method, forward_headers, body)

    if result["error"]:
        return _json_response({"error": result["error"]}, status=502)

    path_base = path.split("?", 1)[0]

    if result["httpCode"] == 401:
        try:
            telegram_session.trigger_refresh_async(reason=f"401 on {path_base}")
        except Exception:
            pass
        mock = None
        for pattern, mdata in MOCK_RESPONSES.items():
            if path_base.startswith(pattern):
                mock = mdata
                break
        return _json_response(mock if mock is not None else {"ok": True})

    # Mock fallback for known endpoints when upstream returns non-2xx
    if not (200 <= result["httpCode"] < 300):
        for pattern, mdata in MOCK_RESPONSES.items():
            if path_base.startswith(pattern):
                return _json_response(mdata)

    # Premium overrides
    if path_base.startswith("/api/v1/kullanici"):
        try:
            data = json.loads(result["respBody"].decode("utf-8", errors="replace"))
        except Exception:
            data = None
        if not isinstance(data, dict):
            data = {}
        # Fill missing common fields from mock template
        mock_user = MOCK_RESPONSES.get("/api/v1/kullanici", {})
        for k, v in mock_user.items():
            if k not in data or data.get(k) in (None, "", []):
                data[k] = v
        data["premium"] = True
        data["is_premium"] = True
        data["bitis"] = "2099-12-31"
        data["abonelik"] = {
            "plan": "premium",
            "baslangic": "2024-01-01",
            "bitis": "2099-12-31",
            "aktif": True,
        }
        return _json_response(data)

    # Enrich piyasa_ozeti with hacim_liderleri alias for the frontend
    if path_base.startswith("/api/v1/piyasa_ozeti"):
        try:
            data = json.loads(result["respBody"].decode("utf-8", errors="replace"))
        except Exception:
            data = None
        if isinstance(data, dict):
            src = data.get("hacim_liderleri") or data.get("en_hacimli") or data.get("hacim") or []
            normalized = []
            for it in src:
                if not isinstance(it, dict):
                    continue
                normalized.append({
                    "sembol": it.get("sembol") or it.get("symbol") or it.get("code"),
                    "fiyat":  it.get("fiyat")  or it.get("last")   or it.get("price"),
                    "degisim": it.get("degisim") if "degisim" in it else it.get("change"),
                    "hacim":  it.get("hacim")  if "hacim" in it else (it.get("hacim_tl") or it.get("volume_tl") or it.get("volume")),
                })
            if normalized:
                data["hacim_liderleri"] = normalized
            return _json_response(data)

    if path_base.startswith("/api/v1/alarm_kur"):
        try:
            data = json.loads(result["respBody"].decode("utf-8", errors="replace"))
        except Exception:
            data = None
        if isinstance(data, dict):
            msg = str(data.get("message") or data.get("msg") or data.get("hata") or "").lower()
            if "premium" in msg or "limit" in msg:
                return _json_response({"ok": True})

    if path_base.startswith("/api/v1/alarm_liste"):
        try:
            data = json.loads(result["respBody"].decode("utf-8", errors="replace"))
        except Exception:
            data = None
        if isinstance(data, dict):
            data["is_premium"] = True
            if not data.get("limitler"):
                data["limitler"] = dict(ALARM_LIMITLER)
            return _json_response(data)

    # Default passthrough
    skip_headers = {
        "transfer-encoding", "content-encoding", "content-length",
        "connection", "keep-alive", "set-cookie",
    }
    out_headers = {}
    for k, v in result["respHeaders"].items():
        if k.lower() in skip_headers:
            continue
        out_headers[k] = v

    return Response(result["respBody"], status=result["httpCode"], headers=out_headers)


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def catch_all(path):
    full_path = "/" + path

    # Static file passthrough (mirror cli-server behaviour for files in project root)
    if path:
        local_file = os.path.join(BASE_DIR, path)
        if os.path.isfile(local_file) and not local_file.endswith(".php") and not local_file.endswith(".py"):
            try:
                with open(local_file, "rb") as f:
                    content = f.read()
                ext = os.path.splitext(local_file)[1].lower()
                mime_map = {
                    ".js": "application/javascript",
                    ".css": "text/css",
                    ".html": "text/html",
                    ".json": "application/json",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".svg": "image/svg+xml",
                    ".ico": "image/x-icon",
                    ".txt": "text/plain",
                }
                mime = mime_map.get(ext, "application/octet-stream")
                return Response(content, status=200, mimetype=mime)
            except Exception:
                pass

    if full_path == "/" or full_path == "/index.html":
        try:
            with open(os.path.join(BASE_DIR, "static", "web", "index.html"), "rb") as f:
                return Response(f.read(), status=200, mimetype="text/html; charset=utf-8")
        except Exception:
            return _serve_tma_root()

    if full_path in ("/legacy", "/tma_legacy", "/index.php"):
        return _serve_tma_root()

    return _serve_proxy_passthrough(full_path)


if __name__ == "__main__":
    try:
        telegram_session.start_auto_refresh()
    except Exception:
        pass
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
