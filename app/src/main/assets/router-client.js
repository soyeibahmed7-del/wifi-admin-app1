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
    this.type = opts.type === "f3" ? "f3" : opts.type === "netis" ? "netis" : "ac5"; // "f3" = Tenda F3 (plain-text replies, read-only here)
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
    if (this.type === "netis") return this._netisLogin();
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
    var self = this, body = this.type === "f3" ? form : this.n.aes(true, form); // the F3 sends and receives plain text
    function send() { return self._req(path, "POST", { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body); }
    return send().then(function (r) {
      if (!self._needsLogin(r)) return r;
      return self.login().then(function (ok) {
        if (!ok) throw new Error("Router login failed. Check the router password.");
        return send();
      });
    }).then(function (r) {
      if (r.status >= 300) throw new Error("Router rejected the change (HTTP " + r.status + ")");
      var out = self._decrypt(r.text);
      if (self.type === "f3") { try { var j = JSON.parse(out); if (j && j.errCode != null && String(j.errCode) !== "0") throw new Error("Router refused the change (error " + j.errCode + ")"); } catch (e) { if (/Router refused/.test(e.message)) throw e; } }
      return out;
    });
  };

  // Tenda F3 (main router): recorded replies are plain JSON from the same /goform/getQos. Only reading is supported for now.
  // The F3 sends its WiFi settings as plain base64 JSON (not AES). We only read the name and security type, never the password.
  function b64json(text) {
    var t = String(text || "").trim();
    if (t.charAt(0) === "{") return JSON.parse(t);
    var bin = atob(t), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }
  P._wifiF3 = function () {
    return this._req("/goform/getWifi?random=" + Math.random() + "&modules=" + encodeURIComponent("wifiEn,wifiBasicCfg")).then(function (r) {
      if (r.status >= 300 || isHtml(r.text)) return {};
      var j = b64json(r.text), b = j.wifiBasicCfg || {};
      return { ssid24: b.wifiSSID, security: b.wifiSecurityMode, hidden: b.wifiHideSSID === "true", off: (j.wifiEn || {}).wifiEn === "false" };
    }).catch(function () { return {}; });
  };
  // ---- Netis (WF2409E V6 and similar), view-only. Recorded API: POST /cgi-bin/login.cgi (password = urlencode(base64(pw)), reply ["SUCCESS"]),
  // then POST /cgi-bin/skk_get.cgi (mode_name=skk_get&app=routerState|wlan). The router tracks the session by client address, no cookie.
  // Blocking is NOT built: the recording does not show whether the MAC list is a blacklist or a whitelist, and a wrong guess could cut everyone off.
  var NETIS_HDR = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };
  function relaxed(t) { return JSON.parse(String(t).replace(/,\s*([}\]])/g, "$1")); }
  function b64text(v) { try { return decodeURIComponent(escape(atob(v))); } catch (e) { try { return atob(v); } catch (x) { return ""; } } }
  P._netisLogin = function () {
    var self = this;
    return this._req("/cgi-bin/login.cgi", "POST", NETIS_HDR, "password=" + encodeURIComponent(this.n.b64(this.password))).then(function (r) { return r.status === 200 && /SUCCESS/.test(r.text); });
  };
  P._netisGet = function (app) {
    var self = this, body = "mode_name=skk_get&wl_link=0&app=" + app;
    function once() { return self._req("/cgi-bin/skk_get.cgi", "POST", NETIS_HDR, body); }
    function ok(r) { return r.status === 200 && /^\s*\{/.test(r.text); }
    return once().then(function (r) {
      if (ok(r)) return relaxed(r.text);
      return self.login().then(function (good) {
        if (!good) throw new Error("Router login failed. Check the router password.");
        return once().then(function (r2) { if (!ok(r2)) throw new Error("Router still asks for a login after signing in."); return relaxed(r2.text); });
      });
    });
  };
  P._snapshotNetis = function () {
    var self = this;
    return this._netisGet("routerState").then(function (q) {
      var devices = (q.arpList || []).map(function (a) {
        var host = b64text(a.arp_host_name || "");
        return { mac: String(a.arp_mac).toLowerCase(), name: host || "Unknown", hostname: host, remark: "", ip: a.arp_ip || "", band: "", online: true, blocked: false,
          downKBps: 0, upKBps: 0, limitDownKBps: +a.qos_down_limit || 0, limitUpKBps: +a.qos_up_limit || 0, seconds: 0, readonly: true };
      });
      return self._netisGet("wlan").then(function (w) {
        var m = (w.wlan || [])[0] || {};
        return { ssid24: b64text(m.ssid || ""), ssid5: "", security: "", hidden: false, off: false };
      }, function () { return { ssid24: "", ssid5: "", security: "" }; }).then(function (wifi) {
        self._netisState = q;
        return { me: { localhostMAC: "" }, devices: devices, guests: [], wifi: wifi, filterMode: "deny" };
      });
    });
  };
  P._internetNetis = function () {
    var q = this._netisState ? Promise.resolve(this._netisState) : this._netisGet("routerState");
    return q.then(function (s) {
      var ip = s.st_wanIpAddr || "", hasIp = !!ip && ip !== "0.0.0.0", up = String(s.connected) === "1";
      return { state: hasIp && up ? "ok" : !hasIp ? "no_ip" : "no_internet", ip: hasIp ? ip : "", gateway: s.st_wanDefGw && s.st_wanDefGw !== "0.0.0.0" ? s.st_wanDefGw : "", dns: s.st_dns1 || "", type: "", linkMbps: 0, seconds: 0, code: "" };
    });
  };
  function netisNo() { return Promise.reject(new Error("This router (Netis) is view-only in this version.")); }
  P._snapshotF3 = function () {
    var self = this;
    return this._getJson("/goform/getQos?random=" + Math.random() + "&modules=" + encodeURIComponent("localhost,onlineList,blackList,macFilter")).then(function (q) {
      var myIp = (q.localhost || {}).localhost || "";
      function dev(d, blocked, online) {
        return { mac: String(d.qosListMac).toLowerCase(), name: d.qosListRemark || d.qosListHostname || "Unknown", hostname: d.qosListHostname || "", remark: d.qosListRemark || "",
          ip: d.qosListIP || "", band: d.qosListConnectType === "wires" ? "wired" : d.qosListConnectType === "wifi" ? "wifi" : "", online: online, blocked: blocked,
          downKBps: +d.qosListDownSpeed || 0, upKBps: +d.qosListUpSpeed || 0, limitDownKBps: +d.qosListDownLimit || 0, limitUpKBps: +d.qosListUpLimit || 0, seconds: 0 };
      }
      var devices = (q.onlineList || []).map(function (d) { return dev(d, d.qosListAccess === "false", true); });
      var seen = {}; devices.forEach(function (d) { seen[d.mac] = d; });
      (q.blackList || []).forEach(function (b) {
        if (!b.qosListMac) return;
        var mac = String(b.qosListMac).toLowerCase();
        if (seen[mac]) seen[mac].blocked = true; else devices.push(dev(b, true, false));
      });
      // The F3 does not tell us the phone's MAC, only its address. The device with that address is the one we reach the F3 through.
      var me = devices.filter(function (d) { return myIp && d.ip === myIp; })[0];
      var mf = q.macFilter || {};
      return self._wifiF3().then(function (w) { return { me: { localhostMAC: me ? me.mac : "" }, devices: devices, guests: [], wifi: w, filterMode: mf.curFilterMode === "pass" ? "pass" : "deny" }; });
    });
  };

  P.snapshot = function () {
    if (this.type === "netis") return this._snapshotNetis();
    if (this.type === "f3") return this._snapshotF3();
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
  // wanConnectStatus is a code. Characters 3-6 are a message code (same table as the router's own status page):
  //   xx01 WAN port disconnected, xx02 disconnected, xx03 connecting, xx04 connected/accessing, xx05 or xx08 no internet (ISP),
  //   xx06 connected and online, 0207 IP conflict, 0307 PPPoE user/password rejected. (xx: 01 static, 02 DHCP, 03 PPPoE.)
  // state: ok | unplugged | connecting | no_internet | ip_conflict | auth_failed | no_ip (fallback when the code is not known)
  P.internet = function () {
    if (this.type === "netis") return this._internetNetis();
    return this._getJson("/goform/getStatus?random=" + Math.random() + "&modules=" + encodeURIComponent(this.type === "f3" ? "internetStatus,systemInfo,wanAdvCfg" : "internetStatus,systemInfo,wanAdvCfg,sysTime")).then(function (q) {
      var si = q.systemInfo || {}, adv = q.wanAdvCfg || {}, is = q.internetStatus || {}, st = q.sysTime || {};
      var code = String(is.wanConnectStatus || ""), msg = code.slice(3, 7), kind = msg.slice(0, 2), n = msg.slice(2);
      var ip = si.statusWanIP || "", hasIp = !!ip && ip !== "0.0.0.0", net = st.internetState !== "false";
      var state;
      if (/^0[1-3](0[1-8])$/.test(msg)) {
        state = { "01": "unplugged", "02": "connecting", "03": "connecting", "04": "connecting", "05": "no_internet", "06": "ok", "07": kind === "03" ? "auth_failed" : "ip_conflict", "08": "no_internet" }[n];
      } else state = !hasIp ? "no_ip" : !net ? "no_internet" : "ok";
      return { state: state, ip: hasIp ? ip : "", gateway: si.statusWanGaterway || "", dns: si.statusWanDns1 || "", type: si.wanType || "", linkMbps: +adv.wanSpeedCurrent || 0, seconds: +si.wanConnectTime || 0, code: code };
    });
  };

  // Rows are "hostname<TAB>remark<TAB>MAC<TAB>down<TAB>up<TAB>allowed". Several rows are joined with a newline.
  function row(d, allowed, zero) {
    return [d.hostname || "Unknown", d.name || "", d.mac.toUpperCase(), zero ? 0 : (d.limitDownKBps || 0), zero ? 0 : (d.limitUpKBps || 0), allowed].join("\t");
  }
  // Tenda F3: POST /goform/setQos with module1=onlineList&qosList=rows. Row = hostname TAB remark TAB MAC TAB upLimit TAB downLimit TAB true|false.
  // Blocked = 0, 0, false. No limit = 38528. (Recorded page logic; the F3 allows at most 10 blocked devices.)
  function capF3(x) { return !(x > 0) || x >= UNLIMITED ? UNLIMITED : Math.round(x); }
  P._applyF3 = function (devices) {
    var blockedN = devices.filter(function (d) { return d.blocked; }).length;
    if (blockedN > 10) return Promise.reject(new Error("The F3 can block at most 10 devices."));
    var rows = devices.map(function (d) {
      return d.blocked ? [d.hostname || "", d.remark || "", d.mac, 0, 0, "false"].join("\t")
        : [d.hostname || "", d.remark || "", d.mac, capF3(d.limitUpKBps), capF3(d.limitDownKBps), "true"].join("\t");
    });
    return this._post("/goform/setQos", "module1=onlineList&qosList=" + encodeURIComponent(rows.join("\n")));
  };
  P.apply = function (devices) {
    if (this.type === "netis") return netisNo();
    if (this.type === "f3") return this._applyF3(devices);
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
  // Router-side name (the "remark" column). Plain ASCII only, so the router can never garble it or be fed control characters.
  RouterClient.cleanName = function (v) { return String(v == null ? "" : v).replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").trim().slice(0, 20); };
  P.setRemark = function (mac, name) {
    var n = RouterClient.cleanName(name);
    if (!n) return Promise.reject(new Error("Invalid name"));
    return this._change(mac, function (d) { d.remark = n; });
  };
  P.setLimit = function (mac, kbps) {
    return this._change(mac, function (d) { d.limitDownKBps = d.limitUpKBps = kbps > 0 ? Math.round(kbps) : UNLIMITED; });
  };

  // ---- MAC filter: blacklist ("deny": listed devices are kept out) or whitelist ("pass": only listed devices get in).
  // Recorded from the router's Advanced page: GET /goform/getNAT, and POST /goform/setNAT which always carries ALL the
  // modules of that page, so we read the current values first and send them back unchanged. Only module6 changes.
  var NAT_MODULES = "staticIPList,IPTV,portList,ddns,dmz,upnp,lanCfg,macFilter,localhost,wifiRelay,onlineList,ping,productInfo";
  var NAT_MODULES_F3 = "wifiRelay,staticIPList,portList,macFilter,localhost,onlineList,ddns,dmz,ping,upnp,lanCfg,apIsolation";
  P._nat = function () { return this._getJson("/goform/getNAT?random=" + Math.random() + "&modules=" + encodeURIComponent(this.type === "f3" ? NAT_MODULES_F3 : NAT_MODULES)); };
  function natView(n) {
    var mf = n.macFilter || {}, names = {};
    (n.onlineList || []).forEach(function (o) { names[String(o.qosListMac).toLowerCase()] = { hostname: o.qosListHostname, remark: o.qosListRemark }; });
    var list = (mf.macFilterList || []).map(function (m) { return { mac: String(m.mac).toLowerCase(), hostname: m.hostname == null ? "Unknown" : m.hostname, remark: m.remark || "" }; });
    return { mode: mf.curFilterMode === "pass" ? "pass" : "deny", list: list, me: ((n.localhost || {}).localhostMAC || "").toLowerCase(), names: names };
  }
  P.getFilter = function () { if (this.type === "netis") return netisNo(); return this._nat().then(function (n) { var v = natView(n); return { mode: v.mode, list: v.list, me: v.me }; }); };
  // The save command always carries every setting of that page, so we send back what the router told us, changing only the MAC filter.
  // AC5 order: module6=macFilter ... ; F3 order (recorded): module8=macFilter, module6=ping, module7=apIsolation.
  function natForm(n, f3, mode, rows) {
    var dd = n.ddns || {}, e = encodeURIComponent, F = function (x) { return e(x == null ? "" : String(x)); };
    var list = e(rows.length ? rows.join("\n") + "\n" : "");
    var common = "&module1=staticIPList&staticList=&module2=portList&portList=" +
      "&module3=dmz&dmzEn=" + F((n.dmz || {}).dmzEn) + "&dmzHostIP=" + F((n.dmz || {}).dmzHostIP) +
      "&module4=ddns&ddnsEn=" + F(dd.ddnsEn) + "&ddnsServiceName=" + F(dd.ddnsServiceName) + "&ddnsServer=" + F(dd.ddnsServer) + "&ddnsUser=" + F(dd.ddnsUser) + "&ddnsPwd=" + F(dd.ddnsPwd) +
      "&module5=upnp&upnpEn=" + F((n.upnp || {}).upnpEn);
    if (f3) return "module8=macFilter&filterMode=" + mode + "&macFilterList=" + list + common + "&module6=ping&pingEn=" + F((n.ping || {}).pingEn) + "&module7=apIsolation&apIsolationEn=" + F((n.apIsolation || {}).apIsolationEn);
    return "module6=macFilter&filterMode=" + mode + "&macFilterList=" + list + "&module8=ping&pingEn=" + F((n.ping || {}).pingEn) + common + "&module7=IPTV&IPTVEn=false&VLANArea=&VLANID=&VLANSelect=";
  }
  P.setFilter = function (mode, macs) {
    if (this.type === "netis") return netisNo();
    var self = this, f3 = this.type === "f3";
    if (mode !== "pass" && mode !== "deny") return Promise.reject(new Error("Unknown mode"));
    return this._nat().then(function (n) {
      var v = natView(n), want = [];
      (macs || []).forEach(function (m) { m = String(m).toLowerCase(); if (want.indexOf(m) < 0) want.push(m); });
      if (mode === "pass") { if (v.me && want.indexOf(v.me) < 0) want.push(v.me); }
      else if (v.me && want.indexOf(v.me) > -1) throw new Error("This is the device the app reaches the router through. Blacklisting it would lock you out.");
      if (mode === "pass" && !want.length) throw new Error("The whitelist is empty. Everyone would be blocked.");
      if ((n.staticIPList || []).length || (n.portList || []).length || (!f3 && n.IPTV && String(n.IPTV.IPTVEn) === "true"))
        throw new Error("Your router has static IP, port forwarding or IPTV settings. This app cannot rewrite them safely, so it stopped.");
      var known = {}; v.list.forEach(function (m) { known[m.mac] = m; });
      function rowFor(m) { var k = known[m] || v.names[m] || {}; return [k.hostname == null ? "Unknown" : k.hostname, k.remark || "", m].join("\t"); }
      var rows = want.map(rowFor), before = { mode: v.mode, rows: v.list.map(function (m) { return rowFor(m.mac); }) };
      return self._post("/goform/setNAT", natForm(n, f3, mode, rows)).then(function (r) {
        if (!f3) return r;
        // The F3 format was not recorded for a non-empty list, so check the result and put the old list back if it does not match.
        return self._nat().then(function (n2) {
          var v2 = natView(n2), got = v2.list.map(function (m) { return m.mac; }).sort().join(","), exp = want.slice().sort().join(",");
          if (v2.mode === mode && got === exp) return r;
          return self._post("/goform/setNAT", natForm(n, f3, before.mode, before.rows)).then(function () {
            throw new Error("The F3 did not accept that change. The previous list was restored. Please check it on the router page.");
          });
        });
      });
    });
  };

  RouterClient.UNLIMITED = UNLIMITED;
  return RouterClient;
});
