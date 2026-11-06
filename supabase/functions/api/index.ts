// 한국반려동물이동장례협회 회원관리 서버 (Supabase Edge Function)
// 구글 Apps Script(Code.gs)의 기능을 그대로 옮긴 것. 로그인 토큰을 이 프로그램이 직접 확인하므로
// Supabase 의 JWT 확인은 끄고(verify_jwt=false) 씁니다. 표는 모두 이 프로그램만 읽고 씁니다.
import { createClient } from "npm:@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SUPABASE_URL");
const sb = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    persistSession: false
  }
});
const FN_URL = SB_URL + "/functions/v1/api";
const BUCKET = "files";
const DEFAULT_SITE = "사무국";
// (11/4) 임원 = 회원 명부 직책에 임원·대표·회장·이사·감사·사무국장이 들어간 재직자
const OFFICER_RE = /임원|대표|회장|이사|감사|사무국장/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400"
};
const json = (o, status = 200)=>new Response(JSON.stringify(o), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
const TABLE = {
  exp: "expenses",
  doc: "docs",
  emp: "employees"
};
const FORM_SLOTS = [
  {
    k: "resume",
    g: "기본",
    t: "이력서",
    d: "필히 최종학력 기재"
  },
  {
    k: "jumin",
    g: "기본",
    t: "주민등록등본",
    d: ""
  },
  {
    k: "idcard",
    g: "기본",
    t: "신분증 사본",
    d: ""
  },
  {
    k: "bank",
    g: "기본",
    t: "통장사본",
    d: ""
  },
  {
    k: "insure",
    g: "기본",
    t: "건강보험자격득실확인서",
    d: ""
  },
  {
    k: "certs",
    g: "기본",
    t: "보유자격증 사본",
    d: "보유 자격증 전부"
  },
  {
    k: "privacy",
    g: "양식",
    t: "개인정보 수집 이용 및 정보제공 동의서",
    d: ""
  },
  {
    k: "health",
    g: "양식",
    t: "건강체크 리스트",
    d: ""
  },
  {
    k: "rules",
    g: "양식",
    t: "취업규칙 동의서",
    d: ""
  },
  {
    k: "safety",
    g: "양식",
    t: "산업안전 보건교육 동의서",
    d: ""
  }
];
const PUBLIC_ACTIONS = {
  login: 1,
  adminSetup: 1,
  apApprove: 1,
  hireUpload: 1
};
const STAFF_ACTIONS = {
  noticeRead: 1,
  resignSubmit: 1,
  sigSet: 1,
  sigGet: 1,
  docAdd: 1,
  lineAct: 1
};
const MANAGER_ACTIONS = {
  receiptRead: 1,
  add: 1,
  update: 1,
  docAdd: 1,
  docUpdate: 1,
  delete: 1,
  noticeRead: 1,
  noticeAdd: 1,
  noticeDelete: 1,
  sigSet: 1,
  sigGet: 1,
  lineAct: 1,
  empAdd: 1,
  empUpdate: 1,
  formRead: 1
};
// ---------- 공통 도구 ----------
const enc = new TextEncoder();
function b64url(buf) {
  let s = "";
  const b = new Uint8Array(buf);
  for(let i = 0; i < b.length; i++)s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(msg, key) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function sha(msg) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(msg)));
}
function rid(n = 5) {
  return Math.random().toString(36).slice(2, 2 + n);
}
function newId(prefix = "") {
  return prefix + Date.now().toString(36) + rid(5);
}
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
function normName(s) {
  return String(s || "").replace(/\s+/g, "");
}
function last4(s) {
  return String(s || "").replace(/\D/g, "").slice(-4);
}
function must(r) {
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.data;
}
function b64bytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for(let i = 0; i < s.length; i++)u[i] = s.charCodeAt(i);
  return u;
}
// 한 번의 요청 동안 같은 표를 여러 번 읽지 않도록 기억해 두는 묶음
class Ctx {
  memo = new Map();
  once(k, fn) {
    if (!this.memo.has(k)) this.memo.set(k, fn());
    return this.memo.get(k);
  }
  forget(k) {
    this.memo.delete(k);
  }
  // ----- 설정 -----
  settings() {
    return this.once("settings", async ()=>{
      const rows = must(await sb.from("settings").select("key,value"));
      const m = {};
      rows.forEach((r)=>m[r.key] = r.value);
      return m;
    });
  }
  async get(k) {
    const m = await this.settings();
    return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
  }
  async set(k, v) {
    must(await sb.from("settings").upsert({
      key: k,
      value: String(v)
    }));
    (await this.settings())[k] = String(v);
  }
  async del(k) {
    must(await sb.from("settings").delete().eq("key", k));
    delete (await this.settings())[k];
  }
  async getJson(k, dflt) {
    try {
      const v = await this.get(k);
      return v ? JSON.parse(v) : dflt;
    } catch (_e) {
      return dflt;
    }
  }
  async secret() {
    let s = await this.get("SECRET");
    if (!s) {
      s = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
      await this.set("SECRET", s);
    }
    return s;
  }
  async cfg() {
    return {
      role1: await this.get("ROLE1") || "이사",
      role2: await this.get("ROLE2") || "감사"
    };
  }
  async testMode() {
    const v = await this.get("TEST_MODE");
    return v === "1";
  }
  // ----- 표 읽기 -----
  rows(kind) {
    return this.once("rows:" + kind, async ()=>{
      const data = must(await sb.from(TABLE[kind]).select("id,data").order("seq", {
        ascending: true
      }));
      return data.map((r)=>{
        const o = {
          ...r.data || {},
          id: String(r.id)
        };
        if (!Array.isArray(o.attachments)) o.attachments = [];
        if (kind === "exp") {
          o.amount = Number(o.amount) || 0;
          if (!Array.isArray(o.lines)) o.lines = [];
        }
        if (kind === "emp") {
          [
            "base",
            "allow",
            "ot",
            "paySum",
            "annual",
            "sev",
            "total"
          ].forEach((k)=>o[k] = Number(o[k]) || 0);
          o.birth = String(o.birth == null ? "" : o.birth).replace(/\D/g, "");
          if (o.birth) o.birth = ("000000" + o.birth).slice(-6);
          [
            "joinDate",
            "leaveDate",
            "leavePlan"
          ].forEach((k)=>o[k] = String(o[k] || ""));
        }
        return o;
      });
    });
  }
  async find(kind, id) {
    const r = must(await sb.from(TABLE[kind]).select("id,data").eq("id", String(id)).maybeSingle());
    return r ? {
      ...r.data || {},
      id: String(r.id)
    } : null;
  }
  async put(kind, o) {
    must(await sb.from(TABLE[kind]).upsert({
      id: String(o.id),
      data: o
    }));
    this.forget("rows:" + kind);
  }
  async remove(kind, id) {
    must(await sb.from(TABLE[kind]).delete().eq("id", String(id)));
    this.forget("rows:" + kind);
  }
  notices() {
    return this.once("notices", async ()=>{
      const data = must(await sb.from("notices").select("id,data").order("seq", {
        ascending: true
      }));
      return data.map((r)=>{
        const o = {
          ...r.data || {},
          id: String(r.id)
        };
        if (!Array.isArray(o.attachments)) o.attachments = [];
        return o;
      }).sort((a, b)=>String(a.createdAt) < String(b.createdAt) ? 1 : -1);
    });
  }
  reads() {
    return this.once("reads", async ()=>must(await sb.from("notice_reads").select("notice_id,who,name,at")).map((r)=>({
          noticeId: String(r.notice_id),
          who: String(r.who),
          name: String(r.name),
          at: String(r.at)
        })));
  }
  sigIndex() {
    return this.once("sigidx", async ()=>{
      const data = must(await sb.from("signatures").select("id,key").order("seq", {
        ascending: true
      }));
      const out = {};
      data.forEach((r)=>out[String(r.key)] = String(r.id));
      return out;
    });
  }
  async sigIdFor(key) {
    return (await this.sigIndex())[key] || "";
  }
  pay() {
    return this.once("pay", async ()=>must(await sb.from("payslips").select("id,month,emp_id,name,data,open_date,published_at").order("seq", {
        ascending: true
      })).map((r)=>({
          id: r.id,
          month: String(r.month),
          empId: String(r.emp_id),
          name: r.name,
          data: r.data || {},
          openDate: String(r.open_date || ""),
          publishedAt: r.published_at
        })));
  }
  // ----- 로그인 토큰 -----
  async authSecret() {
    return await this.secret() + "|" + (await this.get("TK_EPOCH") || "1");
  }
  async sign(s) {
    return (await hmac(s, await this.authSecret())).slice(0, 24);
  }
  async makeTk(role, id) {
    const p = role + "~" + encodeURIComponent(String(id || ""));
    return p + "." + await this.sign(p);
  }
  async readTk(tkIn) {
    const tk = String(tkIn || "");
    if (tk.indexOf("admin~") !== 0) await Promise.all([
      this.settings(),
      this.rows("emp")
    ]);
    const i = tk.lastIndexOf(".");
    if (i < 0) return null;
    const p = tk.slice(0, i), sg = tk.slice(i + 1);
    if (!sg || await this.sign(p) !== sg) return null;
    const j = p.indexOf("~");
    if (j < 0) return null;
    const role = p.slice(0, j);
    let id = "";
    try {
      id = decodeURIComponent(p.slice(j + 1));
    } catch (_e) {
      return null;
    }
    if (role !== "admin" && role !== "manager" && role !== "staff") return null;
    const who = {
      role,
      id
    };
    if (role === "manager") {
      const me = (await this.rows("emp")).filter((x)=>String(x.id) === String(id) && String(x.status) !== "퇴사" && OFFICER_RE.test(String(x.role || "")))[0];
      if (me) {
        who.id = me.id;
        who.site = String(me.site || DEFAULT_SITE);
        who.name = me.name;
        who.emp = me;
      } else {
        who.site = id;
        who.name = await this.managerName(id);
      }
    }
    if (role === "staff") {
      const me = (await this.rows("emp")).filter((x)=>String(x.id) === id)[0];
      if (!me) return null;
      who.emp = me;
      who.name = me.name;
      who.site = String(me.site || DEFAULT_SITE);
      who.team = me.team || "";
    }
    return who;
  }
  async pinHash(pin) {
    return await sha("pin|" + String(pin) + "|" + await this.secret());
  }
  async tokenFor(role, site) {
    return (await sha(role + "|" + site + "|" + await this.secret())).slice(0, 20);
  }
  async managerName(site) {
    const m = (await this.rows("emp")).filter((x)=>String(x.site || DEFAULT_SITE) === String(site) && String(x.status) !== "퇴사" && OFFICER_RE.test(String(x.role || "")))[0];
    return m ? m.name : "임원";
  }
  async mgrPins() {
    return await this.getJson("MGR_PINS", {});
  }
}
// ---------- 로그인 실패 잠금 (5번 틀리면 10분) ----------
async function failCount(key) {
  const r = must(await sb.from("login_fails").select("n,until").eq("key", key).maybeSingle());
  if (!r) return 0;
  if (new Date(r.until).getTime() < Date.now()) {
    await sb.from("login_fails").delete().eq("key", key);
    return 0;
  }
  return Number(r.n) || 0;
}
async function failCheck(key) {
  return await failCount(key) >= 5;
}
async function failAdd(key) {
  const n = await failCount(key) + 1;
  must(await sb.from("login_fails").upsert({
    key,
    n,
    until: new Date(Date.now() + 600000).toISOString()
  }));
  return n;
}
async function failClear(key) {
  await sb.from("login_fails").delete().eq("key", key);
}
// ---------- 첨부파일 (Storage) ----------
async function fileSig(c, id) {
  return (await hmac("file|" + id, await c.secret())).slice(0, 20);
}
async function fileUrl(c, id) {
  return FN_URL + "?f=" + encodeURIComponent(id) + "&s=" + await fileSig(c, id);
}
function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ""));
  return m ? "." + m[1].toLowerCase() : "";
}
async function saveAtts(c, folder, atts) {
  const links = [];
  for(let i = 0; i < (atts || []).length; i++){
    const at = atts[i];
    if (!at || !at.dataB64) continue;
    const bytes = b64bytes(String(at.dataB64));
    const id = "f" + Date.now().toString(36) + rid(8);
    const name = String(at.name || "file_" + Date.now() + "_" + i);
    const type = String(at.type || "application/octet-stream");
    const path = id.slice(0, 3) + "/" + id + extOf(name);
    const up = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: type,
      upsert: false
    });
    if (up.error) throw new Error("파일 저장 실패: " + up.error.message);
    must(await sb.from("files").insert({
      id,
      path,
      name,
      type,
      size: bytes.length,
      folder
    }));
    links.push({
      name,
      url: await fileUrl(c, id),
      id,
      type: String(at.type || "")
    });
  }
  return links;
}
async function removeFile(id) {
  try {
    const f = must(await sb.from("files").select("id,path").eq("id", String(id)).maybeSingle());
    if (!f) return;
    await sb.storage.from(BUCKET).remove([
      f.path
    ]);
    await sb.from("files").delete().eq("id", f.id);
  } catch (_e) {}
}
async function serveFile(c, id, s, dl) {
  if (!id || s !== await fileSig(c, id)) return json({
    ok: false,
    error: "잘못된 파일 링크입니다."
  }, 403);
  const f = must(await sb.from("files").select("path,name").eq("id", id).maybeSingle());
  if (!f) return json({
    ok: false,
    error: "파일을 찾을 수 없습니다."
  }, 404);
  const r = await sb.storage.from(BUCKET).createSignedUrl(f.path, 300, dl ? {
    download: f.name
  } : undefined);
  if (r.error || !r.data) return json({
    ok: false,
    error: "파일을 열 수 없습니다."
  }, 500);
  return new Response(null, {
    status: 302,
    headers: {
      ...CORS,
      Location: r.data.signedUrl,
      "Cache-Control": "no-store"
    }
  });
}
// ---------- 공지 · 서명 · 급여 ----------
function noticeFor(n, who) {
  if (n.site && who.site && String(n.site) !== String(who.site)) return false;
  const t = String(n.target || "all");
  if (t === "all") return true;
  if (t === "mgr") return who.role === "manager";
  if (t === "staff") return who.role === "staff";
  if (t.indexOf("team:") === 0) return who.role === "staff" && String(who.team) === t.slice(5);
  if (t.indexOf("emp:") === 0) return who.role === "staff" && String(who.id) === t.slice(4);
  return false;
}
const whoKey = (who)=>who.role === "manager" ? "mgr:" + who.site : "emp:" + who.id;
// (11/5) 임원은 본인 회원 id로 서명을 따로 보관 (예전 방식 토큰은 지부 공용 키)
const sigKeyOf = (who)=>who.role === "staff" ? "emp:" + who.id : who.role === "manager" ? who.emp ? "emp:" + who.id : "mgr:" + who.site : "admin";
async function myNotices(c, who) {
  const key = whoKey(who), readSet = {};
  (await c.reads()).forEach((r)=>{
    if (r.who === key) readSet[r.noticeId] = 1;
  });
  return (await c.notices()).filter((n)=>String(n.authorKey || "") !== key && noticeFor(n, who)).map((n)=>({
      id: n.id,
      date: n.date,
      title: n.title,
      body: n.body,
      author: n.author,
      attachments: n.attachments,
      read: !!readSet[n.id]
    }));
}
async function mySigs(c, who) {
  const idx = await c.sigIndex();
  if (who.role === "admin") return {
    admin: idx["admin"] || "",
    role1: idx["role1"] || "",
    role2: idx["role2"] || ""
  };
  return {
    me: idx[sigKeyOf(who)] || ""
  };
}
async function myPayslips(c, empId) {
  const t = today();
  return (await c.pay()).filter((r)=>String(r.empId) === String(empId) && (!r.openDate || r.openDate <= t)).map((r)=>({
      month: r.month,
      openDate: r.openDate,
      slip: r.data || {}
    })).sort((a, b)=>a.month < b.month ? 1 : -1);
}
async function paySummary(c) {
  const m = {};
  (await c.pay()).forEach((r)=>{
    const k = r.month;
    if (!m[k]) m[k] = {
      month: k,
      count: 0,
      openDate: r.openDate
    };
    m[k].count++;
  });
  return Object.keys(m).sort().reverse().map((k)=>m[k]);
}
// ---------- 기안 결재선 ----------
function rankOf(role) {
  const r = String(role || "");
  if (OFFICER_RE.test(r)) return 5;
  if (/과장|팀장|대장|감독/.test(r)) return 4;
  if (/대리|반장/.test(r)) return 3;
  if (/주임/.test(r)) return 2;
  return 1;
}
async function keyInfo(c, keyIn) {
  const key = String(keyIn || "");
  const cfg = await c.cfg();
  if (key === "hq:1") return {
    key,
    label: cfg.role1 + " (협회)",
    pos: cfg.role1,
    rank: 9
  };
  if (key === "hq:2") return {
    key,
    label: cfg.role2 + " (협회)",
    pos: cfg.role2,
    rank: 9
  };
  if (key.indexOf("mgr:") === 0) {
    const s = key.slice(4);
    return {
      key,
      label: "임원 " + (await c.managerName(s) || ""),
      pos: "임원",
      rank: 5
    };
  }
  if (key.indexOf("emp:") === 0) {
    const e = (await c.rows("emp")).filter((x)=>String(x.id) === key.slice(4))[0];
    if (e) return {
      key,
      label: e.name + " " + (e.role || ""),
      pos: e.role || "",
      name: e.name,
      rank: rankOf(e.role),
      site: String(e.site || DEFAULT_SITE),
      team: e.team
    };
  }
  return null;
}
async function superiorsOf(c, keyIn) {
  const key = String(keyIn || "");
  const hq = [
    await keyInfo(c, "hq:1"),
    await keyInfo(c, "hq:2")
  ];
  if (key === "hq:1") return [
    hq[1]
  ];
  if (key === "hq:2") return [
    hq[0]
  ];
  if (key.indexOf("mgr:") === 0) return hq;
  const emps = await c.rows("emp"), me = await keyInfo(c, key);
  if (!me) return hq;
  if (me.rank >= 5) return hq;
  const upsE = emps.filter((x)=>{
    const rk = rankOf(x.role);
    return String(x.status) !== "퇴사" && String(x.status) !== "입사예정" && String(x.site || DEFAULT_SITE) === me.site && rk > me.rank && rk < 5;
  }).sort((a, b)=>{
    const ra = rankOf(a.role), rb = rankOf(b.role);
    if (ra !== rb) return ra - rb;
    return (a.team === me.team ? 0 : 1) - (b.team === me.team ? 0 : 1);
  });
  const ups = [];
  for (const x of upsE){
    const k = await keyInfo(c, "emp:" + x.id);
    if (k) ups.push(k);
  }
  const mg = await keyInfo(c, "mgr:" + me.site);
  return ups.concat(mg ? [
    mg
  ] : []).concat(hq);
}
function lineOf(v) {
  try {
    const a = typeof v === "string" ? JSON.parse(v || "[]") : v;
    return Array.isArray(a) ? a : [];
  } catch (_e) {
    return [];
  }
}
const sigKeyForApprover = (k)=>k === "hq:1" ? "role1" : k === "hq:2" ? "role2" : k;
const myApprKeys = (who)=>who.role === "admin" ? [
    "hq:1",
    "hq:2"
  ] : who.role === "manager" ? Array.from(new Set([
    "mgr:" + who.site,
    sigKeyOf(who)
  ])) : [
    sigKeyOf(who)
  ];
async function apprDocs(c, who) {
  const keys = myApprKeys(who);
  return (await c.rows("doc")).filter((d)=>{
    const s = String(d.line || "");
    return keys.some((k)=>s.indexOf('"' + k + '"') >= 0);
  }).sort((a, b)=>String(a.date) < String(b.date) ? 1 : -1).slice(0, 40);
}
// ---------- 역할별 자료 ----------
async function rosterOf(c, site) {
  return (await c.rows("emp")).filter((x)=>String(x.status) !== "퇴사" && String(x.status) !== "입사예정" && String(x.site || DEFAULT_SITE) === String(site) && !x.referrer).map((x)=>({
      name: x.name,
      role: x.role,
      team: x.team,
      phone: x.phone,
      work: x.work
    }));
}
// (11/5) 재적 회원 수 (소개로 들어온 일반회원 포함)
async function memberTotalOf(c, site) {
  return (await c.rows("emp")).filter((x)=>String(x.status) !== "퇴사" && String(x.status) !== "입사예정" && String(x.site || DEFAULT_SITE) === String(site)).length;
}
// (11/6) 임원별 소개 회원 현황 (임원 화면용: 이름·가입일만, 연락처 없음)
async function refStatsOf(c) {
  const emps = await c.rows("emp");
  const live = (x)=>String(x.status) !== "퇴사" && String(x.status) !== "입사예정";
  return emps.filter((o)=>live(o) && OFFICER_RE.test(String(o.role || ""))).map((o)=>({
      id: o.id,
      name: o.name,
      role: o.role || "",
      members: emps.filter((x)=>live(x) && String(x.referrer || "") === String(o.id)).map((x)=>({
          name: x.name,
          joinDate: x.joinDate || x.applyDate || ""
        }))
    })).sort((a, b)=>b.members.length - a.members.length || String(a.name).localeCompare(String(b.name), "ko"));
}
async function supplyTemplate(c, site) {
  const last = (await c.rows("doc")).filter((d)=>String(d.site) === String(site) && d.doctype === "보급품요청").sort((a, b)=>String(a.date) < String(b.date) ? 1 : -1)[0];
  if (last && last.body) return String(last.body);
  return "1) \n2) \n3) \n\n받을 곳: ";
}
async function mgrPosts(c, who) {
  const key = "mgr:" + who.site, reads = await c.reads();
  return (await c.notices()).filter((n)=>String(n.authorKey || "") === key).map((n)=>({
      id: n.id,
      date: n.date,
      title: n.title,
      body: n.body,
      target: n.target,
      reads: reads.filter((r)=>r.noticeId === n.id).map((r)=>r.name)
    }));
}
async function apkInfo(c) {
  return await c.getJson("APK_FILE", null);
}
// 하루 중 처음 자료를 읽을 때 한 시간에 한 번: 입사예정→재직, 퇴사예정→퇴사, 빈 건물값 채우기
async function maintIfDue(c) {
  try {
    const last = Number(await c.get("MAINT_AT") || 0);
    if (Date.now() - last < 3600000) return;
    await c.set("MAINT_AT", String(Date.now()));
    const t = today();
    for (const e of (await c.rows("emp"))){
      let ch = false;
      const o = {
        ...e
      };
      if (String(o.site || "").trim() === "") {
        o.site = DEFAULT_SITE;
        ch = true;
      }
      let st = String(o.status || "").trim();
      const join = String(o.joinDate || "").slice(0, 10), plan = String(o.leavePlan || "").slice(0, 10);
      if (st === "입사예정" && join && join <= t) {
        o.status = "재직";
        st = "재직";
        ch = true;
      }
      if (st !== "퇴사" && st !== "입사예정" && plan && plan <= t) {
        o.status = "퇴사";
        if (!String(o.leaveDate || "")) o.leaveDate = plan;
        o.leavePlan = "";
        ch = true;
      }
      if (ch) await c.put("emp", o);
    }
    for (const x of (await c.rows("exp"))){
      if (String(x.site || "").trim() === "") await c.put("exp", {
        ...x,
        site: DEFAULT_SITE
      });
    }
  } catch (_e) {}
}
// ---------- (11/5) 공용 자료실 ----------
const LIB_CATS = [
  "협회 기본 서류",
  "회의 기록",
  "가입·회원 서식",
  "재정",
  "대외 활동·정책",
  "교육·민간자격",
  "사업 계획"
];
async function libAll(c) {
  const v = await c.getJson("LIBRARY", []);
  return Array.isArray(v) ? v : [];
}
async function libFor(c, who) {
  const officer = who.role === "admin" || who.role === "manager";
  return (await libAll(c)).filter((x)=>officer || String(x.scope || "all") !== "officer");
}
async function dataFor(c, who) {
  // 필요한 표를 동시에 미리 읽어 둠 (아래에서는 기억해 둔 값을 씀)
  await Promise.all([
    c.settings(),
    c.rows("emp"),
    c.rows("doc"),
    c.notices(),
    c.reads(),
    c.sigIndex(),
    who.role === "staff" ? c.pay() : Promise.resolve(null),
    who.role !== "staff" ? c.rows("exp") : Promise.resolve(null),
    who.role === "admin" ? c.pay() : Promise.resolve(null)
  ]);
  const cfg = await c.cfg();
  if (who.role === "admin") {
    await maintIfDue(c);
    const reads = await c.reads();
    const pins = await c.mgrPins();
    return {
      ok: true,
      expenses: await c.rows("exp"),
      docs: await c.rows("doc"),
      employees: await c.rows("emp"),
      empForms: {
        slots: FORM_SLOTS,
        files: await c.getJson("EMP_FORMS2", {})
      },
      pest: await c.getJson("PEST", {}),
      pestLast: await c.get("PEST_LAST") || "",
      role1: cfg.role1,
      role2: cfg.role2,
      apk: await apkInfo(c),
      role: "admin",
      name: "관리자",
      notices: (await c.notices()).map((n)=>({
          ...n,
          reads: reads.filter((r)=>r.noticeId === n.id).map((r)=>r.name)
        })),
      mgrSites: Object.keys(pins),
      siteDocs: await c.getJson("SITE_DOCS", null),
      mySigs: await mySigs(c, who),
      paySummary: await paySummary(c),
      library: await libFor(c, who)
    };
  }
  if (who.role === "manager") {
    const own = (x)=>String(x.site) === String(who.site) && String(x.createdRole) === "manager";
    return {
      ok: true,
      role: "manager",
      name: who.name,
      site: who.site,
      role1: cfg.role1,
      role2: cfg.role2,
      expenses: (await c.rows("exp")).filter(own),
      docs: (await c.rows("doc")).filter(own),
      notices: await myNotices(c, who),
      roster: await rosterOf(c, who.site),
      memberTotal: await memberTotalOf(c, who.site),
      supplyTemplate: await supplyTemplate(c, who.site),
      meId: who.emp ? who.id : "",
      employees: who.emp ? (await c.rows("emp")).filter((x)=>String(x.referrer || "") === String(who.id) && String(x.status) !== "퇴사") : [],
      refStats: who.emp ? await refStatsOf(c) : [],
      myPosts: await mgrPosts(c, who),
      mySigs: await mySigs(c, who),
      approvers: await superiorsOf(c, sigKeyOf(who)),
      apprDocs: await apprDocs(c, who),
      library: await libFor(c, who)
    };
  }
  const me = who.emp;
  return {
    ok: true,
    role: "staff",
    name: me.name,
    site: who.site,
    me: {
      id: me.id,
      name: me.name,
      role: me.role,
      team: me.team,
      work: me.work,
      phone: me.phone,
      joinDate: me.joinDate,
      status: me.status,
      leavePlan: me.leavePlan,
      site: who.site,
      resignDocs: (me.attachments || []).filter((a)=>/사직/.test(String(a.name || ""))).map((a)=>({
          name: a.name
        }))
    },
    notices: await myNotices(c, who),
    roster: await rosterOf(c, who.site),
    memberTotal: await memberTotalOf(c, who.site),
    payslips: await myPayslips(c, me.id),
    mySigs: await mySigs(c, who),
    myDocs: (await c.rows("doc")).filter((x)=>String(x.createdKey) === "emp:" + me.id).sort((a, b)=>String(a.date) < String(b.date) ? 1 : -1),
    approvers: await superiorsOf(c, "emp:" + me.id),
    apprDocs: await apprDocs(c, who),
    library: await libFor(c, who)
  };
}
async function notifyFor(c, who) {
  if (who.role === "admin") {
    const items = [];
    (await c.rows("exp")).concat(await c.rows("doc")).forEach((x)=>{
      if (String(x.cur || "").indexOf("hq:") === 0) {
        items.push({
          id: "a:" + x.id + ":" + lineOf(x.line).length,
          title: "📝 기안 결재 요청",
          body: String(x.title || "기안서")
        });
        return;
      }
      if (!x.line && (String(x.createdRole) === "manager" || String(x.createdRole) === "staff") && !x.role1By && !x.role2By) {
        items.push({
          id: "m:" + x.id,
          title: String(x.createdRole) === "staff" ? "회원 기안 결재 요청" : "임원 결재 요청",
          body: String(x.title || x.items || x.doctype || "새 문서")
        });
      }
    });
    return items.slice(-20);
  }
  const its = (await myNotices(c, who)).filter((n)=>!n.read).map((n)=>({
      id: "n:" + n.id,
      title: "📢 " + n.title,
      body: String(n.body || "").slice(0, 80)
    }));
  const myk = sigKeyOf(who);
  const myks = myApprKeys(who);
  (await apprDocs(c, who)).forEach((d)=>{
    if (myks.indexOf(String(d.cur)) >= 0) its.push({
      id: "a:" + d.id + ":" + lineOf(d.line).length,
      title: "📝 결재할 기안서가 있습니다",
      body: String(d.title || "")
    });
  });
  (await c.rows("doc")).forEach((d)=>{
    if (String(d.createdKey) === myk && /결재 완료|반려/.test(String(d.status))) {
      its.push({
        id: "r:" + d.id + ":" + d.status,
        title: String(d.status) === "반려" ? "↩️ 기안서가 반려되었습니다" : "✅ 기안서 결재가 끝났습니다",
        body: String(d.title || "")
      });
    }
  });
  if (who.role === "staff") {
    (await myPayslips(c, who.id)).slice(0, 2).forEach((p)=>its.push({
        id: "p:" + p.month,
        title: "💰 " + Number(p.month.slice(5)) + "월 급여명세서가 도착했습니다",
        body: "회원 앱에서 확인해 주세요."
      }));
  }
  return its;
}
function statusOf(o) {
  return o.role1By && o.role2By ? "승인완료" : o.role1By || o.role2By ? "진행중" : "";
}
// ---------- (11/3) 영수증 사진 읽기 : 서버의 AI 키로 (화면에서 키를 넣을 필요 없음) ----------
// ---------- (11/5) 회원가입신청서 사진 읽기 : 손글씨 → 입력칸 (서버의 AI 키 사용) ----------
async function formRead(body) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!key) return {
    ok: false,
    nokey: true,
    error: "서버에 AI 키(ANTHROPIC_API_KEY)가 아직 없어 글자를 자동으로 읽을 수 없어요. 직접 입력해 주세요."
  };
  const b64 = String(body.image || "").replace(/^data:[^,]*,/, "");
  if (!b64) return {
    ok: false,
    error: "사진이 없어요."
  };
  if (b64.length > 7000000) return {
    ok: false,
    error: "사진이 너무 커요 (5MB 이하)."
  };
  let mt = String(body.type || "image/jpeg");
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mt)) mt = "image/jpeg";
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  const prompt = "이 사진은 한국반려동물이동장례협회 '회원가입신청서'를 손으로 작성한 것입니다. 손글씨와 체크 표시를 읽어 아래 JSON 하나만, 설명 없이 응답하세요.\n" + '{"name":"성명","birth":"생년월일 숫자 6자리(YYMMDD)","gender":"남|여|","phone":"010-0000-0000 형식","email":"이메일","addr":"주소","job":"직업·소속","pet":"없음|있음","petd":"반려동물 종류·마릿수","path":"가입 경로(회원 소개/공청회·행사/홈페이지/기타)","referrer":"소개자 이름","mtype":"일반회원|특별회원|임원(후보)","privacy":true,"rules":true,"notice":true,"date":"신청일 YYYY-MM-DD","unsure":["읽기 애매한 항목의 키"]}\n' + "규칙: 빈칸이거나 체크가 없으면 빈 문자열(체크 항목은 false). 연도는 '20 26'처럼 나뉘어 있어도 2026으로. 이메일·전화번호의 숫자와 영문은 한 글자씩 신중히 읽고, 애매하면 가장 그럴듯한 값을 넣되 그 키를 unsure에 넣으세요. 회원 구분은 ✓ 표시된 칸 하나.";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mt,
                  data: b64
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      })
    });
    const j = await r.json();
    if (j.error) return {
      ok: false,
      error: "AI 오류: " + (j.error.message || "")
    };
    const text = (j.content || []).filter((x)=>x.type === "text").map((x)=>x.text).join("\n");
    const s0 = text.indexOf("{"), e0 = text.lastIndexOf("}");
    if (s0 < 0 || e0 < 0) return {
      ok: false,
      error: "신청서 글자를 읽지 못했어요. 직접 입력해 주세요."
    };
    const p = JSON.parse(text.slice(s0, e0 + 1));
    const str = (v)=>v == null ? "" : String(v).trim();
    const birth = str(p.birth).replace(/\D/g, "").slice(0, 6);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date)) ? str(p.date) : "";
    return {
      ok: true,
      form: {
        name: str(p.name).replace(/\s+/g, ""),
        birth,
        gender: /^(남|여)$/.test(str(p.gender)) ? str(p.gender) : "",
        phone: str(p.phone),
        email: str(p.email).replace(/\s+/g, ""),
        addr: str(p.addr),
        job: str(p.job),
        pet: str(p.pet) === "있음" ? "있음" : str(p.pet) === "없음" ? "없음" : "",
        petd: str(p.petd),
        path: str(p.path),
        referrer: str(p.referrer),
        mtype: /^(일반회원|특별회원|임원\(후보\))$/.test(str(p.mtype)) ? str(p.mtype) : "",
        privacy: p.privacy === true,
        rules: p.rules === true,
        notice: p.notice === true,
        date,
        unsure: Array.isArray(p.unsure) ? p.unsure.map(String).slice(0, 20) : []
      }
    };
  } catch (e) {
    return {
      ok: false,
      error: "AI 연결 실패: " + String(e?.message || e)
    };
  }
}
async function receiptRead(body) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!key) return {
    ok: false,
    error: "서버에 AI 키가 아직 없어요. 직접 입력해 주세요."
  };
  const b64 = String(body.image || "").replace(/^data:[^,]*,/, "");
  if (!b64) return {
    ok: false,
    error: "사진이 없어요."
  };
  if (b64.length > 7000000) return {
    ok: false,
    error: "사진이 너무 커요 (5MB 이하)."
  };
  let mt = String(body.type || "image/jpeg");
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mt)) mt = "image/jpeg";
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  const prompt = "다음 영수증/구매내역 이미지에서 지출 정보를 추출하세요. 반드시 아래 JSON 형식으로만, 설명 없이 JSON 하나만 응답:\n" + '{"date":"YYYY-MM-DD","vendor":"구매처","items":"품목 요약","amount":정수금액,"supply":정수공급가액,"vat":정수부가세,"category":"소모품비|복리후생비|교육훈련비|미화용품비|회식비|수선비|기타","memo":""}\n' + "amount는 총결제금액. 영수증에 공급가액·부가세가 따로 있으면 그대로, 없으면 supply=amount/1.1 반올림, vat=amount-supply. date 못 찾으면 빈 문자열. 커피믹스·간식·쌀은 복리후생비, 청소·미화용품은 미화용품비, A4용지·문구는 소모품비, 수리·부품은 수선비.";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mt,
                  data: b64
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      })
    });
    const j = await r.json();
    if (j.error) return {
      ok: false,
      error: "AI 오류: " + (j.error.message || "")
    };
    const text = (j.content || []).filter((x)=>x.type === "text").map((x)=>x.text).join("\n");
    const s0 = text.indexOf("{"), e0 = text.lastIndexOf("}");
    if (s0 < 0 || e0 < 0) return {
      ok: false,
      error: "영수증 내용을 읽지 못했어요. 직접 입력해 주세요."
    };
    const p = JSON.parse(text.slice(s0, e0 + 1));
    const n = (v)=>{
      const x = parseInt(String(v == null ? "" : v).replace(/[^0-9-]/g, ""), 10);
      return isNaN(x) ? 0 : x;
    };
    const amount = n(p.amount);
    let supply = n(p.supply), vat = n(p.vat);
    if (amount && (!supply || supply + vat !== amount)) {
      supply = Math.round(amount / 1.1);
      vat = amount - supply;
    }
    return {
      ok: true,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || "")) ? p.date : "",
      vendor: String(p.vendor || ""),
      items: String(p.items || ""),
      amount,
      supply,
      vat,
      category: String(p.category || "기타"),
      memo: String(p.memo || "")
    };
  } catch (e) {
    return {
      ok: false,
      error: "AI 연결 실패: " + String(e?.message || e)
    };
  }
}
// ---------- GET ----------
async function handleGet(c, p) {
  if (p.get("f")) return await serveFile(c, String(p.get("f")), String(p.get("s") || ""), p.get("dl") === "1");
  const api = p.get("api") || "";
  const adminSet = async ()=>!!await c.get("ADMIN_PIN");
  if (api === "auth" || api === "boot") {
    const o = {
      ok: api === "auth",
      auth: true,
      adminSet: await adminSet(),
      testMode: await c.testMode()
    };
    if (api === "boot") {
      const who = await c.readTk(p.get("tk"));
      if (who) {
        o.lite = true;
        o.tk = String(p.get("tk") || "");
        o.role = who.role;
        o.name = who.name || (who.role === "admin" ? "관리자" : "");
        o.site = who.site || "";
      }
    }
    return json(o);
  }
  if (api === "data") {
    const who = await c.readTk(p.get("tk"));
    if (!who) return json({
      ok: false,
      auth: true,
      adminSet: await adminSet(),
      testMode: await c.testMode(),
      error: "로그인이 필요합니다"
    });
    return json(await dataFor(c, who));
  }
  if (api === "notify") {
    const who = await c.readTk(p.get("tk"));
    if (!who) return json({
      ok: false,
      auth: true
    });
    return json({
      ok: true,
      items: await notifyFor(c, who)
    });
  }
  if (api === "approve") {
    const cfg = await c.cfg();
    const role = String(p.get("role")) === "2" ? 2 : 1, siteName = String(p.get("site") || ""), token = String(p.get("t") || "");
    const valid = token === await c.tokenFor(String(role), siteName);
    if (!valid) return json({
      ok: false,
      valid: false,
      error: "유효하지 않은 결재 링크입니다. 링크를 다시 확인해 주세요."
    });
    const atts = (x)=>(x.attachments || []).map((a)=>({
          name: a.name,
          url: a.url
        }));
    const items = (await c.rows("exp")).filter((x)=>String(x.site) === siteName).map((x)=>({
        id: x.id,
        date: x.date,
        category: x.category,
        vendor: x.vendor,
        items: x.items,
        amount: x.amount,
        title: x.title,
        lines: x.lines || [],
        purpose: x.purpose,
        reference: x.reference,
        createdBy: x.createdBy,
        evidence: x.evidence,
        payment: x.payment,
        supply: x.supply,
        vat: x.vat,
        bizno: x.bizno,
        mineBy: role === 1 ? x.role1By : x.role2By,
        otherBy: role === 1 ? x.role2By : x.role1By,
        status: x.status,
        atts: atts(x)
      }));
    const docs = (await c.rows("doc")).filter((x)=>String(x.site) === siteName).map((x)=>({
        id: x.id,
        date: x.date,
        doctype: x.doctype,
        title: x.title,
        body: x.body,
        createdBy: x.createdBy,
        mineBy: role === 1 ? x.role1By : x.role2By,
        otherBy: role === 1 ? x.role2By : x.role1By,
        status: x.status,
        atts: atts(x)
      }));
    return json({
      ok: true,
      valid: true,
      role,
      site: siteName,
      roleName: role === 1 ? cfg.role1 : cfg.role2,
      otherName: role === 1 ? cfg.role2 : cfg.role1,
      items,
      docs
    });
  }
  if (api === "view") {
    const kind = p.get("kind") === "doc" ? "doc" : "exp";
    const o = await c.find(kind, p.get("id") || "");
    if (!o) return json({
      ok: false,
      error: "해당 결의서를 찾을 수 없습니다. 링크를 다시 확인해 주세요."
    });
    const cfg = await c.cfg();
    return json({
      ok: true,
      kind,
      role1: cfg.role1,
      role2: cfg.role2,
      item: o
    });
  }
  if (api === "install") {
    const info = await apkInfo(c);
    if (!info || !info.id) return json({
      ok: true,
      apk: null
    });
    return json({
      ok: true,
      apk: {
        name: info.name,
        at: info.at,
        url: await fileUrl(c, String(info.id)) + "&dl=1"
      }
    });
  }
  if (api === "forms") return json({
    ok: true,
    slots: FORM_SLOTS,
    files: await c.getJson("EMP_FORMS2", {})
  });
  return json({
    ok: true,
    service: "kmpfa",
    time: new Date().toISOString()
  });
}
// ---------- POST ----------
async function handlePost(c, body) {
  const a = String(body.action || "");
  const who = await c.readTk(body.tk);
  if (!PUBLIC_ACTIONS[a]) {
    if (!who) return {
      ok: false,
      auth: true,
      error: "로그인이 필요합니다. 다시 로그인해 주세요."
    };
    if (who.role === "staff" && !STAFF_ACTIONS[a]) return {
      ok: false,
      error: "권한이 없습니다."
    };
    if (who.role === "manager" && !MANAGER_ACTIONS[a]) return {
      ok: false,
      error: "권한이 없습니다."
    };
  }
  const W = who;
  const isMgr = !!who && who.role === "manager";
  const mgrOwn = (row)=>String(row.site) === String(W.site) && String(row.createdRole) === "manager" && !row.role1By && !row.role2By;
  const TEST = await c.testMode();
  // ============ 로그인 ============
  if (a === "login") {
    const mode = String(body.mode || "");
    if (mode === "staff") {
      // (10/27) 비밀번호 = 직원 명부 휴대폰 번호 뒷자리 4자리 (pw). 예전 화면(birth)도 당분간 받아 줌.
      const nm = normName(body.name), bd = String(body.birth || "").replace(/\D/g, ""), pw = String(body.pw || "").replace(/\D/g, "");
      const fk = "staff_" + nm;
      if (await failCheck(fk)) return {
        ok: false,
        error: "여러 번 틀려서 10분간 잠겼습니다. 잠시 후 다시 시도해 주세요."
      };
      const same = (await c.rows("emp")).filter((x)=>normName(x.name) === nm && String(x.status) !== "퇴사");
      if (TEST && same.length) {
        const t0 = same.filter((x)=>pw && last4(x.phone) === pw)[0] || same[0];
        return {
          ok: true,
          tk: await c.makeTk("staff", t0.id),
          role: "staff",
          name: t0.name
        };
      }
      const hitE = pw ? same.filter((x)=>last4(x.phone).length === 4 && last4(x.phone) === pw)[0] : same.filter((x)=>bd && String(x.birth) === bd)[0];
      if (!hitE) {
        await failAdd(fk);
        return {
          ok: false,
          error: pw ? "이름 또는 휴대폰 번호 뒷자리가 맞지 않습니다. (회원 명부에 휴대폰 번호가 등록되어 있어야 해요)" : "이름 또는 생년월일이 맞지 않습니다."
        };
      }
      await failClear(fk);
      return {
        ok: true,
        tk: await c.makeTk("staff", hitE.id),
        role: "staff",
        name: hitE.name
      };
    }
    const pin = String(body.pin || "");
    if (TEST && mode === "admin") return {
      ok: true,
      tk: await c.makeTk("admin", "A"),
      role: "admin",
      name: "관리자"
    };
    if (mode === "manager" && normName(body.name)) {
      // (11/4) 임원 = 이름 + 휴대폰 번호 뒷자리 4자리. 회원 명부에서 직책이 임원(이사·감사·대표·사무국장 등)인 재직자만. 토큰에 본인 id를 담아 임원마다 자기 이름으로 활동.
      const mn = normName(body.name), mpw = String(body.pw || "").replace(/\D/g, ""), mk = "mgr_" + mn;
      if (await failCheck(mk)) return {
        ok: false,
        error: "여러 번 틀려서 10분간 잠겼습니다. 잠시 후 다시 시도해 주세요."
      };
      const ms = (await c.rows("emp")).filter((x)=>normName(x.name) === mn && String(x.status) !== "퇴사" && OFFICER_RE.test(String(x.role || "")));
      const hm = ms.filter((x)=>last4(x.phone).length === 4 && last4(x.phone) === mpw)[0] || (TEST ? ms[0] : null);
      if (!hm) {
        await failAdd(mk);
        return {
          ok: false,
          error: "이름 또는 휴대폰 번호 뒷자리가 맞지 않습니다. (회원 명부에 직책이 이사·감사 등 임원으로 등록되어 있어야 해요)"
        };
      }
      await failClear(mk);
      const msite = String(hm.site || DEFAULT_SITE);
      return {
        ok: true,
        tk: await c.makeTk("manager", hm.id),
        role: "manager",
        name: hm.name,
        site: msite
      };
    }
    if (TEST && mode === "manager") {
      const ts = String(body.site || "") || DEFAULT_SITE;
      return {
        ok: true,
        tk: await c.makeTk("manager", ts),
        role: "manager",
        name: await c.managerName(ts),
        site: ts
      };
    }
    if (mode === "admin") {
      if (await failCheck("admin")) return {
        ok: false,
        error: "여러 번 틀려서 10분간 잠겼습니다."
      };
      const ah = await c.get("ADMIN_PIN");
      if (!ah) return {
        ok: false,
        needSetup: true,
        error: "관리자 비밀번호를 먼저 정해 주세요."
      };
      if (await c.pinHash(pin) !== ah) {
        const n1 = await failAdd("admin");
        return {
          ok: false,
          error: "비밀번호가 틀렸습니다. (" + n1 + "/5)"
        };
      }
      await failClear("admin");
      return {
        ok: true,
        tk: await c.makeTk("admin", "A"),
        role: "admin",
        name: "관리자"
      };
    }
    if (mode === "manager") {
      if (await failCheck("mgr")) return {
        ok: false,
        error: "여러 번 틀려서 10분간 잠겼습니다."
      };
      const pins = await c.mgrPins(), ph = await c.pinHash(pin);
      let site = null;
      Object.keys(pins).forEach((k)=>{
        if (pins[k] === ph) site = k;
      });
      if (!site) {
        const n2 = await failAdd("mgr");
        return {
          ok: false,
          error: "비밀번호가 틀렸습니다. (" + n2 + "/5)"
        };
      }
      await failClear("mgr");
      return {
        ok: true,
        tk: await c.makeTk("manager", site),
        role: "manager",
        name: await c.managerName(site),
        site
      };
    }
    return {
      ok: false,
      error: "bad mode"
    };
  }
  if (a === "adminSetup") {
    if (await c.get("ADMIN_PIN")) return {
      ok: false,
      error: "이미 설정되어 있습니다."
    };
    const np = String(body.pin || "");
    if (!/^\d{4}$/.test(np)) return {
      ok: false,
      error: "숫자 4자리로 정해 주세요."
    };
    await c.set("ADMIN_PIN", await c.pinHash(np));
    return {
      ok: true,
      tk: await c.makeTk("admin", "A"),
      role: "admin",
      name: "관리자"
    };
  }
  if (a === "changeAdminPin") {
    const cp = String(body.pin || "");
    if (!/^\d{4}$/.test(cp)) return {
      ok: false,
      error: "숫자 4자리로 정해 주세요."
    };
    await c.set("ADMIN_PIN", await c.pinHash(cp));
    return {
      ok: true
    };
  }
  if (a === "setMgrPin") {
    const sp = String(body.pin || ""), ss = String(body.site || "");
    if (!ss) return {
      ok: false,
      error: "지부를 선택해 주세요."
    };
    const mp = await c.mgrPins();
    if (sp === "") {
      delete mp[ss];
    } else {
      if (!/^\d{4}$/.test(sp)) return {
        ok: false,
        error: "숫자 4자리로 정해 주세요."
      };
      const hh = await c.pinHash(sp);
      if (hh === await c.get("ADMIN_PIN")) return {
        ok: false,
        error: "관리자 비밀번호와 다르게 정해 주세요."
      };
      for (const k of Object.keys(mp)){
        if (k !== ss && mp[k] === hh) return {
          ok: false,
          error: "다른 지부 임원 비밀번호와 겹칩니다."
        };
      }
      mp[ss] = hh;
    }
    await c.set("MGR_PINS", JSON.stringify(mp));
    return {
      ok: true,
      sites: Object.keys(mp)
    };
  }
  if (a === "logoutAll") {
    const ep = Number(await c.get("TK_EPOCH") || "1") + 1;
    await c.set("TK_EPOCH", String(ep));
    return {
      ok: true,
      tk: await c.makeTk("admin", "A")
    };
  }
  if (a === "setTestMode") {
    await c.set("TEST_MODE", body.on ? "1" : "0");
    return {
      ok: true,
      testMode: !!body.on
    };
  }
  // ============ 자료 옮기기 (관리자 전용 · 구글 시트 자료를 통째로 받아 넣음) ============
  if (a === "importAll") {
    if (W.role !== "admin") return {
      ok: false,
      error: "권한이 없습니다."
    };
    const cnt = {};
    if (body.wipe === true) {
      for (const t of [
        "expenses",
        "docs",
        "employees",
        "notices",
        "signatures",
        "payslips"
      ])must(await sb.from(t).delete().neq("id", ""));
      must(await sb.from("notice_reads").delete().neq("notice_id", ""));
      must(await sb.from("login_fails").delete().neq("key", ""));
    }
    const chunk = async (table, rows)=>{
      for(let i = 0; i < rows.length; i += 200)must(await sb.from(table).upsert(rows.slice(i, i + 200)));
    };
    for (const [key, table] of [
      [
        "expenses",
        "expenses"
      ],
      [
        "docs",
        "docs"
      ],
      [
        "employees",
        "employees"
      ],
      [
        "notices",
        "notices"
      ]
    ]){
      const arr = body[key] || [];
      await chunk(table, arr.filter((x)=>x && x.id).map((x)=>({
          id: String(x.id),
          data: x
        })));
      cnt[key] = arr.length;
    }
    const sigs = body.signatures || [];
    await chunk("signatures", sigs.filter((x)=>x && x.id && x.data).map((x)=>({
        id: String(x.id),
        key: String(x.key || "legacy:" + x.id),
        name: String(x.name || ""),
        data: String(x.data)
      })));
    cnt.signatures = sigs.length;
    const pays = body.payslips || [];
    await chunk("payslips", pays.filter((x)=>x && x.month && x.empId).map((x)=>({
        id: String(x.id || "p" + Date.now().toString(36) + rid(6)),
        month: String(x.month),
        emp_id: String(x.empId),
        name: String(x.name || ""),
        data: x.data || {},
        open_date: String(x.openDate || ""),
        published_at: String(x.publishedAt || "")
      })));
    cnt.payslips = pays.length;
    const st = body.settings || {};
    for (const k of [
      "ROLE1",
      "ROLE2",
      "PEST",
      "PEST_LAST",
      "EMP_FORMS2",
      "SITE_DOCS"
    ]){
      if (st[k] != null && st[k] !== "") {
        await c.set(k, typeof st[k] === "string" ? st[k] : JSON.stringify(st[k]));
        cnt["set:" + k] = 1;
      }
    }
    return {
      ok: true,
      counts: cnt
    };
  }
  // ============ 공지 ============
  if (a === "noticeAdd") {
    const nr = body.record || {};
    if (isMgr) {
      nr.site = W.site;
      nr.author = "임원 " + (W.name || "");
      if (!/^(staff|all|team:.+)$/.test(String(nr.target || ""))) nr.target = "staff";
      if (String(nr.target) === "all") nr.target = "staff";
    }
    const nlinks = await saveAtts(c, "공지/" + (nr.site || DEFAULT_SITE), body.attachments || []);
    const nid = "n" + Date.now().toString(36) + rid(3);
    const nm2 = {
      id: nid,
      date: today(),
      title: String(nr.title || ""),
      body: String(nr.body || ""),
      target: String(nr.target || "all"),
      site: String(nr.site || ""),
      author: String(nr.author || "관리자"),
      createdAt: new Date().toISOString(),
      attachments: nlinks,
      authorKey: W.role === "manager" ? "mgr:" + W.site : sigKeyOf(W)
    };
    must(await sb.from("notices").insert({
      id: nid,
      data: nm2
    }));
    return {
      ok: true,
      id: nid
    };
  }
  if (a === "noticeDelete") {
    const r = must(await sb.from("notices").select("id,data").eq("id", String(body.id)).maybeSingle());
    if (r && isMgr && String((r.data || {}).authorKey) !== "mgr:" + W.site) return {
      ok: false,
      error: "내가 쓴 공지만 지울 수 있습니다."
    };
    if (r) {
      must(await sb.from("notices").delete().eq("id", r.id));
      await sb.from("notice_reads").delete().eq("notice_id", r.id);
    }
    return {
      ok: true
    };
  }
  if (a === "noticeRead") {
    await sb.from("notice_reads").upsert({
      notice_id: String(body.id),
      who: whoKey(W),
      name: W.name || "",
      at: new Date().toISOString()
    }, {
      onConflict: "notice_id,who",
      ignoreDuplicates: true
    });
    return {
      ok: true
    };
  }
  // ============ 기안 결재선: 승인 / 상급자에게 넘기기 / 반려 ============
  if (a === "lineAct") {
    const d = await c.find("doc", body.id);
    if (!d) return {
      ok: false,
      error: "문서를 찾을 수 없습니다."
    };
    const line = lineOf(d.line);
    let cur = String(d.cur || "");
    if (!cur || myApprKeys(W).indexOf(cur) < 0) return {
      ok: false,
      error: "지금 결재할 차례가 아닙니다."
    };
    let ent = null;
    for(let li = line.length - 1; li >= 0; li--){
      if (line[li].key === cur && line[li].st === "wait") {
        ent = line[li];
        break;
      }
    }
    if (!ent) return {
      ok: false,
      error: "결재 정보가 올바르지 않습니다."
    };
    ent.at = today();
    ent.name = W.role === "admin" ? String(body.name || ent.pos || "") : String(W.name || "");
    let nstat;
    if (String(body.act) === "reject") {
      ent.st = "no";
      ent.comment = String(body.comment || "");
      cur = "";
      nstat = "반려";
    } else {
      ent.st = "ok";
      ent.sig = await c.sigIdFor(W.role === "manager" && String(ent.key).indexOf("mgr:") === 0 ? sigKeyOf(W) : sigKeyForApprover(ent.key));
      ent.comment = String(body.comment || "");
      const nx = String(body.next || "");
      if (nx) {
        const used = {};
        line.forEach((x)=>used[x.key] = 1);
        const up = (await superiorsOf(c, ent.key)).filter((s)=>s && s.key === nx && !used[nx])[0];
        if (!up) return {
          ok: false,
          error: "넘길 상급자를 다시 선택해 주세요."
        };
        line.push({
          key: up.key,
          label: up.label,
          pos: up.pos,
          st: "wait"
        });
        cur = up.key;
        nstat = "결재 중";
      } else {
        cur = "";
        nstat = "결재 완료";
      }
    }
    await c.put("doc", {
      ...d,
      line: JSON.stringify(line),
      cur,
      status: nstat
    });
    return {
      ok: true,
      line,
      cur,
      status: nstat
    };
  }
  // ============ 영수증 읽기 (관리자·관리소장) ============
  if (a === "receiptRead") return await receiptRead(body);
  if (a === "formRead") return await formRead(body); // 관리자·임원 (11/6 임원도 자기 회원 등록 때 사용)
  // ============ 시설 자료 · 서명 ============
  if (a === "sigSet") {
    const sd = String(body.data || "");
    if (!/^data:image\/(png|jpeg);base64,/.test(sd)) return {
      ok: false,
      error: "서명 이미지가 올바르지 않습니다."
    };
    if (sd.length > 49000) return {
      ok: false,
      error: "서명 이미지가 너무 큽니다. 다시 찍어 주세요."
    };
    let sk = sigKeyOf(W);
    if (W.role === "admin" && /^(admin|role1|role2)$/.test(String(body.key || ""))) sk = String(body.key);
    const sid = "s" + Date.now().toString(36) + rid(4);
    must(await sb.from("signatures").insert({
      id: sid,
      key: sk,
      name: String(W.name || ""),
      data: sd
    }));
    return {
      ok: true,
      id: sid,
      key: sk
    };
  }
  if (a === "sigGet") {
    const ids = (body.ids || []).slice(0, 40).map(String);
    const out = {};
    if (ids.length) must(await sb.from("signatures").select("id,data").in("id", ids)).forEach((r)=>out[String(r.id)] = String(r.data));
    return {
      ok: true,
      sigs: out
    };
  }
  // ============ 급여명세서 (관리자) ============
  if (a === "payslipUpload") {
    const pm = String(body.month || "");
    if (!/^\d{4}-\d{2}$/.test(pm)) return {
      ok: false,
      error: "귀속 연월이 올바르지 않습니다."
    };
    let pod = String(body.openDate || "");
    if (pod && !/^\d{4}-\d{2}-\d{2}$/.test(pod)) pod = "";
    const byName = {};
    (await c.rows("emp")).forEach((x)=>{
      const k = normName(x.name);
      if (!byName[k] || String(byName[k].status) === "퇴사") byName[k] = x;
    });
    const saved = [], unmatched = [], nowIso = new Date().toISOString(), newRows = [];
    (body.items || []).forEach((it)=>{
      const e = byName[normName(it.name)];
      if (!e) {
        unmatched.push(String(it.name || ""));
        return;
      }
      saved.push(e.name);
      newRows.push({
        id: "p" + Date.now().toString(36) + rid(6),
        month: pm,
        emp_id: String(e.id),
        name: e.name,
        data: it,
        open_date: pod,
        published_at: nowIso
      });
    });
    if (newRows.length) {
      must(await sb.from("payslips").delete().eq("month", pm).in("emp_id", newRows.map((r)=>r.emp_id)));
      must(await sb.from("payslips").insert(newRows));
    }
    return {
      ok: true,
      saved: saved.length,
      unmatched
    };
  }
  if (a === "payslipPdf") {
    if (W.role !== "admin") return {
      ok: false,
      error: "권한이 없습니다."
    };
    const pm = String(body.month || "");
    if (!/^\d{4}-\d{2}$/.test(pm)) return {
      ok: false,
      error: "귀속 연월이 올바르지 않습니다."
    };
    let pod = String(body.openDate || "");
    if (pod && !/^\d{4}-\d{2}-\d{2}$/.test(pod)) pod = "";
    const e = (await c.rows("emp")).filter((x)=>String(x.id) === String(body.empId || ""))[0];
    if (!e) return {
      ok: false,
      error: "회원을 찾을 수 없습니다."
    };
    const b64 = String(body.b64 || "");
    if (b64.indexOf("JVBER") !== 0) return {
      ok: false,
      error: "PDF 파일이 아닙니다."
    };
    if (b64.length > 14000000) return {
      ok: false,
      error: "파일이 너무 큽니다. 10MB 이하로 올려 주세요."
    };
    const old = must(await sb.from("payslips").select("id,data").eq("month", pm).eq("emp_id", String(e.id)));
    for (const o of old){
      const od = o.data || {};
      if (od.pdf && od.pdf.id) await removeFile(od.pdf.id);
    }
    const fl = await saveAtts(c, "급여명세서/" + pm, [
      {
        dataB64: b64,
        type: "application/pdf",
        name: e.name + "_" + pm + "_급여명세서.pdf"
      }
    ]);
    if (!fl.length) return {
      ok: false,
      error: "파일 저장에 실패했습니다."
    };
    if (old.length) must(await sb.from("payslips").delete().eq("month", pm).eq("emp_id", String(e.id)));
    must(await sb.from("payslips").insert({
      id: "p" + Date.now().toString(36) + rid(6),
      month: pm,
      emp_id: String(e.id),
      name: e.name,
      data: {
        name: e.name,
        position: e.role || "",
        pdf: fl[0]
      },
      open_date: pod,
      published_at: new Date().toISOString()
    }));
    return {
      ok: true,
      name: e.name
    };
  }
  if (a === "payslipDelete") {
    const del = must(await sb.from("payslips").delete().eq("month", String(body.month || "")).select("id,data"));
    for (const d of del){
      const dd = d.data || {};
      if (dd.pdf && dd.pdf.id) await removeFile(dd.pdf.id);
    }
    return {
      ok: true,
      removed: del.length
    };
  }
  // ============ 직원: 사직서 제출 ============
  if (a === "resignSubmit") {
    const e = await c.find("emp", W.id);
    if (!e) return {
      ok: false,
      error: "회원 정보를 찾을 수 없습니다."
    };
    const natts = (body.attachments || []).map((x, i)=>({
        ...x,
        name: W.name + "_사직서_" + (i + 1) + "_" + (x.name || "file")
      }));
    const rl = await saveAtts(c, "회원서류/" + (W.site || DEFAULT_SITE), natts);
    const cur = Array.isArray(e.attachments) ? e.attachments : [];
    const o = {
      ...e,
      attachments: cur.concat(rl)
    };
    const lp = String(body.leavePlan || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(lp)) o.leavePlan = lp;
    await c.put("emp", o);
    return {
      ok: true,
      count: rl.length
    };
  }
  // ============ 지출 ============
  if (a === "add") {
    const rec = body.record || {};
    if (isMgr) {
      rec.site = W.site;
      rec.createdBy = W.name || rec.createdBy;
    }
    const links = await saveAtts(c, "지출/" + (rec.site || ""), body.attachments || []);
    const id = String(rec.id || Date.now().toString(36) + rid(5));
    const m = {
      id,
      date: rec.date || "",
      category: rec.category || "",
      vendor: rec.vendor || "",
      items: rec.items || "",
      amount: Number(rec.amount) || 0,
      memo: rec.memo || "",
      attachments: links,
      approvedBy: "",
      approvedAt: "",
      site: rec.site || "",
      createdBy: rec.createdBy || "",
      createdAt: today(),
      role1By: "",
      role1At: "",
      role2By: "",
      role2At: "",
      status: "",
      title: rec.title || "",
      lines: Array.isArray(rec.lines) ? rec.lines : [],
      purpose: rec.purpose || "",
      reference: rec.reference || "",
      evidence: rec.evidence || "",
      payment: rec.payment || "",
      supply: Number(rec.supply) || 0,
      vat: Number(rec.vat) || 0,
      bizno: rec.bizno || "",
      createdRole: isMgr ? "manager" : "admin",
      sig0: await c.sigIdFor(sigKeyOf(W)),
      sig1: "",
      sig2: ""
    };
    must(await sb.from("expenses").insert({
      id,
      data: m
    }));
    return {
      ok: true,
      id,
      attachments: links
    };
  }
  if (a === "update") {
    const urec = body.record || {};
    const u = await c.find("exp", body.id);
    if (!u) return {
      ok: false,
      error: "not found"
    };
    if (isMgr) {
      if (!mgrOwn(u)) return {
        ok: false,
        error: "이미 결재가 진행된 건은 수정할 수 없습니다."
      };
      urec.site = W.site;
    }
    let ulinks = (body.keepAttachments || []).slice();
    ulinks = ulinks.concat(await saveAtts(c, "지출/" + (urec.site || ""), body.attachments || []));
    await c.put("exp", {
      ...u,
      date: urec.date || "",
      category: urec.category || "",
      vendor: urec.vendor || "",
      items: urec.items || "",
      amount: Number(urec.amount) || 0,
      attachments: ulinks,
      site: urec.site || "",
      title: urec.title || "",
      lines: Array.isArray(urec.lines) ? urec.lines : [],
      purpose: urec.purpose || "",
      reference: urec.reference || "",
      evidence: urec.evidence || "",
      payment: urec.payment || "",
      supply: Number(urec.supply) || 0,
      vat: Number(urec.vat) || 0,
      bizno: urec.bizno || "",
      role1By: "",
      role1At: "",
      role2By: "",
      role2At: "",
      status: "",
      sig1: "",
      sig2: ""
    });
    return {
      ok: true,
      attachments: ulinks
    };
  }
  // ============ 결재 (지출/문서 공용) ============
  if (a === "approveRole" || a === "unapproveRole") {
    const kind = body.kind === "doc" ? "doc" : "exp";
    const role = String(body.role) === "2" ? 2 : 1;
    const h = await c.find(kind, body.id);
    if (!h) return {
      ok: false,
      error: "not found"
    };
    const o = {
      ...h
    };
    if (a === "approveRole") {
      o["role" + role + "By"] = body.name || "";
      o["role" + role + "At"] = body.at || today();
      o["sig" + role] = await c.sigIdFor("role" + role);
    } else {
      o["role" + role + "By"] = "";
      o["role" + role + "At"] = "";
      o["sig" + role] = "";
    }
    o.status = statusOf(o);
    await c.put(kind, o);
    return a === "approveRole" ? {
      ok: true,
      status: o.status,
      sig: o["sig" + role]
    } : {
      ok: true
    };
  }
  if (a === "delete") {
    const kind = body.kind === "doc" ? "doc" : body.kind === "emp" ? "emp" : "exp";
    const h = await c.find(kind, body.id);
    if (h && isMgr && (kind === "emp" ? !(W.emp && String(h.referrer || "") === String(W.id)) : !mgrOwn(h))) return {
      ok: false,
      error: "삭제할 수 없는 항목입니다."
    };
    if (h) {
      await c.remove(kind, body.id);
      return {
        ok: true
      };
    }
    return {
      ok: false,
      error: "not found"
    };
  }
  // ============ 문서 ============
  if (a === "docAdd") {
    const drec = body.record || {};
    if (isMgr) {
      drec.site = W.site;
      drec.createdBy = W.name || drec.createdBy;
    }
    const isStf = W.role === "staff";
    if (isStf) {
      drec.site = W.site;
      drec.createdBy = W.name;
      drec.doctype = "기안서";
    }
    const dm = {
      date: drec.date || today(),
      doctype: drec.doctype || "기타",
      title: drec.title || "",
      body: drec.body || "",
      attachments: [],
      site: drec.site || "",
      createdBy: drec.createdBy || "",
      createdAt: today(),
      role1By: "",
      role1At: "",
      role2By: "",
      role2At: "",
      status: "",
      createdRole: isMgr ? "manager" : isStf ? "staff" : "admin",
      sig0: await c.sigIdFor(sigKeyOf(W)),
      sig1: "",
      sig2: "",
      createdKey: sigKeyOf(W),
      line: "",
      cur: ""
    };
    if (body.approver && W.role !== "admin") {
      const okA = (await superiorsOf(c, sigKeyOf(W))).filter((s)=>s && s.key === String(body.approver))[0];
      if (!okA) return {
        ok: false,
        error: "결재자를 다시 선택해 주세요."
      };
      dm.line = JSON.stringify([
        {
          key: okA.key,
          label: okA.label,
          pos: okA.pos,
          st: "wait"
        }
      ]);
      dm.cur = okA.key;
      dm.status = "결재 대기";
    } else if (isStf) {
      return {
        ok: false,
        error: "결재자(상급자)를 선택해 주세요."
      };
    }
    const dlinks = await saveAtts(c, "문서/" + (drec.site || ""), body.attachments || []);
    const did = Date.now().toString(36) + rid(5);
    dm.id = did;
    dm.attachments = dlinks;
    must(await sb.from("docs").insert({
      id: did,
      data: dm
    }));
    return {
      ok: true,
      id: did,
      attachments: dlinks,
      sig0: dm.sig0
    };
  }
  if (a === "docUpdate") {
    const direc = body.record || {};
    const d = await c.find("doc", body.id);
    if (!d) return {
      ok: false,
      error: "not found"
    };
    if (isMgr) {
      if (!mgrOwn(d)) return {
        ok: false,
        error: "이미 결재가 진행된 문서는 수정할 수 없습니다."
      };
      direc.site = W.site;
    }
    let dulinks = (body.keepAttachments || []).slice();
    dulinks = dulinks.concat(await saveAtts(c, "문서/" + (direc.site || ""), body.attachments || []));
    await c.put("doc", {
      ...d,
      date: direc.date || "",
      doctype: direc.doctype || "기타",
      title: direc.title || "",
      body: direc.body || "",
      attachments: dulinks,
      site: direc.site || "",
      role1By: "",
      role1At: "",
      role2By: "",
      role2At: "",
      status: "",
      sig1: "",
      sig2: ""
    });
    return {
      ok: true,
      attachments: dulinks
    };
  }
  // ============ 직원 ============
  if (a === "empAdd" || a === "empUpdate") {
    const er = body.record || {};
    // (11/6) 임원은 자기가 소개한 일반회원만 등록·수정 (소개 임원·소속·상태는 서버가 정함)
    if (isMgr) {
      if (!W.emp) return {
        ok: false,
        error: "임원 본인 이름으로 로그인해야 회원을 등록할 수 있습니다."
      };
      if (a === "empUpdate") {
        const mine = await c.find("emp", body.id);
        if (!mine || String(mine.referrer || "") !== String(W.id)) return {
          ok: false,
          error: "내가 등록한 회원만 수정할 수 있습니다."
        };
      }
      Object.assign(er, {
        role: "회원",
        team: "",
        work: "",
        status: "재직",
        certs: "",
        leaveDate: "",
        leavePlan: "",
        deps: "",
        base: 0,
        allow: 0,
        ot: 0,
        annual: 0,
        sev: 0,
        paySum: 0,
        total: 0,
        referrer: W.id,
        refName: W.name || "",
        site: W.site
      });
    }
    [
      "base",
      "allow",
      "ot",
      "annual",
      "sev"
    ].forEach((k)=>er[k] = Number(er[k]) || 0);
    er.paySum = Number(er.paySum) || 0 || er.base + er.allow + er.ot;
    er.total = Number(er.total) || 0 || er.paySum + er.annual + er.sev;
    const ekeep = (body.keepAttachments || []).slice();
    let eatts = ekeep.concat(await saveAtts(c, "회원서류/" + (er.site || ""), body.attachments || []));
    if (a === "empAdd") {
      const eid = Date.now().toString(36) + rid(5);
      const em = {
        id: eid,
        name: er.name || "",
        role: er.role || "",
        team: er.team || "",
        work: er.work || "",
        gender: er.gender || "",
        phone: er.phone || "",
        joinDate: er.joinDate || "",
        leaveDate: er.leaveDate || "",
        status: er.status || "재직",
        certs: er.certs || "",
        base: er.base,
        allow: er.allow,
        ot: er.ot,
        paySum: er.paySum,
        annual: er.annual,
        sev: er.sev,
        total: er.total,
        memo: er.memo || "",
        site: er.site || "",
        birth: er.birth ? String(er.birth).replace(/\D/g, "") : "",
        deps: er.deps || "",
        attachments: eatts,
        leavePlan: er.leavePlan || "",
        email: er.email || "",
        addr: er.addr || "",
        job: er.job || "",
        pet: er.pet || "",
        mtype: er.mtype || "",
        consent: er.consent || null,
        referrer: er.referrer || "",
        refName: er.refName || "",
        applyDate: er.applyDate || ""
      };
      must(await sb.from("employees").insert({
        id: eid,
        data: em
      }));
      return {
        ok: true,
        id: eid,
        attachments: eatts
      };
    }
    const e = await c.find("emp", body.id);
    if (!e) return {
      ok: false,
      error: "not found"
    };
    const o = {
      ...e
    };
    if (er.birth !== undefined) o.birth = String(er.birth || "").replace(/\D/g, "");
    if (er.deps !== undefined) o.deps = er.deps || "";
    [
      "name",
      "role",
      "team",
      "work",
      "gender",
      "phone",
      "joinDate",
      "leaveDate",
      "status",
      "certs",
      "memo",
      "site",
      "leavePlan"
    ].forEach((k)=>o[k] = er[k] !== undefined ? er[k] : "");
    [
      "base",
      "allow",
      "ot",
      "paySum",
      "annual",
      "sev",
      "total"
    ].forEach((k)=>o[k] = Number(er[k]) || 0);
    [
      "email",
      "addr",
      "job",
      "pet",
      "mtype",
      "consent",
      "referrer",
      "refName",
      "applyDate"
    ].forEach((k)=>{
      if (er[k] !== undefined) o[k] = er[k];
    });
    // 첨부 정보를 보내온 경우에만 첨부란 갱신 (안 보내면 기존 첨부 유지)
    if (body.keepAttachments !== undefined || body.attachments && body.attachments.length) o.attachments = eatts;
    else eatts = Array.isArray(e.attachments) ? e.attachments : [];
    await c.put("emp", o);
    return {
      ok: true,
      attachments: eatts
    };
  }
  if (a === "empSeed") return {
    ok: false,
    error: "새 서버에서는 기본 명단 불러오기를 쓰지 않습니다. 회원을 직접 추가해 주세요."
  };
  // ============ 입사 서류 양식 ============
  if (a === "formSet" || a === "formClear") {
    const key = String(body.key || "");
    const fm = await c.getJson("EMP_FORMS2", {});
    if (a === "formSet") {
      const fl = await saveAtts(c, "입사서류양식", body.attachments || []);
      if (!fl.length) return {
        ok: false,
        error: "파일이 없습니다"
      };
      if (fm[key] && fm[key].id) await removeFile(fm[key].id);
      fm[key] = fl[0];
    } else {
      if (fm[key] && fm[key].id) await removeFile(fm[key].id);
      delete fm[key];
    }
    await c.set("EMP_FORMS2", JSON.stringify(fm));
    return {
      ok: true,
      files: fm
    };
  }
  // ============ 정기 방역 알림 ============
  if (a === "pestSet") {
    const pc = body.cfg || {};
    const saved = {
      enabled: pc.enabled === true,
      email: String(pc.email || "").trim(),
      cc: String(pc.cc || "").trim(),
      day: Math.max(1, Math.min(28, Number(pc.day) || 1)),
      anchor: String(pc.anchor || "").slice(0, 7),
      subject: String(pc.subject || ""),
      body: String(pc.body || "")
    };
    await c.set("PEST", JSON.stringify(saved));
    return {
      ok: true,
      cfg: saved
    };
  }
  if (a === "pestSendNow" || a === "pestTest") return {
    ok: false,
    error: "메일 발송은 새 서버에 아직 연결되지 않았습니다."
  };
  // ============ 앱 설치 파일 ============
  if (a === "apkSet") {
    const fl = await saveAtts(c, "앱설치파일", body.attachments || []);
    if (!fl.length) return {
      ok: false,
      error: "파일이 없습니다"
    };
    const old = await apkInfo(c);
    if (old && old.id) await removeFile(old.id);
    const info = {
      id: fl[0].id,
      name: fl[0].name,
      at: today()
    };
    await c.set("APK_FILE", JSON.stringify(info));
    return {
      ok: true,
      apk: info
    };
  }
  // ============ 기타 ============
  if (a === "approveLink") {
    const cfg = await c.cfg();
    const roleL = String(body.role) === "2" ? 2 : 1, siteName = String(body.site || "");
    return {
      ok: true,
      role: roleL,
      site: siteName,
      t: await c.tokenFor(String(roleL), siteName),
      roleName: roleL === 1 ? cfg.role1 : cfg.role2
    };
  }
  if (a === "renameBuilding") {
    const from = String(body.from || ""), to = String(body.to || "");
    if (!from || !to) return {
      ok: false,
      error: "bad names"
    };
    let n = 0;
    for (const x of (await c.rows("exp"))){
      if (String(x.site) === from) {
        await c.put("exp", {
          ...x,
          site: to
        });
        n++;
      }
    }
    return {
      ok: true,
      changed: n
    };
  }
  if (a === "setRoles") {
    if (body.role1) await c.set("ROLE1", String(body.role1));
    if (body.role2) await c.set("ROLE2", String(body.role2));
    return {
      ok: true
    };
  }
  // ============ 로그인 없이 쓰는 것: 결재 링크 승인 · 입사 서류 제출 ============
  if (a === "apApprove") {
    const kind = body.kind === "doc" ? "doc" : "exp";
    const h = await c.find(kind, body.id);
    if (!h) return {
      ok: false,
      error: "항목을 찾을 수 없습니다."
    };
    const role = String(body.role) === "2" ? 2 : 1;
    if (String(body.token || "") !== await c.tokenFor(String(role), String(h.site || ""))) return {
      ok: false,
      error: "권한이 없습니다."
    };
    if (!body.name) return {
      ok: false,
      error: "이름을 입력하세요."
    };
    const o = {
      ...h
    };
    o["role" + role + "By"] = String(body.name);
    o["role" + role + "At"] = today();
    o["sig" + role] = await c.sigIdFor("role" + role);
    o.status = statusOf(o);
    await c.put(kind, o);
    return {
      ok: true
    };
  }
  if (a === "hireUpload") {
    const nm = String(body.name || "").trim();
    if (!nm) return {
      ok: false,
      error: "이름을 입력하세요."
    };
    if (!body.b64) return {
      ok: false,
      error: "파일이 비어 있습니다."
    };
    if (String(body.b64).length > 14000000) return {
      ok: false,
      error: "파일이 너무 큽니다. 10MB 이하로 올려 주세요."
    };
    await saveAtts(c, "입사서류제출/" + nm, [
      {
        dataB64: body.b64,
        type: body.ftype,
        name: nm + "_" + String(body.title || "서류") + "_" + String(body.fname || "file_" + Date.now())
      }
    ]);
    return {
      ok: true
    };
  }
  // ============ (11/5) 공용 자료실 : 관리자만 올리기·고치기·지우기 ============
  if (a === "libAdd") {
    const cat = LIB_CATS.indexOf(String(body.cat)) >= 0 ? String(body.cat) : LIB_CATS[0];
    const scope = String(body.scope) === "officer" ? "officer" : "all";
    const atts = body.attachments || [];
    if (!atts.length) return {
      ok: false,
      error: "파일을 선택해 주세요."
    };
    if (atts.some((x)=>String(x.dataB64 || "").length > 14000000)) return {
      ok: false,
      error: "파일이 너무 큽니다. 10MB 이하로 올려 주세요."
    };
    const saved = await saveAtts(c, "자료실/" + cat, atts);
    const list = await libAll(c);
    saved.forEach((f, i)=>{
      const t = String(body.title || "").trim();
      list.push({
        id: "L" + Date.now().toString(36) + rid(4),
        cat,
        title: t ? saved.length > 1 ? t + " (" + (i + 1) + ")" : t : String(f.name).replace(/\.[^.]+$/, ""),
        name: f.name,
        url: f.url,
        fileId: f.id,
        type: f.type,
        scope,
        at: today()
      });
    });
    await c.set("LIBRARY", JSON.stringify(list));
    return {
      ok: true,
      library: await libFor(c, W)
    };
  }
  if (a === "libUpdate") {
    const list = await libAll(c);
    const x = list.filter((r)=>String(r.id) === String(body.id))[0];
    if (!x) return {
      ok: false,
      error: "자료를 찾을 수 없습니다."
    };
    if (body.title !== undefined && String(body.title).trim()) x.title = String(body.title).trim();
    if (body.cat !== undefined && LIB_CATS.indexOf(String(body.cat)) >= 0) x.cat = String(body.cat);
    if (body.scope !== undefined) x.scope = String(body.scope) === "officer" ? "officer" : "all";
    await c.set("LIBRARY", JSON.stringify(list));
    return {
      ok: true,
      library: await libFor(c, W)
    };
  }
  if (a === "libDelete") {
    const list = await libAll(c);
    const x = list.filter((r)=>String(r.id) === String(body.id))[0];
    if (!x) return {
      ok: false,
      error: "자료를 찾을 수 없습니다."
    };
    if (x.fileId) await removeFile(x.fileId);
    await c.set("LIBRARY", JSON.stringify(list.filter((r)=>String(r.id) !== String(body.id))));
    return {
      ok: true,
      library: await libFor(c, W)
    };
  }
  return {
    ok: false,
    error: "unknown action"
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  const c = new Ctx();
  try {
    const u = new URL(req.url);
    if (req.method === "GET") return await handleGet(c, u.searchParams);
    if (req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await req.text());
      } catch (_e) {
        return json({
          ok: false,
          error: "요청 형식이 올바르지 않습니다."
        });
      }
      return json(await handlePost(c, body || {}));
    }
    return json({
      ok: false,
      error: "method"
    }, 405);
  } catch (err) {
    return json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});
