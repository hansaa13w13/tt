"""
Telegram MTProto session manager for automatic init_data refresh.

Logs in with the user's personal Telegram account (via Telethon),
opens the Hisse Plus Mini App, and extracts a fresh tgWebAppData
(init_data) string that can be saved to data/real_init_data.txt.
"""
import asyncio
import json
import os
import threading
import time
from typing import Optional, Tuple
from urllib.parse import urlparse, parse_qs, unquote

from telethon import TelegramClient, functions
from telethon.sessions import StringSession
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PhoneNumberInvalidError,
    FloodWaitError,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
SESSION_FILE = os.path.join(DATA_DIR, "telegram_session.txt")
CONFIG_FILE = os.path.join(DATA_DIR, "telegram_config.json")
PENDING_FILE = os.path.join(DATA_DIR, "telegram_pending.json")
INIT_DATA_FILE = os.path.join(DATA_DIR, "real_init_data.txt")

os.makedirs(DATA_DIR, exist_ok=True)

_LOCK = threading.Lock()


# Public Telegram Desktop API credentials. These are openly published and used
# by countless open-source clients/tutorials. The user does NOT need to obtain
# their own from my.telegram.org — login still works the same way (phone + SMS).
DEFAULT_API_ID = 2040
DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627"


def _api_credentials() -> Tuple[Optional[int], Optional[str]]:
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    try:
        api_id_int = int(api_id) if api_id else DEFAULT_API_ID
    except ValueError:
        api_id_int = DEFAULT_API_ID
    return api_id_int, (api_hash or DEFAULT_API_HASH)


def _read_session() -> str:
    if not os.path.isfile(SESSION_FILE):
        return ""
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def _write_session(session_str: str) -> None:
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        f.write(session_str or "")


def _delete_session() -> None:
    for path in (SESSION_FILE, PENDING_FILE):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except Exception:
            pass


def read_config() -> dict:
    if not os.path.isfile(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def write_config(cfg: dict) -> None:
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _read_pending() -> dict:
    if not os.path.isfile(PENDING_FILE):
        return {}
    try:
        with open(PENDING_FILE, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _write_pending(d: dict) -> None:
    with open(PENDING_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def _clear_pending() -> None:
    try:
        if os.path.isfile(PENDING_FILE):
            os.remove(PENDING_FILE)
    except Exception:
        pass


def _run(coro):
    """Run an async coroutine in a fresh event loop (thread-safe)."""
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()


def status() -> dict:
    api_id, api_hash = _api_credentials()
    cfg = read_config()
    has_session = bool(_read_session())
    pending = _read_pending()
    init_age_hours = None
    init_expired = True
    if os.path.isfile(INIT_DATA_FILE):
        try:
            with open(INIT_DATA_FILE, "r", encoding="utf-8") as f:
                raw = f.read().strip()
            params = parse_qs(raw, keep_blank_values=True)
            auth_date = int((params.get("auth_date", ["0"]) or ["0"])[0] or 0)
            if auth_date:
                age = int(time.time()) - auth_date
                init_age_hours = round(age / 3600, 1)
                init_expired = age >= 86400
        except Exception:
            pass
    return {
        "api_credentials_set": True,
        "logged_in": has_session,
        "pending_login": bool(pending.get("phone")),
        "pending_phone": pending.get("phone"),
        "needs_password": bool(pending.get("needs_password")),
        "bot_username": cfg.get("bot_username") or "",
        "app_short_name": cfg.get("app_short_name") or "",
        "start_param": cfg.get("start_param") or "",
        "last_refresh_ts": cfg.get("last_refresh_ts") or 0,
        "last_refresh_error": cfg.get("last_refresh_error") or "",
        "init_age_hours": init_age_hours,
        "init_expired": init_expired,
    }


# ─────────────────────────── Telethon coroutines ───────────────────────────

async def _send_code_async(phone: str) -> dict:
    api_id, api_hash = _api_credentials()
    if not api_id or not api_hash:
        return {"ok": False, "reason": "api_credentials_missing"}

    client = TelegramClient(StringSession(), api_id, api_hash, device_model="Hisse Plus Proxy",
                            system_version="1.0", app_version="1.0")
    await client.connect()
    try:
        sent = await client.send_code_request(phone)
        session_str = client.session.save()
        _write_pending({
            "phone": phone,
            "phone_code_hash": sent.phone_code_hash,
            "session": session_str,
            "needs_password": False,
            "ts": int(time.time()),
        })
        return {"ok": True, "type": getattr(sent.type, "__class__", type(sent.type)).__name__}
    except FloodWaitError as e:
        return {"ok": False, "reason": "flood_wait", "seconds": e.seconds}
    except PhoneNumberInvalidError:
        return {"ok": False, "reason": "phone_invalid"}
    except Exception as e:
        return {"ok": False, "reason": "send_code_failed", "detail": str(e)}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def _verify_code_async(code: str, password: Optional[str]) -> dict:
    api_id, api_hash = _api_credentials()
    if not api_id or not api_hash:
        return {"ok": False, "reason": "api_credentials_missing"}

    pending = _read_pending()
    if not pending.get("phone") or not pending.get("session"):
        return {"ok": False, "reason": "no_pending_login"}

    client = TelegramClient(StringSession(pending["session"]), api_id, api_hash,
                            device_model="Hisse Plus Proxy", system_version="1.0", app_version="1.0")
    await client.connect()
    try:
        try:
            if code:
                await client.sign_in(phone=pending["phone"], code=code,
                                     phone_code_hash=pending.get("phone_code_hash"))
            elif password:
                await client.sign_in(password=password)
            else:
                return {"ok": False, "reason": "missing_input"}
        except SessionPasswordNeededError:
            if not password:
                pending["needs_password"] = True
                _write_pending(pending)
                return {"ok": False, "reason": "password_required"}
            await client.sign_in(password=password)
        except PhoneCodeInvalidError:
            return {"ok": False, "reason": "code_invalid"}
        except PhoneCodeExpiredError:
            return {"ok": False, "reason": "code_expired"}

        session_str = client.session.save()
        _write_session(session_str)
        _clear_pending()
        me = await client.get_me()
        return {
            "ok": True,
            "user": {
                "id": getattr(me, "id", None),
                "username": getattr(me, "username", None),
                "first_name": getattr(me, "first_name", None),
            },
        }
    except Exception as e:
        return {"ok": False, "reason": "verify_failed", "detail": str(e)}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def _extract_init_data_from_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    fragment = parsed.fragment or ""
    if not fragment and "#" in url:
        fragment = url.split("#", 1)[1]
    if not fragment:
        return ""
    parts = fragment.split("&")
    for part in parts:
        if part.startswith("tgWebAppData="):
            return unquote(part[len("tgWebAppData="):])
    return ""


async def _refresh_init_data_async() -> dict:
    api_id, api_hash = _api_credentials()
    if not api_id or not api_hash:
        return {"ok": False, "reason": "api_credentials_missing"}

    session_str = _read_session()
    if not session_str:
        return {"ok": False, "reason": "not_logged_in"}

    cfg = read_config()
    bot_username = (cfg.get("bot_username") or "").strip().lstrip("@")
    if not bot_username:
        return {"ok": False, "reason": "bot_username_missing"}
    app_short_name = (cfg.get("app_short_name") or "").strip()
    start_param = (cfg.get("start_param") or "").strip()
    platform = (cfg.get("platform") or "android").strip() or "android"

    client = TelegramClient(StringSession(session_str), api_id, api_hash,
                            device_model="Hisse Plus Proxy", system_version="1.0", app_version="1.0")
    await client.connect()
    try:
        if not await client.is_user_authorized():
            return {"ok": False, "reason": "session_expired"}

        bot = await client.get_entity(bot_username)

        url = ""
        last_err = None

        if app_short_name:
            try:
                from telethon.tl.types import InputBotAppShortName
                app_obj = await client(functions.messages.GetBotAppRequest(
                    app=InputBotAppShortName(bot_id=bot, short_name=app_short_name),
                    hash=0,
                ))
                result = await client(functions.messages.RequestAppWebViewRequest(
                    peer=bot,
                    app=app_obj.app,
                    write_allowed=True,
                    platform=platform,
                    start_param=start_param or None,
                ))
                url = getattr(result, "url", "")
            except Exception as e:
                last_err = f"app_webview: {e}"

        if not url:
            try:
                kwargs = dict(peer=bot, bot=bot, platform=platform)
                if start_param:
                    kwargs["start_param"] = start_param
                result = await client(functions.messages.RequestMainWebViewRequest(**kwargs))
                url = getattr(result, "url", "")
            except Exception as e:
                last_err = f"main_webview: {e}"

        if not url:
            try:
                result = await client(functions.messages.RequestWebViewRequest(
                    peer=bot,
                    bot=bot,
                    platform=platform,
                    from_bot_menu=False,
                    url=None,
                    start_param=start_param or None,
                ))
                url = getattr(result, "url", "")
            except Exception as e:
                last_err = f"menu_webview: {e}"

        if not url:
            cfg["last_refresh_error"] = last_err or "no_webview_method_worked"
            write_config(cfg)
            return {"ok": False, "reason": "webview_request_failed", "detail": last_err}

        init_data = _extract_init_data_from_url(url)
        if not init_data:
            cfg["last_refresh_error"] = "url_has_no_init_data"
            write_config(cfg)
            return {"ok": False, "reason": "no_init_data_in_url", "url": url}

        params = parse_qs(init_data, keep_blank_values=True)
        hsh = (params.get("hash", [""]) or [""])[0]
        auth_date = int((params.get("auth_date", ["0"]) or ["0"])[0] or 0)
        if not hsh or auth_date <= 0:
            cfg["last_refresh_error"] = "invalid_init_data"
            write_config(cfg)
            return {"ok": False, "reason": "invalid_init_data"}

        with open(INIT_DATA_FILE, "w", encoding="utf-8") as f:
            f.write(init_data)

        cfg["last_refresh_ts"] = int(time.time())
        cfg["last_refresh_error"] = ""
        write_config(cfg)
        return {"ok": True, "auth_date": auth_date}
    except Exception as e:
        cfg["last_refresh_error"] = str(e)
        write_config(cfg)
        return {"ok": False, "reason": "refresh_failed", "detail": str(e)}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def _logout_async() -> dict:
    api_id, api_hash = _api_credentials()
    session_str = _read_session()
    if session_str and api_id and api_hash:
        client = TelegramClient(StringSession(session_str), api_id, api_hash)
        try:
            await client.connect()
            await client.log_out()
        except Exception:
            pass
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass
    _delete_session()
    return {"ok": True}


# ─────────────────────────── Public sync wrappers ───────────────────────────

def send_code(phone: str) -> dict:
    with _LOCK:
        return _run(_send_code_async(phone))


def verify_code(code: str, password: Optional[str] = None) -> dict:
    with _LOCK:
        return _run(_verify_code_async(code, password))


def refresh_init_data() -> dict:
    with _LOCK:
        return _run(_refresh_init_data_async())


def logout() -> dict:
    with _LOCK:
        return _run(_logout_async())


# ─────────────────────────── Background auto-refresh ───────────────────────────

_AUTO_THREAD: Optional[threading.Thread] = None
_AUTO_STOP = threading.Event()


def _init_data_age_seconds() -> Optional[int]:
    if not os.path.isfile(INIT_DATA_FILE):
        return None
    try:
        with open(INIT_DATA_FILE, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        params = parse_qs(raw, keep_blank_values=True)
        auth_date = int((params.get("auth_date", ["0"]) or ["0"])[0] or 0)
        if auth_date <= 0:
            return None
        return int(time.time()) - auth_date
    except Exception:
        return None


def _auto_loop():
    # Refresh threshold: 6 hours old → refresh proactively
    REFRESH_AFTER = 6 * 3600
    CHECK_EVERY = 15 * 60  # 15 minutes
    while not _AUTO_STOP.wait(timeout=30):
        try:
            session_str = _read_session()
            cfg = read_config()
            api_id, api_hash = _api_credentials()
            if not (session_str and cfg.get("bot_username") and api_id and api_hash):
                continue
            age = _init_data_age_seconds()
            if age is None or age >= REFRESH_AFTER:
                refresh_init_data()
        except Exception:
            pass
        _AUTO_STOP.wait(timeout=CHECK_EVERY)


def start_auto_refresh():
    global _AUTO_THREAD
    if _AUTO_THREAD and _AUTO_THREAD.is_alive():
        return
    _AUTO_STOP.clear()
    _AUTO_THREAD = threading.Thread(target=_auto_loop, name="tg-auto-refresh", daemon=True)
    _AUTO_THREAD.start()


_TRIGGER_LOCK = threading.Lock()
_TRIGGER_STATE = {"running": False, "last_ts": 0.0}
_TRIGGER_COOLDOWN = 60


def trigger_refresh_async(reason: str = "") -> bool:
    """Kick off an init_data refresh in a background thread (rate-limited)."""
    with _TRIGGER_LOCK:
        now = time.time()
        if _TRIGGER_STATE["running"]:
            return False
        if (now - _TRIGGER_STATE["last_ts"]) < _TRIGGER_COOLDOWN:
            return False
        if not _read_session():
            return False
        cfg = read_config()
        if not cfg.get("bot_username"):
            return False
        _TRIGGER_STATE["running"] = True
        _TRIGGER_STATE["last_ts"] = now

    def _worker():
        try:
            refresh_init_data()
        except Exception:
            pass
        finally:
            with _TRIGGER_LOCK:
                _TRIGGER_STATE["running"] = False

    threading.Thread(target=_worker, name="tg-trigger-refresh", daemon=True).start()
    return True
