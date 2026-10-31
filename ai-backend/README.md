# RouterMate AI backend (keeps the Gemini key out of the APK)

The app never holds your Gemini key. It talks to a tiny backend that you own (Cloudflare Worker, free plan).
The backend holds two secrets: your Gemini key and an app token (a long password only you and the app know).

## Setup (about 10 minutes, on your laptop)
1. Get a Gemini API key at https://aistudio.google.com/apikey (free tier is enough).
2. Make a free account at https://dash.cloudflare.com and install Node.js.
3. In a terminal:
   ```
   cd ai-backend
   npx wrangler login
   npx wrangler secret put GEMINI_API_KEY      # paste your Gemini key
   npx wrangler secret put APP_TOKEN           # type a long random password, e.g. 30+ characters
   npx wrangler deploy
   ```
   Wrangler prints a link like `https://routermate-ai.YOURNAME.workers.dev`.
4. In RouterMate: **Settings > AI backend**: paste the link and the same app token, press Save.
5. Open the **AI** tab and ask something.

Optional: use another model with `npx wrangler deploy --var GEMINI_MODEL:gemini-3.8-flash`.

## How it is kept safe
- The Gemini key and APP_TOKEN exist only as Worker secrets. They are not in the app, the repo, or the APK.
- Every request must carry `Authorization: Bearer <APP_TOKEN>`; wrong token gives 401.
- The backend limits request size and forwards only the fields it expects. Model and key are chosen on the server.
- The app token is stored only on your phone (Settings), like your router passwords. If the phone is lost, run `wrangler secret put APP_TOKEN` again to change it.
- The model can only ask for the 9 functions in `app/src/main/assets/ai-tools.js`. The app validates each call, runs it through its own router client, and re-reads the router to verify the result. Nothing the model writes is ever run as code or sent to the router as text.
- Router passwords and WiFi passwords are never sent to the backend or Gemini. Device names, IPs, short MAC endings and speeds are sent so the AI can answer.
