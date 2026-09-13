"""Phase 0: verifikasi apakah instagrapi bisa baca profil tanpa 429."""
import json
import sys

from ig_common import get_client, user_to_dict


def main() -> None:
    username = sys.argv[1] if len(sys.argv) > 1 else "ssbsetiabandung"
    client = get_client()
    info = client.user_info_by_username(username)
    print(json.dumps(user_to_dict(info), indent=2))


if __name__ == "__main__":
    main()
