#!/usr/bin/env python3
"""
iTerm2 Python API daemon for Claude Status Stream Deck plugin.

Monitors tab layout changes and sends session→slot mapping to the plugin's
HTTP server. Install as an AutoLaunch script in iTerm2.

Install path:
  ~/Library/Application Support/iTerm2/Scripts/AutoLaunch/claude-status.py
"""

import iterm2
import json
import urllib.request
import asyncio
import os
import signal
import atexit
import subprocess

PLUGIN_URL = "http://127.0.0.1:51820/sessions"
MAX_SLOTS = 8
PID_FILE = os.path.join(os.path.expanduser("~"), ".cache", "claude-status", "daemon.pid")


def _is_claude_status_daemon(pid):
    """Check if pid is a claude-status.py AutoLaunch process."""
    try:
        output = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return False
    script_name = os.path.basename(__file__)
    return f"/{script_name}" in output and "AutoLaunch" in output


def _kill_pid(pid):
    """Kill pid if it looks valid and isn't this process."""
    if pid <= 0 or pid == os.getpid():
        return
    try:
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _kill_previous_from_pidfile():
    """Kill process recorded in PID file, if present."""
    try:
        with open(PID_FILE, "r") as f:
            old_pid = int(f.read().strip())
        if _is_claude_status_daemon(old_pid):
            _kill_pid(old_pid)
    except (FileNotFoundError, ValueError):
        pass


def _kill_other_daemons():
    """
    Best-effort cleanup for stale daemons that predate PID-file support.
    Looks for other AutoLaunch claude-status.py processes and kills them.
    """
    me = os.getpid()
    parent = os.getppid()
    script_name = os.path.basename(__file__)

    try:
        output = subprocess.check_output(
            ["ps", "-ax", "-o", "pid=,command="],
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return

    for line in output.splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) != 2:
            continue
        pid_str, command = parts
        try:
            pid = int(pid_str)
        except ValueError:
            continue

        # Keep current process tree alive; only remove other stale copies.
        if pid in (me, parent):
            continue
        if f"/{script_name}" not in command:
            continue
        if "AutoLaunch" not in command:
            continue
        _kill_pid(pid)


def acquire_singleton():
    """Ensure only one instance runs. Kill any stale previous process."""
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)

    # Use SIGKILL because iterm2.run_forever catches SIGTERM and restarts.
    _kill_previous_from_pidfile()
    _kill_other_daemons()

    # Write our PID
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    atexit.register(_cleanup_pid)


def _cleanup_pid():
    try:
        with open(PID_FILE, "r") as f:
            if int(f.read().strip()) == os.getpid():
                os.remove(PID_FILE)
    except (FileNotFoundError, ValueError):
        pass


acquire_singleton()


async def send_mapping(app):
    """Build session UUID → slot mapping from current window tabs and POST it."""
    mapping = {}
    window = app.current_window
    if window:
        for i, tab in enumerate(window.tabs):
            slot = i + 1
            if slot > MAX_SLOTS:
                break
            # Map ALL sessions in the tab (handles split panes)
            for session in tab.sessions:
                mapping[session.session_id] = slot

    try:
        data = json.dumps(mapping).encode()
        req = urllib.request.Request(
            PLUGIN_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        # Plugin may not be running — silently ignore
        pass


async def monitor(connection):
    app = await iterm2.async_get_app(connection)

    # Send initial mapping on startup
    await send_mapping(app)

    async with iterm2.LayoutChangeMonitor(connection) as layout_mon:
        async with iterm2.SessionTerminationMonitor(connection) as term_mon:

            async def layout_loop():
                while True:
                    await layout_mon.async_get()
                    await send_mapping(app)

            async def term_loop():
                while True:
                    await term_mon.async_get()
                    # Small delay to let iTerm2 finalize tab removal
                    await asyncio.sleep(0.1)
                    await send_mapping(app)

            async def heartbeat_loop():
                """Re-send mapping periodically so late-starting plugin gets it."""
                while True:
                    await asyncio.sleep(30)
                    await send_mapping(app)

            await asyncio.gather(layout_loop(), term_loop(), heartbeat_loop())


iterm2.run_forever(monitor)
