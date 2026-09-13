"""Phase 0: verifikasi session/proxy IG.

  python ig/ig_check.py            -> tampilkan akun pemilik session (siapa yang login)
  python ig/ig_check.py <username> -> baca profil target
"""
import json
import sys

from ig_common import get_client, user_to_dict


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else ""
    client = get_client()

    if target in ("", "me", "--me"):
        try:
            me = client.account_info()
            print(json.dumps({"username": me.username, "full_name": me.full_name, "pk": me.pk}, indent=2))
        except Exception as err:  # noqa: BLE001
            print(
                json.dumps(
                    {
                        "info": "session valid untuk baca profil; account_info butuh login penuh",
                        "error": str(err).splitlines()[0],
                        "saran": "uji dengan: python ig/ig_check.py <username>",
                    },
                    indent=2,
                )
            )
        return

    info = client.user_info_by_username(target)
    print(json.dumps(user_to_dict(info), indent=2))


if __name__ == "__main__":
    main()
