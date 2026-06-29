// Secrets (RESEND_API_KEY, TURNSTILE_SECRET_KEY) are re-applied on every deploy via .github/workflows/deploy-worker.yml
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
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
    const { name, email, message, lang, company, turnstileToken } = await request.json();
    if (company) return jsonResponse({ success: true });
    if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request))) {
      return jsonResponse({ error: 'verification_failed' }, 403);
    }
    if (!(await checkRateLimit(env, request))) {
      return jsonResponse({ error: 'rate_limited' }, 429);
    }
    if (!name || !email || !message) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    if (!isValidEmail(email)) {
      return jsonResponse({ error: 'Invalid email' }, 400);
    }
    const isJa = lang === 'ja';
    ctx.waitUntil((async () => {
      await sendEmailWithRetry(env.RESEND_API_KEY, {
        from: 'noreply@denroot.com',
        to: 'contact@denroot.com',
        subject: `[お問合せ] ${name}様`,
        text: `名前: ${name}\nメール: ${email}\n\nメッセージ:\n${message}`,
      });
      await sleep(600);
      await sendEmailWithRetry(env.RESEND_API_KEY, {
        from: 'noreply@denroot.com',
        to: email,
        subject: isJa ? 'お問合せを承りました' : 'Thank you for your inquiry',
        html: contactConfirmHtml(name, message, isJa),
      });
    })().catch(e => console.error('Contact emails failed:', e.message)));
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function handleWaitlist(request, env, ctx) {
  try {
    const { email, lang, company, turnstileToken } = await request.json();
    if (company) return jsonResponse({ success: true });
    if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request))) {
      return jsonResponse({ error: 'verification_failed' }, 403);
    }
    if (!(await checkRateLimit(env, request))) {
      return jsonResponse({ error: 'rate_limited' }, 429);
    }
    if (!isValidEmail(email)) return jsonResponse({ error: 'Email is required' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM waitlist WHERE email = ?').bind(email).first();
    if (existing) return jsonResponse({ error: 'already_registered' }, 409);
    await env.DB.prepare('INSERT INTO waitlist (email, lang) VALUES (?, ?)').bind(email, lang || 'en').run();
    const isJa = lang === 'ja';
    ctx.waitUntil((async () => {
      await sendEmailWithRetry(env.RESEND_API_KEY, {
        from: 'noreply@denroot.com',
        to: email,
        subject: isJa ? 'ウェイトリスト登録完了' : 'Waitlist Registration Confirmed',
        html: waitlistConfirmHtml(isJa),
      });
      await sleep(600);
      await sendEmailWithRetry(env.RESEND_API_KEY, {
        from: 'noreply@denroot.com',
        to: 'contact@denroot.com',
        subject: '[ウェイトリスト] 新規登録',
        text: `新規ウェイトリスト登録\nメール: ${email}\n言語: ${lang || 'en'}`,
      });
    })().catch(e => console.error('Waitlist emails failed:', e.message)));
    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

function waitlistConfirmHtml(isJa) {
  const title = isJa ? 'ウェイトリスト登録完了' : 'Waitlist Registration Confirmed';
  const h1 = isJa ? 'ウェイトリストへの<br>ご登録ありがとうございます。' : 'Welcome to<br>the waitlist.';
  const p1 = isJa ? 'ウェイトリストへのご登録を確認いたしました。' : 'Your spot on the waitlist is confirmed.';
  const p2 = isJa ? 'サービスのローンチ時に、このメールアドレスへご連絡いたします。' : "We'll reach out to this address the moment we launch.";
  const footer = isJa ? 'このメールはウェイトリスト登録のご確認として送信されました。' : 'This email was sent to confirm your waitlist registration.';
  return `<!DOCTYPE html>
<html lang="${isJa ? 'ja' : 'en'}">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Inter','Helvetica Neue',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:48px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#060810;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
<img src="https://denroot.com/assets/denroot-logo-white.png" alt="denroot" width="132" style="display:block;margin:0 auto;height:auto;border:0;" />
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:48px 40px 40px;">
<h1 style="margin:0 0 24px;font-size:26px;font-weight:600;line-height:1.3;letter-spacing:-0.02em;color:#1d1d1f;">${h1}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#48484a;">${p1}</p>
<p style="margin:0 0 40px;font-size:15px;line-height:1.75;color:#48484a;">${p2}</p>
<hr style="border:none;border-top:1px solid #e8e8ed;margin:0 0 24px;">
<p style="margin:0;font-size:11px;color:#6e6e73;line-height:1.6;">${footer}</p>
<p style="margin:8px 0 0;font-size:11px;color:#6e6e73;">© 2026 Denroot</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function contactConfirmHtml(name, message, isJa) {
  const safeName = escapeHtml(name);
  const safeMsg = escapeHtml(message);
  const t = isJa
    ? { title: 'お問合せを承りました', h1: `${safeName}様、<br>ご連絡ありがとうございます。`, body: 'お問合せを承りました。内容を確認後、できるだけ早くご返答いたします。', label: 'お問い合わせ内容', footer: 'このメールはお問合せフォームからの自動返信です。' }
    : { title: 'Thank you for your inquiry', h1: `Thank you, ${safeName}.`, body: "We've received your inquiry and will get back to you as soon as possible.", label: 'Your message', footer: 'This is an automated confirmation from the contact form.' };
  return `<!DOCTYPE html>
<html lang="${isJa ? 'ja' : 'en'}">
<head><meta charset="UTF-8"><title>${t.title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Inter','Helvetica Neue',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:48px 20px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#060810;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
<img src="https://denroot.com/assets/denroot-logo-white.png" alt="denroot" width="132" style="display:block;margin:0 auto;height:auto;border:0;" />
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:48px 40px 40px;">
<h1 style="margin:0 0 24px;font-size:26px;font-weight:600;line-height:1.3;letter-spacing:-0.02em;color:#1d1d1f;">${t.h1}</h1>
<p style="margin:0 0 28px;font-size:15px;line-height:1.75;color:#48484a;">${t.body}</p>
<div style="background:#f5f5f7;border-radius:10px;padding:20px 22px;margin:0 0 32px;">
<p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6e6e73;">${t.label}</p>
<p style="margin:0;font-size:14px;line-height:1.75;color:#1d1d1f;white-space:pre-wrap;">${safeMsg}</p>
</div>
<hr style="border:none;border-top:1px solid #e8e8ed;margin:0 0 24px;">
<p style="margin:0;font-size:11px;color:#6e6e73;line-height:1.6;">${t.footer}</p>
<p style="margin:8px 0 0;font-size:11px;color:#6e6e73;">© 2026 Denroot</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
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

async function verifyTurnstile(token, secret, request) {
  if (!token || !secret) return false;
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    return false;
  }
}

async function checkRateLimit(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip || !env.DB) return true;
  const LIMIT = 30;
  const WINDOW = 600;
  const now = Math.floor(Date.now() / 1000);
  const run = async () => {
    const row = await env.DB.prepare('SELECT cnt, reset_at FROM rate_limit WHERE ip = ?').bind(ip).first();
    if (!row || row.reset_at < now) {
      await env.DB.prepare('INSERT INTO rate_limit (ip, cnt, reset_at) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET cnt = 1, reset_at = ?').bind(ip, now + WINDOW, now + WINDOW).run();
      return true;
    }
    if (row.cnt >= LIMIT) return false;
    await env.DB.prepare('UPDATE rate_limit SET cnt = cnt + 1 WHERE ip = ?').bind(ip).run();
    return true;
  };
  try {
    return await run();
  } catch (e) {
    try {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS rate_limit (ip TEXT PRIMARY KEY, cnt INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run();
      return await run();
    } catch (e2) {
      return true;
    }
  }
}

function isValidEmail(e) {
  if (typeof e !== 'string' || e.length > 254) return false;
  var at = e.indexOf('@');
  var dot = e.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < e.length - 1 && e.indexOf(' ') === -1;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEmailWithRetry(apiKey, message, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await sendEmail(apiKey, message);
    } catch (e) {
      if (i === tries - 1) throw e;
      // Resend free-tier rate limit is ~2 req/sec; back off and retry.
      await sleep(800 * (i + 1));
    }
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
