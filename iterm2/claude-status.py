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

PLUGIN_URL = "http://127.0.0.1:51820/sessions"
MAX_SLOTS = 8


async def send_mapping(app):
    """Build session UUID → slot mapping from current window tabs and POST it."""
    mapping = {}
    window = app.current_window
    if window:
        for i, tab in enumerate(window.tabs):
            slot = i + 1
            if slot > MAX_SLOTS:
                break
            session = tab.current_session
            if session:
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

            await asyncio.gather(layout_loop(), term_loop())


iterm2.run_forever(monitor)
