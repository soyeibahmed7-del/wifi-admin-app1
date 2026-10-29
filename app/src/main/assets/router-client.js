/* Talks to a Tenda AC5 admin page. Built from recorded browser sessions, not from official docs.
 * Runs in the app (through the Native bridge) and in Node (tests). It needs a `native` object with:
 *   http(method, url, headersObject, bodyString) -> Promise<{status, location, cookies:[Set-Cookie lines], text}>
 *   md5(string), aes(encrypt:boolean, string), b64(string)   (b64 = base64 of the UTF-8 text) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RouterClient = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var UNLIMITED = 38528; // value the router page sends for "no limit"
  var MODULES = "localhost,onlineList,macFilter,guestList,wifiBasicCfg,wifiRelay,wifiGuest,productInfo";
  function isHtml(t) { return /<!DOCTYPE|<html/i.test(t || ""); }

  function RouterClient(opts) {
    this.url = String(opts.url || "").replace(/\/+$/, "");
    this.password = opts.password || "";
    this.n = opts.native;
    this.cookie = "";
  }
  var P = RouterClient.prototype;

  P._decrypt = function (text) {
    var t = String(text || "").trim();
    if (!t || !/^[A-Za-z0-9+/=]+$/.test(t)) return t; // some replies are plain text
    return this.n.aes(false, t);
  };
  P._req = function (path, method, headers, body) {
    var self = this, h = { Referer: this.url + "/index.html" };
    if (this.cookie) h.Cookie = this.cookie;
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    return this.n.http(method || "GET", this.url + path, h, body || "").then(function (r) {
      if (r.cookies && r.cookies.length) {
        self.cookie = r.cookies.map(function (c) { return c.split(";")[0].trim(); }).filter(Boolean).join("; ");
      }
      return r;
    }).catch(function (e) {
      throw new Error("Cannot reach the router at " + self.url + ". Is the phone on the home WiFi? (" + (e && e.message ? e.message : e) + ")");
    });
  };

  // Recorded from the router's own login page: GET /goform/getstok gives a one-time "random" value,
  // then POST /login/Auth with one field: password = MD5( base64(password) + random ).
  // Success is a 302 redirect to index.html plus a session cookie. A wrong password redirects back to login.html.
  P.login = function () {
    var self = this;
    if (!this.password) return Promise.resolve(false);
    this.cookie = "";
    return this._req("/goform/getstok?random=" + Math.random(), "GET", { Referer: this.url + "/login.html" }).then(function (t) {
      var random;
      try { random = JSON.parse(self._decrypt(t.text)).random; } catch (e) { return false; }
      if (!random) return false;
      var body = "password=" + self.n.md5(self.n.b64(self.password) + random);
      return self._req("/login/Auth", "POST", { "Content-Type": "application/x-www-form-urlencoded", Referer: self.url + "/login.html" }, body).then(function (r) {
        return r.status === 302 && !!self.cookie && !/login\.html/.test(r.location || "");
      });
    });
  };
  P._needsLogin = function (r) { return r.status >= 300 || isHtml(r.text); };

  P._getJson = function (path) {
    var self = this;
    return this._req(path).then(function (r) {
      if (!self._needsLogin(r)) return r;
      return self.login().then(function (ok) {
        if (!ok) throw new Error("Router login failed. Check the router password.");
        return self._req(path).then(function (r2) {
          if (self._needsLogin(r2)) throw new Error("Router still asks for a login after signing in.");
          return r2;
        });
      });
    }).then(function (r) { return JSON.parse(self._decrypt(r.text)); });
  };
  P._post = function (path, form) {
    var self = this, body = this.n.aes(true, form);
    function send() { return self._req(path, "POST", { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body); }
    return send().then(function (r) {
      if (!self._needsLogin(r)) return r;
      return self.login().then(function (ok) {
        if (!ok) throw new Error("Router login failed. Check the router password.");
        return send();
      });
    }).then(function (r) {
      if (r.status >= 300) throw new Error("Router rejected the change (HTTP " + r.status + ")");
      return self._decrypt(r.text);
    });
  };

  P.snapshot = function () {
    return this._getJson("/goform/getQos?random=" + Math.random() + "&modules=" + encodeURIComponent(MODULES)).then(function (q) {
      var mf = (q.macFilter && q.macFilter.macFilterList) || [];
      var denied = {};
      mf.forEach(function (m) { if (m.filterMode === "deny") denied[m.mac.toLowerCase()] = true; });
      var devices = (q.onlineList || []).map(function (d) {
        var mac = d.qosListMac.toLowerCase();
        return {
          mac: mac, name: d.qosListRemark || d.qosListHostname || "Unknown", hostname: d.qosListHostname, ip: d.qosListIP,
          band: d.qosListAccessType, online: true, blocked: d.qosListAccess === "false" || !!denied[mac],
          downKBps: +d.qosListDownSpeed, upKBps: +d.qosListUpSpeed, limitDownKBps: +d.qosListDownLimit, limitUpKBps: +d.qosListUpLimit, seconds: d.qoslistConnetTime
        };
      });
      var onlineMacs = {};
      devices.forEach(function (d) { onlineMacs[d.mac] = true; });
      mf.forEach(function (m) {
        var mac = m.mac.toLowerCase();
        if (m.filterMode === "deny" && !onlineMacs[mac]) {
          devices.push({ mac: mac, name: m.remark || m.hostname || "Unknown", hostname: m.hostname, ip: "", band: "", online: false, blocked: true, downKBps: 0, upKBps: 0, limitDownKBps: 0, limitUpKBps: 0, seconds: 0 });
        }
      });
      var w = q.wifiBasicCfg || {}, g = q.wifiGuest || {};
      var guests = (q.guestList || []).map(function (x) { return { mac: String(x.qosListMac).toLowerCase(), name: x.qosListHostname || "Unknown", ip: x.qosListIP, downKBps: +x.qosListDownSpeed || 0, upKBps: +x.qosListUpSpeed || 0, band: /5G/.test(x.qosListAccessType || "") ? "5G" : "2.4G", seconds: +x.qoslistConnetTime || 0 }; });
      return { me: q.localhost, devices: devices, guests: guests, wifi: { ssid24: w.wifiSSID, ssid5: w.wifiSSID_5G, security: w.wifiSecurityMode, guest: { on24: g.guestEn === "true", on5: g.guestEn_5G === "true", ssid24: g.guestSSID, ssid5: g.guestSSID_5G, open: g.guestSecurityMode === "NONE", speedKBps: +g.guestShareSpeed || 0, time: g.guestValidTime } } };
    });
  };

  // Internet / WAN status, from GET /goform/getStatus (the router's own home page polls this).
  // state: "ok", "unplugged" (no WAN link), "no_ip" (cable ok but no address from the ISP) or "no_internet" (address but router says offline).
  // The "unplugged" rule assumes wanSpeedCurrent is 0 with no cable; "code" is the router's raw wanConnectStatus so unknown values can be learned.
  P.internet = function () {
    return this._getJson("/goform/getStatus?random=" + Math.random() + "&modules=" + encodeURIComponent("internetStatus,systemInfo,wanAdvCfg,sysTime")).then(function (q) {
      var si = q.systemInfo || {}, adv = q.wanAdvCfg || {}, is = q.internetStatus || {}, st = q.sysTime || {};
      var ip = si.statusWanIP || "", link = +adv.wanSpeedCurrent > 0, hasIp = !!ip && ip !== "0.0.0.0", net = st.internetState === "true";
      var state = !link ? "unplugged" : !hasIp ? "no_ip" : !net ? "no_internet" : "ok";
      return { state: state, ip: hasIp ? ip : "", gateway: si.statusWanGaterway || "", dns: si.statusWanDns1 || "", type: si.wanType || "", linkMbps: +adv.wanSpeedCurrent || 0, seconds: +si.wanConnectTime || 0, code: String(is.wanConnectStatus || "") };
    });
  };

  // Rows are "hostname<TAB>remark<TAB>MAC<TAB>down<TAB>up<TAB>allowed". Several rows are joined with a newline.
  function row(d, allowed, zero) {
    return [d.hostname || "Unknown", d.name || "", d.mac.toUpperCase(), zero ? 0 : (d.limitDownKBps || 0), zero ? 0 : (d.limitUpKBps || 0), allowed].join("\t");
  }
  P.apply = function (devices) {
    var online = devices.filter(function (d) { return d.online && !d.blocked; }).map(function (d) { return row(d, true); });
    var blocked = devices.filter(function (d) { return d.blocked; }).map(function (d) { return row(d, false, true); });
    var form = "module1=onlineList&onlineList=" + encodeURIComponent(online.join("\n")) + "&module2=macFilter&macFilterList=" + encodeURIComponent(blocked.join("\n"));
    return this._post("/goform/setQos", form);
  };
  P._change = function (mac, fn) {
    var self = this;
    return this.snapshot().then(function (s) {
      var d = s.devices.filter(function (x) { return x.mac === String(mac).toLowerCase(); })[0];
      if (!d) throw new Error("Device not found");
      fn(d, s);
      return self.apply(s.devices);
    });
  };
  P.setBlocked = function (mac, blocked) {
    return this._change(mac, function (d, s) {
      if (blocked && s.me && s.me.localhostMAC && s.me.localhostMAC.toLowerCase() === d.mac) throw new Error("This is the phone running the app. Blocking it would lock you out.");
      d.blocked = !!blocked;
    });
  };
  P.setLimit = function (mac, kbps) {
    return this._change(mac, function (d) { d.limitDownKBps = d.limitUpKBps = kbps > 0 ? Math.round(kbps) : UNLIMITED; });
  };

  // ---- MAC filter: blacklist ("deny": listed devices are kept out) or whitelist ("pass": only listed devices get in).
  // Recorded from the router's Advanced page: GET /goform/getNAT, and POST /goform/setNAT which always carries ALL the
  // modules of that page, so we read the current values first and send them back unchanged. Only module6 changes.
  var NAT_MODULES = "staticIPList,IPTV,portList,ddns,dmz,upnp,lanCfg,macFilter,localhost,wifiRelay,onlineList,ping,productInfo";
  P._nat = function () { return this._getJson("/goform/getNAT?random=" + Math.random() + "&modules=" + encodeURIComponent(NAT_MODULES)); };
  function natView(n) {
    var mf = n.macFilter || {}, names = {};
    (n.onlineList || []).forEach(function (o) { names[String(o.qosListMac).toLowerCase()] = { hostname: o.qosListHostname, remark: o.qosListRemark }; });
    var list = (mf.macFilterList || []).map(function (m) { return { mac: String(m.mac).toLowerCase(), hostname: m.hostname || "Unknown", remark: m.remark || "" }; });
    return { mode: mf.curFilterMode === "pass" ? "pass" : "deny", list: list, me: ((n.localhost || {}).localhostMAC || "").toLowerCase(), names: names };
  }
  P.getFilter = function () { return this._nat().then(function (n) { var v = natView(n); return { mode: v.mode, list: v.list, me: v.me }; }); };
  P.setFilter = function (mode, macs) {
    var self = this;
    if (mode !== "pass" && mode !== "deny") return Promise.reject(new Error("Unknown mode"));
    return this._nat().then(function (n) {
      var v = natView(n), want = [];
      (macs || []).forEach(function (m) { m = String(m).toLowerCase(); if (want.indexOf(m) < 0) want.push(m); });
      if (mode === "pass") { if (v.me && want.indexOf(v.me) < 0) want.push(v.me); }
      else if (v.me && want.indexOf(v.me) > -1) throw new Error("This is the phone running the app. Blacklisting it would lock you out.");
      if (mode === "pass" && !want.length) throw new Error("The whitelist is empty. Everyone would be blocked.");
      if ((n.staticIPList || []).length || (n.portList || []).length || (n.IPTV && String(n.IPTV.IPTVEn) === "true"))
        throw new Error("Your router has static IP, port forwarding or IPTV settings. This app cannot rewrite them safely, so it stopped.");
      var known = {}; v.list.forEach(function (m) { known[m.mac] = m; });
      var rows = want.map(function (m) {
        var k = known[m] || v.names[m] || {};
        return [k.hostname || "Unknown", k.remark || "", m].join("\t");
      });
      var dd = n.ddns || {}, e = encodeURIComponent, F = function (x) { return e(x == null ? "" : String(x)); };
      var form = "module6=macFilter&filterMode=" + mode + "&macFilterList=" + e(rows.length ? rows.join("\n") + "\n" : "") +
        "&module8=ping&pingEn=" + F((n.ping || {}).pingEn) +
        "&module1=staticIPList&staticList=&module2=portList&portList=" +
        "&module3=dmz&dmzEn=" + F((n.dmz || {}).dmzEn) + "&dmzHostIP=" + F((n.dmz || {}).dmzHostIP) +
        "&module4=ddns&ddnsEn=" + F(dd.ddnsEn) + "&ddnsServiceName=" + F(dd.ddnsServiceName) + "&ddnsServer=" + F(dd.ddnsServer) + "&ddnsUser=" + F(dd.ddnsUser) + "&ddnsPwd=" + F(dd.ddnsPwd) +
        "&module5=upnp&upnpEn=" + F((n.upnp || {}).upnpEn) +
        "&module7=IPTV&IPTVEn=false&VLANArea=&VLANID=&VLANSelect=";
      return self._post("/goform/setNAT", form);
    });
  };

  RouterClient.UNLIMITED = UNLIMITED;
  return RouterClient;
});
