/**
 * CCN Freeballs Worker v5-final
 * Sponsors:
 *   tylersmithgolf  - 16 GANs
 *   gildrew         - 0 GANs (cards moved to Bibby Hygiene)
 *   bibby-hygiene   - 30 GANs (20 from Gildrew + 10 Bibby)
 */

const SQUARE = "https://connect.squareup.com/v2";

const SPONSORS = {
  "tylersmithgolf": {
    name: "Boomers & Swingers",
    expiry: "Expires midnight 9 Apr 2026",
    amount: "£6.50", total: 16,
    gans: [
      "7783326544467258","7783323839157165","7783325804455607","7783325970015755",
      "7783323605018625","7783329528774574","7783329729332347","7783320758309298",
      "7783329403249551","7783328061743970","7783325054073787","7783323981410859",
      "7783320279257000","7783325891467432","7783328364347073","7783326554192366"
    ]
  },
  "gildrew": {
    name: "Gildrew",
    expiry: "Valid until 31 Dec 2026",
    amount: "£6.50", total: 0,
    gans: []
  },
  "bibby-hygiene": {
    name: "Bibby Hygiene",
    expiry: "Valid until 31 Dec 2026",
    amount: "£6.50", total: 30,
    gans: [
      "7783323361535960","7783320879486504","7783328352523289","7783322971418187",
      "7783321042566172","7783326097671744","7783321182375673","7783325477479611",
      "7783329046484912","7783325995144655","7783324688354572","7783323444254407",
      "7783328623383687","7783323493354223","7783324492011855","7783323077090516",
      "7783327000850060","7783323489573752","7783322125221040","7783320447643032",
      "7783328010961665","7783326308389052","7783328089468741","7783321287794612",
      "7783326417946560","7783326267639182","7783326817124719","7783325502066953",
      "7783327125991005","7783326745271426"
    ]
  }
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
      if (request.method === "GET" && url.pathname === "/stats")  return await handleStats(request, env);
      if (request.method === "GET" && url.pathname === "/admin")  return await handleAdmin(request, env);
      if (request.method === "POST" && url.pathname === "/api")   return await handleAPI(request, env);
      if (request.method === "GET") return new Response(getHTML(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      return jsonResponse({ error: "Worker error: " + (err.message || String(err)) }, 500);
    }
  }
};

async function handleStats(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("s");
  if (!slug || !SPONSORS[slug]) return jsonResponse({ error: "Unknown sponsor" }, 400);
  const sponsor = SPONSORS[slug];
  let claimed = 0;
  try { const v = await env.CCN_KV.get("claimed:" + slug); claimed = v ? parseInt(v) : 0; } catch {}
  return jsonResponse({ claimed, available: sponsor.total - claimed, total: sponsor.total });
}

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw");
  const adminPw = env.ADMIN_PASSWORD;
  const slug = url.searchParams.get("s") || "";
  if (!adminPw || pw !== adminPw) {
    return new Response(loginHTML(slug), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }
  try {
    const searchRes = await sq(env.SQUARE_TOKEN, "POST", "/customers/search", {
      limit: 100,
      query: { filter: { reference_id: { fuzzy: "CCN" } }, sort: { field: "CREATED_AT", order: "DESC" } }
    });
    const customers = searchRes.customers || [];
    const filtered = slug ? customers.filter(c => (c.note || "").includes(slug)) : customers;
    const rows = await Promise.all(filtered.map(async c => {
      let gan = "", balance = "", status = "Unknown";
      try {
        const gcRes = await sq(env.SQUARE_TOKEN, "GET", `/gift-cards?customer_id=${c.id}`, null);
        const cards = gcRes.gift_cards || [];
        if (cards.length > 0) {
          const card = cards[0];
          gan = card.gan || "";
          const bal = card.balance_money?.amount || 0;
          balance = "£" + (bal / 100).toFixed(2);
          status = bal === 0 ? "REDEEMED" : "ACTIVE";
        } else { status = "No card"; }
      } catch {}
      const note = c.note || "";
      const parts = note.split("·").map(s => s.trim());
      const sponsorSlug = parts[1] || "";
      const ref = parts[2] || "";
      const sponsor = SPONSORS[sponsorSlug]?.name || sponsorSlug;
      return {
        name: [c.given_name, c.family_name].filter(Boolean).join(" "),
        email: c.email_address || "", phone: c.phone_number || "",
        postcode: c.address?.postal_code || "", sponsor, ref,
        gan: gan ? gan.replace(/(\d{4})(?=\d)/g, "$1 ") : "",
        balance, status, date: c.created_at?.slice(0, 10) || ""
      };
    }));
    const stats = {};
    for (const s of Object.keys(SPONSORS)) {
      try { const claimed = await env.CCN_KV.get("claimed:" + s); stats[s] = { claimed: parseInt(claimed || "0"), total: SPONSORS[s].total, name: SPONSORS[s].name }; } catch {}
    }
    return new Response(adminHTML(rows, stats, slug, pw), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  } catch (err) {
    return new Response(`<pre>Error: ${err.message}</pre>`, { headers: { "Content-Type": "text/html" } });
  }
}

function loginHTML(slug) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCN Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#070d07;color:#e8f5e8;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#111c11;border:1px solid rgba(74,222,128,.18);border-radius:16px;padding:40px;width:100%;max-width:360px;text-align:center}
h1{font-size:24px;color:#4ADE80;margin-bottom:8px}p{color:#6b7a6b;font-size:14px;margin-bottom:24px}
input{width:100%;padding:12px 14px;background:rgba(74,222,128,.04);border:1px solid rgba(74,222,128,.18);border-radius:10px;color:#e8f5e8;font-size:14px;outline:none;margin-bottom:14px}
button{width:100%;background:#4ADE80;color:#070d07;font-size:14px;font-weight:700;padding:13px;border:none;border-radius:100px;cursor:pointer}
</style></head><body>
<div class="box"><h1>⛳ CCN Admin</h1><p>Boomers &amp; Swingers · Community Champion Network</p>
<form method="GET"><input type="password" name="pw" placeholder="Admin password" autofocus>
${slug ? `<input type="hidden" name="s" value="${slug}">` : ""}
<button type="submit">Sign in →</button></form></div></body></html>`;
}

function adminHTML(rows, stats, slug, pw) {
  const redeemed = rows.filter(r => r.status === "REDEEMED").length;
  const active = rows.filter(r => r.status === "ACTIVE").length;
  const sponsorTabs = Object.entries(SPONSORS).map(([s, sp]) => {
    const isActive = slug === s;
    return `<a href="/admin?pw=${pw}&s=${s}" style="display:inline-block;padding:7px 16px;border-radius:100px;font-size:12px;font-weight:600;text-decoration:none;margin-right:6px;margin-bottom:6px;background:${isActive?"#4ADE80":"rgba(74,222,128,.08)"};color:${isActive?"#070d07":"#4ADE80"};border:1px solid ${isActive?"#4ADE80":"rgba(74,222,128,.2)"}">
      ${sp.name} ${stats[s] ? `(${stats[s].claimed}/${stats[s].total})` : ""}</a>`;
  }).join("");
  const rowsHTML = rows.length === 0
    ? `<tr><td colspan="9" style="text-align:center;color:#6b7a6b;padding:40px">No claimants yet</td></tr>`
    : rows.map(r => `<tr>
        <td>${r.date}</td><td><b style="color:#e8f5e8">${r.name}</b></td>
        <td><a href="mailto:${r.email}" style="color:#4ADE80;text-decoration:none">${r.email}</a></td>
        <td>${r.phone}</td><td>${r.postcode}</td>
        <td style="color:#6b7a6b;font-size:12px">${r.sponsor}</td>
        <td><span style="font-family:monospace;font-size:11px;color:#9ca3af">${r.gan}</span></td>
        <td style="color:#4ADE80;font-weight:600">${r.balance}</td>
        <td><span style="display:inline-block;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700;background:${r.status==="REDEEMED"?"rgba(239,68,68,.15)":r.status==="ACTIVE"?"rgba(74,222,128,.15)":"rgba(107,122,107,.15)"};color:${r.status==="REDEEMED"?"#f87171":r.status==="ACTIVE"?"#4ADE80":"#6b7a6b"}">${r.status}</span></td>
      </tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCN Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#070d07;color:#e8f5e8;min-height:100vh}
body::after{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(74,222,128,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,.03) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;max-width:1200px;margin:0 auto;padding:32px 20px 60px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
.logo{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#4ADE80;letter-spacing:.04em}.logo span{color:#e8f5e8}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.card{background:#111c11;border:1px solid rgba(74,222,128,.18);border-radius:12px;padding:16px}
.card-n{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#fff;line-height:1}
.card-l{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6b7a6b;margin-top:4px}
.tabs{margin-bottom:20px}
.all-tab{display:inline-block;padding:7px 16px;border-radius:100px;font-size:12px;font-weight:600;text-decoration:none;margin-right:6px;margin-bottom:6px;background:${!slug?"#4ADE80":"rgba(74,222,128,.08)"};color:${!slug?"#070d07":"#4ADE80"};border:1px solid ${!slug?"#4ADE80":"rgba(74,222,128,.2)"}}
.table-wrap{background:#111c11;border:1px solid rgba(74,222,128,.18);border-radius:16px;overflow:hidden;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:900px}
thead{background:rgba(74,222,128,.06)}
th{padding:12px 14px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7a6b;text-align:left;white-space:nowrap}
td{padding:12px 14px;font-size:13px;color:#9ca3af;border-top:1px solid rgba(74,222,128,.07);white-space:nowrap}
tr:hover td{background:rgba(74,222,128,.03)}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">CCN <span>Admin</span></div><a href="/admin?pw=${pw}" style="font-size:12px;color:#6b7a6b;text-decoration:none">← All sponsors</a></div>
  <div class="summary">
    <div class="card"><div class="card-n">${rows.length}</div><div class="card-l">Total claimants</div></div>
    <div class="card"><div class="card-n" style="color:#4ADE80">${active}</div><div class="card-l">Active (unused)</div></div>
    <div class="card"><div class="card-n" style="color:#f87171">${redeemed}</div><div class="card-l">Redeemed</div></div>
    ${Object.entries(stats).filter(([,st])=>st.total>0).map(([s,st])=>`<div class="card"><div class="card-n">${st.claimed}</div><div class="card-l">${st.name} claimed</div></div>`).join("")}
  </div>
  <div class="tabs"><a href="/admin?pw=${pw}" class="all-tab">All sponsors</a>${sponsorTabs}</div>
  <div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Phone</th><th>Postcode</th><th>Sponsor</th><th>Gift card</th><th>Balance</th><th>Status</th></tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table></div>
  <p style="text-align:center;margin-top:20px;font-size:11px;color:#4b5563">CCN Admin · Boomers &amp; Swingers · <a href="/admin?pw=${pw}" style="color:#4ADE80;text-decoration:none" onclick="location.reload()">↻ Refresh</a></p>
</div></body></html>`;
}

async function handleAPI(request, env) {
  if (!env.SQUARE_TOKEN) return jsonResponse({ error: "SQUARE_TOKEN not configured" }, 500);
  if (!env.RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);
  if (!env.CCN_KV) return jsonResponse({ error: "CCN_KV binding not configured" }, 500);
  let body;
  try { const text = await request.text(); if (!text || !text.trim()) return jsonResponse({ error: "Empty request body" }, 400); body = JSON.parse(text); }
  catch (err) { return jsonResponse({ error: "Invalid JSON: " + err.message }, 400); }
  const { firstName, lastName, email, phone, postcode, plannedVisit, bsConsent, sponsorConsent, slug, reference, sponsorName, expiry } = body;
  if (!firstName || !email || !phone || !postcode) return jsonResponse({ error: "Missing required fields" }, 400);
  const sponsor = SPONSORS[slug];
  if (!sponsor) return jsonResponse({ error: "Unknown sponsor: " + slug }, 400);
  if (!sponsor.gans.length) return jsonResponse({ error: "No gift cards configured for this sponsor yet" }, 400);
  const ref = reference || ("CCN-" + Math.random().toString(36).slice(2, 8).toUpperCase());
  let gan;
  try {
    const claimedStr = await env.CCN_KV.get("claimed:" + slug);
    const claimed = claimedStr ? parseInt(claimedStr) : 0;
    if (claimed >= sponsor.gans.length) return jsonResponse({ error: "All sessions for this sponsor have been claimed" }, 400);
    gan = sponsor.gans[claimed];
    await env.CCN_KV.put("claimed:" + slug, String(claimed + 1));
  } catch (err) { return jsonResponse({ error: "Queue error: " + err.message }, 500); }
  const fmtGAN = gan.replace(/(\d{4})(?=\d)/g, "$1 ");
  const token = env.SQUARE_TOKEN;
  const donor = sponsorName || sponsor.name;
  const expiryTxt = expiry || sponsor.expiry;
  let customerId;
  try { customerId = await findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref }); }
  catch (err) { console.warn("Customer:", err.message); }
  if (customerId) {
    try { await sq(token, "POST", "/gift-cards/link-customer", { customer_id: customerId, gift_card_gan: gan }); }
    catch (err) { console.warn("Link:", err.message); }
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Boomers & Swingers <hello@boomersandswingers.golf>",
        to: [email], cc: ["nick@boomersandswingers.golf"],
        subject: "Your free session — Boomers & Swingers ⛳",
        text: [`Hi ${firstName},`,"","Your free 50-ball session is confirmed!","",`Square gift card: ${fmtGAN}`,`Balance: ${sponsor.amount}`,`Reference: ${ref}`,expiryTxt,"","📍 Manchester Rd, Astley M29 7EJ","🕐 Mon–Fri 1–9pm | Sat–Sun 10am–5pm","⛳ Show your gift card number to staff at the till. No booking needed.",``,`Donated by ${donor}`,"","See you on the range!","Boomers & Swingers · boomersandswingers.golf"].join("\n")
      })
    });
  } catch (err) { console.warn("Email:", err.message); }
  return jsonResponse({ success: true, gan: fmtGAN, reference: ref, customerId: customerId || null, balance: sponsor.amount });
}

async function findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref }) {
  const search = await sq(token, "POST", "/customers/search", { query: { filter: { email_address: { exact: email } } } });
  if (search.customers?.length > 0) {
    const e = search.customers[0];
    await sq(token, "PUT", `/customers/${e.id}`, { given_name: firstName, family_name: lastName, phone_number: phone, note: `CCN · ${slug} · ${ref} · ${new Date().toISOString().slice(0,10)}` });
    return e.id;
  }
  const created = await sq(token, "POST", "/customers", { idempotency_key: ref + "-customer", given_name: firstName, family_name: lastName, email_address: email, phone_number: phone, address: { postal_code: postcode, country: "GB" }, reference_id: ref, note: `CCN claimant · ${slug} · ${new Date().toISOString().slice(0,10)}` });
  if (!created.customer) throw new Error("Customer creation returned no customer");
  return created.customer.id;
}

async function sq(token, method, path, body) {
  const res = await fetch(SQUARE + path, { method, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Square-Version": "2024-01-18" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Square non-JSON (${res.status}): ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(data.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`);
  return data;
}

function corsHeaders() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function jsonResponse(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } }); }

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Golf Session — Boomers &amp; Swingers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#4ADE80;--dark:#070d07;--card:#111c11;--border:rgba(74,222,128,.18);--text:#e8f5e8;--muted:#6b7a6b}
body{font-family:'DM Sans',sans-serif;background:var(--dark);color:var(--text);min-height:100vh;overflow-x:hidden}
body::after{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(74,222,128,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,.03) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;max-width:520px;margin:0 auto;padding:0 16px 60px}
.hero{padding:48px 0 32px;text-align:center}
.badge{display:inline-flex;align-items:center;gap:7px;background:rgba(74,222,128,.08);border:1px solid var(--border);border-radius:100px;padding:5px 14px 5px 10px;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--green);margin-bottom:24px}
.dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(52px,14vw,88px);line-height:.95;color:#fff;margin-bottom:8px}
h1 span{color:var(--green);display:block}
.sub{font-size:14px;color:var(--muted);font-weight:300;margin-bottom:28px;line-height:1.6}
.stats{display:grid;grid-template-columns:repeat(3,1fr);background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px}
.stat{padding:16px 12px;text-align:center;border-right:1px solid var(--border)}.stat:last-child{border:none}
.stat-n{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#fff;line-height:1;margin-bottom:3px}
.stat-l{font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:14px}
.ch{background:rgba(74,222,128,.06);border-bottom:1px solid var(--border);padding:12px 18px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--green)}
.cb{padding:18px}
.srow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.si{font-size:13px;color:var(--muted);line-height:1.6}.si b{color:var(--text);font-weight:600;display:block;margin-bottom:2px}
.fb{font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--green);flex-shrink:0}
.steps{list-style:none}
.step{display:flex;gap:14px;align-items:flex-start;padding:13px 0;border-bottom:1px solid rgba(74,222,128,.08)}.step:last-child{border:none}
.sn{width:22px;height:22px;background:var(--green);border-radius:50%;color:var(--dark);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step b{font-size:13px;font-weight:600;color:var(--text);display:block;margin-bottom:2px}.step span{font-size:12px;color:var(--muted)}
.sbanner{background:rgba(74,222,128,.05);border:1px solid var(--border);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:12px;color:var(--muted);line-height:1.5}.sbanner b{color:var(--text)}
.cta{width:100%;background:var(--green);color:var(--dark);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;padding:16px;border:none;border-radius:100px;cursor:pointer;transition:transform .15s,opacity .15s;margin-bottom:8px}
.cta:hover{transform:translateY(-1px);opacity:.92}.cta:disabled{background:#2a3a2a;color:var(--muted);cursor:not-allowed;transform:none}
.exp{text-align:center;font-size:11px;color:var(--muted);padding:4px 0}.hidden{display:none}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
input[type=text],input[type=email],input[type=tel]{width:100%;background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:'DM Sans',sans-serif;font-size:14px;color:var(--text);outline:none;transition:border-color .15s}
input:focus{border-color:rgba(74,222,128,.5)}input::placeholder{color:var(--muted)}.mb{margin-bottom:12px}
.cbox{background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px}
.ck{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}.ck:last-child{margin:0}
.ck input[type=checkbox]{width:15px;height:15px;margin-top:2px;flex-shrink:0;accent-color:var(--green);cursor:pointer}
.ck label{font-size:12px;color:var(--muted);line-height:1.5;text-transform:none;letter-spacing:0;font-weight:400;cursor:pointer}.ck label b{color:var(--text);font-weight:600}
.shot-banner{background:rgba(74,222,128,.15);border:2px solid var(--green);border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.shot-banner-text{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--green)}.shot-banner-text span{font-size:20px}
.shot-banner-sub{font-size:11px;color:var(--muted);margin-top:2px;font-weight:400}
.gan{background:var(--card);border:2px solid var(--border);border-radius:16px;padding:24px;text-align:center;margin-bottom:14px}
.gl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
#qr{margin:0 auto 14px;width:160px;height:160px;background:#fff;padding:8px;border-radius:10px;display:flex;align-items:center;justify-content:center}
#qr canvas,#qr img{display:block}
.gn{font-family:'JetBrains Mono',monospace;font-size:clamp(18px,5vw,24px);font-weight:700;color:var(--green);letter-spacing:.12em;margin-bottom:4px}
.gs{font-size:11px;color:var(--muted);margin-bottom:8px}.gan-logo{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.05em}
.dl-btn{width:100%;background:transparent;border:2px solid var(--green);color:var(--green);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;padding:13px;border-radius:100px;cursor:pointer;transition:background .15s,color .15s;margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:8px}
.dl-btn:hover{background:var(--green);color:var(--dark)}
.vbox{background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:12px;color:var(--muted);line-height:1.9}
.foot{text-align:center;padding-top:20px;font-size:11px;color:var(--muted)}.foot a{color:var(--green);text-decoration:none}
.err{background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);border-radius:10px;padding:12px 14px;font-size:12px;color:#ff9090;margin-bottom:12px;display:none}
@media(max-width:400px){.fr{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<div id="s1">
  <div class="hero">
    <div class="badge"><div class="dot"></div><span id="bt">Community Champion</span></div>
    <h1>FREE<span id="ha">SESSION</span></h1>
    <p class="sub" id="hs">50 free balls at Boomers &amp; Swingers Driving Range, Astley</p>
    <div class="stats">
      <div class="stat"><div class="stat-n" id="sr">-</div><div class="stat-l">Claimed</div></div>
      <div class="stat"><div class="stat-n" id="sm">-</div><div class="stat-l">Available</div></div>
      <div class="stat"><div class="stat-n" id="sd">-</div><div class="stat-l">Days left</div></div>
    </div>
  </div>
  <div class="card">
    <div class="ch">⛳ What you get</div>
    <div class="cb"><div class="srow"><div class="si"><b>Driving range session</b>50 balls · Free club hire · No booking needed</div><div class="fb">FREE</div></div></div>
  </div>
  <div class="card">
    <div class="ch">📋 How it works</div>
    <div class="cb" style="padding:8px 18px">
      <ul class="steps">
        <li class="step"><div class="sn">1</div><div><b>Fill in your details</b><span>60 seconds — name, email &amp; mobile</span></div></li>
        <li class="step"><div class="sn">2</div><div><b>Get your unique gift card</b><span>Screenshot or download your QR code</span></div></li>
        <li class="step"><div class="sn">3</div><div><b>Turn up &amp; play</b><span>Show QR code or gift card number to staff</span></div></li>
      </ul>
    </div>
  </div>
  <div class="sbanner"><span style="font-size:18px">⛳</span><span id="st">Donated by <b>Boomers &amp; Swingers</b></span></div>
  <button class="cta" onclick="go(2)">Claim my free session →</button>
  <p class="exp" id="en"></p>
</div>
<div id="s2" class="hidden">
  <div class="hero" style="padding-top:32px">
    <div class="badge"><div class="dot"></div><span>Almost there</span></div>
    <h1 style="font-size:clamp(40px,11vw,64px)">CLAIM<span>YOURS</span></h1>
  </div>
  <div class="card">
    <div class="ch" id="fh">🎁 Gifted by Boomers &amp; Swingers</div>
    <div class="cb">
      <div class="err" id="err"></div>
      <div class="fr">
        <div><label>First name *</label><input type="text" id="f1" placeholder="Sarah"></div>
        <div><label>Last name *</label><input type="text" id="f2" placeholder="Johnson"></div>
      </div>
      <div class="mb"><label>Email address *</label><input type="email" id="f3" placeholder="your@email.com"></div>
      <div class="mb"><label>Mobile number *</label><input type="tel" id="f4" placeholder="07xxx xxxxxx"></div>
      <div class="fr mb">
        <div><label>Postcode *</label><input type="text" id="f5" placeholder="WN7 3UF"></div>
        <div><label>Planned visit?</label><input type="text" id="f6" placeholder="e.g. Saturday"></div>
      </div>
      <div class="cbox">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--green);margin-bottom:10px">Your data choices</div>
        <div class="ck"><input type="checkbox" id="c1" checked><label for="c1"><b>Boomers &amp; Swingers loyalty &amp; offers</b> — happy to hear about future sessions.</label></div>
        <div class="ck"><input type="checkbox" id="c2"><label for="c2" id="c2l"><b>Sponsor offers</b> — happy to share my details with the donating business.</label></div>
      </div>
      <div class="ck mb"><input type="checkbox" id="c3" checked><label for="c3" style="font-size:11px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400">I confirm I am 16+ and agree to the terms of this offer.</label></div>
      <button class="cta" id="sb" onclick="sub()">Get my gift card →</button>
    </div>
  </div>
  <p class="foot"><a href="javascript:void(0)" onclick="go(1)">← Back</a> · <a href="https://www.boomersandswingers.golf/privacy-policy" target="_blank">Privacy policy</a></p>
</div>
<div id="s3" class="hidden">
  <div class="hero" style="padding-top:32px">
    <div class="badge"><div class="dot"></div><span>✓ Confirmed</span></div>
    <h1 style="font-size:clamp(40px,11vw,64px)">YOU'RE<span>IN!</span></h1>
    <p class="sub">Your gift card is ready. Screenshot it or download below.</p>
  </div>
  <div class="shot-banner">
    <div><div class="shot-banner-text"><span>📸</span> Screenshot this page!</div><div class="shot-banner-sub">Or use the download button below to save your gift card</div></div>
    <span style="font-size:28px">👇</span>
  </div>
  <div class="gan" id="gan-card">
    <div class="gl">Your Square gift card</div>
    <div id="qr"></div>
    <div class="gn" id="gd">---- ---- ---- ----</div>
    <div class="gs" id="ge">Single use · Show QR or number to staff</div>
    <div class="gan-logo">⛳ Boomers &amp; Swingers · boomersandswingers.golf</div>
  </div>
  <button class="dl-btn" onclick="dlCard()"><span>⬇</span> Save gift card to phone</button>
  <div class="card">
    <div class="ch">📋 Summary</div>
    <div class="cb" style="font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between"><span>Donated by</span><b style="color:var(--text)" id="cs">-</b></div>
      <div style="display:flex;justify-content:space-between"><span>Reference</span><span style="font-family:'JetBrains Mono',monospace;font-size:12px" id="cr">-</span></div>
      <div style="display:flex;justify-content:space-between"><span>Balance</span><b style="color:var(--green)">£6.50</b></div>
    </div>
  </div>
  <div class="vbox">📍 Manchester Rd, Astley M29 7EJ<br>📱 Show QR code or gift card number to staff<br>🕐 Mon–Fri 1–9pm | Sat–Sun 10am–5pm<br>⭐ No booking needed</div>
  <div style="margin-top:14px" class="foot"><a href="https://www.boomersandswingers.golf" target="_blank">boomersandswingers.golf</a></div>
</div>
</div>
<script>
const SP={
  "tylersmithgolf":{n:"Boomers & Swingers",b:"Tyler Smith Golf × B&S Drop",h:"DROP",s:"50 free balls · for @tylersmithgolf_ followers · Astley",st:'Gifted by <b>Boomers &amp; Swingers</b> for @tylersmithgolf_ followers.',e:"Expires midnight 9 Apr 2026",d:3,fh:"🎁 For @tylersmithgolf_ followers",c2:"<b>B&S offers</b> — happy to hear about future sessions."},
  "gildrew":{n:"Gildrew",b:"Community Champion · Gildrew",h:"SESSION",s:"50 free balls · Donated by Gildrew · Astley",st:'Gifted by <b>Gildrew</b> — supporting the local community.',e:"Valid until 31 Dec 2026",d:269,fh:"🎁 Gifted by Gildrew",c2:"<b>Gildrew offers</b> — happy to share my details with Gildrew."},
  "bibby-hygiene":{n:"Bibby Hygiene",b:"Community Champion · Bibby Hygiene",h:"SESSION",s:"50 free balls · Donated by Bibby Hygiene · Astley",st:'Gifted by <b>Bibby Hygiene</b> — supporting the local community.',e:"Valid until 31 Dec 2026",d:269,fh:"🎁 Gifted by Bibby Hygiene",c2:"<b>Bibby Hygiene offers</b> — happy to share my details with Bibby Hygiene."}
};
const slug=new URLSearchParams(location.search).get("s")||"";
const sp=SP[slug];
window.addEventListener("DOMContentLoaded",async()=>{
  if(!sp){document.querySelector(".wrap").innerHTML='<div style="text-align:center;padding:80px 20px"><h1 style="font-family:Bebas Neue,sans-serif;color:var(--green);font-size:48px">⛳</h1><p style="color:var(--muted);margin-top:12px">Visit <a href="https://www.boomersandswingers.golf" style="color:var(--green)">boomersandswingers.golf</a> for your sponsor link.</p></div>';return;}
  document.title="Free Session — "+sp.n;
  document.getElementById("bt").textContent=sp.b;
  document.getElementById("ha").textContent=sp.h;
  document.getElementById("hs").textContent=sp.s;
  document.getElementById("st").innerHTML=sp.st;
  document.getElementById("sd").textContent=sp.d;
  document.getElementById("en").textContent=sp.e+" · One per person · Astley";
  document.getElementById("fh").textContent=sp.fh;
  document.getElementById("c2l").innerHTML=sp.c2;
  document.getElementById("cs").textContent=sp.n;
  try{const r=await fetch("/stats?s="+slug);const d=await r.json();document.getElementById("sr").textContent=d.claimed;document.getElementById("sm").textContent=d.available;}
  catch{document.getElementById("sr").textContent="?";document.getElementById("sm").textContent="?";}
});
function go(n){document.getElementById("s1").style.display=n===1?"":"none";document.getElementById("s2").className=n===2?"":"hidden";document.getElementById("s3").className=n===3?"":"hidden";document.getElementById("err").style.display="none";window.scrollTo(0,0);}
window.go=go;
function showErr(msg){const el=document.getElementById("err");el.textContent=msg;el.style.display="block";}
async function dlCard(){
  const btn=document.querySelector(".dl-btn");const orig=btn.innerHTML;btn.innerHTML="<span>⏳</span> Saving…";btn.disabled=true;
  try{const canvas=await html2canvas(document.getElementById("gan-card"),{backgroundColor:"#111c11",scale:2,useCORS:true,logging:false});const link=document.createElement("a");link.download="boomers-gift-card.png";link.href=canvas.toDataURL("image/png");link.click();}
  catch(e){alert("Screenshot didn't work — please screenshot the page manually.");}
  btn.innerHTML=orig;btn.disabled=false;
}
window.dlCard=dlCard;
async function sub(){
  const f1=document.getElementById("f1").value.trim(),f2=document.getElementById("f2").value.trim(),f3=document.getElementById("f3").value.trim(),f4=document.getElementById("f4").value.trim(),f5=document.getElementById("f5").value.trim();
  if(!f1||!f3||!f4||!f5){showErr("Please fill in all required fields (marked with *).");return;}
  const rn=Math.floor(Math.random()*9000+1000);const ref="CCN-"+slug.slice(0,3).toUpperCase()+"-"+rn;
  const btn=document.getElementById("sb");btn.disabled=true;btn.textContent="Sending your gift card…";document.getElementById("err").style.display="none";
  try{
    const res=await fetch("/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstName:f1,lastName:f2,email:f3,phone:f4,postcode:f5,plannedVisit:document.getElementById("f6").value.trim(),bsConsent:document.getElementById("c1").checked,sponsorConsent:document.getElementById("c2").checked,slug,reference:ref,sponsorName:sp?.n,expiry:sp?.e})});
    let data;try{data=await res.json();}catch{throw new Error("Server returned an invalid response. Please try again.");}
    if(!res.ok||data.error)throw new Error(data.error||"Something went wrong (HTTP "+res.status+")");
    const rawGAN=(data.gan||ref).replace(/\s/g,"");
    document.getElementById("qr").innerHTML="";
    new QRCode(document.getElementById("qr"),{width:144,height:144,text:rawGAN,colorDark:"#070d07",colorLight:"#ffffff"});
    document.getElementById("gd").textContent=data.gan||ref;
    document.getElementById("ge").textContent=(sp?.e||"")+" · Single use · Show to staff";
    document.getElementById("cr").textContent=data.reference||ref;
    go(3);
  }catch(err){showErr(err.message||"An error occurred. Please try again.");btn.disabled=false;btn.textContent="Get my gift card →";}
}
window.sub=sub;
</script>
</body>
</html>`;
}
