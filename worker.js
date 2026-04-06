const SQUARE = "https://connect.squareup.com/v2";

const SESSION_AMOUNTS = {
  "tylersmithgolf": 650,
  "gildrew":        650,
  "talentia-group": 650,
  "adl-scaffold":   650,
  "honest-fuel":    650,
};

export default {
  async fetch(request, env) {
    // Top-level catch — always return JSON, never empty body
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }

      if (request.method === "POST" && url.pathname === "/api") {
        return await handleAPI(request, env);
      }

      if (request.method === "GET") {
        return new Response(getHTML(), {
          headers: { "Content-Type": "text/html;charset=UTF-8" }
        });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      return jsonResponse({ error: "Worker error: " + (err.message || String(err)) }, 500);
    }
  }
};

async function handleAPI(request, env) {
  // Validate env vars first
  if (!env.SQUARE_TOKEN) {
    return jsonResponse({ error: "SQUARE_TOKEN not configured" }, 500);
  }
  if (!env.WEB3FORMS_KEY) {
    return jsonResponse({ error: "WEB3FORMS_KEY not configured" }, 500);
  }

  // Parse body
  let body;
  try {
    const text = await request.text();
    if (!text || text.trim() === "") {
      return jsonResponse({ error: "Empty request body" }, 400);
    }
    body = JSON.parse(text);
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON: " + err.message }, 400);
  }

  const {
    firstName, lastName, email, phone, postcode,
    plannedVisit, bsConsent, sponsorConsent,
    slug, reference, sponsorName, expiry
  } = body;

  if (!firstName || !email || !phone || !postcode) {
    return jsonResponse({ error: "Missing required fields: firstName, email, phone, postcode" }, 400);
  }

  const token      = env.SQUARE_TOKEN;
  const locationId = env.SQUARE_LOCATION || "LDQSQ4YZX7YS0";
  const amount     = SESSION_AMOUNTS[slug] || 650;
  const ref        = reference || ("CCN-" + Math.random().toString(36).slice(2, 8).toUpperCase());

  try {
    // Step 1: Find or create customer
    let customerId;
    try {
      customerId = await findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref });
    } catch (err) {
      return jsonResponse({ error: "Customer step failed: " + err.message }, 500);
    }

    // Step 2: Create gift card
    let gcId, gan;
    try {
      const gcData = await sq(token, "POST", "/gift-cards", {
        idempotency_key: ref + "-gc",
        location_id: locationId,
        gift_card: { type: "DIGITAL" }
      });
      if (!gcData.gift_card) throw new Error("No gift_card in response: " + JSON.stringify(gcData));
      gcId = gcData.gift_card.id;
      gan  = gcData.gift_card.gan;
    } catch (err) {
      return jsonResponse({ error: "Gift card creation failed: " + err.message }, 500);
    }

    // Step 3: Activate gift card
    try {
      await sq(token, "POST", "/gift-card-activities", {
        idempotency_key: ref + "-act",
        gift_card_activity: {
          type: "ACTIVATE",
          location_id: locationId,
          gift_card_gan: gan,
          activate_activity_details: {
            amount_money: { amount, currency: "GBP" },
            buyer_payment_instrument_ids: ["complimentary-bsg-" + ref.toLowerCase()],
            reference_id: ref
          }
        }
      });
    } catch (err) {
      return jsonResponse({ error: "Gift card activation failed: " + err.message }, 500);
    }

    // Step 4: Link to customer
    try {
      await sq(token, "POST", `/gift-cards/${gcId}/link-customer`, { customer_id: customerId });
    } catch (err) {
      // Non-fatal — log but continue
      console.warn("Link customer failed (non-fatal):", err.message);
    }

    // Step 5: Send email
    const fmtGAN = gan.replace(/(\d{4})(?=\d)/g, "$1 ");
    const donor  = sponsorName || "Boomers & Swingers";
    try {
      await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: env.WEB3FORMS_KEY,
          from_name: "Boomers & Swingers",
          to: email,
          name: `${firstName} ${lastName}`,
          subject: "Your free session — Boomers & Swingers",
          message: [
            "Session confirmed!",
            `Square gift card: ${fmtGAN}`,
            `Balance: £${(amount / 100).toFixed(2)}`,
            `Reference: ${ref}`,
            expiry || "See terms",
            "",
            "Venue: Manchester Rd, Astley M29 7EJ",
            "Show gift card number to staff. No booking needed.",
            "",
            `Donated by ${donor}`
          ].join("\n"),
          mobile: phone,
          postcode,
          reference: ref,
          gift_card: gan,
          source: slug || "ccn",
          planned_visit: plannedVisit || "",
          bs_consent: bsConsent ? "yes" : "no",
          sponsor_consent: sponsorConsent ? "yes" : "no"
        })
      });
    } catch (err) {
      // Non-fatal — gift card is created, email failed
      console.warn("Email failed (non-fatal):", err.message);
    }

    // Success
    return jsonResponse({
      success:    true,
      gan:        fmtGAN,
      reference:  ref,
      customerId,
      balance:    `£${(amount / 100).toFixed(2)}`
    });

  } catch (err) {
    return jsonResponse({ error: "Unexpected error: " + err.message }, 500);
  }
}

async function findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref }) {
  const search = await sq(token, "POST", "/customers/search", {
    query: { filter: { email_address: { exact: email } } }
  });

  if (search.customers?.length > 0) {
    const existing = search.customers[0];
    await sq(token, "PUT", `/customers/${existing.id}`, {
      given_name: firstName,
      family_name: lastName,
      phone_number: phone,
      note: `CCN · ${slug} · ${ref} · ${new Date().toISOString().slice(0, 10)}`
    });
    return existing.id;
  }

  const created = await sq(token, "POST", "/customers", {
    idempotency_key: ref + "-customer",
    given_name: firstName,
    family_name: lastName,
    email_address: email,
    phone_number: phone,
    address: { postal_code: postcode, country: "GB" },
    reference_id: ref,
    note: `CCN claimant · ${slug} · ${new Date().toISOString().slice(0, 10)}`,
    creation_source: "THIRD_PARTY"
  });

  if (!created.customer) throw new Error("Customer creation returned no customer: " + JSON.stringify(created));
  return created.customer.id;
}

async function sq(token, method, path, body) {
  const res = await fetch(SQUARE + path, {
    method,
    headers: {
      "Authorization":  "Bearer " + token,
      "Content-Type":   "application/json",
      "Square-Version": "2024-01-18"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Square returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data.errors?.map(e => e.detail).join("; ") || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Golf Session — Boomers &amp; Swingers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
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
.stat{padding:16px 12px;text-align:center;border-right:1px solid var(--border)}
.stat:last-child{border:none}
.stat-n{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#fff;line-height:1;margin-bottom:3px}
.stat-l{font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:14px}
.ch{background:rgba(74,222,128,.06);border-bottom:1px solid var(--border);padding:12px 18px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--green)}
.cb{padding:18px}
.srow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.si{font-size:13px;color:var(--muted);line-height:1.6}
.si b{color:var(--text);font-weight:600;display:block;margin-bottom:2px}
.fb{font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--green);flex-shrink:0}
.steps{list-style:none}
.step{display:flex;gap:14px;align-items:flex-start;padding:13px 0;border-bottom:1px solid rgba(74,222,128,.08)}
.step:last-child{border:none}
.sn{width:22px;height:22px;background:var(--green);border-radius:50%;color:var(--dark);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step b{font-size:13px;font-weight:600;color:var(--text);display:block;margin-bottom:2px}
.step span{font-size:12px;color:var(--muted)}
.sbanner{background:rgba(74,222,128,.05);border:1px solid var(--border);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:12px;color:var(--muted);line-height:1.5}
.sbanner b{color:var(--text)}
.cta{width:100%;background:var(--green);color:var(--dark);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;padding:16px;border:none;border-radius:100px;cursor:pointer;transition:transform .15s,opacity .15s;margin-bottom:8px}
.cta:hover{transform:translateY(-1px);opacity:.92}
.cta:disabled{background:#2a3a2a;color:var(--muted);cursor:not-allowed;transform:none}
.exp{text-align:center;font-size:11px;color:var(--muted);padding:4px 0}
.hidden{display:none}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
input[type=text],input[type=email],input[type=tel]{width:100%;background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:'DM Sans',sans-serif;font-size:14px;color:var(--text);outline:none;transition:border-color .15s}
input:focus{border-color:rgba(74,222,128,.5)}
input::placeholder{color:var(--muted)}
.mb{margin-bottom:12px}
.cbox{background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px}
.ck{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}
.ck:last-child{margin:0}
.ck input[type=checkbox]{width:15px;height:15px;margin-top:2px;flex-shrink:0;accent-color:var(--green);cursor:pointer}
.ck label{font-size:12px;color:var(--muted);line-height:1.5;text-transform:none;letter-spacing:0;font-weight:400;cursor:pointer}
.ck label b{color:var(--text);font-weight:600}
.gan{background:rgba(74,222,128,.06);border:1px solid var(--border);border-radius:14px;padding:24px;text-align:center;margin-bottom:14px}
.gl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.gn{font-family:'JetBrains Mono',monospace;font-size:clamp(20px,6vw,28px);font-weight:700;color:var(--green);letter-spacing:.12em;margin-bottom:6px}
.gs{font-size:11px;color:var(--muted)}
.vbox{background:rgba(74,222,128,.04);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:12px;color:var(--muted);line-height:1.9}
.foot{text-align:center;padding-top:20px;font-size:11px;color:var(--muted)}
.foot a{color:var(--green);text-decoration:none}
.err{background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);border-radius:10px;padding:12px 14px;font-size:12px;color:#ff9090;margin-bottom:12px;display:none}
@media(max-width:400px){.fr{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">

<!-- Step 1: Landing -->
<div id="s1">
  <div class="hero">
    <div class="badge"><div class="dot"></div><span id="bt">Giveaway drop</span></div>
    <h1>FREE<span id="ha">SESSION</span></h1>
    <p class="sub" id="hs">50 free balls at Boomers &amp; Swingers Driving Range, Astley</p>
    <div class="stats">
      <div class="stat"><div class="stat-n" id="sr">0</div><div class="stat-l">Claimed</div></div>
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
        <li class="step"><div class="sn">2</div><div><b>Get your unique gift card</b><span>Sent to your inbox instantly</span></div></li>
        <li class="step"><div class="sn">3</div><div><b>Turn up &amp; play</b><span>Show gift card number to staff at the till</span></div></li>
      </ul>
    </div>
  </div>
  <div class="sbanner"><span style="font-size:18px">⛳</span><span id="st">Donated by <b>Boomers &amp; Swingers</b></span></div>
  <button class="cta" onclick="go(2)">Claim my free session →</button>
  <p class="exp" id="en"></p>
</div>

<!-- Step 2: Form -->
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

<!-- Step 3: Confirmation -->
<div id="s3" class="hidden">
  <div class="hero" style="padding-top:32px">
    <div class="badge"><div class="dot"></div><span>✓ Confirmed</span></div>
    <h1 style="font-size:clamp(40px,11vw,64px)">YOU'RE<span>IN!</span></h1>
    <p class="sub">Your Square gift card has been sent to your inbox.</p>
  </div>
  <div class="gan"><div class="gl">Your Square gift card number</div><div class="gn" id="gd">---- ---- ---- ----</div><div class="gs" id="ge">Single use · Show to staff at the range</div></div>
  <div class="card">
    <div class="ch">📋 Summary</div>
    <div class="cb" style="font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between"><span>Donated by</span><b style="color:var(--text)" id="cs">Boomers &amp; Swingers</b></div>
      <div style="display:flex;justify-content:space-between"><span>Reference</span><span style="font-family:'JetBrains Mono',monospace;font-size:12px" id="cr">-</span></div>
      <div style="display:flex;justify-content:space-between"><span>Balance</span><b style="color:var(--green)">£6.50</b></div>
    </div>
  </div>
  <div class="vbox">📍 Manchester Rd, Astley M29 7EJ<br>📱 Show gift card number to staff at the till<br>🕐 Mon–Fri 1–9pm | Sat–Sun 10am–5pm<br>⭐ No booking needed</div>
  <div style="margin-top:14px" class="foot"><a href="https://www.boomersandswingers.golf" target="_blank">boomersandswingers.golf</a></div>
</div>

</div>
<script>
const SP={
  "tylersmithgolf":{n:"Boomers & Swingers",b:"Tyler Smith Golf × B&S Drop",h:"DROP",s:"50 free balls · for @tylersmithgolf_ followers · Astley",st:'Gifted by <b>Boomers &amp; Swingers</b> for followers of @tylersmithgolf_ on Instagram.',e:"Expires midnight 7 Apr 2026",m:10,r:0,d:1,fh:"🎁 For @tylersmithgolf_ followers",c2:"<b>B&S offers</b> — happy to hear about future sessions."},
  "gildrew":{n:"Gildrew",b:"Community Champion · Gildrew",h:"SESSION",s:"50 free balls · Donated by Gildrew · Astley",st:'Gifted by <b>Gildrew</b> — supporting the local community.',e:"Valid until 31 Dec 2026",m:60,r:34,d:269,fh:"🎁 Gifted by Gildrew",c2:"<b>Gildrew offers</b> — happy to share my details with Gildrew."},
  "adl-scaffold":{n:"ADL Scaffold",b:"Community Champion · ADL Scaffold",h:"SESSION",s:"50 free balls · Donated by ADL Scaffold · Astley",st:'Gifted by <b>ADL Scaffold</b>.',e:"Valid until 31 Mar 2027",m:60,r:12,d:359,fh:"🎁 Gifted by ADL Scaffold",c2:"<b>ADL Scaffold offers</b> — happy to share my details with ADL Scaffold."},
  "honest-fuel":{n:"Honest Fuel",b:"Community Champion · Honest Fuel",h:"SESSION",s:"50 free balls · Donated by Honest Fuel · Astley",st:'Gifted by <b>Honest Fuel</b>.',e:"Valid until 30 Apr 2027",m:60,r:8,d:389,fh:"🎁 Gifted by Honest Fuel",c2:"<b>Honest Fuel offers</b> — happy to share my details with Honest Fuel."}
};

const slug = new URLSearchParams(location.search).get("s") || "";
const sp   = SP[slug];

window.addEventListener("DOMContentLoaded", () => {
  if (!sp) {
    document.querySelector(".wrap").innerHTML = '<div style="text-align:center;padding:80px 20px"><h1 style="font-family:Bebas Neue,sans-serif;color:var(--green);font-size:48px">⛳</h1><p style="color:var(--muted);margin-top:12px">Visit <a href="https://www.boomersandswingers.golf" style="color:var(--green)">boomersandswingers.golf</a> for your sponsor link.</p></div>';
    return;
  }
  document.title = "Free Session — " + sp.n;
  document.getElementById("bt").textContent = sp.b;
  document.getElementById("ha").textContent = sp.h;
  document.getElementById("hs").textContent = sp.s;
  document.getElementById("st").innerHTML  = sp.st;
  document.getElementById("sr").textContent = sp.r;
  document.getElementById("sm").textContent = sp.m - sp.r;
  document.getElementById("sd").textContent = sp.d;
  document.getElementById("en").textContent = sp.e + " · One per person · Astley";
  document.getElementById("fh").textContent = sp.fh;
  document.getElementById("c2l").innerHTML  = sp.c2;
  document.getElementById("cs").textContent = sp.n;
});

function go(n) {
  document.getElementById("s1").style.display = n === 1 ? "" : "none";
  document.getElementById("s2").className = n === 2 ? "" : "hidden";
  document.getElementById("s3").className = n === 3 ? "" : "hidden";
  document.getElementById("err").style.display = "none";
  window.scrollTo(0, 0);
}
window.go = go;

function showErr(msg) {
  const el = document.getElementById("err");
  el.textContent = msg;
  el.style.display = "block";
}

async function sub() {
  const f1 = document.getElementById("f1").value.trim();
  const f2 = document.getElementById("f2").value.trim();
  const f3 = document.getElementById("f3").value.trim();
  const f4 = document.getElementById("f4").value.trim();
  const f5 = document.getElementById("f5").value.trim();

  if (!f1 || !f3 || !f4 || !f5) {
    showErr("Please fill in all required fields (marked with *).");
    return;
  }

  const rn  = Math.floor(Math.random() * 9000 + 1000);
  const ref = "CCN-" + slug.slice(0, 3).toUpperCase() + "-" + rn;
  const btn = document.getElementById("sb");
  btn.disabled = true;
  btn.textContent = "Creating your gift card…";
  document.getElementById("err").style.display = "none";

  try {
    const res = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: f1, lastName: f2, email: f3, phone: f4, postcode: f5,
        plannedVisit:   document.getElementById("f6").value.trim(),
        bsConsent:      document.getElementById("c1").checked,
        sponsorConsent: document.getElementById("c2").checked,
        slug, reference: ref, sponsorName: sp?.n, expiry: sp?.e
      })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Server returned an invalid response. Please try again.");
    }

    if (!res.ok || data.error) {
      throw new Error(data.error || "Something went wrong (HTTP " + res.status + ")");
    }

    document.getElementById("gd").textContent = data.gan || ref;
    document.getElementById("ge").textContent = (sp?.e || "") + " · Single use · Show to staff";
    document.getElementById("cr").textContent = data.reference || ref;
    go(3);

  } catch (err) {
    showErr(err.message || "An error occurred. Please try again.");
    btn.disabled = false;
    btn.textContent = "Get my gift card →";
  }
}
window.sub = sub;
</script>
</body>
</html>`;
}
