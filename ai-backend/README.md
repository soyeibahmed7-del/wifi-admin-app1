# RouterMate AI Gateway

This Node.js 20+ backend keeps the Gemini API key out of the APK. It receives a user message and sanitized live router observations, then returns text and an optional allow-listed action proposal. The Android app validates and executes every router operation.

## Deployment

1. Deploy this folder as a private HTTPS Node.js service.
2. Set GEMINI_API_KEY to your Gemini API key.
3. Set APP_API_TOKEN to a random secret of at least 32 characters. Generate one with: openssl rand -hex 32
4. Optionally set GEMINI_MODEL (default gemini-2.5-flash) and PORT.
5. Start with npm start. GET /health should return an OK response.
6. In RouterMate AI Assistant settings, enter the HTTPS service URL and the same APP_API_TOKEN.

Never commit .env, put either secret in Android assets, or expose the service over public plain HTTP. Keep the bearer token private and rotate it if shared.

## Safety and limitations

- The gateway does not connect to the router and cannot execute commands.
- Function calls are proposals validated against the current snapshot and a fixed allow-list.
- Android performs final checks for the controlling device, router IP, supported filter mode, and actual router response.
- Supported proposals: device block/unblock, existing deny-list management, bandwidth limits, and read-only blacklist inspection.
- Wi-Fi configuration changes are deliberately not exposed.
- Router speed values are instantaneous samples, not historical usage totals.
