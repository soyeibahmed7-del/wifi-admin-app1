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
    console.log("ALL TESTS PASSED");
  } catch (e) { console.error("FAILED:", e); process.exitCode = 1; }
  server.close();
});
