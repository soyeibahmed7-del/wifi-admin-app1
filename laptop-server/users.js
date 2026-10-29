// Accounts stored in users.json with scrypt-hashed passwords.
// Add a user:    node users.js add <name> <password> [admin|viewer]
// Remove a user: node users.js remove <name>      List users: node users.js list
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const FILE = path.join(__dirname, "users.json");
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return {}; } };
const save = (u) => fs.writeFileSync(FILE, JSON.stringify(u, null, 2), { mode: 0o600 });
function hash(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString("hex"); }
function add(name, pw, role) {
  if (!/^[a-z0-9_.-]{3,32}$/i.test(name)) throw new Error("Name: 3 to 32 letters, digits, dot, dash or underscore");
  if (String(pw).length < 8) throw new Error("Password needs at least 8 characters");
  const u = load(), salt = crypto.randomBytes(16).toString("hex");
  u[name.toLowerCase()] = { salt, hash: hash(pw, salt), role: role === "viewer" ? "viewer" : "admin" };
  save(u);
}
function verify(name, pw) {
  const u = load()[String(name).toLowerCase()];
  const salt = u ? u.salt : "0".repeat(32), h = hash(String(pw), salt); // same work for unknown names
  if (!u) return null;
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(u.hash, "hex")) ? { name: String(name).toLowerCase(), role: u.role } : null;
}
module.exports = { add, verify, load, save };
if (require.main === module) {
  const [cmd, name, pw, role] = process.argv.slice(2);
  try {
    if (cmd === "add") { add(name, pw, role); console.log("Saved user", name); }
    else if (cmd === "remove") { const u = load(); delete u[String(name).toLowerCase()]; save(u); console.log("Removed", name); }
    else if (cmd === "list") console.log(Object.entries(load()).map(([n, v]) => n + " (" + v.role + ")").join("\n") || "No users yet");
    else console.log("Usage: node users.js add <name> <password> [admin|viewer] | remove <name> | list");
  } catch (e) { console.error(e.message); process.exit(1); }
}
