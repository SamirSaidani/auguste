#!/usr/bin/env python3
"""Prepare a Gitea server to receive Rhythm Trainer runs from a phone.

Creates, if missing:
  1. a private data repository owned by the admin token's user;
  2. a bot account with no other rights, added to that repository with write access;
  3. a token for the bot, limited to the "write:repository" scope.
With Gitea tokens covering every repository of their owner, the bot is what keeps
the phone's token away from the owner's other repositories.

Writes a setup link (app URL + #sync=...) to a private file, and a QR code image
of it when `qrencode` is installed. Scan it with the phone: the app stores the
sync settings and removes them from the address bar. Secrets are never printed.

The admin token is read from the GITEA_TOKEN environment variable, or from --admin-token-file.

Usage:
  GITEA_TOKEN=... setup-gitea-sync.py --server https://git.example.org \
      --app https://user.github.io/rhythm-trainer/ [--repo rhythm-trainer-data] [--bot rhythm-bot]
      [--out-dir DIR]
"""
import argparse
import base64
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


class Api:
    def __init__(self, server, token=None, basic=None):
        self.base = server.rstrip("/") + "/api/v1"
        self.headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if token:
            self.headers["Authorization"] = "token " + token
        if basic:
            raw = (basic[0] + ":" + basic[1]).encode()
            self.headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()

    def call(self, method, path, body=None, ok=(200, 201, 204)):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req) as res:
                text = res.read().decode() or "null"
                return res.status, json.loads(text)
        except urllib.error.HTTPError as err:
            if err.code in ok:
                return err.code, None
            detail = err.read().decode()[:300]
            return err.code, {"error": detail}


def write_private(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--server", required=True)
    ap.add_argument("--admin-token-file", type=Path)
    ap.add_argument("--app", required=True, help="URL of the published app")
    ap.add_argument("--repo", default="rhythm-trainer-data")
    ap.add_argument("--bot", default="rhythm-bot")
    ap.add_argument("--out-dir", type=Path, default=Path.home() / ".config" / "rhythm-trainer")
    args = ap.parse_args()

    token = os.environ.get("GITEA_TOKEN") or (args.admin_token_file.read_text().strip() if args.admin_token_file else "")
    if not token:
        sys.exit("Set GITEA_TOKEN or pass --admin-token-file.")
    admin = Api(args.server, token=token)
    status, me = admin.call("GET", "/user")
    if status != 200:
        sys.exit("Admin token rejected (HTTP %s)." % status)
    owner = me["login"]
    print("Signed in as", owner, "(admin)" if me.get("is_admin") else "(not admin)")

    # 1. Private data repository.
    status, _ = admin.call("GET", "/repos/%s/%s" % (owner, args.repo))
    if status == 200:
        print("Repository exists:", owner + "/" + args.repo)
    else:
        status, res = admin.call("POST", "/user/repos", {
            "name": args.repo, "private": True, "auto_init": True, "default_branch": "main",
            "description": "Rhythm Trainer runs, written by the app after each run.",
        })
        if status != 201:
            sys.exit("Could not create the repository: %s %s" % (status, res))
        print("Repository created:", owner + "/" + args.repo, "(private)")

    # 2. Bot account, write access to the data repository only.
    password = secrets.token_urlsafe(24)
    status, _ = admin.call("GET", "/users/" + args.bot)
    if status == 200:
        print("Bot account exists:", args.bot, "- resetting its password to create a token")
        status, res = admin.call("PATCH", "/admin/users/" + args.bot, {
            "login_name": args.bot, "source_id": 0, "password": password, "must_change_password": False,
        })
    else:
        status, res = admin.call("POST", "/admin/users", {
            "username": args.bot, "login_name": args.bot, "password": password,
            "email": args.bot + "@noreply.invalid", "must_change_password": False,
            "send_notify": False, "visibility": "private",
        })
        if status == 201:
            print("Bot account created:", args.bot)
    if status not in (200, 201):
        sys.exit("Could not prepare the bot account: %s %s" % (status, res))
    status, res = admin.call("PUT", "/repos/%s/%s/collaborators/%s" % (owner, args.repo, args.bot), {"permission": "write"})
    if status not in (200, 204):
        sys.exit("Could not add the bot to the repository: %s %s" % (status, res))
    print("Bot has write access to", owner + "/" + args.repo, "only")

    # 3. Bot token, repository scope only. Created with the bot's own credentials.
    bot = Api(args.server, basic=(args.bot, password))
    name = "rhythm-trainer-phone-" + secrets.token_hex(3)
    status, res = bot.call("POST", "/users/%s/tokens" % args.bot, {"name": name, "scopes": ["write:repository"]})
    if status != 201 or not res or not res.get("sha1"):
        sys.exit("Could not create the bot token: %s %s" % (status, res))
    print("Bot token created:", name, "(scope write:repository)")

    # Setup link for the phone, kept in private files.
    sync = {"kind": "gitea", "api": args.server.rstrip("/") + "/api/v1", "repo": owner + "/" + args.repo, "token": res["sha1"]}
    payload = base64.urlsafe_b64encode(json.dumps(sync).encode()).decode().rstrip("=")
    link = args.app.split("#")[0] + "#sync=" + payload
    link_file = args.out_dir / "phone-setup-link.txt"
    write_private(link_file, link + "\n")
    print("Setup link written to", link_file)
    if shutil.which("qrencode"):
        png = args.out_dir / "phone-setup-qr.png"
        subprocess.run(["qrencode", "-o", str(png), "-s", "8", link], check=True)
        os.chmod(png, 0o600)
        print("QR code written to", png, "- open it on screen and scan it with the phone")
    else:
        print("Install qrencode to get a QR code (sudo apt install qrencode), then run this script again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
