const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'groups.json');

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '{}', 'utf8');
}
function readAll() {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function writeAll(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}
function getGroup(id) {
  const all = readAll();
  return all[id] || { antilink: false, antispam: false, rules: 'Respekte tout manm. Pa voye lyen san pèmisyon. Swiv direktiv administratè yo.', warns: {} };
}
function updateGroup(id, patch) {
  const all = readAll();
  all[id] = { ...getGroup(id), ...patch };
  writeAll(all);
  return all[id];
}
module.exports = { getGroup, updateGroup };
