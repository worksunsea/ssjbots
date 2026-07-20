#!/usr/bin/env python3
"""
WA session watchdog — runs on the NAS via DSM Task Scheduler every 5 min.

Ported from wa-service/watchdog.ps1 (originally ran on the office PC via
Windows Task Scheduler; wa-service moved to the NAS on 2026-07-20 so this
now runs where the container actually lives). Same logic: poll wa-service's
/clients status, and if any session has been disconnected for 2 consecutive
checks (~10 min), restart the container and push a notification via ssj-hr's
push endpoint plus a WhatsApp alert via WbizTool (doesn't depend on Baileys
being the thing that's broken).
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

STATE_FILE = "/volume1/docker/wa-watchdog-state.json"
HEALTH_URL = "http://localhost:3021/clients"
PUSH_URL = "https://hr.gemtre.in/api/push"
WA_ALERT_URL = "https://ssjbot.gemtre.in/api/connection-alert"
CRM_SECRET = os.environ.get("CRM_SECRET", "")
CONTAINER_NAME = "ssj-wa-service-live"
RESTART_COOLDOWN_MIN = 60


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"fails": {}, "lastRestart": None, "knownMe": {}}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def post_json(url, payload, headers=None):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=15) as r:
        r.read()


def send_alert(title, body):
    try:
        post_json(PUSH_URL, {
            "user_id": "admin",
            "title": title,
            "body": body,
            "url": "https://ssjbot.gemtre.in/?screen=connections",
            "notif_type": "wa_session_down",
        })
    except Exception as e:
        print(f"wa-watchdog: push alert failed - {e}")

    if CRM_SECRET:
        try:
            post_json(WA_ALERT_URL, {"title": title, "message": body},
                      headers={"x-crm-secret": CRM_SECRET})
        except Exception as e:
            print(f"wa-watchdog: WA alert failed - {e}")


def clean_phone(me):
    if not me:
        return None
    return me.split(":")[0]


def main():
    state = load_state()
    state.setdefault("fails", {})
    state.setdefault("knownMe", {})

    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=15) as r:
            health = json.loads(r.read())
    except Exception as e:
        print(f"wa-watchdog: could not reach wa-service at all - {e}")
        send_alert("WA service unreachable",
                    f"wa-service did not respond on {HEALTH_URL} - check Docker on the NAS.")
        return

    down_clients = []
    for c in health.get("clients", []):
        cid = c["client_id"]
        if c.get("connected"):
            state["fails"][cid] = 0
            phone = clean_phone(c.get("me"))
            if phone:
                state["knownMe"][cid] = phone
        else:
            state["fails"][cid] = state["fails"].get(cid, 0) + 1
            if state["fails"][cid] >= 2:
                down_clients.append(cid)

    if down_clients:
        now = time.time()
        can_restart = True
        if state.get("lastRestart"):
            if (now - state["lastRestart"]) / 60 < RESTART_COOLDOWN_MIN:
                can_restart = False

        names = ", ".join(
            f"{cid} ({state['knownMe'][cid]})" if cid in state["knownMe"] else cid
            for cid in down_clients
        )

        if can_restart:
            print(f"wa-watchdog: {names} disconnected 2+ checks in a row - restarting {CONTAINER_NAME}")
            subprocess.run(["docker", "restart", CONTAINER_NAME], capture_output=True)
            state["lastRestart"] = now
            send_alert("WhatsApp session dropped",
                       f"{names} disconnected - auto-restarted the wa-service container. "
                       "If messages still show waiting after a few minutes, it needs a manual re-pair (scan QR again).")
        else:
            print(f"wa-watchdog: {names} still down but restarted within the last {RESTART_COOLDOWN_MIN} min - skipping restart, still alerting")
            send_alert("WhatsApp session still down",
                       f"{names} still disconnected after a recent auto-restart - likely needs a manual re-pair (scan QR again).")

    save_state(state)


if __name__ == "__main__":
    main()
