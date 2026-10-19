# Security headers — owner checklist (Cloudflare in front of GitHub Pages)

GitHub Pages cannot send custom security headers. Putting Cloudflare's free tier
in front of the site adds them without changing the app. ~10 minutes, DNS only,
no code changes. Verify afterwards at https://securityheaders.com (target: A).

## Steps

1. Create a free Cloudflare account → **Add a site** → `my-spr-with-mo.duckdns.org`.
2. Cloudflare shows two nameservers (e.g. `ada.ns.cloudflare.com`). At your
   **DuckDNS account** you cannot change nameservers (DuckDNS only manages A
   records) — so instead keep DuckDNS and add the domain to Cloudflare as
   *DNS-only via a CNAME setup*, or simpler: point a subdomain you own at
   Cloudflare. **If nameserver delegation is not possible with duckdns.org**,
   the practical alternative is a custom domain you control (e.g. a cheap
   `spr.yourdomain.com`) delegated to Cloudflare, with a CNAME to
   `mdshezkhn.github.io`. Update the repo `CNAME` file to match.
3. In Cloudflare → **SSL/TLS** → set mode **Full (strict)**.
4. Cloudflare → **Rules → Transform Rules → Managed Transform** → *Add security
   headers* ON. Or add them individually (Network → HTTP Response Headers):
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: SAMEORIGIN` *(or a CSP frame-ancestors rule)*
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
5. Keep **Brotli/compression** and **caching** defaults; do NOT enable
   "Rocket Loader" or auto-minify for JS (the app ships one pre-built file —
   rewriting it risks breaking the service-worker version hash).

## Why each header matters here

- **HSTS** — stops a first-visit HTTP downgrade on a school network.
- **nosniff** — MIME confusion protection for `sw.js`/future assets.
- **frame-ancestors/XFO** — clickjacking protection for a student-data UI.
- **Referrer-Policy** — share links (which contain decryption keys in the URL
  fragment) must never leak via Referer to third parties.
- **Permissions-Policy** — the app needs no camera/mic/location.

## Rollback

Disable the Transform/Response-Header rules in Cloudflare — the site is served
unchanged from GitHub Pages either way.
