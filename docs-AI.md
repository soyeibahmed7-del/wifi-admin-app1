# RouterMate AI: what works

Tested with fake Tenda AC5 and F3 routers in `tests/test-ai.js` and `tests/test-client.js` (both run in CI). NOT yet tested on your real routers or with a real Gemini key.

| Feature | AC5 | F3 | Notes |
|---|---|---|---|
| List devices / status | yes | yes | from the router's own device list |
| Block / unblock | yes | yes (max 10 blocked) | verified by re-reading the router |
| Blacklist show/add/remove | yes | yes | only in blacklist mode; refuses in whitelist mode |
| Speed limit per device | yes | yes | verified by re-reading |
| Top bandwidth | yes | yes | live speed only, the router keeps no history |
| Internet / health / insights | yes | yes | rule-based, runs on the phone without AI |
| Unfamiliar devices | yes | yes | "New" until you mark a device Known |
| Model detection | manual | manual | you choose AC5/F3 when adding; firmware version is not read |
| Change WiFi name/password, reboot, guest on/off | no | no | not built: needs router recordings. The AI says so honestly |
| "Why does it disconnect" | partial | partial | only current state and the app's join/leave log; no router history |

Safety: the phone controlling the router (AC5) / the uplink router (F3) and the router itself can never be blocked or blacklisted by the AI.
