"""Batch fetch profil Instagram (instagrapi).

Input : JSON array username di stdin  ->  ["ssbgaruda", "futsal_elang"]
Output: JSONL di stdout, satu objek per akun (lihat user_to_dict).
"""
import json
import sys

from ig_common import get_client, user_to_dict


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print("[ig] tidak ada input di stdin", file=sys.stderr)
        return

    try:
        usernames = json.loads(raw)
    except json.JSONDecodeError:
        usernames = [line.strip() for line in raw.splitlines() if line.strip()]

    usernames = [str(u).lstrip("@").strip() for u in usernames if str(u).strip()]
    if not usernames:
        print("[ig] daftar username kosong", file=sys.stderr)
        return

    client = get_client()
    ok = 0
    for index, username in enumerate(usernames, 1):
        fatal = False
        try:
            info = client.user_info_by_username(username)
            record = user_to_dict(info)
            ok += 1
        except Exception as err:  # noqa: BLE001
            msg = str(err)
            record = {"username": username, "error": msg}
            lowered = msg.lower()
            fatal = "challenge" in lowered or "login required" in lowered or "rate" in lowered
            print(f"[ig] {username}: {msg.splitlines()[0]}", file=sys.stderr)

        print(json.dumps(record), flush=True)
        print(f"[ig] {index}/{len(usernames)} {username}", file=sys.stderr)

        if fatal:
            print("[ig] error fatal, hentikan batch", file=sys.stderr)
            break

    print(f"[ig] selesai, {ok} profil berhasil", file=sys.stderr)


if __name__ == "__main__":
    main()
