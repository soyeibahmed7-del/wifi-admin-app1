# RouterMate AI Network Assistant — implementation notes

## Architecture

- Android WebView UI remains in `app/src/main/assets/index.html`; the existing router client remains in `router-client.js`.
- The UI sends sanitized live observations to a separately deployed Node.js Gemini gateway under `ai-backend/`.
- The gateway uses Gemini function calling to propose only a fixed set of actions. It never connects to the router and cannot execute a command.
- The Android app validates the target against its current router snapshot, invokes the existing router client, and verifies the resulting state before reporting completion.
- Gemini API credentials remain on the backend. The app stores its gateway bearer token and router admin passwords encrypted with an AES-GCM key held by Android Keystore. Legacy router passwords in the old WebView config are migrated on app startup.

## Implemented UI and assistant functions

- Bilingual AI Network Assistant screen, live network status, device count, model label, basic insights, chat, loading and error states.
- English and Bangla labels for the new assistant.
- Secure backend URL/token configuration in Settings. HTTPS is required by the UI.
- AI proposals supported by the app: block, unblock, set a symmetric per-device bandwidth cap, display the access-filter list, add to blacklist, and remove from blacklist.
- Existing Wi-Fi settings are not exposed to the AI. It must not switch between whitelist and blacklist modes.
- Action results are checked against a fresh router snapshot or filter-list read. A rejected or unverified action is not reported as successful.
- Blocking is refused if the current controlling phone cannot be identified. The existing router client also protects the controller MAC.

## Router compatibility

The repository's router client already contains separate Tenda F3 and AC5 protocol paths. Setup and Add Router now expose explicit model selection.

| Feature | Tenda F3 client path | Tenda AC5 client path |
|---|---|---|
| Connected-device snapshot | Implemented | Implemented |
| Current upload/download samples | If exposed by firmware | If exposed by firmware |
| Block/unblock | Implemented through F3 QoS list | Implemented through AC5 QoS/MAC filter |
| Access-filter list | Implemented with post-read verification | Implemented |
| Add/remove blacklist entries | Implemented; only existing deny mode | Implemented; only existing deny mode |
| Bandwidth limit | Implemented through F3 QoS list | Implemented through AC5 QoS list |
| WAN status | Implemented | Implemented |
| Firmware version | Not currently surfaced reliably | Not currently surfaced reliably |
| Automatic model detection | Not implemented; choose model manually | Not implemented; choose model manually |

Firmware variations can change endpoint behavior. The model selector is not proof that a specific hardware revision or firmware build has been tested.

## Honest test status

- JavaScript syntax checks were performed for the updated app script, router client, and AI gateway.
- The repository's `tests/test-client.js` uses simulated Tenda F3 and AC5 HTTP servers. It covers login, device lists, block/unblock, bandwidth limits, access-filter operations, WAN state parsing, and controller lockout safeguards.
- GitHub Actions runs that test suite before assembling the debug APK.
- No physical Tenda F3 or AC5 device was available to this implementation session. Real firmware behavior, real-phone self-identification, and real network performance must be verified on the user's hardware before treating the feature matrix as field-certified.
- No historical per-device usage totals, signal-strength readings, or RF congestion measurements are claimed unless a future firmware adapter exposes those measurements.

## Configure Gemini securely

1. Deploy `ai-backend/` to a Node.js 20+ host with HTTPS.
2. Set `GEMINI_API_KEY` and `APP_API_TOKEN` as host secrets. Generate a unique token with `openssl rand -hex 32`.
3. Optionally set `GEMINI_MODEL` and `PORT`.
4. Start with `npm start` and check `GET /health`.
5. In RouterMate Settings, enter the HTTPS backend URL and the same app token. Do not enter a Gemini key in the APK.
6. Keep the app token private and rotate it if shared. Do not expose the backend over plain HTTP.

The gateway currently uses a shared bearer token for app authentication. For a public multi-user deployment, add per-user identities, token rotation/revocation, HTTPS hosting controls, and persistent audit storage before production rollout.
