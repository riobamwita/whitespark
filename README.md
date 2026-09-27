# White Spark Consulting — www.whitesparkconsulting.com

Static site. No build step — upload the folder as-is (Vercel, Netlify, Cloudflare Pages or Apache/cPanel; config for each is included).

## Page order (index.html)
Hero → 01 About Us → Brand Positioning → 02 Core Services + Who We Serve → 03 SME Focus → 04 AI Consultancy → 05 Our Team + Advisory Network → 06 How We Work → 07 East Africa Focus → 08 Why White Spark → 09 Engage Us → Footer. The consultation form opens as a modal from the nav "Engage Us", the mobile menu and "Request a Consultation"; `index.html#enquiry` opens it directly

## Files
- `index.html`, `privacy.html`, `sitemap.html`, `404.html`
- `assets/css/style.css` — v2 visual system (Midnight Ink, Burnished Gold, East Africa Teal; Cormorant Garamond / Barlow / Barlow Condensed)
- `assets/js/config.js` — Supabase URL, anon key, contact details (edit here)
- `assets/js/app.js` — nav, counters, consent banner, analytics, consultation form and enquiry modal
- `assets/docs/WhiteSparkConsulting_Profile_2025.pdf` — "Download Profile" button
- `assets/img/` — team photos (WebP + JPG), icons, social share image

## Database (Supabase project blveufcpnigfhvrphkhv — unchanged)
| Site action | Table / bucket |
|---|---|
| Consultation form | `contact_submissions` |
| Form attachment | storage bucket `contact-attachments` (`inbox/<uuid>/<file>`) |
| Page visits | `page_views` |
| Clicks, downloads, form errors | `events` |
| Cookie choice | `consent_log` |
