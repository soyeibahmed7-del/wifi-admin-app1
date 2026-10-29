WiFi Admin (Tenda AC5), version 3: backend and dashboard together

Update an existing install: unzip over Downloads\wifi-admin-backend (Replace all). users.json stays.

Start (Windows PowerShell, inside the wifi-admin-backend folder):
  node users.js add yourname YourPassword123 admin      (once; skip if you already made a user)
  $env:ROUTER_URL="http://192.168.1.1"
  $env:ROUTER_PASSWORD="router admin password"
  node server.js
Then open http://localhost:8080 in Chrome and sign in.

Keep it inside your home network. Do not forward a port to it from the internet.
