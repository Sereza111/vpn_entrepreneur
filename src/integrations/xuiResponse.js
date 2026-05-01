export function parsePossiblyConcatenatedJsonText(text) {
  const src = String(text || "");
  const s = src.trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    const open = s[0];
    const close = open === "{" ? "}" : open === "[" ? "]" : "";
    if (!close) throw new Error("xui_bad_json");
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") {
        inStr = true;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return JSON.parse(s.slice(0, i + 1));
        }
      }
    }
    throw new Error("xui_bad_json");
  }
}

export async function readXuiApiOrThrow(res, errorCodePrefix) {
  const text = await res.text().catch(() => "");
  const payload = (() => {
    try {
      return parsePossiblyConcatenatedJsonText(text);
    } catch {
      return {};
    }
  })();
  if (!res.ok) {
    const msg = String(payload?.msg || payload?.message || text || "").trim();
    throw new Error(`${errorCodePrefix}: ${res.status} ${msg}`.trim());
  }
  if (
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(payload, "success") &&
    payload.success === false
  ) {
    const msg = String(payload?.msg || payload?.message || text || "api_error").trim();
    throw new Error(`${errorCodePrefix}: ${msg}`);
  }
  return payload;
}
