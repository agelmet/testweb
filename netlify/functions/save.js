// netlify/functions/save.js
// Runs on Netlify's server. The token stays here — clients never see it.
// Handles: text edits, image swaps (by URL), and gallery add/remove (by URL).

// ─────────────────────────────────────────────────────────────
// CONFIG — change these to match your setup
const OWNER    = "agelmet";      // your GitHub username
const REPO     = "testweb";      // the website repo
const FILE     = "index.html";   // the page being edited
const BRANCH   = "main";
const PASSCODE = "advon2026";    // client's password
// ─────────────────────────────────────────────────────────────

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: "Server is missing GITHUB_TOKEN." }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Bad request." }, 400); }

  if (body.passcode !== PASSCODE) return json({ error: "Wrong passcode." }, 401);

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

  // 1. Text edits: { "hero-title": "new text", ... }
  if (body.edits) {
    for (const [key, newText] of Object.entries(body.edits)) {
      const pattern = new RegExp(
        `(data-edit=["']${escapeRegex(key)}["'][^>]*>)([\\s\\S]*?)(</)`, "i"
      );
      html = html.replace(pattern, `$1${escapeHtml(newText)}$3`);
    }
  }

  // 1b. Links/buttons: { "cta-hero": {text:"...", href:"..."}, ... }
  if (body.links) {
    for (const [key, val] of Object.entries(body.links)) {
      // Find the whole <a ... data-link="key" ...> ... </a>
      const linkPat = new RegExp(
        `(<a\\b[^>]*\\bdata-link=["']${escapeRegex(key)}["'][^>]*>)([\\s\\S]*?)(</a>)`, "i"
      );
      html = html.replace(linkPat, (full, open, inner, close) => {
        // update href inside the opening tag
        let newOpen = open;
        if (/\shref=["'][^"']*["']/i.test(newOpen)) {
          newOpen = newOpen.replace(/(\shref=["'])[^"']*(["'])/i, `$1${val.href}$2`);
        } else {
          newOpen = newOpen.replace(/<a\b/i, `<a href="${val.href}"`);
        }
        // keep any inner tags (icons like <i ...></i>), replace only text
        const icons = (inner.match(/<[^>]+>[\s\S]*?<\/[^>]+>|<[^>]+\/?>/g) || []).join("");
        const textPart = escapeHtml(val.text);
        const newInner = icons ? `${textPart} ${icons}` : textPart;
        return `${newOpen}${newInner}${close}`;
      });
    }
  }

  // 2. Image swaps: { "hero-photo": "https://...", ... }
  if (body.images) {
    for (const [key, newUrl] of Object.entries(body.images)) {
      const pattern = new RegExp(
        `(data-img=["']${escapeRegex(key)}["'][^>]*\\ssrc=["'])([^"']*)(["'])`, "i"
      );
      html = html.replace(pattern, `$1${newUrl}$3`);
    }
  }

  // 3. Galleries: { "clinic": ["url1","url2",...] } — rebuild the whole gallery
  if (body.galleries) {
    for (const [key, urls] of Object.entries(body.galleries)) {
      const open = new RegExp(`(<div[^>]*data-gallery=["']${escapeRegex(key)}["'][^>]*>)`, "i");
      const m = html.match(open);
      if (!m) continue;
      const start = html.indexOf(m[0]) + m[0].length;
      const end = findClosingDiv(html, start);
      const items = urls.map(u => galleryItem(u)).join("\n");
      html = html.slice(0, start) + "\n" + items + "\n            " + html.slice(end);
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

function galleryItem(url) {
  return `                <button class="w-full break-inside-avoid overflow-hidden group relative reveal shadow-md rounded-md" onclick="openLightbox('${url}')">
                    <img src="${url}" alt="" class="w-full h-auto">
                </button>`;
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
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
