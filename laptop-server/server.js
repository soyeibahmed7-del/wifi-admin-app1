// Run on a computer inside your home network:  ROUTER_URL=http://192.168.1.1 ROUTER_PASSWORD=... node server.js
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { Router } = require("./router"), users = require("./users");
const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || "0.0.0.0";
const router = new Router({ url: process.env.ROUTER_URL || "http://192.168.1.1", password: process.env.ROUTER_PASSWORD || "" });
const sessions = new Map(), fails = new Map(); // token -> user ; ip -> {n, until}
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

function send(res, code, obj, extra) { res.writeHead(code, Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extra || {})); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok, no) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e5) { no(new Error("too big")); req.destroy(); } }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); }); }
function userOf(req) { const m = /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); return m && sessions.get(m[1]); }

http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (url === "/api/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return send(res, 429, { error: "Too many tries. Wait a minute." });
      const b = await body(req), u = users.verify(b.name, b.password);
      if (!u) { f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ip, f); return send(res, 401, { error: "Wrong name or password" }); }
      fails.delete(ip);
      const t = crypto.randomBytes(24).toString("hex"); sessions.set(t, u);
      return send(res, 200, u, { "Set-Cookie": "sid=" + t + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" });
    }
    if (url.startsWith("/api/")) {
      const u = userOf(req);
      if (!u) return send(res, 401, { error: "Sign in first" });
      if (url === "/api/me") return send(res, 200, u);
      if (url === "/api/logout") { sessions.delete(/sid=([a-f0-9]+)/.exec(req.headers.cookie)[1]); return send(res, 200, {}); }
      if (url === "/api/devices" && req.method === "GET") { const s = await router.snapshot(); delete s.raw; return send(res, 200, s); }
      if (req.method === "POST" && (url === "/api/block" || url === "/api/limit")) {
        if (u.role !== "admin") return send(res, 403, { error: "Viewers cannot change settings" });
        const b = await body(req);
        if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(b.mac || "")) return send(res, 400, { error: "Bad MAC address" });
        if (url === "/api/block") await router.setBlocked(b.mac, !!b.blocked); else await router.setLimit(b.mac, +b.kbps || 0);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "Not found" });
    }
    const file = path.join(PUBLIC, url === "/" ? "index.html" : url);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 502, { error: e.message }); }
}).listen(PORT, HOST, () => console.log("WiFi admin on http://localhost:" + PORT));
