/**
 * B站 WBI 签名（B站公开混淆算法，用于 feed/space、搜索等需签名的接口）
 * 实现参考社区公开逆向；keys 从 /x/web-interface/nav 获取，缓存 1 小时。
 */
const crypto = require("crypto");
const config = require("./config");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join("").slice(0, 32);
}

let keysCache = null;
async function getKeys() {
  if (keysCache && Date.now() - keysCache.t < 3600e3) return keysCache;
  const cookie = config.bili && config.bili.cookie;
  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`nav code=${json.code} ${json.message}`);
  const img = (json.data.wbi_img && json.data.wbi_img.img_url) || "";
  const sub = (json.data.wbi_img && json.data.wbi_img.sub_url) || "";
  const imgKey = img.split("/").pop().split(".")[0];
  const subKey = sub.split("/").pop().split(".")[0];
  keysCache = { imgKey, subKey, t: Date.now() };
  return keysCache;
}

/** 返回带 w_rid/wts 的签名参数对象 */
async function encWbi(params = {}) {
  const { imgKey, subKey } = await getKeys();
  const mixin = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const query = { ...params, wts };
  const sorted = Object.keys(query).sort();
  const queryStr = sorted
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const wRid = crypto.createHash("md5").update(queryStr + mixin).digest("hex");
  return { ...query, w_rid: wRid };
}

/** 带 WBI 签名的 GET 请求 */
async function signedGetJSON(url, params = {}, headers = {}) {
  const q = await encWbi(params);
  const qs = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const sep = url.includes("?") ? "&" : "?";
  const cookie = config.bili && config.bili.cookie;
  const res = await fetch(`${url}${sep}${qs}`, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`非JSON(${res.status}) ${url} -> ${text.slice(0, 60)}`);
  }
  return json;
}

module.exports = { encWbi, signedGetJSON, getMixinKey };
