# Stoic

Minimalist productivity app — [dolphinstark.com](https://dolphinstark.com)

## Stack

| Layer | Tech |
|---|---|
| Frontend | GitHub Pages → dolphinstark.com |
| Backend | Cloudflare Workers (`stoic-mailer`) |
| Database | Cloudflare D1 (`stoic-waitlist`) |
| Email | Resend (`noreply@dolphinstark.com`) |
| CI/CD | GitHub Actions (auto-deploys on `workers/**` push) |
