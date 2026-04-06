/**
 * CCN Claim API — Cloudflare Pages Function
 * Route: POST /api
 *
 * Set in Cloudflare Pages → Settings → Environment Variables:
 *   SQUARE_TOKEN     — Square production access token
 *   SQUARE_LOCATION  — LDQSQ4YZX7YS0
 *   WEB3FORMS_KEY    — 52fd6bfb-2d94-4d78-9242-e359dfa69c95
 */

const SQUARE = "https://connect.squareup.com/v2";

const SESSION_AMOUNTS = {
  "tylersmithgolf": 650,
  "gildrew":        650,
  "talentia-group": 650,
  "adl-scaffold":   650,
  "honest-fuel":    650,
};

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return res({ error: "Invalid JSON" }, 400); }

  const { firstName, lastName, email, phone, postcode,
          plannedVisit, bsConsent, sponsorConsent,
          slug, reference, sponsorName, expiry } = body;

  if (!firstName || !email || !phone || !postcode)
    return res({ error: "Missing required fields" }, 400);

  const token      = env.SQUARE_TOKEN;
  const locationId = env.SQUARE_LOCATION || "LDQSQ4YZX7YS0";
  const amount     = SESSION_AMOUNTS[slug] || 650;
  const ref        = reference || ("CCN-" + Math.random().toString(36).slice(2,8).toUpperCase());

  try {
    // 1. Find or create customer
    const customerId = await findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref });

    // 2. Create digital gift card
    const gcData = await sq(token, "POST", "/gift-cards", {
      idempotency_key: ref + "-gc",
      location_id: locationId,
      gift_card: { type: "DIGITAL" }
    });
    if (!gcData.gift_card) throw new Error("Gift card creation failed");
    const { id: gcId, gan } = gcData.gift_card;

    // 3. Activate with £6.50 balance
    await sq(token, "POST", "/gift-card-activities", {
      idempotency_key: ref + "-act",
      gift_card_activity: {
        type: "ACTIVATE",
        location_id: locationId,
        gift_card_id: gcId,
        activate_activity_details: {
          amount_money: { amount, currency: "GBP" },
          buyer_payment_instrument_ids: ["complimentary-bsg-" + ref.toLowerCase()],
          reference_id: ref
        }
      }
    });

    // 4. Link gift card to customer
    await sq(token, "POST", `/gift-cards/${gcId}/link-customer`, { customer_id: customerId });

    // 5. Send confirmation email
    const fmtGAN = gan.replace(/(\d{4})(?=\d)/g, "$1 ");
    await sendEmail(env.WEB3FORMS_KEY, {
      to: email, name: `${firstName} ${lastName}`,
      subject: "Your free session — Boomers & Swingers",
      message: [
        "Session confirmed!",
        `Square gift card: ${fmtGAN}`,
        `Balance: £${(amount/100).toFixed(2)}`,
        `Reference: ${ref}`,
        expiry || "See terms",
        "",
        "Venue: Manchester Rd, Astley M29 7EJ",
        "Show gift card number to staff. No booking needed.",
        "",
        `Donated by ${sponsorName || "Boomers & Swingers"}`
      ].join("\n"),
      mobile: phone, postcode, reference: ref, gift_card: gan,
      source: slug || "ccn",
      planned_visit: plannedVisit || "",
      bs_consent: bsConsent ? "yes" : "no",
      sponsor_consent: sponsorConsent ? "yes" : "no"
    });

    return res({ success: true, gan: fmtGAN, reference: ref, customerId, balance: `£${(amount/100).toFixed(2)}` });

  } catch (err) {
    console.error("CCN error:", err.message);
    return res({ error: err.message || "Internal error" }, 500);
  }
}

async function findOrCreateCustomer(token, { firstName, lastName, email, phone, postcode, slug, ref }) {
  const search = await sq(token, "POST", "/customers/search", {
    query: { filter: { email_address: { exact: email } } }
  });
  if (search.customers?.length > 0) {
    const e = search.customers[0];
    await sq(token, "PUT", `/customers/${e.id}`, {
      given_name: firstName, family_name: lastName, phone_number: phone,
      note: `CCN · ${slug} · ${ref} · ${new Date().toISOString().slice(0,10)}`
    });
    return e.id;
  }
  const created = await sq(token, "POST", "/customers", {
    idempotency_key: ref + "-customer",
    given_name: firstName, family_name: lastName,
    email_address: email, phone_number: phone,
    address: { postal_code: postcode, country: "GB" },
    reference_id: ref,
    note: `CCN claimant · ${slug} · ${new Date().toISOString().slice(0,10)}`,
    creation_source: "THIRD_PARTY"
  });
  if (!created.customer) throw new Error("Customer creation failed");
  return created.customer.id;
}

async function sq(token, method, path, body) {
  const r = await fetch(SQUARE + path, {
    method,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Square-Version": "2024-01-18" },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json();
  if (!r.ok && d.errors) throw new Error(d.errors.map(e => e.detail).join("; "));
  return d;
}

async function sendEmail(key, { to, name, subject, message, ...extra }) {
  await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_key: key, from_name: "Boomers & Swingers", to, name, subject, message, ...extra })
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
