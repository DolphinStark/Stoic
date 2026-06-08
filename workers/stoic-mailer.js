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
      if (url.pathname === '/contact') return handleContact(request, env);
      if (url.pathname === '/waitlist') return handleWaitlist(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleContact(request, env) {
  try {
    const { name, email, message } = await request.json();
    if (!name || !email || !message) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // Notification to owner (fire and forget - don't block on failure)
    ctx_send(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: 'dolphinstark@protonmail.com',
      subject: `[お問い合わせ] ${name}より`,
      text: `名前: ${name}\nメール: ${email}\n\nメッセージ:\n${message}`,
    }));

    // Auto-reply to sender
    ctx_send(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: email,
      subject: 'お問い合わせを受け付けました / Thank you for your inquiry',
      text: `${name} 様\n\nお問い合わせありがとうございます。\n内容を確認の上�3営業日以内にご連絡いたします。\n\n---\n\nDear ${name},\n\nThank you for your inquiry. We will get back to you within 3 business days.\n\nBest regards,\nDolphin Stark`,
    }));

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function handleWaitlist(request, env) {
  try {
    const { email, lang } = await request.json();
    if (!email) return jsonResponse({ error: 'Email is required' }, 400);

    // Check duplicate
    const existing = await env.DB.prepare(
      'SELECT id FROM waitlist WHERE email = ?'
    ).bind(email).first();

    if (existing) return jsonResponse({ error: 'already_registered' }, 409);

    // Insert to D1
    await env.DB.prepare(
      'INSERT INTO waitlist (email, lang) VALUES (?, ?)'
    ).bind(email, lang || 'en').run();

    // Confirmation email to registrant
    const isJa = lang === 'ja';
    ctx_send(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: email,
      subject: isJa ? 'ウェイトリスデ登録完了' : 'Waitlist Registration Confirmed',
      text: isJa
        ? `ウェイトリストへのご登録ありがとうございます。\nサービス開始時にご連絡いたします。\n\nDolphin Stark`
        : `Thank you for joining our waitlist!\nWe'll notify you when the service launches.\n\nDolphin Stark`,
    }));

    // Notification to owner
    ctx_send(sendEmail(env.RESEND_API_KEY, {
      from: 'noreply@dolphinstark.com',
      to: 'dolphinstark@protonmail.com',
      subject: '[ウェイトリスデ] 新規登録',
      text: `新規ウェイトリスト登録\nメール: ${email}\n言語: ${lang || 'en'}`,
    }));

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function sendEmail(apiKey, { from, to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
  return res.json();
}

// Helper: fire-and-forget (errors silently caught)
function ctx_send(promise) {
  promise.catch(e => console.error('Email send failed:', e.message));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
