// Talks to a Tenda AC5 admin page. Built from recorded browser sessions (HAR and DevTools), not from official docs.
const crypto = require("crypto");

const KEY = Buffer.from("AbDu2ZdTFut6eQ7f"); // fixed AES key and IV in the router's own page script (js/aes/util.js)
const IV = Buffer.from("EU5H62G9ICGRNI43");

function encrypt(text) {
  const c = crypto.createCipheriv("aes-128-cbc", KEY, IV);
  return Buffer.concat([c.update(text, "utf8"), c.final()]).toString("base64");
}
function decrypt(text) {
  const t = String(text || "").trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(t) || !t) return t; // the router sends some replies as plain text
  const d = crypto.createDecipheriv("aes-128-cbc", KEY, IV);
  return Buffer.concat([d.update(Buffer.from(t, "base64")), d.final()]).toString("utf8");
}

const UNLIMITED = 38528; // value the router page sends for "no limit"
const MODULES = "localhost,onlineList,macFilter,guestList,wifiBasicCfg,wifiRelay,wifiGuest,productInfo";
const isHtml = (t) => /<!DOCTYPE|<html/i.test(t);

class Router {
  constructor({ url, password, fetchImpl }) {
    this.url = url.replace(/\/$/, "");
    this.password = password || "";
    this.cookie = "";
    this.fetch = fetchImpl || fetch;
  }
  async _req(path, opts = {}) {
    const headers = Object.assign({ Cookie: this.cookie, Referer: this.url + "/index.html" }, opts.headers || {});
    let res;
    try { res = await this.fetch(this.url + path, Object.assign({}, opts, { headers, redirect: "manual" })); }
    catch (e) { throw new Error("Cannot reach the router at " + this.url + ". Is this computer on the home WiFi?"); }
    const sc = res.headers.get && res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).join("; ");
    return { status: res.status, location: (res.headers.get && res.headers.get("location")) || "", text: await res.text() };
  }
  // Recorded from the router's own login page (login.js): first GET /goform/getstok for a one-time "random" value,
  // then POST /login/Auth with one field: password = MD5( base64(password) + random ).
  // Success is a 302 redirect to index.html plus a session cookie. A wrong password redirects back to login.html.
  async login() {
    if (!this.password) return false;
    this.cookie = "";
    const t = await this._req("/goform/getstok?random=" + Math.random(), { headers: { Referer: this.url + "/login.html" } });
    let random;
    try { random = JSON.parse(decrypt(t.text)).random; } catch (e) { return false; }
    if (!random) return false;
    const b64 = Buffer.from(this.password, "utf8").toString("base64");
    const body = "password=" + crypto.createHash("md5").update(b64 + random).digest("hex");
    const r = await this._req("/login/Auth", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: this.url + "/login.html" }, body });
    return r.status === 302 && !!this.cookie && !/login\.html/.test(r.location);
  }
  _needsLogin(r) { return r.status >= 300 || isHtml(r.text); }
  async _getJson(path) {
    let r = await this._req(path);
    if (this._needsLogin(r)) {
      if (!(await this.login())) throw new Error("Router login failed. Check ROUTER_PASSWORD.");
      r = await this._req(path);
      if (this._needsLogin(r)) throw new Error("Router still asks for a login after signing in.");
    }
    return JSON.parse(decrypt(r.text));
  }
  async _post(path, form) {
    const body = encrypt(form);
    const send = () => this._req(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body });
    let r = await send();
    if (this._needsLogin(r)) {
      if (!(await this.login())) throw new Error("Router login failed. Check ROUTER_PASSWORD.");
      r = await send();
    }
    if (r.status >= 300) throw new Error("Router rejected the change (HTTP " + r.status + ")");
    return decrypt(r.text);
  }

  async snapshot() {
    const q = await this._getJson("/goform/getQos?random=" + Math.random() + "&modules=" + encodeURIComponent(MODULES));
    const mf = (q.macFilter && q.macFilter.macFilterList) || [];
    const denied = new Set(mf.filter((m) => m.filterMode === "deny").map((m) => m.mac.toLowerCase()));
    const devices = (q.onlineList || []).map((d) => ({
      mac: d.qosListMac.toLowerCase(), name: d.qosListRemark || d.qosListHostname || "Unknown", hostname: d.qosListHostname, ip: d.qosListIP,
      band: d.qosListAccessType, online: true, blocked: d.qosListAccess === "false" || denied.has(d.qosListMac.toLowerCase()),
      downKBps: +d.qosListDownSpeed, upKBps: +d.qosListUpSpeed, limitDownKBps: +d.qosListDownLimit, limitUpKBps: +d.qosListUpLimit, seconds: d.qoslistConnetTime,
    }));
    const onlineMacs = new Set(devices.map((d) => d.mac));
    mf.filter((m) => m.filterMode === "deny" && !onlineMacs.has(m.mac.toLowerCase())).forEach((m) => {
      devices.push({ mac: m.mac.toLowerCase(), name: m.remark || m.hostname || "Unknown", hostname: m.hostname, ip: "", band: "", online: false, blocked: true, downKBps: 0, upKBps: 0, limitDownKBps: 0, limitUpKBps: 0, seconds: 0 });
    });
    const w = q.wifiBasicCfg || {};
    return { me: q.localhost, devices, wifi: { ssid24: w.wifiSSID, ssid5: w.wifiSSID_5G, security: w.wifiSecurityMode }, raw: q };
  }

  // Rows are "hostname<TAB>remark<TAB>MAC<TAB>down<TAB>up<TAB>allowed". Several rows are joined with a newline (only single rows appear in the recording).
  _row(d, allowed) {
    return [d.hostname || "Unknown", d.name || "", d.mac.toUpperCase(), d.limitDownKBps || 0, d.limitUpKBps || 0, allowed].join("\t");
  }
  async apply(devices) {
    const online = devices.filter((d) => d.online && !d.blocked).map((d) => this._row(d, true));
    const blocked = devices.filter((d) => d.blocked).map((d) => this._row(Object.assign({}, d, { limitDownKBps: 0, limitUpKBps: 0 }), false));
    const form = "module1=onlineList&onlineList=" + encodeURIComponent(online.join("\n")) + "&module2=macFilter&macFilterList=" + encodeURIComponent(blocked.join("\n"));
    return this._post("/goform/setQos", form);
  }
  async setBlocked(mac, blocked) {
    const s = await this.snapshot();
    const d = s.devices.find((x) => x.mac === mac.toLowerCase());
    if (!d) throw new Error("Device not found");
    if (blocked && s.me && s.me.localhostMAC && s.me.localhostMAC.toLowerCase() === d.mac) throw new Error("This is the computer running the app. Blocking it would lock you out.");
    d.blocked = blocked;
    await this.apply(s.devices);
  }
  async setLimit(mac, kbps) {
    const s = await this.snapshot();
    const d = s.devices.find((x) => x.mac === mac.toLowerCase());
    if (!d) throw new Error("Device not found");
    d.limitDownKBps = d.limitUpKBps = kbps > 0 ? Math.round(kbps) : UNLIMITED;
    await this.apply(s.devices);
  }
}
module.exports = { Router, encrypt, decrypt };
