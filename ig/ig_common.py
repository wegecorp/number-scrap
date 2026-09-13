"""Utilitas bersama untuk sidecar Instagram (instagrapi)."""
import os
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
SESSION_PATH = Path(__file__).resolve().parent / "session.json"


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def get_client():
    load_env()
    from instagrapi import Client

    client = Client()
    client.delay_range = [2, 5]

    proxy = os.environ.get("IG_PROXY_URL", "").strip()
    if proxy:
        client.set_proxy(proxy)
        print("[ig] proxy aktif", file=sys.stderr)

    sid = unquote(os.environ.get("IG_SESSIONID", "").strip())

    if sid:
        # Selalu login fresh dari sessionid -> hindari session.json basi yang bikin login_required.
        try:
            client.login_by_sessionid(sid)
            client.dump_settings(str(SESSION_PATH))
            print("[ig] login via sessionid OK", file=sys.stderr)
            return client
        except Exception as err:  # noqa: BLE001
            hint = (
                "[ig] Gagal login dengan IG_SESSIONID.\n"
                "[ig] Kemungkinan cookie sudah kedaluwarsa / akun kena challenge / IP berubah.\n"
                "[ig] Ambil ulang cookie 'sessionid' dari browser (DevTools > Application > Cookies),\n"
                "[ig] update .env, lalu coba lagi. Kalau tetap gagal: pakai proxy atau akun burner lain."
            )
            raise SystemExit(f"[ig] {type(err).__name__}: {str(err).splitlines()[0]}\n{hint}") from err

    if SESSION_PATH.exists():
        try:
            client.load_settings(str(SESSION_PATH))
            print("[ig] pakai session.json tersimpan", file=sys.stderr)
            return client
        except Exception as err:  # noqa: BLE001
            raise SystemExit(f"[ig] session.json rusak: {err}") from err

    raise SystemExit("[ig] IG_SESSIONID kosong dan session.json tidak ada")


def user_to_dict(info) -> dict:
    def g(name, default=None):
        return getattr(info, name, default)

    url = g("external_url")
    bio_links = []
    for link in g("bio_links") or []:
        link_url = getattr(link, "url", None)
        if link_url:
            bio_links.append(str(link_url))

    return {
        "username": g("username"),
        "full_name": g("full_name"),
        "biography": g("biography"),
        "external_url": str(url) if url else None,
        "bio_links": bio_links,
        "public_phone_number": g("public_phone_number"),
        "contact_phone_number": g("contact_phone_number"),
        "public_phone_country_code": g("public_phone_country_code"),
        "public_email": g("public_email"),
        "business_contact_method": g("business_contact_method"),
        "follower_count": g("follower_count"),
        "media_count": g("media_count"),
        "is_business": g("is_business"),
        "is_private": bool(g("is_private", False)),
        "category_name": g("category_name") or g("business_category_name"),
    }
