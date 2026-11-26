"""Exercise the built bridge with two private Herdr workspaces on Linux."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[1]


def eventually(read):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        try:
            value = read()
            if value:
                return value
        except (ConnectionError, URLError):
            pass
        time.sleep(0.1)
    raise AssertionError("Isolated service did not reach its expected state")


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def exercise(root):
    state = root / "collie"
    state.mkdir(mode=0o700)
    sock = root / "mux.sock"
    token = secrets.token_hex(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    (state / "paired-devices.json").write_text(json.dumps({"devices": [{"label": "Fixture", "tokenHash": digest}]}))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    wrapper_dir = root / "fixture wrappers"
    wrapper_dir.mkdir()
    for name in ("codexp", "claudep", "kimi"):
        program = wrapper_dir / name
        program.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$0.args\"\n")
        program.chmod(0o700)
    env = {
        "HOME": str(root), "USER": "fixture", "SHELL": "/bin/sh", "TERM": "xterm-256color",
        "COLLIE_KOPERCA_BOT_PROFILES": "1",
        "PATH": f"{wrapper_dir}:{Path(shutil.which('bun')).parent}:/usr/local/bin:/usr/bin:/bin",
        "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"), "XDG_RUNTIME_DIR": str(root),
        "HERDR_SOCKET_PATH": str(sock), "HERDR_PLUGIN_CONFIG_DIR": str(root / "plugin"),
        "COLLIE_HOST": "127.0.0.1", "COLLIE_PORT": str(port), "COLLIE_INSTANCE": "test-bot-trash",
        "COLLIE_MUX": "herdr", "COLLIE_STATE_DIR": str(state), "COLLIE_PLUGIN_ROOT": str(REPO),
        "COLLIE_MULTI_SESSION": "0", "COLLIE_SKIP_SERVE": "1", "COLLIE_SKILL_SYNC": "off",
        "COLLIE_TELEMETRY": "0", "COLLIE_UPDATE_MIRROR": "http://127.0.0.1:9",
    }

    def start(*argv):
        return subprocess.Popen(argv, cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def rpc(method, **params):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(4)
            client.connect(str(sock))
            client.sendall((json.dumps({"id": "fixture", "method": method, "params": params}) + "\n").encode())
            with client.makefile() as stream:
                reply = json.loads(stream.readline())
            assert "result" in reply, reply.get("error")
            return reply["result"]

    def api(path, data=None, content_type="application/json"):
        req = Request(origin + path, headers={
            "Authorization": "Bearer " + token, "Origin": origin,
            "X-Requested-With": "XMLHttpRequest", "Content-Type": content_type,
        }, data=data)
        with urlopen(req, timeout=4) as reply:
            return json.load(reply)

    def start_bridge():
        return start(str(REPO / "bin/collie"), "_exec-bridge")

    mux = start(shutil.which("herdr"), "server")
    bridge = None
    try:
        eventually(sock.exists)
        source, target = [rpc("workspace.create", label=label, cwd=str(root))["root_pane"]
                          for label in ("Fixture-A", "Fixture-B")]
        terminal = source["terminal_id"]
        bridge = start_bridge()

        def rows():
            snapshot = api("/api/snapshot")
            return snapshot["agents"] + snapshot["shellPanes"]

        def chat():
            return next((p for p in rows() if p.get("terminalId") == terminal), {})

        def act(action, **kwargs):
            payload = json.dumps({"terminalId": terminal, "action": action, **kwargs}).encode()
            assert api("/api/bot-action", payload)["ok"]

        eventually(chat)
        shell_pid = rpc("pane.process_info", pane_id=source["pane_id"])["process_info"]["shell_pid"]
        act("move", workspaceId=target["workspace_id"])
        eventually(lambda: chat().get("workspaceId") == target["workspace_id"])
        moved = chat()["paneId"]
        assert moved != source["pane_id"]
        assert rpc("pane.process_info", pane_id=moved)["process_info"]["shell_pid"] == shell_pid
        boundary = "fixture-bot-trash"
        form = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\n'
                f'Content-Type: text/plain\r\n\r\nfixture\r\n--{boundary}--\r\n').encode()
        upload = Path(api("/api/pane/" + moved + "/upload", form, f"multipart/form-data; boundary={boundary}")["path"])
        assert upload.is_relative_to(state) and upload.is_file()
        act("trash")
        record = eventually(lambda: chat().get("trash"))
        stop(bridge)
        bridge = start_bridge()
        assert eventually(lambda: chat().get("trash")) == record
        assert Path(f"/proc/{shell_pid}").exists()
        act("restore", trashedAt=record["trashedAt"])
        eventually(lambda: chat() and "trash" not in chat())
        child_file = root / "child-pid"
        rpc("pane.send_text", pane_id=moved, text=f"nohup sleep 60 >/dev/null 2>&1 & echo $! > {child_file}")
        rpc("pane.send_keys", pane_id=moved, keys=["Enter"])
        eventually(lambda: child_file.is_file() and child_file.read_text().strip())
        child_proc = Path("/proc") / str(int(child_file.read_text()))
        assert child_proc.exists()
        act("trash")
        record = eventually(lambda: chat().get("trash"))
        act("purge", trashedAt=record["trashedAt"])
        eventually(lambda: not Path(f"/proc/{shell_pid}").exists())
        eventually(lambda: not child_proc.exists())
        assert not upload.exists()
        assert not (state / "bot-trash.json").exists()
        assert [p["terminal_id"] for p in rpc("session.snapshot")["snapshot"]["panes"]] == [target["terminal_id"]]

        # Exercise the actual startup job on an expired record while Herdr keeps running.
        terminal = target["terminal_id"]
        act("trash")
        eventually(lambda: chat().get("trash"))
        stop(bridge)
        ledger = state / "bot-trash.json"
        saved = json.loads(ledger.read_text())
        saved[0]["trashedAt"] -= 7 * 86400 * 1000
        ledger.write_text(json.dumps(saved))
        bridge = start_bridge()
        eventually(lambda: not ledger.exists())
        topology = rpc("session.snapshot")["snapshot"]
        assert all(p["terminal_id"] != terminal for p in topology["panes"])
        assert [w["workspace_id"] for w in topology["workspaces"]] == [target["workspace_id"]]
        # A whole workspace uses the same ledger and sweep, including the final pane.
        group = rpc("workspace.create", label="Grupo de prueba", cwd=str(root))["root_pane"]
        wid = group["workspace_id"]
        rpc("tab.create", workspace_id=wid, cwd=str(root))
        eventually(lambda: len([p for p in rows() if p["workspaceId"] == wid]) == 2)
        members = [p["terminalId"] for p in rows() if p["workspaceId"] == wid]
        untouched = [p["terminalId"] for p in rows() if p["workspaceId"] != wid]

        def post(path, body):
            return api(path, json.dumps(body).encode())

        assert post("/api/space/" + wid + "/rename", {"label": "Taller"})["ok"]
        assert rpc("workspace.get", workspace_id=wid)["workspace"]["label"] == "Taller"
        assert post("/api/space/" + wid + "/move", {"before": target["workspace_id"]})["ok"]
        assert rpc("workspace.list")["workspaces"][0]["workspace_id"] == wid
        saved_order = post("/api/chat-order", {"workspaceId": wid, "paneId": members[1], "before": members[0]})
        assert saved_order["paneIds"] == members[::-1]

        def group_rows():
            return [p for p in rows() if p.get("terminalId") in members]

        assert post("/api/bot-action", {"action": "trashWorkspace", "workspaceId": wid})["ok"]
        eventually(lambda: len([p for p in group_rows() if p.get("trash", {}).get("workspaceLabel") == "Taller"]) == 2)
        stamp = group_rows()[0]["trash"]["trashedAt"]
        stop(bridge)
        bridge = start_bridge()
        eventually(lambda: len(group_rows()) == 2)
        assert all(p["trash"]["trashedAt"] == stamp for p in group_rows())
        assert saved_order in api("/api/chat-order")
        assert post("/api/bot-action", {"action": "restoreWorkspace", "workspaceId": wid, "trashedAt": stamp})["ok"]
        eventually(lambda: all("trash" not in p for p in group_rows()))
        assert not ledger.exists()
        assert post("/api/bot-action", {"action": "trashWorkspace", "workspaceId": wid})["ok"]
        stop(bridge)
        saved = json.loads(ledger.read_text())
        assert {row["terminalId"] for row in saved} == set(members)
        for entry in saved:
            entry["trashedAt"] -= 7 * 86400 * 1000
        ledger.write_text(json.dumps(saved))
        bridge = start_bridge()
        eventually(lambda: not ledger.exists())
        topology = rpc("session.snapshot")["snapshot"]
        assert [s["workspace_id"] for s in topology["workspaces"]] == [target["workspace_id"]]
        assert sorted(p["terminal_id"] for p in topology["panes"]) == sorted(untouched)
        # Exercise the real shell command with harmless local executables.
        catalog = api("/api/launchers")["botCreate"]
        assert catalog["last"] is None
        assert [profile["id"] for profile in catalog["agents"]] == ["codexp", "claudep", "kimi"]
        for agent, harness, effort, args in (
            ("codexp", "codex", "high", ["-c", "model_reasoning_effort=high"]),
            ("claudep", "claude", "medium", ["--effort", "medium"]),
            ("kimi", "claude", "low", ["--effort", "low"]),
        ):
            prefs = {"agent": agent, "effort": effort}
            receipt = post("/api/launch", {"harness": harness, "botCreate": prefs, "cwd": str(root)})
            assert receipt["ok"]
            delivered = wrapper_dir / (agent + ".args")
            eventually(delivered.is_file)
            assert delivered.read_text().splitlines() == args
            assert api("/api/launchers")["botCreate"]["last"] == prefs
        stop(bridge)
        bridge = start_bridge()
        assert eventually(lambda: api("/api/launchers")["botCreate"]["last"]) == prefs
        print("PASS installed fixture wrappers receive the chosen argv and the bridge remembers after restart")
        print("PASS isolated chat and workspace move, rename, order, restart, restore and seven-day purge")
    finally:
        if bridge is not None:
            stop(bridge)
        stop(mux)


if __name__ == "__main__":
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="collie-trash-test-") as directory:
        exercise(Path(directory))
