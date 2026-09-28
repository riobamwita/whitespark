# White Spark Consulting — www.whitesparkconsulting.com

Static site. No build step — upload the folder as-is (Vercel, Netlify, Cloudflare Pages or Apache/cPanel; config for each is included).

## Pages
Each navigation item is its own page (folder + index.html, so URLs are clean):

| URL | Content |
|---|---|
| `/` | Hero, brand positioning, Explore (links to every page), How We Work, Why White Spark, Engage Us |
| `/about/` | About Us, mission, track record |
| `/services/` | Core Services + 8 Sectors We Serve (`/services/#sectors`) |
| `/sme/` | SME Focus |
| `/ai-advisory/` | AI Consultancy |
| `/team/` | Team (compact cards, "Open profile" expands) + Advisory Network |
| `/experts/` | Expert Network Services (`#xn-phone`, `#xn-video`, `#xn-reports`, `#xn-workshops`) |
| `/east-africa/` | East Africa Focus and market map |
| `/privacy.html`, `/sitemap.html`, `/404.html` | Utility pages |

Every page shares the same navigation, footer, Engage Us block and both forms:
- Consultation form: any "Engage Us" / "Request a Consultation" / "Get started" button; link `#enquiry` on any page.
- Join as an Expert: nav, mobile menu, Team, Expert Network, Engage Us and footer; link `#join` on any page.

All asset and page links are root-absolute (`/assets/...`), so the site must be served from the domain root. Old one-page links such as `/#services` redirect to the new pages automatically. Short links: `/ai`, `/markets`, `/smes`, `/expert-network`, `/join`, `/process`, `/why`, `/contact`, `/profile`.

## Files
- `index.html` (home) and `about/`, `services/`, `sme/`, `ai-advisory/`, `team/`, `experts/`, `east-africa/` (each with `index.html`); `privacy.html`, `sitemap.html`, `404.html`
- `assets/css/style.css` — v2 visual system (Midnight Ink, Burnished Gold, East Africa Teal; Cormorant Garamond / Barlow / Barlow Condensed)
- `assets/js/config.js` — Supabase URL, anon key, contact details (edit here)
- `assets/js/app.js` — nav, counters, consent banner, analytics, consultation form and enquiry modal
- `assets/docs/WhiteSparkConsulting_Profile_2025.pdf` — original company profile. Used until an admin uploads a replacement in Admin → Settings → Company profile.
- `assets/img/` — team photos (WebP + JPG), icons, social share image

## Database (Supabase project blveufcpnigfhvrphkhv)
| Site action | Table / bucket |
|---|---|
| Consultation form | `contact_submissions` |
| Form attachment | storage bucket `contact-attachments` (`inbox/<uuid>/<file>`) |
| Page visits | `page_views` |
| Clicks, downloads, form errors | `events` |
| Cookie choice | `consent_log` |
| Join as an Expert form | `expert_applications` |
| Expert CV | private storage bucket `expert-cvs` (`cv/<uuid>/<file>`, PDF/DOC/DOCX, 10 MB) |
| Company profile (admin-managed) | `site_settings` key `company_profile` → public bucket `site-assets` (`docs/profile-<timestamp>.pdf`) |

## Admin (`/admin/`)
Overview · Enquiries · Experts (applications, CV download, status, notes, CSV export) · Analytics · Settings (company profile upload, admin team, data retention).
