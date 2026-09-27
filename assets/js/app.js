/* White Spark Consulting — app.js (no dependencies)
   Supabase: page_views, events, consent_log, contact_submissions + storage bucket contact-attachments */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  root.classList.add("js");
  var CFG = window.WS_CONFIG || {};
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---------------- Hero background video ----------------
     iOS Safari (incl. iPhone 8 / Low Power Mode) can refuse muted autoplay.
     The poster keeps a slow CSS pan as a fallback, and the video is retried
     on the visitor's first tap, which iOS always accepts. */
  (function heroVideo() {
    var v = $(".hero-video"); if (!v) return;
    var media = v.parentNode;
    var conn = navigator.connection || {};
    if (reduced || conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")) return; // poster only
    var mobile = window.matchMedia("(max-aspect-ratio: 3/4)").matches;
    v.muted = true; v.defaultMuted = true; v.autoplay = true; v.loop = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.playsInline = true;
    v.src = mobile ? v.getAttribute("data-src-mobile") : v.getAttribute("data-src-desktop");
    v.load();
    var started = false, inView = true;
    function onPlaying() {
      if (started) return; started = true;
      v.classList.add("is-playing"); media.classList.add("video-on");
      unbindGesture();
    }
    v.addEventListener("playing", onPlaying);
    v.addEventListener("timeupdate", function () { if (v.currentTime > 0.05) onPlaying(); });
    function tryPlay() {
      if (!inView || doc.hidden) return;
      var p = v.play(); if (p && p.catch) p.catch(function () { bindGesture(); });
    }
    var gestures = ["touchend", "click", "keydown"], bound = false;
    function kick() { tryPlay(); }
    function bindGesture() {
      if (bound || started) return; bound = true;
      gestures.forEach(function (g) { doc.addEventListener(g, kick, { passive: true }); });
    }
    function unbindGesture() {
      if (!bound) return; bound = false;
      gestures.forEach(function (g) { doc.removeEventListener(g, kick, { passive: true }); });
    }
    tryPlay();
    v.addEventListener("canplay", function () { if (!started) tryPlay(); }, { once: true });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) {
        inView = e[0].isIntersecting;
        if (inView) tryPlay(); else v.pause();
      }, { threshold: 0.05 }).observe(v);
    }
    doc.addEventListener("visibilitychange", function () { if (doc.hidden) v.pause(); else tryPlay(); });
    window.addEventListener("pageshow", function (e) { if (e.persisted) tryPlay(); });
  })();

  /* ---------------- IDs & storage ---------------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  function store(kind, k, v) {
    try { var s = kind === "l" ? localStorage : sessionStorage; if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (e) { return null; }
  }
  var SESSION = store("s", "ws_sid") || uuid(); store("s", "ws_sid", SESSION);
  var CONSENT_KEY = "ws_consent_" + (CFG.policyVersion || "1");
  function consent() { return store("l", CONSENT_KEY) === "accepted" ? "full" : "essential"; }
  function visitor() {
    if (consent() !== "full") return null;
    var v = store("l", "ws_vid"); if (!v) { v = uuid(); store("l", "ws_vid", v); } return v;
  }

  /* ---------------- Supabase REST (minimal) ---------------- */
  function sbHeaders(extra) {
    var h = { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey };
    for (var k in extra) h[k] = extra[k];
    return h;
  }
  function sbInsert(table, row, keepalive) {
    if (!CFG.supabaseUrl) return Promise.reject(new Error("not_configured"));
    return fetch(CFG.supabaseUrl + "/rest/v1/" + table, {
      method: "POST", keepalive: !!keepalive,
      headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(row)
    }).then(function (r) {
      if (r.ok) return true;
      return r.json().catch(function () { return {}; }).then(function (j) {
        var e = new Error(j.message || ("HTTP " + r.status)); e.code = j.code; e.status = r.status; throw e;
      });
    });
  }
  function sbUpload(path, file) {
    return fetch(CFG.supabaseUrl + "/storage/v1/object/" + CFG.attachmentBucket + "/" + path, {
      method: "POST",
      headers: sbHeaders({ "Content-Type": file.type || "application/octet-stream", "x-upsert": "false", "cache-control": "3600" }),
      body: file
    }).then(function (r) {
      if (r.ok) return path;
      return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || j.error || "upload_failed"); });
    });
  }

  /* ---------------- Analytics (consent-aware) ---------------- */
  var ESSENTIAL_EVENTS = { page_leave: 1, download: 1, form_submit: 1, form_error: 1, not_found: 1 };
  function path() { return location.pathname || "/"; }
  function device() {
    var ua = navigator.userAgent;
    if (/bot|crawl|spider|slurp|lighthouse/i.test(ua)) return "bot";
    if (/iPad|Tablet|PlayBook/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|iPhone|Android/i.test(ua)) return "mobile";
    return "desktop";
  }
  function browser() {
    var ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return "Edge"; if (/OPR\//.test(ua)) return "Opera"; if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
    if (/Firefox\//.test(ua)) return "Firefox"; if (/Chrome\//.test(ua)) return "Chrome"; if (/Safari\//.test(ua)) return "Safari"; return "Other";
  }
  function os() {
    var ua = navigator.userAgent;
    if (/Windows/.test(ua)) return "Windows"; if (/iPhone|iPad|iPod/.test(ua)) return "iOS"; if (/Mac OS X/.test(ua)) return "macOS";
    if (/Android/.test(ua)) return "Android"; if (/Linux/.test(ua)) return "Linux"; return "Other";
  }
  var cut = function (s, n) { return s == null ? null : String(s).slice(0, n); };
  function track(name, label, value, meta) {
    var c = consent();
    if (c !== "full" && !ESSENTIAL_EVENTS[name]) return;
    sbInsert("events", {
      session_id: SESSION, visitor_id: visitor(), consent: c, path: cut(path(), 512),
      name: name, label: cut(label, 300), value: typeof value === "number" && isFinite(value) ? value : null, meta: meta || {}
    }, name === "page_leave").catch(function () {});
  }
  window.wsTrack = track;
  function pageView(status) {
    var q = new URLSearchParams(location.search), ref = doc.referrer || null, refHost = null;
    try { if (ref) { refHost = new URL(ref).host; if (refHost === location.host) { ref = null; refHost = null; } } } catch (e) {}
    var isEntry = !store("s", "ws_entry"); store("s", "ws_entry", "1");
    sbInsert("page_views", {
      session_id: SESSION, visitor_id: visitor(), consent: consent(), path: cut(path(), 512), title: cut(doc.title, 300),
      status: status || 200, is_entry: isEntry, referrer: cut(ref, 1024), referrer_host: cut(refHost, 255),
      utm_source: cut(q.get("utm_source"), 200), utm_medium: cut(q.get("utm_medium"), 200), utm_campaign: cut(q.get("utm_campaign"), 200),
      utm_term: cut(q.get("utm_term"), 200), utm_content: cut(q.get("utm_content"), 200),
      device: device(), browser: browser(), os: os(), screen_w: screen.width || null, screen_h: screen.height || null,
      viewport_w: innerWidth, viewport_h: innerHeight, language: cut(navigator.language, 35),
      timezone: cut((Intl.DateTimeFormat().resolvedOptions() || {}).timeZone, 64)
    }).catch(function () {});
  }
  var started = Date.now(), maxScroll = 0, leftSent = false;
  addEventListener("scroll", function () {
    var h = doc.documentElement.scrollHeight - innerHeight;
    if (h > 0) maxScroll = Math.max(maxScroll, Math.round((scrollY / h) * 100));
  }, { passive: true });
  function leave() {
    if (leftSent) return; leftSent = true;
    track("page_leave", null, Math.round((Date.now() - started) / 1000), { max_scroll: maxScroll });
  }
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") leave(); });
  addEventListener("pagehide", leave);

  /* ---------------- Consent banner ---------------- */
  function initConsent() {
    var bar = $("#cookie");
    if (!bar) return;
    if (!store("l", CONSENT_KEY)) setTimeout(function () { bar.hidden = false; }, 1200);
    $$("[data-consent]", bar).forEach(function (b) {
      b.addEventListener("click", function () {
        var d = b.getAttribute("data-consent");
        store("l", CONSENT_KEY, d);
        if (d !== "accepted") store("l", "ws_vid", null);
        bar.hidden = true;
        sbInsert("consent_log", { session_id: SESSION, visitor_id: d === "accepted" ? visitor() : null, decision: d, policy_version: CFG.policyVersion || "1", path: cut(path(), 512) }).catch(function () {});
      });
    });
    $$("[data-cookie-settings]").forEach(function (b) { b.addEventListener("click", function () { bar.hidden = false; }); });
  }

  /* ---------------- Config-driven contact links ---------------- */
  function applyConfig() {
    if (CFG.email) {
      $$("[data-cfg-email]").forEach(function (a) { a.href = "mailto:" + CFG.email; });
      $$("[data-cfg-email-text]").forEach(function (e) { e.textContent = CFG.email; });
    }
    if (CFG.phone) {
      $$("[data-cfg-tel]").forEach(function (a) { a.href = "tel:" + CFG.phone.replace(/[^\d+]/g, ""); });
      $$("[data-cfg-phone-text]").forEach(function (e) { e.textContent = CFG.phone; });
    }
    if (CFG.whatsapp) $$("[data-cfg-wa]").forEach(function (a) { a.href = "https://wa.me/" + CFG.whatsapp; });
    if (CFG.linkedin) $$("[data-cfg-li]").forEach(function (a) { a.href = CFG.linkedin; });
    $$("[data-year]").forEach(function (e) { e.textContent = new Date().getFullYear(); });
  }

  /* ---------------- Nav ---------------- */
  function initNav() {
    var t = $(".nav-toggle"), m = $("#mnav");
    if (t && m) {
      var set = function (open) {
        m.hidden = !open; t.setAttribute("aria-expanded", open);
        t.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        $(".i-open", t).style.display = open ? "none" : "";
        $(".i-close", t).style.display = open ? "" : "none";
      };
      t.addEventListener("click", function () { set(m.hidden); });
      $$("a", m).forEach(function (a) { a.addEventListener("click", function () { set(false); }); });
      doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !m.hidden) { set(false); t.focus(); } });
      addEventListener("resize", function () { if (innerWidth > 960 && !m.hidden) set(false); });
      doc.addEventListener("click", function (e) { if (!m.hidden && !m.contains(e.target) && !t.contains(e.target)) set(false); });
    }
    var links = $$(".nav-links a");
    if ("IntersectionObserver" in window && links.length) {
      var map = {};
      links.forEach(function (a) { var h = a.getAttribute("href"); if (h.charAt(0) === "#") map[h.slice(1)] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.remove("is-active"); });
          if (map[en.target.id]) map[en.target.id].classList.add("is-active");
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      $$("main section[id]").forEach(function (s) { io.observe(s); });
    }
  }

  /* ---------------- Counters ---------------- */
  function initCounters() {
    var els = $$("[data-count]"); if (!els.length || reduced || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var el = en.target, to = +el.getAttribute("data-count"), t0 = performance.now(), dur = 1400;
        (function tick(now) {
          var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
          el.textContent = Math.round(to * e);
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: 0.6 });
    els.forEach(function (el) { el.textContent = "0"; io.observe(el); });
  }


  /* ---------------- Team profiles: Read profile / Close profile ---------------- */
  (function teamProfiles() {
    $$(".team-more").forEach(function (btn) {
      var card = btn.closest(".team-card"), wrap = $("#" + btn.getAttribute("aria-controls")), lbl = $("span", btn);
      if (!card || !wrap) return;
      btn.addEventListener("click", function () {
        var open = !card.classList.contains("is-open");
        card.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        lbl.textContent = open ? "Close profile" : "Read profile";
        wrap.style.maxHeight = open ? wrap.scrollHeight + "px" : "";
        if (!open) {
          var top = card.getBoundingClientRect().top;
          if (top < 0) window.scrollBy({ top: top - 90, behavior: reduced ? "auto" : "smooth" });
        }
      });
      addEventListener("resize", function () { if (card.classList.contains("is-open")) wrap.style.maxHeight = wrap.scrollHeight + "px"; }, { passive: true });
    });
  })();

  /* ---------------- Motion: reveal, live card beams, pointer glow ---------------- */
  function initMotion() {
    $$("[data-stagger]").forEach(function (g) {
      Array.prototype.forEach.call(g.children, function (c, i) { c.style.setProperty("--i", i); });
    });
    var rv = $$(".rv"), cards = $$(".c");
    /* idle float: stagger phase and tempo per card so the page breathes rather than marches */
    cards.forEach(function (c, i) {
      c.style.setProperty("--bd", (-((i * 1.37) % 5.6)).toFixed(2) + "s");
      c.style.setProperty("--bt", (5.2 + (i % 4) * 0.35).toFixed(2) + "s");
    });
    if (!("IntersectionObserver" in window)) {
      rv.forEach(function (e) { e.classList.add("in"); }); cards.forEach(function (c) { c.classList.add("live"); }); return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    rv.forEach(function (e) { io.observe(e); });
    /* anything already scrolled past (fast scroll, anchor jumps) reveals immediately */
    var sweepQ = 0;
    function sweep() {
      sweepQ = 0;
      $$(".rv:not(.in)").forEach(function (e) { if (e.getBoundingClientRect().top < innerHeight * 0.92) { e.classList.add("in"); io.unobserve(e); } });
    }
    addEventListener("scroll", function () { if (!sweepQ) sweepQ = setTimeout(sweep, 140); }, { passive: true });
    addEventListener("load", sweep);
    if (!reduced) {
      var live = new IntersectionObserver(function (es) {
        es.forEach(function (en) { en.target.classList.toggle("live", en.isIntersecting); });
      }, { rootMargin: "60px 0px" });
      cards.forEach(function (c) { live.observe(c); });
    }
    if (canHover && !reduced) {
      var raf = 0, last = null;
      doc.addEventListener("pointermove", function (e) {
        var c = e.target.closest && e.target.closest(".c");
        if (!c) return;
        last = { c: c, x: e.clientX, y: e.clientY };
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0; var r = last.c.getBoundingClientRect();
          last.c.style.setProperty("--mx", (last.x - r.left) + "px");
          last.c.style.setProperty("--my", (last.y - r.top) + "px");
        });
      }, { passive: true });
    }
    var nav = $("#nav");
    if (nav) {
      var onScroll = function () { nav.classList.toggle("scrolled", scrollY > 24); };
      addEventListener("scroll", onScroll, { passive: true }); onScroll();
    }
  }

  /* ---------------- East Africa map ---------------- */
  var MARKETS = {
    KEN: ["Kenya", "Headquarters — Nairobi", "1°17′S 36°49′E"],
    RWA: ["Rwanda", "Active operations — Kigali", "1°57′S 30°04′E"],
    UGA: ["Uganda", "Active operations — Kampala", "0°21′N 32°35′E"],
    TZA: ["Tanzania", "Active operations — Dar es Salaam", "6°48′S 39°17′E"],
    ETH: ["Ethiopia", "Emerging market — Addis Ababa", "9°02′N 38°45′E"],
    SDS: ["South Sudan", "Development advisory — Juba", "4°51′N 31°35′E"],
    COD: ["DRC", "Project-based — Kinshasa", "4°19′S 15°19′E"],
    MOZ: ["Mozambique", "Project-based — Maputo", "25°58′S 32°35′E"]
  };
  function initMap() {
    var fig = $("#eaMap"); if (!fig) return;
    var svg = $("svg", fig), read = $(".map-read", fig), mk = $(".mkts", fig);
    var btns = $$(".ea-market[data-k]"), pinned = "KEN";
    function show(k, pin) {
      if (!MARKETS[k]) return;
      if (pin) pinned = k;
      $$("[data-k]", svg).forEach(function (el) { el.classList.toggle("on", el.getAttribute("data-k") === k); });
      mk.classList.add("dim");
      btns.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-k") === pinned ? "true" : "false"); });
      var m = MARKETS[k];
      $(".ro-name", read).textContent = m[0]; $(".ro-note", read).textContent = m[1]; $(".ro-coord", read).textContent = m[2];
      read.classList.remove("flash"); void read.offsetWidth; read.classList.add("flash");
    }
    function rest() { show(pinned); }
    $$(".mk", svg).forEach(function (p) {
      var k = p.getAttribute("data-k");
      p.addEventListener("mouseenter", function () { show(k); });
      p.addEventListener("mouseleave", rest);
      p.addEventListener("focus", function () { show(k); });
      p.addEventListener("blur", rest);
      p.addEventListener("click", function () { show(k, true); track("map_select", k); });
      p.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(k, true); } });
    });
    btns.forEach(function (b) {
      var k = b.getAttribute("data-k");
      if (canHover) { b.addEventListener("mouseenter", function () { show(k); }); b.addEventListener("mouseleave", rest); }
      b.addEventListener("click", function () {
        show(k, true); track("map_select", k);
        if (innerWidth <= 960) { var r = fig.getBoundingClientRect(); if (r.top > innerHeight || r.bottom < 0) fig.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" }); }
      });
    });
    show("KEN", true);
    if (reduced) { fig.classList.add("map-live"); if (svg.pauseAnimations) svg.pauseAnimations(); return; }
    if ("IntersectionObserver" in window) {
      if (svg.pauseAnimations) svg.pauseAnimations();
      new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (en.isIntersecting) { fig.classList.add("map-live"); if (svg.unpauseAnimations) svg.unpauseAnimations(); }
          else if (svg.pauseAnimations) svg.pauseAnimations();
        });
      }, { threshold: 0.2 }).observe(fig);
    } else fig.classList.add("map-live");
  }

  /* ---------------- Contact form ---------------- */
  var MAX_FILE = 10 * 1024 * 1024;
  var OK_EXT = /\.(pdf|docx?|pptx|xlsx|jpe?g|png)$/i;
  function safeName(n) {
    var ext = (n.match(/\.[A-Za-z0-9]{1,6}$/) || [""])[0].toLowerCase();
    var base = n.slice(0, n.length - ext.length).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "brief";
    return base + ext;
  }
  function initForm() {
    var form = $("#enquiry"); if (!form) return;
    var msg = $(".f-msg", form), btn = $("button[type=submit]", form), sent = $("#sent");
    var ta = form.elements.message, count = $(".count", form);
    ta.addEventListener("input", function () { count.textContent = ta.value.length + " / 5000"; });
    $$("[data-sme]").forEach(function (a) { a.addEventListener("click", function () { form.elements.client_segment.value = "SME / growth business"; form.elements.service_interest.value = "SME advisory"; }); });

    var fileIn = form.elements.attachment, fileBox = fileIn.closest(".file"), fileName = $(".file-name", fileBox), fileDefault = fileName.textContent;
    fileIn.addEventListener("change", function () {
      var f = fileIn.files[0];
      fileBox.classList.toggle("has-file", !!f);
      fileName.textContent = f ? f.name + " (" + (f.size / 1048576).toFixed(1) + " MB)" : fileDefault;
      setErr(fileIn, "");
    });

    function fieldOf(inp) { return inp.closest(".fld") || inp.closest(".consent"); }
    function setErr(inp, text) {
      var f = fieldOf(inp); if (!f) return;
      f.classList.toggle("is-bad", !!text);
      var e = $(".err", f);
      if (text) { if (!e) { e = doc.createElement("small"); e.className = "err"; f.appendChild(e); } e.textContent = text; inp.setAttribute("aria-invalid", "true"); }
      else { if (e) e.remove(); inp.removeAttribute("aria-invalid"); }
    }
    function check(inp) {
      var v = (inp.value || "").trim(), n = inp.name;
      if (n === "full_name" && v.length < 2) return "Enter your full name.";
      if (n === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "Enter a valid email address, like name@company.com.";
      if (n === "phone" && v && !/^[+\d][\d\s()-]{6,}$/.test(v)) return "Use digits only, for example +254 712 345 678.";
      if ((n === "client_segment" || n === "service_interest") && !v) return "Choose one option.";
      if (n === "message" && v.length < 10) return "Add a little more detail (at least 10 characters).";
      if (n === "consent_given" && !inp.checked) return "Tick the box so we can reply to you.";
      if (n === "attachment" && inp.files[0]) {
        var f = inp.files[0];
        if (f.size > MAX_FILE) return "That file is over 10 MB. Attach a smaller version or send it by email.";
        if (!OK_EXT.test(f.name)) return "Attach a PDF, Word, PowerPoint, Excel, JPG or PNG file.";
      }
      return "";
    }
    var watched = ["full_name", "email", "phone", "client_segment", "service_interest", "message", "consent_given"];
    watched.forEach(function (n) {
      var inp = form.elements[n];
      inp.addEventListener("blur", function () { if (inp.value || inp.type === "checkbox") setErr(inp, check(inp)); });
      inp.addEventListener("input", function () { if (fieldOf(inp).classList.contains("is-bad")) setErr(inp, check(inp)); });
      inp.addEventListener("change", function () { if (fieldOf(inp).classList.contains("is-bad")) setErr(inp, check(inp)); });
    });
    // consent label lives outside .fld; give it an error hook
    var consentBox = form.elements.consent_given;
    consentBox.addEventListener("change", function () { consentBox.closest(".consent").classList.toggle("is-bad", !consentBox.checked && consentBox.closest(".consent").classList.contains("is-bad")); });

    function busy(on) {
      btn.setAttribute("aria-busy", on ? "true" : "false");
      btn.disabled = !!on;
      $(".b-txt", btn).textContent = on ? "Sending…" : "Send Enquiry";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.textContent = ""; msg.classList.remove("is-info");
      var firstBad = null;
      watched.concat(["attachment"]).forEach(function (n) {
        var inp = form.elements[n], err = check(inp);
        if (n === "consent_given") { inp.closest(".consent").classList.toggle("is-bad", !!err); if (err && !firstBad) firstBad = inp; return; }
        setErr(inp, err); if (err && !firstBad) firstBad = inp;
      });
      if (firstBad) {
        if (firstBad.name === "attachment") $("details.more", form).open = true;
        firstBad.focus({ preventScroll: false });
        msg.textContent = "Check the highlighted fields and try again.";
        track("form_error", "validation", null, { field: firstBad.name });
        return;
      }
      if (form.elements.website.value) { done(form.elements.email.value); return; } // honeypot

      var el = form.elements, val = function (n) { var v = (el[n].value || "").trim(); return v || null; };
      var pc = form.querySelector("input[name=preferred_contact]:checked");
      var row = {
        full_name: val("full_name"), email: val("email"), phone: val("phone"), organisation: val("organisation"),
        client_segment: val("client_segment"), service_interest: val("service_interest"), sector: val("sector"),
        country: val("country"), timeline: val("timeline"), budget_range: val("budget_range"),
        preferred_contact: pc ? pc.value : "email", message: val("message"), consent_given: true,
        source_path: cut(location.pathname + location.search, 512), session_id: SESSION, visitor_id: visitor()
      };
      busy(true);
      var file = el.attachment.files[0];
      var up = file ? sbUpload("inbox/" + uuid() + "/" + safeName(file.name), file) : Promise.resolve(null);
      if (file) { msg.classList.add("is-info"); msg.textContent = "Uploading your file…"; }
      up.then(function (p) {
        row.attachment_path = p;
        msg.textContent = "";
        return sbInsert("contact_submissions", row);
      }).then(function () {
        track("form_submit", row.service_interest, null, { segment: row.client_segment, attachment: !!file });
        done(row.email);
      }).catch(function (err) {
        busy(false); msg.classList.remove("is-info");
        var m = (err && err.message) || "";
        if (/Too many messages|privacy notice/.test(m)) msg.textContent = m;
        else if (/Failed to fetch|NetworkError|network/i.test(m)) msg.textContent = "You appear to be offline. Check your connection and send again.";
        else if (/upload|mime|size|exceeded/i.test(m)) msg.textContent = "The attachment could not be uploaded. Remove it and send again, or email it to " + (CFG.email || "us") + ".";
        else msg.innerHTML = "The enquiry did not go through. Send again, or email us at <a href=\"mailto:" + CFG.email + "\">" + CFG.email + "</a>.";
        track("form_error", "submit", null, { code: err && err.code ? String(err.code) : "unknown" });
      });
    });

    function done(email) {
      busy(false);
      $("[data-sent-email]", sent).textContent = email;
      form.hidden = true; sent.hidden = false; sent.focus();
    }
    $("[data-reset]", sent).addEventListener("click", function () {
      form.reset(); count.textContent = "0 / 5000"; fileBox.classList.remove("has-file"); fileName.textContent = fileDefault;
      sent.hidden = true; form.hidden = false; form.elements.full_name.focus();
    });
  }

  /* ---------------- CTA / outbound / download tracking ---------------- */
  function initClickTracking() {
    doc.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-track]");
      if (a) track(a.getAttribute("data-track"), a.getAttribute("data-label"));
      var dl = e.target.closest && e.target.closest("a[download], a[href$='.pdf']");
      if (dl) track("download", dl.getAttribute("href"));
    });
  }

  /* ---------------- Enquiry modal ---------------- */
  function initModal() {
    var dlg = $("#enq-modal"); if (!dlg || typeof dlg.showModal !== "function") return;
    var form = $("#enquiry"), sent = $("#sent"), opener = null;
    function open(trigger) {
      if (dlg.open) return;
      opener = trigger || doc.activeElement;
      root.classList.add("modal-open");
      dlg.showModal(); dlg.scrollTop = 0;
      var target = form && !form.hidden ? form.elements.full_name : sent;
      if (target) target.focus({ preventScroll: true });
      track("enquiry_open", trigger ? trigger.getAttribute("data-label") : "link");
    }
    function close() { if (dlg.open) dlg.close(); }
    dlg.addEventListener("close", function () {
      root.classList.remove("modal-open");
      if (location.hash === "#enquiry") history.replaceState(null, "", location.pathname + location.search);
      // after a successful send, the next open shows a fresh form
      if (sent && !sent.hidden) { var r = $("[data-reset]", sent); if (r) r.click(); }
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    });
    $$("[data-open-enquiry], a[href='#enquiry']").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); open(a); });
    });
    $$("[data-close-enquiry]", dlg).forEach(function (b) { b.addEventListener("click", close); });
    // click on the backdrop (outside the card) closes
    dlg.addEventListener("mousedown", function (e) { dlg._downOut = e.target === dlg; });
    dlg.addEventListener("click", function (e) { if (e.target === dlg && dlg._downOut) close(); });
    // deep links from other pages: index.html#enquiry
    if (location.hash === "#enquiry") setTimeout(function () { open(null); }, 0);
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    applyConfig(); initNav(); initMotion(); initMap(); initConsent(); initCounters(); initForm(); initModal(); initClickTracking();
    var nf = doc.body.getAttribute("data-status") === "404";
    pageView(nf ? 404 : 200);
    if (nf) track("not_found", location.pathname);
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot); else boot();
})();
