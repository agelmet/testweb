// netlify/functions/save.js
// This runs on Netlify's server. The client's browser never sees the token.
// It receives edited text from edit.html, then commits the updated file to GitHub.

// ─────────────────────────────────────────────────────────────
// CONFIG — change these three values to match your repo
const OWNER  = "agelmet";      // your GitHub username
const REPO   = "testweb";      // the repository name
const FILE   = "index.html";   // the file clients are editing
const BRANCH = "main";         // the branch (usually "main")
// A simple passcode clients must enter. Change it to anything you like.
const PASSCODE = "advon2026";
// ─────────────────────────────────────────────────────────────

export default async (request) => {
  // Only accept POST requests
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const token = process.env.GITHUB_TOKEN; // the secret, read from Netlify settings
  if (!token) {
    return json({ error: "Server is missing GITHUB_TOKEN." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  // Check the passcode
  if (body.passcode !== PASSCODE) {
    return json({ error: "Wrong passcode." }, 401);
  }

  // body.edits is an object like { "hero-title": "New text", "intro": "..." }
  const edits = body.edits;
  if (!edits || typeof edits !== "object") {
    return json({ error: "No edits received." }, 400);
  }

  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "advon-cms",
  };

  // 1. Get the current file from GitHub (its content + its sha)
  const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers });
  if (!getRes.ok) {
    return json({ error: `Could not read file (${getRes.status}).` }, 500);
  }
  const fileData = await getRes.json();
  let html = decodeBase64(fileData.content);

  // 2. Replace the text inside each marked element
  for (const [key, newText] of Object.entries(edits)) {
    // Matches: <tag data-edit="key" ...>OLD TEXT</tag>
    const pattern = new RegExp(
      `(data-edit=["']${escapeRegex(key)}["'][^>]*>)([\\s\\S]*?)(</)`,
      "i"
    );
    html = html.replace(pattern, `$1${escapeHtml(newText)}$3`);
  }

  // 3. Commit the updated file back to GitHub
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers,
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

// ── helpers ──
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function decodeBase64(b64) {
  return Buffer.from(b64, "base64").toString("utf-8");
}
function encodeBase64(str) {
  return Buffer.from(str, "utf-8").toString("base64");
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
