/**
 * Supervisores P&C — backend Google Sheets + Apps Script (100 % gratuito).
 *
 * Instalação (ver google-sheets/README-instalacao.md):
 *   1. Criar uma folha Google nova → Extensões → Apps Script → colar este ficheiro.
 *   2. Executar a função  setup  (autorizar quando pedido).
 *   3. Implementar → Nova implementação → App Web → Executar como: Eu · Acesso: Qualquer pessoa.
 *   4. Copiar o URL …/exec para config.js da app (window.GAS_CONFIG = {url: "…"}).
 *
 * Os dados ficam nas folhas (uma por tabela); a folha «log» é o histórico de tudo o que cada conta fez
 * e a folha «audit» guarda o antes/depois de cada linha alterada. Os e-mails partem da conta Google
 * que instalou o script (MailApp, 100 destinatários/dia nas contas gratuitas).
 */

const TZ = 'Europe/Lisbon';
const APP_NAME = 'Supervisores P&C';
const SESSION_DAYS = 30;

// Tipos: s texto · n número · b booleano · ja lista JSON · jo objeto JSON
const SCHEMA = {
  users:    {id:'s',name:'s',email:'s',phone:'s',role:'s',active:'b',createdAt:'s',salt:'s',hash:'s',lastReset:'s'},
  settings: {id:'n',cadA:'n',cadB:'n',cadC:'n',dormant:'n',noShip:'n',dueSoon:'n',maxNoVisit:'n',reasons:'ja',trainings:'ja',sedeEmail:'s'},
  items:    {id:'n',label:'s',action:'s',days:'n',owner:'s',active:'b'},
  stores:   {id:'n',name:'s',code:'s',city:'s',address:'s',phone:'s',hours:'s',team:'n',manager:'s',email:'s',cad:'s',tempCad:'s',tempUntil:'s',sup:'s',active:'b',lat:'n',lng:'n',priority:'s',notes:'s'},
  planned:  {id:'n',store:'n',sup:'s',date:'s',time:'s',reason:'s',notes:'s',visitId:'n'},
  visits:   {id:'n',store:'n',sup:'s',at:'s',reason:'s',rating:'n',comment:'s',bad:'ja',photos:'ja',lat:'n',lng:'n',sent:'b',sentVia:'ja',extra:'jo'},
  actions:  {id:'n',store:'n',visit:'n',item:'n',title:'s',owner:'s',status:'s',due:'s',notes:'s'},
  stock:    {site:'s',ref:'s',des:'s',qty:'n',last:'s',top:'b'},
  shipments:{no:'s',site:'s',date:'s',lines:'n',sent:'n',recv:'n',status:'s'},
  kpis:     {site:'s',month:'s',sales:'n',target:'n',traffic:'n',tickets:'n'},
  imports:  {id:'n',kind:'s',at:'s',rows:'n',unknown:'ja'},
  outbox:   {id:'n',at:'s',to:'s',toEmail:'s',ccEmail:'s',toUser:'s',subject:'s',body:'s',visit:'n',status:'s',sentAt:'s',error:'s'},
  log:      {id:'n',at:'s',user:'s',userName:'s',entity:'s',action:'s',detail:'s',store:'n'},
  audit:    {at:'s',user:'s',userName:'s',table:'s',op:'s',id:'s',before:'s',after:'s'},
  sessions: {tokenHash:'s',user:'s',expires:'s'}
};
const KEYS = {stock:['site','ref'], shipments:['no'], kpis:['site','month'], sessions:['tokenHash']};
const AUDITED = {users:1,settings:1,items:1,stores:1,planned:1,visits:1,actions:1};
const DEFAULT_SETTINGS = {id:1,cadA:14,cadB:30,cadC:91,dormant:90,noShip:14,dueSoon:7,maxNoVisit:30,
  reasons:['Visita de cadência','Acompanhamento de ações','Abertura / formação da equipa','Incidente ou reclamação','Inventário / stock','Campanha / merchandising','Outro'],
  trainings:['Produto / marcas','Técnica de venda','Caixa / sistema','Atendimento','Merchandising'], sedeEmail:''};

// ------------------------------------------------------------------ utilitários
function fail(code, msg){ const e = new Error(msg); e.code = code; return e; }
function nowIso(){ return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function todayIso(){ return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function genId(){ return Date.now()*1000 + Math.floor(Math.random()*1000); }
function props(){ return PropertiesService.getScriptProperties(); }
function bumpVer(){ const v = String(Date.now()); props().setProperty('ver', v); return v; }
function getVer(){ return props().getProperty('ver') || '0'; }
function sha(s){ return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function(b){ return ('0'+(b&255).toString(16)).slice(-2); }).join(''); }
function hashPw(pw, salt){ let h = salt + pw; for (let i=0;i<300;i++) h = sha(salt + h); return h; }
function normEmail(e){ return String(e||'').trim().toLowerCase(); }
function ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function daysBetween(a, b){ return Math.round((new Date(String(b).slice(0,10)+'T00:00:00') - new Date(String(a).slice(0,10)+'T00:00:00'))/86400000); }
function addDaysIso(d, n){ const x = new Date(String(d).slice(0,10)+'T12:00:00'); x.setDate(x.getDate()+n); return Utilities.formatDate(x, TZ, 'yyyy-MM-dd'); }
function fmtDay(d){ const s = String(d).slice(0,10).split('-'); return s[2]+'/'+s[1]; }
function fmtDate(d){ const s = String(d).slice(0,10).split('-'); return s[2]+'/'+s[1]+'/'+s[0]; }

// ------------------------------------------------------------------ folhas como tabelas
function dec(type, v){
  if (v instanceof Date) v = Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  if (type === 'n'){ if (v === '' || v === null) return null; const n = Number(String(v).replace(/^'/,'')); return isNaN(n) ? null : n; }
  if (type === 'b') return v === true || String(v).toLowerCase() === 'true';
  if (type === 'ja' || type === 'jo'){ try { const j = JSON.parse(String(v)); if (j && typeof j === 'object') return j; } catch(e){} return type === 'ja' ? [] : {}; }
  return String(v === null || v === undefined ? '' : v).replace(/^'(?=[=+\-@'])/, '');
}
function enc(type, v){
  if (v === null || v === undefined) return '';
  if (type === 'n') return v === '' ? '' : String(v);
  if (type === 'b') return v ? 'true' : 'false';
  if (type === 'ja' || type === 'jo') return JSON.stringify(v).slice(0, 49000);
  const s = String(v).slice(0, 49000);
  return /^[=+\-@']/.test(s) ? "'" + s : s; // nunca deixar texto de utilizador virar fórmula
}
function ensureSheet(name){
  let sh = ss().getSheetByName(name);
  if (!sh) sh = ss().insertSheet(name);
  const cols = Object.keys(SCHEMA[name]);
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1,1,1,lastCol).getValues()[0].map(String) : [];
  const missing = cols.filter(function(c){ return head.indexOf(c) < 0; });
  if (missing.length) sh.getRange(1, head.length+1, 1, missing.length).setValues([missing]);
  sh.getRange(1,1,sh.getMaxRows(),sh.getMaxColumns()).setNumberFormat('@');
  sh.setFrozenRows(1);
  sh.getRange(1,1,1,sh.getLastColumn()).setFontWeight('bold');
  return sh;
}
let _tables = {};
function table(name){
  if (_tables[name]) return _tables[name];
  const sh = ss().getSheetByName(name);
  if (!sh) throw fail('bad', 'Folha «'+name+'» em falta: execute a função setup no editor Apps Script.');
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(String), sch = SCHEMA[name], rows = [];
  for (let i=1;i<vals.length;i++){
    if (vals[i].join('') === '') continue;
    const o = {};
    head.forEach(function(h,c){ if (sch[h]) o[h] = dec(sch[h], vals[i][c]); });
    rows.push({o:o, r:i+1, dirty:false});
  }
  return _tables[name] = {name:name, sh:sh, head:head, rows:rows, deleted:[], replaced:false};
}
function all(name){ return table(name).rows.map(function(x){ return x.o; }); }
function keyOf(name, o){ return (KEYS[name]||['id']).map(function(k){ return String(o[k]); }).join('\u0001'); }
function findRow(name, o){ const k = keyOf(name, o); return table(name).rows.filter(function(x){ return keyOf(name, x.o) === k; })[0]; }
function upsert(name, row){
  const x = findRow(name, row);
  if (x){ const before = JSON.parse(JSON.stringify(x.o)); Object.keys(row).forEach(function(k){ if (SCHEMA[name][k]) x.o[k] = row[k]; }); x.dirty = true; return {before:before, row:x.o}; }
  const o = {}; Object.keys(SCHEMA[name]).forEach(function(k){ o[k] = row[k] === undefined ? null : row[k]; });
  table(name).rows.push({o:o, r:0, dirty:false});
  return {before:null, row:o};
}
function removeRow(name, o){
  const t = table(name), x = findRow(name, o); if (!x) return null;
  if (x.r) t.deleted.push(x.r);
  t.rows = t.rows.filter(function(y){ return y !== x; });
  return x.o;
}
function replaceAll(name, rows){
  const t = table(name); t.replaced = true;
  t.rows = rows.map(function(r){ const o = {}; Object.keys(SCHEMA[name]).forEach(function(k){ o[k] = r[k] === undefined ? null : r[k]; }); return {o:o, r:0, dirty:false}; });
}
function toArr(t, o){ const sch = SCHEMA[t.name]; return t.head.map(function(h){ return sch[h] ? enc(sch[h], o[h]) : ''; }); }
function room(sh, lastNeeded, cols){
  const max = sh.getMaxRows();
  if (lastNeeded > max){ sh.insertRowsAfter(max, lastNeeded - max); sh.getRange(max+1, 1, lastNeeded-max, cols).setNumberFormat('@'); }
}
function flush(){
  Object.keys(_tables).forEach(function(name){
    const t = _tables[name], w = t.head.length;
    if (t.replaced){
      const last = t.sh.getLastRow(); if (last > 1) t.sh.getRange(2,1,last-1,w).clearContent();
      if (t.rows.length){ room(t.sh, t.rows.length+1, w); t.sh.getRange(2,1,t.rows.length,w).setValues(t.rows.map(function(x){ return toArr(t, x.o); })); }
      return;
    }
    t.rows.forEach(function(x){ if (x.dirty && x.r) t.sh.getRange(x.r,1,1,w).setValues([toArr(t, x.o)]); });
    t.deleted.sort(function(a,b){ return b-a; }).forEach(function(r){ t.sh.deleteRow(r); });
    const add = t.rows.filter(function(x){ return !x.r; });
    if (add.length){ const start = t.sh.getLastRow()+1; room(t.sh, start+add.length-1, w); t.sh.getRange(start,1,add.length,w).setValues(add.map(function(x){ return toArr(t, x.o); })); }
  });
  // folhas só-de-acréscimo (log, audit): escreve no fim sem ler a folha inteira
  Object.keys(_appends).forEach(function(name){
    const sh = ss().getSheetByName(name), list = _appends[name]; if (!sh || !list.length) return;
    const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String), t = {name:name, head:head};
    const start = sh.getLastRow()+1; room(sh, start+list.length-1, head.length);
    sh.getRange(start,1,list.length,head.length).setValues(list.map(function(o){ return toArr(t, o); }));
  });
  _tables = {}; _appends = {};
}
let _appends = {};
function appendOnly(name, o){ (_appends[name] = _appends[name] || []).push(o); }
function audit(me, name, op, before, after){
  if (!AUDITED[name]) return;
  const strip = function(o){ if (!o) return ''; const c = JSON.parse(JSON.stringify(o)); delete c.salt; delete c.hash; if (c.photos) c.photos = c.photos.length+' foto(s)'; return JSON.stringify(c); };
  appendOnly('audit', {at:nowIso(), user:me ? me.id : '', userName:me ? me.name : 'sistema', table:name, op:op, id:String((after||before||{}).id||''), before:strip(before), after:strip(after)});
}
function addLog(me, entity, action, detail, store){
  appendOnly('log', {id:genId(), at:nowIso(), user:me ? me.id : '', userName:me ? me.name : 'sistema', entity:entity, action:action, detail:String(detail||''), store:store||null});
}

// ------------------------------------------------------------------ instalação
function setup(){
  Object.keys(SCHEMA).forEach(ensureSheet);
  _tables = {};
  if (!all('settings').length) upsert('settings', DEFAULT_SETTINGS);
  if (!all('items').length){
    [[1,'Merchandising','Repor a implantação conforme o plano de merchandising em vigor (montras, gôndolas, testers).',7,'Responsável loja'],
     [2,'Limpeza','Limpeza completa da loja (vitrines, espelhos, testers, chão, provador).',2,'Responsável loja'],
     [3,'Apresentação da equipa','Relembrar à equipa as regras de farda e apresentação.',3,'Responsável loja'],
     [4,'Stock / reposição','Verificar ruturas e fazer pedido de reposição ao armazém.',5,'Supervisor'],
     [5,'Afixação de preços','Corrigir etiquetas de preço e cartazes de promoção em falta ou errados.',2,'Responsável loja'],
     [6,'Briefing da equipa','Fazer o briefing da equipa (objetivos do mês, promoções, novidades).',7,'Responsável loja']]
    .forEach(function(i){ upsert('items', {id:i[0],label:i[1],action:i[2],days:i[3],owner:i[4],active:true}); });
  }
  flush();
  if (!props().getProperty('IMPORT_KEY')) props().setProperty('IMPORT_KEY', (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''));
  photoFolder(); // cria a pasta das fotos e pede já a autorização do Drive
  MailApp.getRemainingDailyQuota(); // pede já a autorização de envio de e-mail
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyAgenda').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone(TZ).create();
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(7).nearMinute(30).inTimezone(TZ).create();
  ScriptApp.newTrigger('cleanSessions').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
  bumpVer();
  const s1 = ss().getSheetByName('Sheet1') || ss().getSheetByName('Folha1') || ss().getSheetByName('Feuille 1') || ss().getSheetByName('Página1');
  if (s1 && s1.getLastRow() === 0 && ss().getSheets().length > 1) ss().deleteSheet(s1);
  Logger.log('Instalação concluída. Chave do import noturno (IMPORT_KEY): ' + props().getProperty('IMPORT_KEY'));
  Logger.log('Agora: Implementar → Nova implementação → App Web → Executar como «Eu», acesso «Qualquer pessoa» → copiar o URL /exec.');
}
/** Opcional: 8 lojas de exemplo (sem supervisor). Executar uma vez, se quiser começar com dados de teste. */
function carregarLojasExemplo(){
  if (all('stores').length){ Logger.log('Já existem lojas: nada feito.'); return; }
  [[1,'P&C Colombo','L001','Lisboa','CC Colombo, Av. Lusíada, loja 0.112','10h–23h',6,'A',38.7536,-9.1886],
   [2,'P&C Vasco da Gama','L002','Lisboa','CC Vasco da Gama, piso 1','10h–23h',4,'B',38.7682,-9.0967],
   [3,'P&C Cascais','L003','Cascais','CascaiShopping, piso 0','10h–23h',5,'C',38.7071,-9.4213],
   [4,'P&C NorteShopping','L010','Matosinhos','NorteShopping, piso 0','10h–23h',7,'A',41.1813,-8.6494],
   [5,'P&C Braga Parque','L011','Braga','Braga Parque, piso 1','10h–23h',4,'B',41.5607,-8.4030],
   [6,'P&C Coimbra','L020','Coimbra','Forum Coimbra, piso 1','10h–23h',4,'C',40.1902,-8.4318],
   [7,'P&C Setúbal','L004','Setúbal','Alegro Setúbal, piso 1','10h–22h',3,'B',38.5244,-8.8882],
   [8,'P&C Guimarães','L012','Guimarães','Guimarães Shopping, piso 0','10h–23h',3,'C',41.4425,-8.2918]]
  .forEach(function(s){ upsert('stores', {id:s[0],name:s[1],code:s[2],city:s[3],address:s[4],phone:'',hours:s[5],team:s[6],manager:'',email:'',cad:s[7],tempCad:'',tempUntil:'',sup:'',active:true,lat:s[8],lng:s[9],priority:'Normal',notes:''}); });
  flush(); bumpVer(); Logger.log('8 lojas de exemplo criadas.');
}
function photoFolder(){
  const id = props().getProperty('PHOTO_FOLDER');
  if (id){ try { return DriveApp.getFolderById(id); } catch(e){} }
  const f = DriveApp.createFolder(APP_NAME + ' – fotos das visitas');
  props().setProperty('PHOTO_FOLDER', f.getId());
  return f;
}
function savePhotos(row){
  if (!row.photos || !row.photos.length) return;
  row.photos = row.photos.map(function(p, i){
    const m = String(p).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) return p;
    const f = photoFolder().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'visita-'+row.id+'-'+(i+1)+'.jpg'));
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e){}
    return 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1000';
  });
}

// ------------------------------------------------------------------ contas e sessões
function pub(u){ return {id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role,active:u.active,createdAt:u.createdAt}; }
function newSession(userId){
  const token = (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
  const exp = new Date(); exp.setDate(exp.getDate()+SESSION_DAYS);
  table('sessions').rows.push({o:{tokenHash:sha(token), user:userId, expires:Utilities.formatDate(exp, TZ, "yyyy-MM-dd'T'HH:mm:ss")}, r:0, dirty:false});
  return token;
}
function whoami(token){
  if (!token) throw fail('auth', 'Sessão em falta. Entre de novo.');
  const h = sha(String(token)), cache = CacheService.getScriptCache();
  let uid = cache.get('s_'+h);
  if (!uid){
    const s = all('sessions').filter(function(x){ return x.tokenHash === h && x.expires > nowIso(); })[0];
    if (!s) throw fail('auth', 'Sessão expirada. Entre de novo.');
    uid = s.user; cache.put('s_'+h, uid, 3600);
  }
  const u = all('users').filter(function(x){ return x.id === uid; })[0];
  if (!u) throw fail('auth', 'Conta inexistente.');
  return u;
}
function activeAdmins(){ return all('users').filter(function(u){ return u.active && u.role === 'admin'; }); }
function tempPassword(){ return Utilities.getUuid().replace(/-/g,'').slice(0,10); }
function signup(req){
  const email = normEmail(req.email), name = String(req.name||'').trim(), pw = String(req.password||'');
  if (!name) throw fail('bad', 'O nome é obrigatório.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('bad', 'E-mail inválido.');
  if (pw.length < 8) throw fail('bad', 'A password tem de ter pelo menos 8 caracteres.');
  if (all('users').some(function(u){ return normEmail(u.email) === email; })) throw fail('bad', 'Já existe uma conta com este e-mail.');
  const first = all('users').length === 0, salt = Utilities.getUuid();
  const u = {id:Utilities.getUuid(), name:name, email:email, phone:String(req.phone||'').trim(), role:first?'admin':'sup', active:first, createdAt:nowIso(), salt:salt, hash:hashPw(pw, salt), lastReset:''};
  table('users').rows.push({o:u, r:0, dirty:false});
  audit(u, 'users', 'INSERT', null, u);
  addLog(u, 'conta', 'Criou a sua conta', first ? 'Primeira conta: Sede' : 'Aguarda ativação pela Sede');
  if (!first){
    const to = activeAdmins().map(function(a){ return a.email; }).filter(String).join(',');
    if (to) try { MailApp.sendEmail(to, 'Nova conta a aguardar ativação — ' + name, name + ' (' + email + ') criou uma conta na app ' + APP_NAME + '.\n\nPara a ativar e atribuir lojas: Bastidor → Contas, depois Bastidor → Configuração.', {name:APP_NAME}); } catch(e){}
  }
  return {token:newSession(u.id)};
}
function login(req){
  const email = normEmail(req.email), cache = CacheService.getScriptCache(), k = 'f_'+sha(email);
  const fails = Number(cache.get(k)||0);
  if (fails >= 8) throw fail('bad', 'Demasiadas tentativas; aguarde 15 minutos.');
  const u = all('users').filter(function(x){ return normEmail(x.email) === email; })[0];
  if (!u || hashPw(String(req.password||''), u.salt) !== u.hash){ cache.put(k, String(fails+1), 900); throw fail('bad', 'E-mail ou password errados.'); }
  cache.remove(k);
  return {token:newSession(u.id)};
}
function resetPassword(req, byAdmin){
  const x = table('users').rows.filter(function(r){ return byAdmin ? r.o.id === req.userId : normEmail(r.o.email) === normEmail(req.email); })[0];
  if (!x) return {}; // não revelar se a conta existe
  if (!byAdmin && x.o.lastReset && (new Date(nowIso()) - new Date(x.o.lastReset)) < 10*60000) throw fail('bad', 'Já foi enviado um e-mail há menos de 10 minutos.');
  const tmp = tempPassword();
  x.o.salt = Utilities.getUuid(); x.o.hash = hashPw(tmp, x.o.salt); x.o.lastReset = nowIso(); x.dirty = true;
  MailApp.sendEmail(x.o.email, APP_NAME + ' — password temporária', 'Olá ' + x.o.name + ',\n\nA sua password temporária é:  ' + tmp + '\n\nEntre na app com ela e mude-a em «A minha conta» (toque no seu nome, no topo).', {name:APP_NAME});
  addLog(byAdmin || x.o, 'conta', byAdmin ? 'Repôs a password de uma conta' : 'Pediu password nova', x.o.name);
  return {};
}
function changePassword(me, req){
  const x = table('users').rows.filter(function(r){ return r.o.id === me.id; })[0];
  if (hashPw(String(req.old||''), x.o.salt) !== x.o.hash) throw fail('bad', 'A password atual não está certa.');
  if (String(req.new||'').length < 8) throw fail('bad', 'A password nova tem de ter pelo menos 8 caracteres.');
  x.o.salt = Utilities.getUuid(); x.o.hash = hashPw(String(req.new), x.o.salt); x.dirty = true;
  addLog(me, 'conta', 'Alterou a password', '');
  return {};
}
function cleanSessions(){
  const t = table('sessions'), now = nowIso();
  t.rows.slice().forEach(function(x){ if (x.o.expires <= now) removeRow('sessions', x.o); });
  flush();
}

// ------------------------------------------------------------------ leitura (cada conta só recebe o que pode ver)
function loadFor(me){
  if (!me.active) return {me:pub(me), data:{users:[pub(me)]}, ver:getVer()};
  const admin = me.role === 'admin';
  const stores = all('stores').filter(function(s){ return admin || s.sup === me.id; });
  const sid = {}, codes = {}; stores.forEach(function(s){ sid[s.id] = 1; codes[String(s.code).toUpperCase()] = 1; });
  const mine = function(r){ return admin || sid[r.store]; };
  const site = function(r){ return admin || codes[String(r.site).toUpperCase()]; };
  const visits = all('visits').filter(mine), vid = {}; visits.forEach(function(v){ vid[v.id] = 1; });
  const desc = function(a,b){ return String(b.at).localeCompare(String(a.at)); };
  return {me:pub(me), ver:getVer(), data:{
    users: all('users').map(pub),
    settings: all('settings')[0] || DEFAULT_SETTINGS,
    items: all('items'), stores: stores,
    planned: all('planned').filter(mine), visits: visits, actions: all('actions').filter(mine),
    stock: all('stock').filter(site), shipments: all('shipments').filter(site), kpis: all('kpis').filter(site),
    imports: all('imports').sort(desc).slice(0,20),
    outbox: all('outbox').filter(function(m){ return admin || m.toUser === me.id || (m.visit && vid[m.visit]); }).sort(desc).slice(0,200),
    log: all('log').filter(function(l){ return admin || l.user === me.id; }).sort(desc).slice(0,2000)
  }};
}

// ------------------------------------------------------------------ escrita (permissões verificadas aqui, não na app)
function myStore(me, storeId){
  if (me.role === 'admin') return true;
  return all('stores').some(function(s){ return String(s.id) === String(storeId) && s.sup === me.id; });
}
function sendMail(row){
  if (!row.toEmail){ row.status = 'skipped'; row.error = 'sem e-mail de destino'; return; }
  try {
    const opt = {name:APP_NAME};
    if (row.ccEmail && normEmail(row.ccEmail) !== normEmail(row.toEmail)){ opt.cc = row.ccEmail; opt.replyTo = row.ccEmail; }
    MailApp.sendEmail(row.toEmail, row.subject, String(row.body).replace(/\*/g,''), opt);
    row.status = 'sent'; row.sentAt = nowIso(); row.error = '';
  } catch(e){ row.status = 'error'; row.error = String(e.message||e).slice(0,300); }
}
function opPut(me, t, row){
  const admin = me.role === 'admin';
  if (!row || typeof row !== 'object') throw fail('bad', 'Linha em falta.');
  if (t === 'log'){ addLog(me, String(row.entity||''), String(row.action||''), row.detail, row.store); return {}; }
  if (t === 'visits' || t === 'planned' || t === 'actions'){
    const ex = findRow(t, row);
    if (ex && !myStore(me, ex.o.store)) throw fail('denied', 'Sem acesso a esta loja.');
    if (!myStore(me, row.store)) throw fail('denied', 'Sem acesso a esta loja.');
    if (t === 'visits'){ if (!ex) { if (!admin || !row.sup) row.sup = me.id; } savePhotos(row); }
    const r = upsert(t, row); audit(me, t, r.before ? 'UPDATE' : 'INSERT', r.before, r.row); return {row:r.row};
  }
  if (t === 'stores'){
    if (admin){ const r = upsert(t, row); audit(me, t, r.before ? 'UPDATE' : 'INSERT', r.before, r.row); return {row:r.row}; }
    const ex = findRow(t, row);
    if (!ex || ex.o.sup !== me.id) throw fail('denied', 'Sem acesso a esta loja.');
    const r = upsert(t, {id:ex.o.id, notes:row.notes, priority:row.priority}); audit(me, t, 'UPDATE', r.before, r.row); return {row:r.row};
  }
  if (t === 'users'){
    const ex = findRow(t, row); if (!ex) throw fail('denied', 'Conta inexistente.');
    let patch;
    if (admin){
      patch = {id:ex.o.id, name:row.name, email:normEmail(row.email)||ex.o.email, phone:row.phone, role:row.role === 'admin' ? 'admin' : 'sup', active:!!row.active};
      const losing = ex.o.role === 'admin' && ex.o.active && (patch.role !== 'admin' || !patch.active);
      if (losing && activeAdmins().length <= 1) throw fail('denied', 'Tem de existir pelo menos uma conta Sede ativa.');
    } else if (ex.o.id === me.id) patch = {id:me.id, name:row.name, phone:row.phone};
    else throw fail('denied', 'Só a Sede altera outras contas.');
    const r = upsert(t, patch); audit(me, t, 'UPDATE', r.before, r.row); return {row:pub(r.row)};
  }
  if (t === 'settings' || t === 'items' || t === 'imports'){
    if (!admin) throw fail('denied', 'Só a Sede altera a configuração.');
    if (t === 'settings') row.id = 1;
    const r = upsert(t, row); audit(me, t, r.before ? 'UPDATE' : 'INSERT', r.before, r.row); return {row:r.row};
  }
  if (t === 'outbox'){
    if (findRow(t, row)) return {row:findRow(t, row).o}; // já enviada (repetição da fila): não reenviar
    if (!admin && row.visit){ const v = all('visits').filter(function(x){ return String(x.id) === String(row.visit); })[0]; if (!v || !myStore(me, v.store)) throw fail('denied', 'Sem acesso a esta visita.'); }
    if (!admin && !row.visit) throw fail('denied', 'Só a Sede envia esta mensagem.');
    row.at = nowIso(); row.status = 'pending'; sendMail(row);
    const r = upsert(t, row); return {row:r.row};
  }
  throw fail('denied', 'Tabela não permitida: ' + t);
}
function opDel(me, t, id){
  const admin = me.role === 'admin';
  const ex = findRow(t, {id:id}); if (!ex) return {};
  if (t === 'planned'){ if (!myStore(me, ex.o.store)) throw fail('denied', 'Sem acesso a esta loja.'); }
  else if (!(admin && (t === 'items' || t === 'stores' || t === 'actions'))) throw fail('denied', 'Não permitido.');
  audit(me, t, 'DELETE', removeRow(t, {id:id}), null); return {};
}
function opBulk(me, op){
  if (me.role !== 'admin') throw fail('denied', 'Só a Sede importa dados.');
  if (op.op === 'replace' && (op.table === 'stock' || op.table === 'shipments')){ replaceAll(op.table, op.rows||[]); return {}; }
  if (op.op === 'upsertMany' && op.table === 'kpis'){ (op.rows||[]).forEach(function(r){ upsert('kpis', r); }); return {}; }
  throw fail('denied', 'Operação não permitida.');
}
function runBatch(me, ops){
  if (!me.active) throw fail('denied', 'Conta a aguardar ativação.');
  return (ops||[]).map(function(op){
    try {
      if (op.op === 'put') return opPut(me, op.table, op.row);
      if (op.op === 'del') return opDel(me, op.table, op.id);
      if (op.op === 'replace' || op.op === 'upsertMany') return opBulk(me, op);
      throw fail('bad', 'Operação desconhecida.');
    } catch(e){ return {error:String(e.message||e), code:e.code||'error'}; }
  });
}
/** Import noturno Sage X3 (script Python no PC da empresa), autenticado pela IMPORT_KEY. */
function nightlyImport(req){
  if (!req.key || req.key !== props().getProperty('IMPORT_KEY')) throw fail('auth', 'Chave de import inválida.');
  const kind = req.kind, rows = req.rows||[];
  if (kind === 'stock' || kind === 'shipments'){
    if (req.first) replaceAll(kind, rows);
    else rows.forEach(function(r){ const o = {}; Object.keys(SCHEMA[kind]).forEach(function(k){ o[k] = r[k] === undefined ? null : r[k]; }); table(kind).rows.push({o:o, r:0, dirty:false}); });
  } else if (kind === 'kpis') rows.forEach(function(r){ upsert('kpis', r); });
  else throw fail('bad', 'Tipo desconhecido.');
  let unknown = [];
  if (req.last){
    const known = {}; all('stores').forEach(function(s){ known[String(s.code).toUpperCase()] = 1; });
    const seen = {}; all(kind).forEach(function(r){ const s = String(r.site).toUpperCase(); if (!known[s]) seen[s] = 1; });
    unknown = Object.keys(seen).sort();
    upsert('imports', {id:genId(), kind:{stock:'Stock',shipments:'Expedições',kpis:'KPI'}[kind], at:nowIso(), rows:req.total||rows.length, unknown:unknown});
    addLog(null, 'import', 'Import noturno', kind + ' · ' + (req.total||rows.length) + ' linha(s)');
  }
  return {unknown:unknown};
}

// ------------------------------------------------------------------ API (um único endereço, POST JSON como text/plain)
function doGet(){ return ContentService.createTextOutput(APP_NAME + ' — API ativa.'); }
function doPost(e){
  let out;
  try {
    const req = JSON.parse((e.postData && e.postData.contents) || '{}');
    out = handle(req); out.ok = true;
  } catch(ex){ out = {ok:false, error:String(ex.message||ex), code:ex.code||'error'}; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function handle(req){
  const a = req.action;
  if (a === 'ver'){ whoamiLight(req.token); return {ver:getVer()}; }
  if (a === 'load') return loadFor(whoami(req.token));
  // tudo o resto escreve: um de cada vez
  const lock = LockService.getScriptLock(); lock.waitLock(28000);
  try {
    _tables = {}; _appends = {};
    let res;
    if (a === 'signup') res = signup(req);
    else if (a === 'login') res = login(req);
    else if (a === 'reset') res = resetPassword(req, null);
    else if (a === 'import') res = nightlyImport(req);
    else {
      const me = whoami(req.token);
      if (a === 'logout'){ removeRow('sessions', {tokenHash:sha(String(req.token))}); CacheService.getScriptCache().remove('s_'+sha(String(req.token))); res = {}; }
      else if (a === 'password') res = changePassword(me, req);
      else if (a === 'adminReset'){ if (me.role !== 'admin' || !me.active) throw fail('denied', 'Só a Sede.'); res = resetPassword(req, me); }
      else if (a === 'batch') res = {results:runBatch(me, req.ops)};
      else throw fail('bad', 'Ação desconhecida.');
    }
    flush();
    res.ver = bumpVer();
    return res;
  } finally { lock.releaseLock(); }
}
function whoamiLight(token){ // só confirma a sessão pela cache (rápido); se não estiver em cache, valida a sério
  if (!token) throw fail('auth', 'Sessão em falta.');
  if (!CacheService.getScriptCache().get('s_'+sha(String(token)))) whoami(token);
}

// ------------------------------------------------------------------ agenda de 2.ª feira e lembretes (acionadores)
function storeStatus(){
  const cfg = all('settings')[0] || DEFAULT_SETTINGS, today = todayIso(), visits = all('visits'), actions = all('actions');
  return all('stores').filter(function(s){ return s.active; }).map(function(s){
    const vs = visits.filter(function(v){ return v.store === s.id; }).map(function(v){ return String(v.at); }).sort();
    const last = vs.length ? vs[vs.length-1].slice(0,10) : null;
    const cad = (s.tempCad && s.tempUntil && s.tempUntil >= today) ? s.tempCad : s.cad;
    const days = cad === 'A' ? cfg.cadA : cad === 'B' ? cfg.cadB : cfg.cadC;
    const next = last ? addDaysIso(last, days) : today, until = daysBetween(today, next);
    const open = actions.filter(function(a){ return a.store === s.id && a.status !== 'done'; });
    return {s:s, last:last, next:next, until:until,
      status: !last ? 'never' : until < 0 ? 'late' : until <= cfg.dueSoon ? 'soon' : 'ok',
      noVisit: !last || daysBetween(last, today) > cfg.maxNoVisit,
      open: open.length, lateActs: open.filter(function(a){ return a.due < today; })};
  });
}
function queueMail(u, subject, body, cc){
  const row = {id:genId(), at:nowIso(), to:u.name+' · '+u.email, toEmail:u.email, ccEmail:cc||'', toUser:u.id, subject:subject, body:body, visit:null, status:'pending', sentAt:'', error:''};
  sendMail(row); upsert('outbox', row);
}
function weeklyAgenda(){
  const lock = LockService.getScriptLock(); lock.waitLock(28000);
  try {
    _tables = {};
    const cfg = all('settings')[0] || DEFAULT_SETTINGS, st = storeStatus();
    all('users').filter(function(u){ return u.active && u.role === 'sup'; }).forEach(function(u){
      const m = st.filter(function(x){ return x.s.sup === u.id && (x.status !== 'ok' || x.noVisit); }).sort(function(a,b){ return a.until - b.until; });
      const lines = m.map(function(x){
        const txt = x.status === 'never' ? 'Nunca visitada' : x.status === 'late' ? 'Atrasada '+(-x.until)+' d' : x.status === 'soon' ? (x.until === 0 ? 'Visitar hoje' : 'Visitar até '+fmtDay(x.next)) : 'Sem visita há '+daysBetween(x.last, todayIso())+' dias';
        return (x.status === 'soon' ? '🟠 ' : '🔴 ') + x.s.name + ' (' + x.s.city + ') — ' + txt + (x.open ? ' · ' + x.open + ' ação(ões) aberta(s)' : '');
      });
      queueMail(u, 'Lojas a visitar esta semana (' + m.length + ')', 'Bom dia ' + u.name + ',\n\nLojas a visitar nos próximos ' + cfg.dueSoon + ' dias (🔴 = em atraso):\n\n' + (lines.length ? lines.join('\n') : 'Nenhuma loja a visitar esta semana. 👍') + '\n\nBoa semana!', cfg.sedeEmail);
    });
    addLog(null, 'agenda', 'Agenda de 2.ª feira enviada', '');
    flush(); bumpVer();
  } finally { lock.releaseLock(); }
}
function dailyReminders(){
  const dow = Number(Utilities.formatDate(new Date(), TZ, 'u')); if (dow > 5) return; // sábado/domingo: nada
  const lock = LockService.getScriptLock(); lock.waitLock(28000);
  try {
    _tables = {};
    const st = storeStatus();
    all('users').filter(function(u){ return u.active && u.role === 'sup'; }).forEach(function(u){
      const acts = []; st.filter(function(x){ return x.s.sup === u.id; }).forEach(function(x){ x.lateActs.forEach(function(a){ acts.push(a); }); });
      if (!acts.length) return;
      acts.sort(function(a,b){ return String(a.due).localeCompare(String(b.due)); });
      queueMail(u, 'Ações em atraso (' + acts.length + ')', 'Bom dia ' + u.name + ',\n\nAções com prazo ultrapassado nas suas lojas:\n\n' + acts.map(function(a){ return '• ' + a.title + ' — prazo ' + fmtDate(a.due) + ' · ' + a.owner; }).join('\n') + '\n\nObrigado!', '');
    });
    flush(); bumpVer();
  } finally { lock.releaseLock(); }
}
