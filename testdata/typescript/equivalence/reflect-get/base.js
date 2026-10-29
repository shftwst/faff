const fs = require("fs");
function code(p) {
  try { fs.statSync(p); return null; } catch (e) { return e.code; }
}
module.exports = { code };
