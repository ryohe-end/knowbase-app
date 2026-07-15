import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);

// ../../lib/cpss.ts
var BASE_URLS = {
  JOYFIT: { stg: "https://stg-yamauchi.nac.jp", prod: "https://yamauchi.nac.jp" },
  FIT365: { stg: "https://stg-wellness.nac.jp", prod: "https://wellness.nac.jp" }
};
var CpssError = class extends Error {
  constructor(code, msg, transid) {
    super(`CPSS ${code}: ${msg}`);
    this.name = "CpssError";
    this.code = code;
    this.msg = msg;
    this.transid = transid;
  }
};
function creds(brand, env) {
  const p = `CPSS_${brand}_${env.toUpperCase()}`;
  const sid = (process.env[`${p}_SID`] || "").trim();
  const spw = (process.env[`${p}_SPW`] || "").trim();
  if (!sid || !spw) throw new Error(`CPSS \u8A8D\u8A3C\u60C5\u5831\u304C\u672A\u8A2D\u5B9A\u3067\u3059 (${p}_SID / ${p}_SPW)`);
  return { sid, spw };
}
async function call(brand, env, apiset, name, params, opts = {}) {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/${apiset}/api/${name}.php`;
  const body = new URLSearchParams();
  body.set("sid", sid);
  body.set("spw", spw);
  body.set("result", "json_utf8");
  if (opts.test) body.set("test", "1");
  for (const [k, v] of Object.entries(params)) {
    if (v !== void 0 && v !== null && v !== "") body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store"
  });
  if (res.status === 403) throw new CpssError("403", "IP\u672A\u8A31\u53EF(\u9001\u4FE1\u5143IP\u306E\u30DB\u30EF\u30A4\u30C8\u30EA\u30B9\u30C8\u767B\u9332\u304C\u5FC5\u8981)");
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new CpssError(String(res.status), `\u975EJSON\u5FDC\u7B54: ${text.slice(0, 200)}`);
  }
  if (j.code && j.code !== "000-000-000") {
    if (j.code === "001-006-000") return j.result;
    throw new CpssError(j.code, j.msg || "\u30A8\u30E9\u30FC", j.transid);
  }
  return j.result;
}
async function callMultipart(brand, env, apiset, name, fileName, fileBuf, extra = {}) {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/${apiset}/api/${name}.php`;
  const form = new FormData();
  form.set("sid", sid);
  form.set("spw", spw);
  form.set("result", "json_utf8");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  form.set("file", new Blob([new Uint8Array(fileBuf)], { type: "text/csv" }), fileName);
  const res = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  if (res.status === 403) throw new CpssError("403", "IP\u672A\u8A31\u53EF");
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new CpssError(String(res.status), `\u975EJSON\u5FDC\u7B54: ${text.slice(0, 200)}`);
  }
  if (j.code && j.code !== "000-000-000") throw new CpssError(j.code, j.msg || "\u30A8\u30E9\u30FC", j.transid);
  return j.result;
}
async function addMember(brand, env, args) {
  return call(brand, env, "cmmm", "add_member", {
    aid: args.aid,
    reqid: args.reqid,
    sts: args.sts || "REG",
    pw: args.pw,
    familyNameKana: args.familyNameKana,
    firstNameKana: args.firstNameKana,
    familyNameKanji: args.familyNameKanji,
    firstNameKanji: args.firstNameKanji,
    gender: args.gender,
    birthday: args.birthday,
    rank: args.rank
  }, { test: args.test });
}
async function updateMember(brand, env, args) {
  return call(brand, env, "cmmm", "update_member", { aid: args.aid, reqid: args.reqid, rank: args.rank });
}
async function getMemberForApp(brand, env, args) {
  return call(brand, env, "cspm", "get_member_for_app", {
    aid: args.aid,
    ptypes: args.ptypes,
    shopid: args.shopid,
    retattr: args.retattr,
    cumulus: args.cumulus ? "true" : void 0,
    expires: args.expires ? "true" : void 0
  });
}
async function givePoint(brand, env, args) {
  return call(brand, env, "cspm", "give_point", {
    aid: args.aid,
    shopid: args.shopid,
    point: args.point,
    reqid: args.reqid,
    ptype: args.ptype,
    hid: args.hid,
    action: args.action,
    scode: args.scode,
    svalue: args.svalue,
    empid: args.empid
  }, { test: args.test });
}
async function usePoint(brand, env, args) {
  return call(brand, env, "cspm", "use_point", {
    aid: args.aid,
    shopid: args.shopid,
    point: args.point,
    reqid: args.reqid,
    ptypes: args.ptypes,
    hid: args.hid,
    action: args.action,
    scode: args.scode,
    svalue: args.svalue,
    empid: args.empid
  }, { test: args.test });
}
async function removePoint(brand, env, args) {
  return call(brand, env, "cspm", "remove_point", {
    aid: args.aid,
    shopid: args.shopid,
    point: args.point,
    reqid: args.reqid,
    ptypes: args.ptypes,
    hid: args.hid,
    scode: args.scode,
    svalue: args.svalue,
    empid: args.empid,
    reason: args.reason
  }, { test: args.test });
}
async function cancelPoint(brand, env, args) {
  return call(brand, env, "cspm", "cancel_point", {
    hid: args.hid,
    shopid: args.shopid,
    reason: args.reason,
    empid: args.empid,
    secid: args.secid,
    reqid: args.reqid
  });
}
async function uploadPoint(brand, env, args) {
  const buf = typeof args.tsv === "string" ? Buffer.from(args.tsv, "utf-8") : args.tsv;
  return callMultipart(brand, env, "cspm", "upload_point", args.fileName || `upload-${args.reqid}.tsv`, buf, { reqid: args.reqid });
}
async function getBatlogList(brand, env, args) {
  return call(brand, env, "cpss", "get_batlog_list", {
    sdate: args.sdate,
    edate: args.edate,
    fields: args.fields || "bid,bname,aid,sdate,edate,fname,comment,rcode,emsg",
    bnames: args.bnames,
    sort: args.sort || "desc"
  });
}
async function downloadFile(brand, env, fileName) {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/cpss/api/DownloadFile.php`;
  const body = new URLSearchParams({ sid, spw, V_FILENAME: fileName });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), cache: "no-store" });
  if (res.status === 403) throw new CpssError("403", "IP\u672A\u8A31\u53EF");
  return res.text();
}
async function isAlive(brand, env) {
  try {
    const r = await call(brand, env, "cpss", "is_alive", {});
    return r?.status === "ok";
  } catch {
    return false;
  }
}

// handler.mjs
var handler = async (event) => {
  const brand = event?.brand === "FIT365" ? "FIT365" : "JOYFIT";
  const env = event?.env === "prod" ? "prod" : "stg";
  const action = event?.action;
  const a = event?.args || {};
  try {
    let result;
    switch (action) {
      case "isAlive":
        result = await isAlive(brand, env);
        break;
      case "addMember":
        result = await addMember(brand, env, a);
        break;
      case "updateMember":
        result = await updateMember(brand, env, a);
        break;
      case "getMemberForApp":
        result = await getMemberForApp(brand, env, a);
        break;
      case "givePoint":
        result = await givePoint(brand, env, a);
        break;
      case "usePoint":
        result = await usePoint(brand, env, a);
        break;
      case "removePoint":
        result = await removePoint(brand, env, a);
        break;
      case "cancelPoint":
        result = await cancelPoint(brand, env, a);
        break;
      case "uploadPoint":
        result = await uploadPoint(brand, env, { ...a, tsv: a.tsv });
        break;
      case "getBatlogList":
        result = await getBatlogList(brand, env, a);
        break;
      case "downloadFile":
        result = await downloadFile(brand, env, a.fileName);
        break;
      default:
        return { ok: false, error: `unknown action: ${action}` };
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code, cpssMsg: e?.msg };
  }
};
export {
  handler
};
