// Runs the app's router client against a fake Tenda router (same login, AES and list format as the real one).
// Usage: node tests/test-client.js
const http = require("http"), crypto = require("crypto"), assert = require("assert");
const RouterClient = require("../app/src/main/assets/router-client.js");

const KEY = Buffer.from("AbDu2ZdTFut6eQ7f"), IV = Buffer.from("EU5H62G9ICGRNI43");
const enc = (t) => { const c = crypto.createCipheriv("aes-128-cbc", KEY, IV); return Buffer.concat([c.update(t, "utf8"), c.final()]).toString("base64"); };
const dec = (t) => { const d = crypto.createDecipheriv("aes-128-cbc", KEY, IV); return Buffer.concat([d.update(Buffer.from(t.trim(), "base64")), d.final()]).toString("utf8"); };
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// ---- fake router ----
const PASSWORD = "asraf555444", RANDOM = "r4ndOm9", SESSION = "ecos_pw=tok123:language=cn";
const state = {
  me: "FC:01:7C:A1:0B:F7",
  online: [
    { mac: "fc:01:7c:a1:0b:f7", host: "SOYEIB", remark: "Laptop", ip: "192.168.1.196", down: "120.00", up: "30.00", lim: "38528.00" },
    { mac: "aa:b3:7d:a1:46:ee", host: "Unknown", remark: "Asma", ip: "192.168.1.199", down: "40.00", up: "5.00", lim: "38528.00" },
  ],
  deny: [],
  lastSetQos: null, wanIp: "192.168.0.101", code: "13102060", wanLink: "100", net: "true",
  nat: { mode: "deny", list: [{ hostname: "SOYEIB", remark: "Laptop", mac: "fc:01:7c:a1:0b:f7" }], lastForm: null },
};
function getQos() {
  return JSON.stringify({
    localhost: { localhostMAC: state.me, localhost: "192.168.1.196", lanMask: "255.255.255.0" },
    onlineList: state.online.map((d) => ({ qosListHostname: d.host, qosListRemark: d.remark, qosListIP: d.ip, qosListConnectType: "wifi", qosListAccessType: "wifi_5G", qosListMac: d.mac, qosListManufacturer: "other", qosListDownSpeed: d.down, qosListUpSpeed: d.up, qosListDownLimit: d.lim, qosListUpLimit: d.lim, qosListAccess: "true", qoslistConnetTime: 100 })),
    macFilter: { curFilterMode: state.deny.length ? "deny" : "pass", macFilterList: state.deny.map((d) => ({ hostname: d.host, remark: d.remark, mac: d.mac, filterMode: "deny" })) },
    guestList: [], wifiBasicCfg: { wifiSSID: "Soyeib ", wifiSSID_5G: "Soyeib_5G", wifiSecurityMode: "WPA2/AES" },
  });
}
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const authed = (req.headers.cookie || "").includes(SESSION);
    const redirect = (loc, extra) => { res.writeHead(302, Object.assign({ Location: loc }, extra || {})); res.end(); };
    if (req.url.startsWith("/goform/getstok")) { res.writeHead(200); return res.end(JSON.stringify({ random: RANDOM })); }
    if (req.url === "/login/Auth" && req.method === "POST") {
      const ok = body === "password=" + md5(Buffer.from(PASSWORD).toString("base64") + RANDOM);
      return ok ? redirect("http://x/index.html", { "Set-Cookie": SESSION + "; path=/; HttpOnly" }) : redirect("http://x/login.html");
    }
    if (!authed) return redirect("/login.html");
    if (req.url.startsWith("/goform/getQos")) { res.writeHead(200); return res.end(enc(getQos())); }
    if (req.url === "/goform/setQos" && req.method === "POST") {
      const form = new URLSearchParams(dec(body)); state.lastSetQos = form;
      const rows = (s) => (s ? s.split("\n").map((r) => r.split("\t")) : []);
      const onl = rows(form.get("onlineList")), blk = rows(form.get("macFilterList"));
      const all = state.online.concat(state.deny.map((d) => Object.assign({}, d)));
      const find = (mac) => all.find((d) => d.mac === mac.toLowerCase());
      state.online = onl.map((r) => Object.assign(find(r[2]), { lim: (+r[3]).toFixed(2) }));
      state.deny = blk.map((r) => find(r[2]));
      res.writeHead(200); return res.end(enc('{"errCode":0}'));
    }
    if (req.url.startsWith("/goform/getStatus")) {
      res.writeHead(200); return res.end(enc(JSON.stringify({ internetStatus: { wanConnectStatus: state.code }, systemInfo: { wanType: "dhcp", statusWanIP: state.wanIp, statusWanGaterway: "192.168.0.1", statusWanDns1: "192.168.0.1", wanConnectTime: "3171" }, wanAdvCfg: { wanSpeedCurrent: state.wanLink }, sysTime: { internetState: state.net } })));
    }
    if (req.url.startsWith("/goform/getNAT")) {
      res.writeHead(200); return res.end(enc(JSON.stringify({ staticIPList: [], IPTV: { IPTVEn: "false", VLANID: [] }, portList: [],
        ddns: { ddnsEn: "false", ddnsServiceName: "oray.com", ddnsUser: "", ddnsPwd: "secret!", ddnsServer: "" }, dmz: { dmzEn: "false", dmzHostIP: "" }, upnp: { upnpEn: "true" },
        macFilter: { curFilterMode: state.nat.mode, macFilterList: state.nat.list.map((m) => Object.assign({ filterMode: "pass" }, m)) },
        localhost: { localhostMAC: state.me }, ping: { pingEn: "true" },
        onlineList: state.online.map((d) => ({ qosListHostname: d.host, qosListRemark: d.remark, qosListMac: d.mac })) })));
    }
    if (req.url === "/goform/setNAT" && req.method === "POST") {
      const form = new URLSearchParams(dec(body)); state.nat.lastForm = form;
      state.nat.mode = form.get("filterMode");
      state.nat.list = (form.get("macFilterList") || "").split("\n").filter(Boolean).map((r) => { const c = r.split("\t"); return { hostname: c[0], remark: c[1], mac: c[2] }; });
      res.writeHead(200); return res.end(enc('{"errCode":0}'));
    }
    res.writeHead(404); res.end();
  });
});

// ---- same shape as the app's Native bridge, but using Node ----
const native = {
  http: async (method, url, headers, body) => {
    const r = await fetch(url, { method, headers, body: method === "GET" ? undefined : body, redirect: "manual" });
    return { status: r.status, location: r.headers.get("location") || "", cookies: r.headers.getSetCookie(), text: await r.text() };
  },
  md5, aes: (e, s) => (e ? enc(s) : dec(s)), b64: (s) => Buffer.from(s, "utf8").toString("base64"),
};

server.listen(0, async () => {
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const bad = new RouterClient({ url, password: "wrong", native });
    await assert.rejects(() => bad.snapshot(), /login failed/);
    console.log("wrong password -> clear error: ok");

    const rc = new RouterClient({ url, password: PASSWORD, native });
    let s = await rc.snapshot();
    assert.deepStrictEqual(s.devices.map((d) => d.name), ["Laptop", "Asma"]);
    assert.strictEqual(s.devices[0].downKBps, 120);
    console.log("login + device list: ok", s.devices.map((d) => d.name + (d.blocked ? " (blocked)" : "")).join(", "));

    await assert.rejects(() => rc.setBlocked("fc:01:7c:a1:0b:f7", true), /lock you out/);
    console.log("cannot block own phone: ok");

    await rc.setBlocked("aa:b3:7d:a1:46:ee", true);
    s = await rc.snapshot();
    assert.ok(s.devices.find((d) => d.name === "Asma").blocked);
    console.log("block: ok. request sent:", JSON.stringify(state.lastSetQos.get("macFilterList")));
    assert.strictEqual(state.lastSetQos.get("macFilterList").split("\t").slice(3).join(","), "0,0,false");

    await rc.setBlocked("aa:b3:7d:a1:46:ee", false);
    s = await rc.snapshot();
    const asma = s.devices.find((d) => d.name === "Asma");
    assert.ok(!asma || !asma.blocked); // an offline device disappears from the lists once unblocked
    console.log("unblock: ok");

    await rc.setLimit("fc:01:7c:a1:0b:f7", 250);
    s = await rc.snapshot();
    assert.strictEqual(s.devices[0].limitDownKBps, 250);
    await rc.setLimit("fc:01:7c:a1:0b:f7", 0);
    s = await rc.snapshot();
    assert.strictEqual(s.devices[0].limitDownKBps, 38528);
    console.log("limit 2 Mbps and back to unlimited: ok");

    rc.cookie = ""; // session lost -> should log in again by itself
    s = await rc.snapshot(); assert.ok(s.devices.length >= 1);
    console.log("auto re-login: ok");
    let f = await rc.getFilter();
    assert.strictEqual(f.mode, "deny"); assert.strictEqual(f.list.length, 1);
    await assert.rejects(() => rc.setFilter("deny", ["fc:01:7c:a1:0b:f7"]), /lock you out/);
    await rc.setFilter("pass", ["aa:b3:7d:a1:46:ee"]); // own phone must be added automatically
    f = await rc.getFilter();
    assert.strictEqual(f.mode, "pass"); assert.deepStrictEqual(f.list.map((m) => m.mac).sort(), ["aa:b3:7d:a1:46:ee", "fc:01:7c:a1:0b:f7"]);
    const sent = state.nat.lastForm;
    assert.strictEqual(sent.get("ddnsPwd"), "secret!"); assert.strictEqual(sent.get("upnpEn"), "true"); assert.strictEqual(sent.get("pingEn"), "true");
    assert.ok(sent.toString().startsWith("module6=macFilter&filterMode=pass&macFilterList="));
    await rc.setFilter("deny", []);
    f = await rc.getFilter(); assert.strictEqual(f.mode, "deny"); assert.strictEqual(f.list.length, 0);
    console.log("whitelist/blacklist: ok (own phone protected, other settings kept)");
    const cases = { "13102060": "ok", "21002010": "unplugged", "13102050": "no_internet", "13102030": "connecting", "13103070": "auth_failed", "13102070": "ip_conflict" };
    for (const code in cases) { state.code = code; assert.strictEqual((await rc.internet()).state, cases[code], code); }
    state.code = "99999999"; state.wanIp = "0.0.0.0"; assert.strictEqual((await rc.internet()).state, "no_ip");
    console.log("internet status states: ok");
    // ---- Tenda F3 (plain JSON, no AES) ----
    const F = {
      ip: "192.168.0.101", mode: "pass", breakNat: false, lastQos: null, lastNat: null,
      online: [
        { h: "Tenda", r: "Soyeib ", ip: "192.168.0.101", t: "wires", mac: "80:9f:e4:42:71:69", down: "1.00", up: "16.00", lim: "4931584.00" },
        { h: "Unknown", r: "আশরাফ ", ip: "192.168.0.107", t: "wifi", mac: "6a:b3:cb:5a:55:62", down: "3754.00", up: "45.00", lim: "4931584.00" },
        { h: "V2556", r: "আমির", ip: "192.168.0.105", t: "wifi", mac: "c2:11:21:1f:e7:95", down: "0.00", up: "0.00", lim: "4931584.00" }],
      black: [],
      allow: [{ hostname: "Tenda", remark: "Soyeib ", mac: "80:9f:e4:42:71:69" }, { hostname: "", remark: "আশরাফ ", mac: "6a:b3:cb:5a:55:62" }, { hostname: "V2556", remark: "আমির", mac: "c2:11:21:1f:e7:95" }],
    };
    const q = (d) => ({ qosListHostname: d.h, qosListRemark: d.r, qosListIP: d.ip, qosListConnectType: d.t, qosListMac: d.mac, qosListDownSpeed: d.down, qosListUpSpeed: d.up, qosListDownLimit: d.lim, qosListUpLimit: d.lim, qosListAccess: "true" });
    const f3 = http.createServer((req, res) => {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
        res.writeHead(200);
        if (req.url.startsWith("/goform/getQos")) return res.end(JSON.stringify({ localhost: { localhost: F.ip, lanMask: "255.255.255.0" }, onlineList: F.online.map(q), blackList: F.black.map(q), macFilter: { curFilterMode: F.mode } }));
        if (req.url.startsWith("/goform/setQos")) {
          const form = new URLSearchParams(body); F.lastQos = form;
          const rows = form.get("qosList").split("\n").map((r) => r.split("\t")), all = F.online.concat(F.black);
          F.online = []; F.black = [];
          rows.forEach((r) => { const d = Object.assign({}, all.find((x) => x.mac === r[2])); d.lim = r[5] === "false" ? "0.00" : (+r[4]).toFixed(2); (r[5] === "false" ? F.black : F.online).push(d); });
          return res.end('{"errCode":"0"}');
        }
        if (req.url.startsWith("/goform/getWifi")) return res.end(Buffer.from(JSON.stringify({ wifiEn: { wifiEn: "true" }, wifiBasicCfg: { wifiHideSSID: "false", wifiSSID: "Jamir ", wifiSecurityMode: "wpa&wpa2", wifiPwd: "secret" } }), "utf8").toString("base64"));
        if (req.url.startsWith("/goform/getStatus")) return res.end(JSON.stringify({ internetStatus: { wanConnectStatus: "13103061" }, systemInfo: { wanType: "pppoe", statusWanIP: "10.15.5.59", wanConnectTime: "84951" }, wanAdvCfg: { wanSpeedCurrent: "100" } }));
        if (req.url.startsWith("/goform/getNAT")) return res.end(JSON.stringify({ staticIPList: [], portList: [], macFilter: { curFilterMode: F.mode, macFilterList: F.allow.map((m) => Object.assign({ filterMode: "pass" }, m)) },
          localhost: { localhostMAC: "80:9F:E4:42:71:69", localhost: F.ip }, onlineList: F.online.map(q), ddns: { ddnsEn: "false", ddnsServiceName: "oray.com", ddnsUser: "", ddnsPwd: "pw1", ddnsServer: "" }, dmz: { dmzEn: "false", dmzHostIP: "" }, ping: { pingEn: "false" }, upnp: { upnpEn: "false" }, apIsolation: { apIsolationEn: "false" } }));
        if (req.url.startsWith("/goform/setNAT")) {
          const form = new URLSearchParams(body); F.lastNat = form;
          if (!F.breakNat) { F.mode = form.get("filterMode"); F.allow = (form.get("macFilterList") || "").split("\n").filter(Boolean).map((r) => { const c = r.split("\t"); return { hostname: c[0], remark: c[1], mac: c[2] }; }); }
          else if (form.get("filterMode") === "pass") F.allow = []; // simulate the router mangling the list
          return res.end('{"errCode":"0"}');
        }
        res.end("{}");
      });
    });
    await new Promise((r) => f3.listen(0, r));
    const r2 = new RouterClient({ url: "http://127.0.0.1:" + f3.address().port, password: "x", native, type: "f3" });
    let s2 = await r2.snapshot();
    assert.strictEqual(s2.devices.length, 3); assert.strictEqual(s2.devices[1].name.trim(), "আশরাফ"); assert.strictEqual(s2.me.localhostMAC, "80:9f:e4:42:71:69");
    assert.strictEqual(s2.devices[1].mac, "6a:b3:cb:5a:55:62"); assert.strictEqual(s2.devices[1].downKBps, 3754);
    assert.strictEqual(s2.wifi.ssid24, "Jamir "); assert.strictEqual(s2.wifi.security, "wpa&wpa2"); assert.ok(!JSON.stringify(s2).includes("secret"));
    const i2 = await r2.internet(); assert.strictEqual(i2.state, "ok"); assert.strictEqual(i2.type, "pppoe");
    await assert.rejects(() => r2.setBlocked("80:9f:e4:42:71:69", true), /lock you out/);
    await r2.setBlocked("c2:11:21:1f:e7:95", true);
    assert.ok(F.lastQos.get("qosList").includes("V2556\tআমির\tc2:11:21:1f:e7:95\t0\t0\tfalse"));
    assert.ok(F.lastQos.get("qosList").includes("Tenda\tSoyeib \t80:9f:e4:42:71:69\t38528\t38528\ttrue"));
    s2 = await r2.snapshot(); assert.ok(s2.devices.find((d) => d.mac === "c2:11:21:1f:e7:95").blocked);
    await r2.setBlocked("c2:11:21:1f:e7:95", false);
    await r2.setLimit("6a:b3:cb:5a:55:62", 250);
    assert.ok(F.lastQos.get("qosList").includes("আশরাফ \t6a:b3:cb:5a:55:62\t250\t250\ttrue"));
    await r2.setLimit("6a:b3:cb:5a:55:62", 0);
    assert.ok(F.lastQos.get("qosList").includes("আশরাফ \t6a:b3:cb:5a:55:62\t38528\t38528\ttrue"));
    console.log("F3 block / unblock / limit: ok");
    f = await r2.getFilter(); assert.strictEqual(f.mode, "pass"); assert.strictEqual(f.list.length, 3);
    await r2.setFilter("pass", ["6a:b3:cb:5a:55:62", "c2:11:21:1f:e7:95", "aa:aa:aa:aa:aa:aa"]);
    f = await r2.getFilter(); assert.strictEqual(f.list.length, 4); // + own gateway device kept
    assert.ok(F.lastNat.toString().startsWith("module8=macFilter&filterMode=pass&macFilterList="));
    assert.strictEqual(F.lastNat.get("ddnsPwd"), "pw1"); assert.strictEqual(F.lastNat.get("apIsolationEn"), "false");
    assert.ok(F.allow.some((m) => m.hostname === "" && m.remark === "আশরাফ ")); // names (even empty hostnames) kept as they were
    await assert.rejects(() => r2.setFilter("deny", ["80:9f:e4:42:71:69"]), /lock you out/);
    F.breakNat = true; const before = JSON.stringify(F.allow);
    await assert.rejects(() => r2.setFilter("pass", ["6a:b3:cb:5a:55:62"]), /previous list was restored/);
    F.breakNat = false;
    console.log("F3 whitelist/blacklist (with safety restore): ok");
    f3.close();
    console.log("ALL TESTS PASSED");
  } catch (e) { console.error("FAILED:", e); process.exitCode = 1; }
  server.close();
});

// ---- Netis (view-only) with a fake router that mimics the recording ----
(async () => {
  const http = require("http");
  let loggedIn = false, bad = 0;
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
      if (req.url === "/cgi-bin/login.cgi") { loggedIn = b === "password=" + encodeURIComponent(Buffer.from("secret12").toString("base64")); res.end(loggedIn ? '["SUCCESS"]' : '["FAIL"]'); return; }
      if (req.url === "/cgi-bin/skk_get.cgi") {
        if (!loggedIn) { res.end("<html>login</html>"); return; }
        if (/app=wlan/.test(b)) res.end('{"wlan":[{"id":"1","ssid":"' + Buffer.from("HomeNet").toString("base64") + '","wepKey":"x",},],}');
        else res.end('{"arpList":[{"id":"1","arp_ip":"192.168.1.101","arp_mac":"86:64:18:42:FE:3F","arp_host_name":"' + Buffer.from("Phone").toString("base64") + '","qos_down_limit":"0","qos_up_limit":"0",},],"macFilterList":[],"connected":"1","st_wanIpAddr":"10.15.6.78","st_wanDefGw":"10.15.0.1",}');
        return;
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => srv.listen(0, r));
  const native = { http: (m, u, h, body) => new Promise((ok, no) => { const o = new URL(u); const q = http.request({ hostname: o.hostname, port: o.port, path: o.pathname, method: m, headers: Object.assign({}, h, { "Content-Length": Buffer.byteLength(body || "") }) }, r => { let t = ""; r.on("data", c => (t += c)); r.on("end", () => ok({ status: r.statusCode, location: r.headers.location || "", cookies: [], text: t })); }); q.on("error", no); q.end(body || ""); }), md5: () => "", aes: (e, s) => s, b64: s => Buffer.from(s).toString("base64") };
  const RC = require("../app/src/main/assets/router-client.js");
  const good = new RC({ url: "http://127.0.0.1:" + srv.address().port, password: "secret12", native, type: "netis" });
  const s = await good.snapshot(), n = await good.internet();
  const t = (c, m) => { console.log(c ? "ok:" : "FAIL:", m); if (!c) bad++; };
  t(s.devices.length === 1 && s.devices[0].name === "Phone" && s.devices[0].mac === "86:64:18:42:fe:3f" && s.devices[0].readonly, "Netis: device list read with auto login (trailing commas ok)");
  t(s.wifi.ssid24 === "HomeNet", "Netis: WiFi name read, password never read");
  t(n.state === "ok" && n.ip === "10.15.6.78", "Netis: internet status");
  let err = ""; try { await good.setBlocked("86:64:18:42:fe:3f", true); } catch (e) { err = e.message; } t(/view-only/.test(err), "Netis: blocking refused (view-only)");
  loggedIn = false; const wrong = new RC({ url: "http://127.0.0.1:" + srv.address().port, password: "nope", native, type: "netis" }); err = ""; try { await wrong.snapshot(); } catch (e) { err = e.message; } t(/login failed/i.test(err), "Netis: wrong password reported");
  srv.close(); console.log(bad ? "NETIS FAILED" : "NETIS TESTS PASSED"); if (bad) process.exit(1);
})();
