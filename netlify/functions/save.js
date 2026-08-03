// netlify/functions/save.js — Advon CMS universal save function
// Runs on Netlify's server. The token stays here — clients never see it.
// Handles: text, images, links/buttons, galleries, button rows, section show/hide, colours.

// ─────────────────────────────────────────────────────────────
// CONFIG — the only lines you change per site
const OWNER    = "agelmet";      // GitHub username
const REPO     = "testweb";      // website repo
const FILE     = "index.html";   // page being edited
const BRANCH   = "main";
const PASSCODE = "Anemos-5084%";    // client password
// ─────────────────────────────────────────────────────────────

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: "Server is missing GITHUB_TOKEN." }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Bad request." }, 400); }

  if (body.passcode !== PASSCODE) return json({ error: "Wrong passcode." }, 401);

  // Gate check: verify passcode without saving anything
  if (body.action === "verify") return json({ ok: true });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "advon-cms",
  };

  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
  const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers });
  if (!getRes.ok) return json({ error: `Could not read page (${getRes.status}).` }, 500);
  const fileData = await getRes.json();
  let html = decodeBase64(fileData.content);

  // 1. TEXT — { "t1": "new text", ... }
  if (body.edits) {
    for (const [key, newText] of Object.entries(body.edits)) {
      const p = new RegExp(`(data-edit=["']${rx(key)}["'][^>]*>)([\\s\\S]*?)(</)`, "i");
      html = html.replace(p, `$1${esc(newText)}$3`);
    }
  }

  // 2. IMAGES — { "img1": "https://...", ... }
  if (body.images) {
    for (const [key, url] of Object.entries(body.images)) {
      const p = new RegExp(`(data-img=["']${rx(key)}["'][^>]*?\\ssrc=["'])([^"']*)(["'])`, "i");
      html = html.replace(p, `$1${url}$3`);
    }
  }

  // 3. LINKS/BUTTONS — { "l1": {text:"...", href:"..."}, ... }
  if (body.links) {
    for (const [key, val] of Object.entries(body.links)) {
      const p = new RegExp(`(<a\\b[^>]*\\bdata-link=["']${rx(key)}["'][^>]*>)([\\s\\S]*?)(</a>)`, "i");
      html = html.replace(p, (full, open, inner, close) => {
        let newOpen = open;
        if (/\shref=["'][^"']*["']/i.test(newOpen))
          newOpen = newOpen.replace(/(\shref=["'])[^"']*(["'])/i, `$1${val.href}$2`);
        else
          newOpen = newOpen.replace(/<a\b/i, `<a href="${val.href}"`);
        const icons = (inner.match(/<[^>]+>[\s\S]*?<\/[^>]+>|<[^>]+\/?>/g) || []).join("");
        const hasText = inner.replace(/<[^>]+>/g, "").trim().length > 0;
        // icon-only links keep their icon untouched; text links get new text + icons
        const newInner = hasText ? (icons ? `${esc(val.text)} ${icons}` : esc(val.text)) : inner;
        return `${newOpen}${newInner}${close}`;
      });
    }
  }

  // 4. GALLERIES — { "gal1": ["url1","url2",...] } (rebuild from first item as template)
  if (body.galleries) {
    for (const [key, urls] of Object.entries(body.galleries)) {
      html = rebuildContainer(html, "data-gallery", key, urls, (tpl, url) => {
        // swap every occurrence of the template's img src (covers onclick lightbox too)
        const srcMatch = tpl.match(/\ssrc=["']([^"']*)["']/i);
        if (!srcMatch) return tpl;
        return tpl.split(srcMatch[1]).join(url);
      });
    }
  }

  // 5. BUTTON ROWS — { "row1": [{text,href}, ...] } (rebuild from first button as template)
  if (body.buttonRows) {
    for (const [key, buttons] of Object.entries(body.buttonRows)) {
      html = rebuildContainer(html, "data-buttons", key, buttons, (tpl, btn) => {
        let out = tpl.replace(/(\shref=["'])[^"']*(["'])/i, `$1${btn.href}$2`);
        out = out.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/i, (f, open, inner, close) => {
          const icons = (inner.match(/<[^>]+>[\s\S]*?<\/[^>]+>|<[^>]+\/?>/g) || []).join("");
          return `${open}${esc(btn.text)}${icons ? " " + icons : ""}${close}`;
        });
        // each rebuilt button must not carry the template's data-link key (avoid duplicates)
        out = out.replace(/\sdata-link=["'][^"']*["']/i, "");
        return out;
      });
    }
  }

  // 6. SECTIONS show/hide — { "bio": true (visible) / false (hidden), ... }
  if (body.sections) {
    for (const [key, visible] of Object.entries(body.sections)) {
      const p = new RegExp(`<(section|header|footer|div)\\b([^>]*\\bdata-section=["']${rx(key)}["'][^>]*)>`, "i");
      html = html.replace(p, (full, tag, attrs) => {
        let a = attrs.replace(/\s+hidden\b/gi, "");
        return `<${tag}${a}${visible ? "" : " hidden"}>`;
      });
    }
  }

  // 7. COLOURS — [ {name:"petrol", old:"#3A6B7E", value:"#224455"}, ... ]
  if (body.colors) {
    for (const col of body.colors) {
      const p = new RegExp(`(\\b${rx(col.name)}\\s*:\\s*["'])${rx(col.old)}(["'])`, "g");
      html = html.replace(p, `$1${col.value}$2`);
    }
  }

  const putRes = await fetch(apiBase, {
    method: "PUT", headers,
    body: JSON.stringify({
      message: "Content update via Advon editor",
      content: encodeBase64(html),
      sha: fileData.sha,
      branch: BRANCH,
    }),
  });
  if (!putRes.ok) {
    const detail = await putRes.text();
    return json({ error: `Could not save (${putRes.status}). ${detail}` }, 500);
  }
  return json({ ok: true });
};

// Rebuild the children of a marked container using its first child as a template.
function rebuildContainer(html, attr, key, items, applyItem) {
  const open = new RegExp(`<div\\b[^>]*\\b${attr}=["']${rx(key)}["'][^>]*>`, "i");
  const m = html.match(open);
  if (!m) return html;
  const start = html.indexOf(m[0]) + m[0].length;
  const end = findClosingDiv(html, start);
  const inner = html.slice(start, end);
  // template = first <a>...</a> or <button>...</button> child
  const tplMatch = inner.match(/<(a|button)\b[\s\S]*?<\/\1>/i);
  if (!tplMatch) return html;
  const tpl = tplMatch[0];
  const rebuilt = items.map(it => "                " + applyItem(tpl, it)).join("\n");
  return html.slice(0, start) + "\n" + rebuilt + "\n            " + html.slice(end);
}

function findClosingDiv(html, from) {
  let depth = 1, i = from;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
    else { depth--; if (depth === 0) return nextClose; i = nextClose + 6; }
  }
  return from;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function decodeBase64(b64) { return Buffer.from(b64, "base64").toString("utf-8"); }
function encodeBase64(str) { return Buffer.from(str, "utf-8").toString("base64"); }
function rx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
