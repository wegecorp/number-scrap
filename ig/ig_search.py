"""Cari akun Instagram lewat search bawaan IG (instagrapi). Tanpa mesin pencari luar.

Input : JSON array frasa pencarian di stdin -> ["ssb jakarta selatan", "sepak bola jakarta"]
Output: JSON array username unik di stdout.
"""
import json
import sys

from ig_common import get_client


def main() -> None:
    raw = sys.stdin.read().strip()
    queries = json.loads(raw) if raw else []
    queries = [str(q).strip() for q in queries if str(q).strip()]
    if not queries:
        print("[]")
        return

    client = get_client()
    seen: list[str] = []
    seen_set: set[str] = set()

    for query in queries:
        try:
            users = client.search_users(query)
        except Exception as err:  # noqa: BLE001
            print(f"[ig] search '{query}' gagal: {str(err).splitlines()[0]}", file=sys.stderr)
            continue

        added = 0
        for user in users:
            name = getattr(user, "username", None)
            if name and name not in seen_set:
                seen_set.add(name)
                seen.append(name)
                added += 1
        print(f"[ig] search '{query}' -> {len(users)} hasil, +{added} baru", file=sys.stderr)

    print(json.dumps(seen))


if __name__ == "__main__":
    main()
