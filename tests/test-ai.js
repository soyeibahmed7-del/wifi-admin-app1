// Tests for the AI tool layer with a fake router environment and a fake Gemini backend.
const AI = require("../app/src/main/assets/ai-tools.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } else console.log("ok:", m); };
const knownSet = new Set();
function mk(type) {
  const devs = [
    { rid: "r1", rname: "R", mac: "aa:aa:aa:aa:aa:01", name: "Asma Phone", ip: "192.168.0.101", online: true, blocked: false, downKBps: 300, upKBps: 10, limitDownKBps: 38528 },
    { rid: "r1", rname: "R", mac: "aa:aa:aa:aa:aa:02", name: "Laptop", ip: "192.168.0.102", online: true, blocked: false, downKBps: 20, upKBps: 5, limitDownKBps: 38528 },
    { rid: "r1", rname: "R", mac: "aa:aa:aa:aa:aa:03", name: "Laptop 2", ip: "192.168.0.103", online: true, blocked: false, downKBps: 0, upKBps: 0, limitDownKBps: 38528 },
    { rid: "r1", rname: "R", mac: "aa:aa:aa:aa:aa:04", name: "ControlPhone", ip: "192.168.0.104", online: true, blocked: false, downKBps: 1, upKBps: 1, limitDownKBps: 38528 },
  ];
  let filter = { mode: "deny", list: [] }; const lie = { on: false };
  const env = {
    devices: () => devs, routers: () => [{ id: "r1", name: "R", type, host: "192.168.0.1" }],
    isMe: d => d.mac.endsWith("04"), known: m => knownSet.has(m), setKnown: (m, on) => (on ? knownSet.add(m) : knownSet.delete(m)), health: () => ({ score: 90 }),
    poll: async () => {},
    api: async (path, b) => {
      if (lie.on) return {};                                   // router "accepts" but changes nothing
      if (path === "/api/block") { devs.find(d => d.mac === b.mac).blocked = b.blocked; return { ok: true }; }
      if (path === "/api/rename") { devs.find(d => d.mac === b.mac).name = b.name; return { ok: true }; }
      if (path === "/api/limit") { devs.find(d => d.mac === b.mac).limitDownKBps = b.kbps || 38528; return { ok: true }; }
      if (path === "/api/filter") return JSON.parse(JSON.stringify(filter));
      if (path === "/api/filter/set") { filter = { mode: b.mode, list: b.macs.map(m => ({ mac: m, remark: devs.find(d => d.mac === m)?.name || "" })) }; return { ok: true }; }
    },
  };
  return { env, devs, lie, setMode: m => (filter.mode = m) };
}
(async () => {
  for (const type of ["ac5", "f3"]) {
    console.log("---", type);
    const { env, devs, lie, setMode } = mk(type), T = AI.Tools(env);
    let r = await T.execute("block_device", { device: "asma" }); ok(r.ok && r.verified && devs[0].blocked, type + ": block by name verified");
    r = await T.execute("unblock_device", { device: "192.168.0.101" }); ok(r.ok && !devs[0].blocked, type + ": unblock by IP");
    r = await T.execute("block_device", { device: "lap" }); ok(!r.ok && r.error === "ambiguous_device" && r.candidates.length === 2, type + ": ambiguous name asks which");
    r = await T.execute("block_device", { device: "this phone" }); ok(!r.ok && r.error === "blocked_by_safety_rule" && !devs[3].blocked, type + ": never blocks controlling phone");
    r = await T.execute("block_device", { device: "ControlPhone" }); ok(r.error === "blocked_by_safety_rule", type + ": by name also refused");
    r = await T.execute("blacklist_add", { device: "aa:aa:aa:aa:aa:04" }); ok(r.error === "blocked_by_safety_rule", type + ": blacklist of controlling phone refused");
    r = await T.execute("blacklist_add", { device: "Laptop 2" }); ok(r.ok && r.verified, type + ": blacklist add verified");
    r = await T.execute("blacklist_show", {}); ok(r.access_lists[0].entries.length === 1 && r.access_lists[0].mode === "blacklist", type + ": blacklist shown");
    r = await T.execute("blacklist_remove", { device: "Laptop 2" }); ok(r.ok && r.verified, type + ": blacklist remove verified");
    setMode("pass"); r = await T.execute("blacklist_add", { device: "asma" }); ok(r.error === "router_in_whitelist_mode", type + ": refuses in whitelist mode"); setMode("deny");
    r = await T.execute("set_speed_limit", { device: "asma", mbps: 2 }); ok(r.ok && r.limit_mbps > 1.8 && r.limit_mbps < 2.2, type + ": speed limit verified");
    r = await T.execute("set_speed_limit", { device: "asma", mbps: 0 }); ok(r.ok && r.limit_mbps === 0, type + ": limit removed");
    r = await T.execute("set_speed_limit", { device: "asma", mbps: -5 }); ok(r.error === "invalid_value", type + ": rejects invalid mbps");
    r = await T.execute("rename_device", { device: "asma", name: "Asma Mobile" }); ok(r.ok && r.verified && devs[0].name === "Asma Mobile", type + ": rename verified");
    r = await T.execute("rename_device", { device: "Asma Mobile", name: "<script>\tx\n" }); ok(r.ok && devs[0].name === "scriptx", type + ": rename strips unsafe characters");
    devs[0].name = "Asma Phone";
    r = await T.execute("rename_device", { device: "Asma", name: "\u09a6\u09be" }); ok(r.error === "invalid_name", type + ": rename rejects non-ASCII only name");
    devs[0].name = "Asma Phone";
    r = await T.execute("mark_known", { device: "asma" }); ok(r.ok && knownSet.has(devs[0].mac), type + ": mark known");
    r = await T.execute("mark_unknown", { device: "asma" }); ok(r.ok && !knownSet.has(devs[0].mac), type + ": mark unknown");
    r = await T.execute("mark_known", { device: "all" }); ok(r.ok && r.count === 4, type + ": mark all online known"); knownSet.clear();
    r = await T.execute("top_bandwidth", {}); ok(r.top[0].name === "Asma Phone", type + ": top bandwidth");
    r = await T.execute("rm -rf", {}); ok(r.error === "unknown_function", type + ": unknown function rejected");
    lie.on = true; r = await T.execute("block_device", { device: "asma" }); ok(!r.ok && r.error === "router_did_not_apply_change", type + ": router ignoring change is NOT reported as success"); lie.on = false;
    r = await T.execute("block_device", { device: "nobody" }); ok(r.error === "device_not_found", type + ": unknown device");
  }
  // Agent loop with a fake Gemini
  const { env, devs } = mk("ac5"), T = AI.Tools(env); let step = 0, seenState = "";
  const http = async (m, u, h, body) => {
    const b = JSON.parse(body); seenState = b.systemInstruction.parts[0].text; step++;
    if (h.Authorization !== "Bearer tok") return { status: 401, text: "{}" };
    if (step === 1) return { status: 200, text: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "block_device", args: { device: "asma" } } }] } }] }) };
    const last = b.contents[b.contents.length - 1].parts[0].functionResponse;
    return { status: 200, text: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: last.response.ok ? "Blocked." : "Failed" }] } }] }) };
  };
  const ag = AI.Agent({ url: "https://x", token: "tok" }, http, T, () => ({ devices: [] }));
  let res = await ag.ask([], "block asma"); ok(res.text === "Blocked." && devs[0].blocked && res.actions[0].result.verified, "agent: model tool call executed and verified");
  ok(!/secret|password/i.test(JSON.stringify(AI.DECLARATIONS)), "declarations expose no secrets");
  const bad = AI.Agent({ url: "https://x", token: "wrong" }, http, T, () => ({})); let err = ""; try { await bad.ask([], "hi"); } catch (e) { err = e.message; } ok(err === "ai_auth", "agent: wrong token -> ai_auth");
  const a = AI.analyze({ devices: [{ rid: "r1", online: true, mac: "x", name: "TV", downKBps: 900, upKBps: 0 }, { rid: "r1", online: true, mac: "y", name: "P", downKBps: 10, upKBps: 0 }], known: () => false, routers: [{ id: "r1", name: "R", net: { state: "unplugged" }, wifi: { security: "none" } }] });
  ok(a.items.some(i => i.key === "h_net") && a.items.some(i => i.key === "h_open") && a.items.some(i => i.key === "h_heavy") && a.score < 50, "analyze: finds unplugged WAN, open WiFi, heavy user");
  console.log(fails ? "FAILED " + fails : "AI TESTS PASSED"); process.exit(fails ? 1 : 0);
})();
