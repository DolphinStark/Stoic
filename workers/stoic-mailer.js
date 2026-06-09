const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://dolphinstark.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (request.method === 'POST') {
      if (url.pathname === '/contact') return handleContact(request, env, ctx);
      if (url.pathname === '/waitlist') return handleWaitlist(request, env, ctx);
    }
    return new Response('Not found', { status: 404 });
  }
};

async function handleContact(request, env, ctx) {
  try {
    const { name, email, message } = await request.json();
    if (!name || !email || !message) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    ctx.waitUntil(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: 'dolphinstark@protonmail.com',
      subject: `[ãåãåãã] ${name}ãã`,
      text: `åå: ${name}\nã¡ã¼ã«: ${email}\n\nã¡ãã»ã¼ã¸:\n${message}`,
    }).catch(e => console.error('Email failed:', e.message)));
    ctx.waitUntil(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: email,
      subject: 'ãåãåãããåãä»ãã¾ãã / Thank you for your inquiry',
      html: contactConfirmHtml(name),
    }).catch(e => console.error('Email failed:', e.message)));
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function handleWaitlist(request, env, ctx) {
  try {
    const { email, lang } = await request.json();
    if (!email) return jsonResponse({ error: 'Email is required' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM waitlist WHERE email = ?').bind(email).first();
    if (existing) return jsonResponse({ error: 'already_registered' }, 409);
    await env.DB.prepare('INSERT INTO waitlist (email, lang) VALUES (?, ?)').bind(email, lang || 'en').run();
    const isJa = lang === 'ja';
    ctx.waitUntil(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: email,
      subject: isJa ? 'ã¦ã§ã¤ããªã¹ãç»é²å®äº â STOIC' : 'Waitlist Registration Confirmed â STOIC',
      html: waitlistConfirmHtml(isJa),
    }).catch(e => console.error('Email failed:', e.message)));
    ctx.waitUntil(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: 'dolphinstark@protonmail.com',
      subject: '[ã¦ã§ã¤ããªã¹ã] æ°è¦ç»é²',
      text: `æ°è¦ã¦ã§ã¤ããªã¹ãç»é²\nã¡ã¼ã«: ${email}\nè¨èª: ${lang || 'en'}`,
    }).catch(e => console.error('Email failed:', e.message)));
    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

function waitlistConfirmHtml(isJa) {
  const title = isJa ? 'ã¦ã§ã¤ããªã¹ãç»é²å®äº' : 'Waitlist Registration Confirmed';
  const tagline = isJa ? 'ç»é²å®äº' : 'Registration Confirmed';
  const h1 = isJa ? 'ã¦ã§ã¤ããªã¹ãã¸ã®<br>ãç»é²ãããã¨ããããã¾ãã' : 'Welcome to<br>the Stoic waitlist.';
  const p1 = isJa ? 'STOICã®ã¦ã§ã¤ããªã¹ãã¸ã®ãç»é²ãç¢ºèªãããã¾ããã' : 'Your spot on the Stoic waitlist is confirmed.';
  const p2 = isJa ? 'ãµã¼ãã¹ã®ã­ã¼ã³ãæã«ããã®ã¡ã¼ã« ${email}"></td></tr></table></td></tr></table></body></html>`;
}

async function sendEmail(apiKey, { from, to, subject, html, text }) {
  const body = { from, to, subject };
  if (html) body.html = html;
  if (text) body.text = text;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
  return res.json();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
