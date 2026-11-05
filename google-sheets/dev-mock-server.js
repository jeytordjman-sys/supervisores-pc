// Servidor de testes: executa Code.gs em Node com imitações dos serviços Google (folhas em memória).
// Serve para testar a app de ponta a ponta sem tocar na folha real:
//   node google-sheets/dev-mock-server.js            → http://127.0.0.1:8767/exec
//   config.js: window.GAS_CONFIG = {url: "http://127.0.0.1:8767/exec"};
// Inspeção: GET /_mails (e-mails «enviados») · GET /_sheet?name=log (conteúdo de uma folha) · GET /_run?fn=weeklyAgenda
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const PORT = +process.env.PORT || 8767;

class Range {
  constructor(sh, r, c, nr, nc){ Object.assign(this, {sh, r, c, nr, nc}); }
  getValues(){ const out = []; for (let i=0;i<this.nr;i++){ const row = []; for (let j=0;j<this.nc;j++) row.push((this.sh.data[this.r-1+i]||[])[this.c-1+j] ?? ""); out.push(row); } return out; }
  setValues(v){
    if (this.r+this.nr-1 > this.sh.maxRows) throw new Error("Range fora da folha (linhas)");
    if (v.length !== this.nr || v.some(x => x.length !== this.nc)) throw new Error("setValues: dimensões erradas");
    v.forEach((row, i) => { const R = this.sh.data[this.r-1+i] = this.sh.data[this.r-1+i] || []; row.forEach((val, j) => {
      if (typeof val !== "string") throw new Error("Valor não-texto escrito na folha: " + typeof val);
      if (/^[=]/.test(val)) throw new Error("Fórmula escrita na folha: " + val.slice(0,40));
      R[this.c-1+j] = val.replace(/^'/, ""); // o Sheets guarda o texto sem o apóstrofo inicial
    }); });
    return this;
  }
  clearContent(){ for (let i=0;i<this.nr;i++){ const R = this.sh.data[this.r-1+i]; if (R) for (let j=0;j<this.nc;j++) R[this.c-1+j] = ""; } return this; }
  setNumberFormat(){ return this; } setFontWeight(){ return this; }
}
class Sheet {
  constructor(name){ this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
  getLastRow(){ for (let i=this.data.length-1;i>=0;i--) if ((this.data[i]||[]).some(v => v !== "" && v != null)) return i+1; return 0; }
  getLastColumn(){ let m = 0; this.data.forEach(r => (r||[]).forEach((v,j) => { if (v !== "" && v != null) m = Math.max(m, j+1); })); return m; }
  getMaxRows(){ return this.maxRows; } getMaxColumns(){ return this.maxCols; }
  getRange(r, c, nr=1, nc=1){ return new Range(this, r, c, nr, nc); }
  getDataRange(){ return new Range(this, 1, 1, Math.max(this.getLastRow(),1), Math.max(this.getLastColumn(),1)); }
  insertRowsAfter(n, k){ this.maxRows += k; } deleteRow(r){ this.data.splice(r-1, 1); } setFrozenRows(){}
}
const book = { sheets: [new Sheet("Sheet1")],
  getSheetByName(n){ return this.sheets.find(s => s.name === n) || null; },
  insertSheet(n){ const s = new Sheet(n); this.sheets.push(s); return s; },
  getSheets(){ return this.sheets; }, deleteSheet(s){ this.sheets = this.sheets.filter(x => x !== s); } };
const mails = [], propsMap = process.env.IMPORT_KEY ? {IMPORT_KEY: process.env.IMPORT_KEY} : {}, cacheMap = {}, files = [];
const parts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false, weekday:"short"}).formatToParts(d).map(p => [p.type, p.value]));
const ctx = {
  console, JSON, Date, Math, Object, Array, String, Number, Error, isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: () => book },
  Utilities: {
    DigestAlgorithm: {SHA_256: "sha256"}, Charset: {UTF_8: "utf8"},
    computeDigest: (alg, s) => [...crypto.createHash("sha256").update(String(s), "utf8").digest()].map(b => b > 127 ? b-256 : b),
    formatDate: (d, tz, f) => { const p = parts(d, tz); const h = p.hour === "24" ? "00" : p.hour;
      if (f === "u") return String(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(p.weekday)+1);
      if (f === "yyyy-MM-dd") return `${p.year}-${p.month}-${p.day}`;
      return `${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}`; },
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => [...Buffer.from(s, "base64")],
    newBlob: (bytes, type, name) => ({bytes, type, name}),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => propsMap[k] ?? null, setProperty: (k,v) => { propsMap[k] = String(v); } }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheMap[k] ?? null, put: (k,v) => { cacheMap[k] = String(v); }, remove: k => { delete cacheMap[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  MailApp: { sendEmail: (to, subject, body, opt) => { if (!to) throw new Error("sem destinatário"); mails.push({to, subject, body, opt, at: new Date().toISOString()}); console.log("✉ ", to, "|", subject); }, getRemainingDailyQuota: () => 100 },
  DriveApp: { Access: {ANYONE_WITH_LINK: 1}, Permission: {VIEW: 1},
    createFolder: n => ({ getId: () => "folder1", createFile: b => { const id = "file" + (files.push(b)); return { getId: () => id, setSharing(){} }; } }),
    getFolderById: () => ({ getId: () => "folder1", createFile: b => { const id = "file" + (files.push(b)); return { getId: () => id, setSharing(){} }; } }) },
  ScriptApp: { WeekDay: {MONDAY: 1}, getProjectTriggers: () => [], deleteTrigger(){},
    newTrigger: () => { const t = { timeBased: () => t, onWeekDay: () => t, atHour: () => t, nearMinute: () => t, everyDays: () => t, inTimezone: () => t, create(){} }; return t; } },
  ContentService: { MimeType: {JSON: "json"}, createTextOutput: s => ({ text: s, setMimeType(){ return this; } }) },
  Logger: { log: (...a) => console.log("[Logger]", ...a) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "Code.gs"), "utf8"), ctx, {filename: "Code.gs"});
vm.runInContext("setup(); carregarLojasExemplo();", ctx);

const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type"};
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS"){ res.writeHead(204, cors); return res.end(); }
  if (req.method === "GET" && u.pathname === "/_mails"){ res.writeHead(200, {...cors, "content-type": "application/json"}); return res.end(JSON.stringify(mails, null, 1)); }
  if (req.method === "GET" && u.pathname === "/_sheet"){ const s = book.getSheetByName(u.searchParams.get("name")); res.writeHead(200, {...cors, "content-type": "application/json"}); return res.end(JSON.stringify(s ? s.data : null)); }
  if (req.method === "GET" && u.pathname === "/_run"){ let out = "ok"; try { vm.runInContext(u.searchParams.get("fn").replace(/\W/g,"") + "()", ctx); } catch(e){ out = String(e.stack||e); } res.writeHead(200, cors); return res.end(out); }
  if (req.method === "GET"){ res.writeHead(200, cors); return res.end(vm.runInContext("doGet().text", ctx)); }
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    ctx.__req = {postData: {contents: body}};
    let out; try { out = vm.runInContext("doPost(__req).text", ctx); } catch(e){ out = JSON.stringify({ok:false, error:String(e.stack||e), code:"crash"}); }
    const a = (() => { try { return JSON.parse(body).action; } catch(e){ return "?"; } })();
    console.log("→", a, out.length > 160 ? out.slice(0,160)+"…" : out);
    res.writeHead(200, {...cors, "content-type": "application/json"}); res.end(out);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Mock Apps Script em http://127.0.0.1:${PORT}/exec`));
