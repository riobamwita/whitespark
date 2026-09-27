/* White Spark Consulting — admin (no dependencies)
   Supabase Auth + REST + RPC: admin_live, admin_enquiry_stats, admin_analytics, purge_old_analytics
   Tables: contact_submissions, enquiry_activity, admin_users · Bucket: contact-attachments */
(function () {
  "use strict";
  var CFG = window.WS_CONFIG || {}, URL_ = CFG.supabaseUrl, KEY = CFG.anonKey, BUCKET = CFG.attachmentBucket || "contact-attachments";
  var TZ = "Africa/Nairobi", SKEY = "ws_admin_session";
  var doc = document, $ = function (s, c) { return (c || doc).querySelector(s); }, $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var session = null, me = { email: "", role: "", canEdit: false }, timer = null, current = "overview";
  var STATUSES = ["new", "contacted", "qualified", "won", "closed", "spam"], PRIORITIES = ["low", "normal", "high"];

  /* ---------- utils ---------- */
  function esc(v) { return v == null ? "" : String(v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(n) { return (+n || 0).toLocaleString("en-KE"); }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(d, opt) { return new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: TZ }, opt)).format(new Date(d)); }
  function when(d) {
    var s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 604800) return fmt(d, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return fmt(d, { day: "numeric", month: "short", year: "numeric" });
  }
  function full(d) { return fmt(d, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function secs(v) { v = Math.round(+v || 0); return v < 60 ? v + "s" : Math.floor(v / 60) + "m " + (v % 60) + "s"; }
  function toast(t, err) {
    var el = $("#toast"); el.textContent = t; el.classList.toggle("err", !!err); el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function chip(s) { return '<span class="chip s-' + esc(s) + '">' + esc(s) + "</span>"; }

  /* ---------- session ---------- */
  function save(s) {
    session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user || (session && session.user) } : null;
    try { if (session) localStorage.setItem(SKEY, JSON.stringify(session)); else localStorage.removeItem(SKEY); } catch (e) {}
  }
  function load() { try { return JSON.parse(localStorage.getItem(SKEY)); } catch (e) { return null; } }

  function authFetch(path, body, method, token) {
    var h = { apikey: KEY, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(URL_ + "/auth/v1/" + path, { method: method || "POST", headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Request failed (" + r.status + ")"); return j; }); });
  }
  var refreshing = null;
  function fresh() {
    if (!session) return Promise.reject(new Error("signed_out"));
    if (session.expires_at - 60 > Date.now() / 1000) return Promise.resolve(session.access_token);
    if (!refreshing) refreshing = authFetch("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (s) { save(s); return s.access_token; })
      .catch(function (e) { signOut(true); throw e; })
      .then(function (t) { refreshing = null; return t; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  /* ---------- data API ---------- */
  function api(path, opt) {
    opt = opt || {};
    return fresh().then(function (tok) {
      var h = { apikey: KEY, Authorization: "Bearer " + tok };
      if (opt.body !== undefined) h["Content-Type"] = "application/json";
      if (opt.prefer) h.Prefer = opt.prefer;
      return fetch(URL_ + path, { method: opt.method || "GET", headers: h, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
    }).then(function (r) {
      if (r.status === 401) { signOut(true); throw new Error("Your session ended. Sign in again."); }
      var range = r.headers.get("content-range");
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var m = (j && (j.message || j.error)) || ("Request failed (" + r.status + ")");
          if (/not_authorized|42501|permission/i.test(m)) m = "This account doesn't have admin access for that action.";
          throw new Error(m);
        }
        if (range && j) j.__total = +(range.split("/")[1] || 0);
        return j;
      });
    });
  }
  function rpc(name, args) { return api("/rest/v1/rpc/" + name, { method: "POST", body: args || {} }); }

  /* ---------- auth screens ---------- */
  function showAuth(which) {
    $("#app").hidden = true; $("#auth").hidden = false;
    ["fLogin", "fForgot", "fNewPass"].forEach(function (id) { $("#" + id).hidden = id !== which; });
    var f = $("#" + which); $(".msg", f).textContent = ""; var i = $("input", f); if (i) setTimeout(function () { i.focus(); }, 50);
  }
  function busy(btn, on, txt) { btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = txt || "Working…"; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

  function initAuth() {
    $$("[data-go]").forEach(function (b) { b.addEventListener("click", function () { showAuth(b.getAttribute("data-go")); }); });
    $("#fLogin").addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target, m = $(".msg", f), b = $("button[type=submit]", f);
      var em = f.email.value.trim(), pw = f.password.value;
      if (!em || !pw) { m.textContent = "Enter your email and password."; return; }
      busy(b, true, "Signing in…"); m.textContent = "";
      authFetch("token?grant_type=password", { email: em, password: pw })
        .then(function (s) { save(s); f.reset(); return boot(); })
        .catch(function (err) { m.textContent = /invalid/i.test(err.message) ? "That email and password don't match an admin account." : err.message; })
        .then(function () { busy(b, false); });
    });
    $("#fForgot").addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target, m = $(".msg", f), b = $("button[type=submit]", f), em = f.email.value.trim();
      if (!em) { m.textContent = "Enter your email."; return; }
      busy(b, true, "Sending…");
      var back = location.origin + location.pathname;
      authFetch("recover?redirect_to=" + encodeURIComponent(back), { email: em })
        .then(function () { m.classList.add("ok"); m.textContent = "If that email has admin access, a reset link is on its way."; })
        .catch(function (err) { m.classList.remove("ok"); m.textContent = err.message; })
        .then(function () { busy(b, false); });
    });
    $("#fNewPass").addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target, m = $(".msg", f), b = $("button[type=submit]", f);
      if (f.password.value.length < 8) { m.textContent = "Use at least 8 characters."; return; }
      if (f.password.value !== f.confirm.value) { m.textContent = "The two passwords don't match."; return; }
      busy(b, true, "Saving…");
      fresh().then(function (t) { return authFetch("user", { password: f.password.value }, "PUT", t); })
        .then(function () { toast("Password updated."); f.reset(); return boot(); })
        .catch(function (err) { m.textContent = err.message; })
        .then(function () { busy(b, false); });
    });
    function out() { signOut(false); }
    $("#signOut").addEventListener("click", out); $("#signOutM").addEventListener("click", out);
  }
  function signOut(expired) {
    var tok = session && session.access_token;
    if (tok && !expired) authFetch("logout", null, "POST", tok).catch(function () {});
    save(null); clearInterval(timer); closeDrawer();
    showAuth("fLogin");
    if (expired) $(".msg", $("#fLogin")).textContent = "Your session ended. Sign in again.";
  }

  /* ---------- shell ---------- */
  var TITLES = { overview: "Overview", enquiries: "Enquiries", analytics: "Analytics", settings: "Settings" };
  function boot() {
    return fresh().then(function () {
      var uid = session.user && session.user.id;
      return api("/rest/v1/admin_users?select=email,role&user_id=eq." + encodeURIComponent(uid));
    }).then(function (rows) {
      if (!rows || !rows.length) { save(null); showAuth("fLogin"); $(".msg", $("#fLogin")).textContent = "This account isn't an admin. Ask the site owner to grant access."; return; }
      me.email = rows[0].email || session.user.email; me.role = rows[0].role; me.canEdit = me.role === "owner" || me.role === "admin";
      $("#meEmail").textContent = me.email; $("#meRole").textContent = me.role;
      $("#auth").hidden = true; $("#app").hidden = false;
      route(); refreshBadge();
    });
  }
  function route() {
    var v = (location.hash || "#overview").slice(1).split("/")[0];
    if (!TITLES[v]) v = "overview";
    current = v; clearInterval(timer);
    $$(".tabs a").forEach(function (a) { var on = a.getAttribute("data-view") === v; a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#viewTitle").textContent = TITLES[v]; doc.title = TITLES[v] + " | White Spark Admin";
    $("#liveDot").classList.toggle("off", v !== "overview");
    var view = $("#view"); view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
    ({ overview: vOverview, enquiries: vEnquiries, analytics: vAnalytics, settings: vSettings })[v](view);
  }
  function refreshBadge() {
    api("/rest/v1/contact_submissions?select=id&read_at=is.null&status=neq.spam&limit=1", { prefer: "count=exact" })
      .then(function (r) { var n = (r && r.__total) || 0, b = $("#unreadBadge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n; })
      .catch(function () {});
  }
  function fail(el, err) { el.innerHTML = '<div class="card empty">' + esc(err.message || "Something went wrong.") + ' <button class="link" type="button" data-retry>Try again</button></div>'; $("[data-retry]", el).addEventListener("click", route); }
  function skel(el, n) { var h = '<div class="grid g4">'; for (var i = 0; i < (n || 4); i++) h += '<div class="skel"></div>'; el.innerHTML = h + "</div>"; }

  /* ---------- charts ---------- */
  function lineChart(series, keys, opts) {
    opts = opts || {}; var W = 720, H = 220, P = { l: 34, r: 10, t: 12, b: 26 }, n = series.length;
    if (!n) return '<div class="empty">No data in this range.</div>';
    var max = 1; series.forEach(function (d) { keys.forEach(function (k) { max = Math.max(max, +d[k] || 0); }); if (opts.bars) max = Math.max(max, +d[opts.bars] || 0); });
    max = Math.ceil(max * 1.15);
    var x = function (i) { return P.l + (n === 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (n - 1)); };
    var y = function (v) { return P.t + (H - P.t - P.b) * (1 - v / max); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opts.label || "Chart") + '"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2D4A7A" stop-opacity=".22"/><stop offset="1" stop-color="#2D4A7A" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g++) { var gv = Math.round(max * g / 4), gy = y(gv); s += '<line class="gl" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + gy + '" y2="' + gy + '"/><text class="ax" x="' + (P.l - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + gv + "</text>"; }
    if (opts.bars) { var bw = Math.max(2, (W - P.l - P.r) / n * 0.5); series.forEach(function (d, i) { var v = +d[opts.bars] || 0; if (v) s += '<rect class="lb" x="' + (x(i) - bw / 2) + '" y="' + y(v) + '" width="' + bw + '" height="' + (y(0) - y(v)) + '" rx="1"/>'; }); }
    keys.forEach(function (k, ki) {
      var pts = series.map(function (d, i) { return x(i).toFixed(1) + "," + y(+d[k] || 0).toFixed(1); });
      if (ki === 0) s += '<path class="ar" d="M' + pts[0].split(",")[0] + "," + y(0) + "L" + pts.join("L") + "L" + x(n - 1) + "," + y(0) + 'Z"/>';
      s += '<path class="' + (ki ? "ln2" : "ln") + '" d="M' + pts.join("L") + '"/>';
    });
    var step = Math.max(1, Math.ceil(n / 7));
    series.forEach(function (d, i) { if ((i % step === 0 && n - 1 - i >= step / 2) || i === n - 1) s += '<text class="ax" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle") + '">' + esc(opts.xl ? opts.xl(d) : "") + "</text>"; });
    return s + "</svg>";
  }
  function bars(list, key, val, total) {
    if (!list || !list.length) return '<div class="empty">Nothing yet.</div>';
    var max = total || Math.max.apply(null, list.map(function (d) { return +d[val] || 0; })) || 1;
    return list.map(function (d, i) { var v = +d[val] || 0; return '<div class="bar"><div class="t"><span>' + esc(d[key]) + "</span><span>" + num(v) + '</span></div><i><b style="width:' + Math.max(2, v / max * 100) + "%;animation-delay:" + i * 40 + 'ms"></b></i></div>'; }).join("");
  }
  function kpi(k, v, d, cls, dark) { return '<div class="card kpi' + (dark ? " dark" : "") + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d ' + (cls || "") + '">' + (d || "&nbsp;") + "</div></div>"; }
  function delta(a, b, invert) {
    a = +a || 0; b = +b || 0; if (!b) return { t: a ? "new this period" : "no change", c: "" };
    var p = Math.round((a - b) / b * 100), up = p >= 0; if (invert) up = !up;
    return { t: (p >= 0 ? "▲ " : "▼ ") + Math.abs(p) + "% vs previous", c: p === 0 ? "" : up ? "up" : "down" };
  }

  /* ---------- overview ---------- */
  function vOverview(el) {
    skel(el);
    function draw() {
      Promise.all([rpc("admin_live"), rpc("admin_enquiry_stats")]).then(function (r) {
        if (current !== "overview") return;
        var L = r[0] || {}, S = r[1] || {}, T = L.today || {}, st = S.by_status || {};
        var h = '<div class="grid g4">' +
          kpi("On site now", num(L.active_sessions), "last 5 minutes", "", true) +
          kpi("Visits today", num(T.sessions), num(T.pageviews) + " page views") +
          kpi("Enquiries today", num(S.today), num(S.week) + " this week") +
          kpi("Unread", num(S.unread), num(S.high) + " high priority open") + "</div>";
        h += '<div class="grid g3 sp"><div class="card" style="grid-column:span 2"><h2>Enquiries, last 30 days <small>' + num(S.total) + " total · " + num(S.won) + " won</small></h2>" +
          lineChart(S.series || [], ["n"], { label: "Enquiries per day", xl: function (d) { return fmt(d.d + "T12:00:00Z", { day: "numeric", month: "short" }); } }) + "</div>" +
          '<div class="card"><h2>Pipeline</h2><div class="rows">' + STATUSES.map(function (s) { return '<div class="row"><span class="l">' + chip(s) + '</span><span class="r">' + num(st[s]) + "</span></div>"; }).join("") + "</div></div></div>";
        h += '<div class="grid g3 sp"><div class="card"><h2>Active pages</h2><div class="rows">' +
          ((L.pages || []).length ? L.pages.map(function (p) { return '<div class="row"><span class="l">' + esc(p.path) + '</span><span class="r">' + num(p.n) + "</span></div>"; }).join("") : '<div class="empty">No one on the site right now.</div>') +
          '</div></div><div class="card"><h2>Top services requested</h2>' + bars(S.by_service, "k", "n") + '</div><div class="card"><h2>Client types</h2>' + bars(S.by_segment, "k", "n") + "</div></div>";
        h += '<div class="card sp"><h2>Latest visits</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>When</th><th>Page</th><th>Source</th><th>Device</th><th>Browser</th></tr></thead><tbody>' +
          ((L.recent || []).length ? L.recent.slice(0, 15).map(function (v) { return "<tr><td>" + when(v.created_at) + "</td><td>" + esc(v.path) + (v.status === 404 ? ' <span class="chip s-spam">404</span>' : "") + "</td><td>" + esc(v.referrer_host || "Direct") + "</td><td>" + esc(cap(v.device || "")) + "</td><td>" + esc(v.browser || "") + "</td></tr>"; }).join("") : '<tr><td colspan="5" class="empty">No visits recorded yet.</td></tr>') +
          "</tbody></table></div></div>";
        el.innerHTML = h; refreshBadge();
      }).catch(function (e) { if (current === "overview") fail(el, e); });
    }
    draw(); timer = setInterval(function () { if (!doc.hidden) draw(); }, 30000);
  }

  /* ---------- enquiries ---------- */
  var q = { search: "", status: "", priority: "", read: "", page: 0, size: 25 };
  function enqQuery(forExport) {
    var p = ["select=*", "order=created_at.desc"];
    if (q.status) p.push("status=eq." + q.status); else p.push("status=neq.spam");
    if (q.status === "all") p[p.length - 1] = "";
    if (q.priority) p.push("priority=eq." + q.priority);
    if (q.read === "unread") p.push("read_at=is.null"); if (q.read === "read") p.push("read_at=not.is.null");
    var s = q.search.replace(/[,()*%\\]/g, " ").trim();
    if (s) { var v = encodeURIComponent("*" + s + "*"); p.push("or=(full_name.ilike." + v + ",email.ilike." + v + ",organisation.ilike." + v + ",message.ilike." + v + ",phone.ilike." + v + ")"); }
    if (!forExport) { p.push("limit=" + q.size); p.push("offset=" + q.page * q.size); } else p.push("limit=5000");
    return "/rest/v1/contact_submissions?" + p.filter(Boolean).join("&");
  }
  function opt(list, sel, blank) { return (blank ? '<option value="">' + blank + "</option>" : "") + list.map(function (v) { var o = Array.isArray(v) ? v : [v, cap(v)]; return '<option value="' + o[0] + '"' + (o[0] === sel ? " selected" : "") + ">" + o[1] + "</option>"; }).join(""); }
  function vEnquiries(el) {
    el.innerHTML = '<div class="filters">' +
      '<label class="fld q"><span>Search</span><input type="search" id="fq" placeholder="Name, email, organisation or message" value="' + esc(q.search) + '"></label>' +
      '<label class="fld"><span>Status</span><select id="fs">' + opt([["", "Open (not spam)"], ["all", "All"]].concat(STATUSES), q.status) + "</select></label>" +
      '<label class="fld"><span>Priority</span><select id="fp">' + opt(PRIORITIES, q.priority, "Any") + "</select></label>" +
      '<label class="fld"><span>Read</span><select id="fr">' + opt([["unread", "Unread"], ["read", "Read"]], q.read, "Any") + "</select></label>" +
      '<button class="btn line exp" type="button" id="fx">Export CSV</button></div><div id="lst"></div>';
    var t;
    $("#fq").addEventListener("input", function (e) { clearTimeout(t); t = setTimeout(function () { q.search = e.target.value; q.page = 0; list(); }, 300); });
    [["#fs", "status"], ["#fp", "priority"], ["#fr", "read"]].forEach(function (p) { $(p[0]).addEventListener("change", function (e) { q[p[1]] = e.target.value; q.page = 0; list(); }); });
    $("#fx").addEventListener("click", exportCsv);
    list();
    var hid = (location.hash.split("/")[1] || ""); if (hid) openEnquiry(hid);
  }
  function list() {
    var box = $("#lst"); if (!box) return;
    box.innerHTML = '<div class="skel" style="height:300px"></div>';
    api(enqQuery(), { prefer: "count=exact" }).then(function (rows) {
      var total = Math.max((rows && rows.__total) || 0, rows ? q.page * q.size + rows.length : 0);
      if (!rows || !rows.length) { box.innerHTML = '<div class="list"><div class="empty">' + (q.search || q.status || q.priority || q.read ? "No enquiries match these filters." : "No enquiries yet. They'll appear here as soon as someone uses the consultation form.") + "</div></div>"; return; }
      box.innerHTML = '<div class="list">' + rows.map(function (r) {
        return '<button type="button" class="item' + (r.read_at ? "" : " unread") + '" data-id="' + r.id + '"><span class="dot"></span>' +
          '<span class="who"><span class="nm">' + esc(r.full_name) + '</span><span class="sub">' + esc(r.organisation || r.email) + "</span></span>" +
          '<span class="ms">' + esc(r.service_interest ? r.service_interest + " — " : "") + esc(r.message) + "</span>" +
          '<span class="sv sub">' + esc(r.client_segment || "") + "</span>" +
          '<span class="st">' + chip(r.status) + (r.priority === "high" ? ' <span class="chip s-spam">High</span>' : "") + "</span>" +
          '<span class="dt">' + when(r.created_at) + "</span></button>";
      }).join("") + "</div>" +
        '<div class="pager"><span>' + (q.page * q.size + 1) + "–" + Math.min(total, (q.page + 1) * q.size) + " of " + num(total) + '</span><div><button class="btn line sm" id="pv"' + (q.page ? "" : " disabled") + '>Previous</button><button class="btn line sm" id="nx"' + ((q.page + 1) * q.size < total ? "" : " disabled") + ">Next</button></div></div>";
      $$(".item", box).forEach(function (b) { b.addEventListener("click", function () { openEnquiry(b.getAttribute("data-id")); }); });
      $("#pv").addEventListener("click", function () { q.page--; list(); window.scrollTo(0, 0); });
      $("#nx").addEventListener("click", function () { q.page++; list(); window.scrollTo(0, 0); });
    }).catch(function (e) { fail(box, e); });
  }
  function exportCsv() {
    var b = $("#fx"); busy(b, true, "Exporting…");
    api(enqQuery(true)).then(function (rows) {
      var cols = ["created_at", "status", "priority", "full_name", "email", "phone", "organisation", "client_segment", "service_interest", "sector", "country", "timeline", "budget_range", "preferred_contact", "message", "assigned_to", "admin_notes", "read_at", "attachment_path"];
      var csv = cols.join(",") + "\n" + (rows || []).map(function (r) { return cols.map(function (c) { var v = r[c] == null ? "" : String(r[c]); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
      var a = doc.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = "white-spark-enquiries-" + fmt(Date.now(), { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-") + ".csv";
      doc.body.appendChild(a); a.click(); a.remove(); toast("Exported " + num((rows || []).length) + " enquiries.");
    }).catch(function (e) { toast(e.message, true); }).then(function () { busy(b, false); });
  }

  /* drawer */
  var lastFocus = null;
  function closeDrawer() {
    var d = $("#drawer"); if (d.hidden) return;
    d.hidden = true; $("#scrim").hidden = true; doc.body.style.overflow = "";
    if (location.hash.indexOf("#enquiries/") === 0) history.replaceState(null, "", "#enquiries");
    if (lastFocus) lastFocus.focus();
  }
  function openEnquiry(id) {
    lastFocus = doc.activeElement;
    var d = $("#drawer"); d.hidden = false; $("#scrim").hidden = false; doc.body.style.overflow = "hidden";
    d.innerHTML = '<div class="dr-head"><div><h2>Loading…</h2></div>' + xBtn() + '</div><div class="dr-body"><div class="skel"></div></div>';
    $(".x", d).addEventListener("click", closeDrawer); d.focus();
    history.replaceState(null, "", "#enquiries/" + id);
    Promise.all([api("/rest/v1/contact_submissions?select=*&id=eq." + id), api("/rest/v1/enquiry_activity?select=*&enquiry_id=eq." + id + "&order=created_at.desc&limit=50")])
      .then(function (r) {
        var e = r[0] && r[0][0]; if (!e) throw new Error("That enquiry no longer exists.");
        renderEnquiry(e, r[1] || []);
        if (!e.read_at && me.canEdit) api("/rest/v1/contact_submissions?id=eq." + id, { method: "PATCH", body: { read_at: new Date().toISOString() }, prefer: "return=minimal" }).then(function () { refreshBadge(); var it = $('.item[data-id="' + id + '"]'); if (it) it.classList.remove("unread"); }).catch(function () {});
      }).catch(function (err) { $(".dr-body", d).innerHTML = '<div class="card empty">' + esc(err.message) + "</div>"; $("h2", d).textContent = "Enquiry"; });
  }
  function xBtn() { return '<button class="x" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'; }
  function renderEnquiry(e, acts) {
    var d = $("#drawer"), ro = me.canEdit ? "" : " disabled";
    var phone = (e.phone || "").replace(/[^\d+]/g, ""), wa = phone.replace(/^\+/, "").replace(/^0/, "254");
    var subj = encodeURIComponent("Re: your enquiry to White Spark Consulting");
    var greet = encodeURIComponent("Dear " + (e.full_name || "").split(" ")[0] + ",\n\nThank you for contacting White Spark Consulting");
    var dl = [["Email", '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + "</a>"], ["Phone", esc(e.phone)], ["Organisation", esc(e.organisation)], ["Client type", esc(e.client_segment)], ["Service", esc(e.service_interest)],
      ["Industry", esc(e.sector)], ["Country", esc(e.country)], ["Timeline", esc(e.timeline)], ["Budget", esc(e.budget_range)], ["Prefers", esc({ email: "Email", phone: "Phone", whatsapp: "WhatsApp" }[e.preferred_contact] || "")], ["Received", full(e.created_at)], ["Came from", esc(e.source_path)]]
      .filter(function (x) { return x[1]; }).map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("");
    var LBL = { received: "Enquiry received", status: "Status changed", priority: "Priority changed", assigned: "Assigned", note: "Notes updated", opened: "Opened" };
    var tl = acts.map(function (a) {
      var t = "<b>" + (LBL[a.action] || cap(a.action)) + "</b>";
      if (a.action === "status" || a.action === "priority" || a.action === "assigned") t += " " + esc(a.from_value || "—") + " → " + esc(a.to_value || "—");
      else if (a.action === "received") t += " — " + esc(a.to_value);
      return "<div>" + t + (a.actor_email ? " by " + esc(a.actor_email) : "") + "<time>" + full(a.created_at) + "</time></div>";
    }).join("");
    d.innerHTML = '<div class="dr-head"><div><h2>' + esc(e.full_name) + "</h2><p>" + esc(e.organisation || e.email) + " · " + when(e.created_at) + "</p></div>" + xBtn() + "</div>" +
      '<div class="dr-body">' +
      '<div class="acts"><a class="btn gold sm" href="mailto:' + esc(e.email) + "?subject=" + subj + "&body=" + greet + '">Reply by email</a>' +
      (phone ? '<a class="btn line sm" href="tel:' + esc(phone) + '">Call</a><a class="btn line sm" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : "") +
      (e.attachment_path ? '<button class="btn line sm" type="button" id="att">Open attachment</button>' : "") + "</div>" +
      '<div class="card"><h2>Message</h2><div class="msgbox">' + esc(e.message) + "</div></div>" +
      '<div class="card"><h2>Details</h2><dl class="dl">' + dl + "</dl></div>" +
      '<div class="card"><h2>Manage' + (me.canEdit ? "" : " <small>view-only account</small>") + '</h2><div class="edit">' +
      '<label class="fld"><span>Status</span><select id="eS"' + ro + ">" + opt(STATUSES, e.status) + "</select></label>" +
      '<label class="fld"><span>Priority</span><select id="eP"' + ro + ">" + opt(PRIORITIES, e.priority) + "</select></label>" +
      '<label class="fld full"><span>Assigned to</span><input id="eA" maxlength="120" value="' + esc(e.assigned_to) + '" placeholder="Consultant name"' + ro + "></label>" +
      '<label class="fld full"><span>Internal notes</span><textarea id="eN" maxlength="5000" placeholder="Call notes, next steps…"' + ro + ">" + esc(e.admin_notes) + "</textarea></label>" +
      (me.canEdit ? '<div class="full acts"><button class="btn gold" type="button" id="eSave">Save changes</button><button class="btn line" type="button" id="eUnread">Mark unread</button><button class="btn danger" type="button" id="eDel" style="margin-left:auto">Delete</button></div>' : "") +
      "</div></div>" +
      '<div class="card"><h2>History</h2>' + (tl ? '<div class="tl">' + tl + "</div>" : '<div class="empty">No activity yet.</div>') + "</div></div>";
    $(".x", d).addEventListener("click", closeDrawer);
    if (e.attachment_path) $("#att").addEventListener("click", function () {
      var w = window.open("", "_blank");
      api("/storage/v1/object/sign/" + BUCKET + "/" + e.attachment_path.split("/").map(encodeURIComponent).join("/"), { method: "POST", body: { expiresIn: 300 } })
        .then(function (r) { var u = URL_ + "/storage/v1" + r.signedURL; if (w) w.location = u; else location.href = u; })
        .catch(function (err) { if (w) w.close(); toast(err.message, true); });
    });
    if (!me.canEdit) return;
    $("#eSave").addEventListener("click", function () {
      var b = this, body = { status: $("#eS").value, priority: $("#eP").value, assigned_to: $("#eA").value.trim() || null, admin_notes: $("#eN").value.trim() || null };
      busy(b, true, "Saving…");
      api("/rest/v1/contact_submissions?id=eq." + e.id, { method: "PATCH", body: body, prefer: "return=minimal" })
        .then(function () { toast("Saved."); list(); refreshBadge(); openEnquiry(e.id); })
        .catch(function (err) { toast(err.message, true); busy(b, false); });
    });
    $("#eUnread").addEventListener("click", function () {
      api("/rest/v1/contact_submissions?id=eq." + e.id, { method: "PATCH", body: { read_at: null }, prefer: "return=minimal" })
        .then(function () { toast("Marked unread."); closeDrawer(); list(); refreshBadge(); }).catch(function (err) { toast(err.message, true); });
    });
    $("#eDel").addEventListener("click", function () {
      if (!confirm("Delete the enquiry from " + e.full_name + "? This removes it and its attachment permanently.")) return;
      var rm = e.attachment_path ? api("/storage/v1/object/" + BUCKET, { method: "DELETE", body: { prefixes: [e.attachment_path] } }).catch(function () {}) : Promise.resolve();
      rm.then(function () { return api("/rest/v1/contact_submissions?id=eq." + e.id, { method: "DELETE", prefer: "return=minimal" }); })
        .then(function () { toast("Enquiry deleted."); closeDrawer(); list(); refreshBadge(); })
        .catch(function (err) { toast(err.message, true); });
    });
  }

  /* ---------- analytics ---------- */
  var range = "30d";
  var RANGES = { "24h": ["24 hours", 1], "7d": ["7 days", 7], "30d": ["30 days", 30], "90d": ["90 days", 90], "365d": ["12 months", 365] };
  function vAnalytics(el) {
    el.innerHTML = '<div class="seg" role="group" aria-label="Date range">' + Object.keys(RANGES).map(function (k) { return '<button type="button" data-r="' + k + '"' + (k === range ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + RANGES[k][0] + "</button>"; }).join("") + '</div><div id="an" class="sp"></div>';
    $$(".seg button", el).forEach(function (b) { b.addEventListener("click", function () { range = b.getAttribute("data-r"); vAnalytics(el); }); });
    var box = $("#an"); skel(box, 8);
    var to = new Date(), from = new Date(to - RANGES[range][1] * 864e5);
    rpc("admin_analytics", { p_from: from.toISOString(), p_to: to.toISOString() }).then(function (A) {
      if (current !== "analytics") return;
      var T = A.totals || {}, P = A.previous || {}, hourly = (A.range || {}).bucket === "hour";
      var d1 = delta(T.sessions, P.sessions), d2 = delta(T.pageviews, P.pageviews), d3 = delta(T.leads, P.leads), d4 = delta(T.bounce_rate, P.bounce_rate, true), d5 = delta(T.avg_session_secs, P.avg_session_secs);
      var h = '<div class="grid g4">' + kpi("Visits", num(T.sessions), d1.t, d1.c, true) + kpi("Page views", num(T.pageviews), d2.t, d2.c) + kpi("Enquiries", num(T.leads), d3.t + " · " + (T.conversion_rate || 0) + "% of visits", d3.c) + kpi("Avg. visit", secs(T.avg_session_secs), d5.t, d5.c) + "</div>";
      h += '<div class="grid g4 sp">' + kpi("Visitors (opted in)", num(T.visitors), num(T.new_visitors) + " new · " + num(T.returning_visitors) + " returning") + kpi("Pages per visit", T.pages_per_session || 0, "") + kpi("Bounce rate", (T.bounce_rate || 0) + "%", d4.t, d4.c) + kpi("Broken links hit", num(T.not_found), "404 page views") + "</div>";
      h += '<div class="card sp"><h2>Traffic <small>' + (hourly ? "by hour" : "by day") + ", Nairobi time</small></h2>" +
        lineChart(A.series || [], ["views", "sessions"], { bars: "leads", label: "Traffic over time", xl: function (d) { return hourly ? d.t.slice(11, 16) : fmt(d.t + "T12:00:00Z", { day: "numeric", month: "short" }); } }) +
        '<div class="legend"><span><i style="background:#2D4A7A"></i>Page views</span><span><i style="background:#C8A84B"></i>Visits</span><span><i style="background:#1B5E52;height:8px"></i>Enquiries</span></div></div>';
      h += '<div class="grid g2 sp"><div class="card"><h2>Top pages</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Page</th><th class="n">Views</th><th class="n">Entries</th><th class="n">Avg. time</th></tr></thead><tbody>' +
        ((A.top_pages || []).length ? A.top_pages.slice(0, 10).map(function (p) { return "<tr><td>" + esc(p.path) + '</td><td class="n">' + num(p.views) + '</td><td class="n">' + num(p.entries) + '</td><td class="n">' + (p.avg_secs != null ? secs(p.avg_secs) : "—") + "</td></tr>"; }).join("") : '<tr><td colspan="4" class="empty">No page views in this range.</td></tr>') +
        '</tbody></table></div></div><div class="card"><h2>Where visits come from</h2>' + bars(A.referrers, "source", "sessions") + "</div></div>";
      h += '<div class="grid g3 sp"><div class="card"><h2>Devices</h2>' + bars((A.devices || []).map(function (d) { return { k: cap(d.k), n: d.n }; }), "k", "n") + '</div><div class="card"><h2>Browsers</h2>' + bars(A.browsers, "k", "n") + '</div><div class="card"><h2>Operating systems</h2>' + bars(A.os, "k", "n") + "</div></div>";
      var hrs = A.hours || [], hm = Math.max.apply(null, hrs.map(function (x) { return x.n; }).concat([1]));
      h += '<div class="grid g3 sp"><div class="card"><h2>Busiest hours <small>Nairobi</small></h2><div class="hours">' + hrs.map(function (x) { return '<span title="' + x.h + ':00 — ' + x.n + ' views" style="height:' + Math.max(2, x.n / hm * 100) + '%"></span>'; }).join("") + '</div><div class="hours-ax"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>' +
        '<div class="card"><h2>Enquiry sources</h2>' + bars(A.lead_sources, "source", "n") + '</div><div class="card"><h2>Cookie choices</h2><div class="rows">' +
        '<div class="row"><span class="l">Allowed analytics</span><span class="r">' + num((A.consent || {}).accepted) + '</span></div><div class="row"><span class="l">Essential only</span><span class="r">' + num((A.consent || {}).rejected) + '</span></div><div class="row"><span class="l">Visits with no choice made</span><span class="r">' + num((A.consent || {}).no_choice_sessions) + "</span></div></div></div></div>";
      h += '<div class="grid g2 sp"><div class="card"><h2>Clicks & actions</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Action</th><th>Detail</th><th class="n">Count</th></tr></thead><tbody>' +
        ((A.events || []).length ? A.events.slice(0, 15).map(function (e) { return "<tr><td>" + esc(e.name.replace(/_/g, " ")) + "</td><td>" + esc(e.label) + '</td><td class="n">' + num(e.n) + "</td></tr>"; }).join("") : '<tr><td colspan="3" class="empty">No tracked actions yet.</td></tr>') +
        '</tbody></table></div></div><div class="card"><h2>Broken links visitors hit</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Address</th><th>From</th><th class="n">Hits</th></tr></thead><tbody>' +
        ((A.not_found || []).length ? A.not_found.slice(0, 12).map(function (n) { return "<tr><td>" + esc(n.path) + "</td><td>" + esc(n.source) + '</td><td class="n">' + num(n.hits) + "</td></tr>"; }).join("") : '<tr><td colspan="3" class="empty">No broken links hit. Good.</td></tr>') +
        "</tbody></table></div></div></div>";
      if ((A.campaigns || []).length || (A.countries || []).length > 1) h += '<div class="grid g2 sp"><div class="card"><h2>Campaigns</h2>' + bars((A.campaigns || []).map(function (c) { return { k: [c.source, c.medium, c.campaign].filter(Boolean).join(" / "), n: c.sessions }; }), "k", "n") + '</div><div class="card"><h2>Countries</h2>' + bars(A.countries, "k", "n") + "</div></div>";
      box.innerHTML = h;
    }).catch(function (e) { if (current === "analytics") fail(box, e); });
  }

  /* ---------- settings ---------- */
  function vSettings(el) {
    el.innerHTML = '<div class="grid g2"><div class="card"><h2>Your account</h2><dl class="dl"><dt>Email</dt><dd>' + esc(me.email) + "</dd><dt>Role</dt><dd>" + esc(cap(me.role)) + (me.canEdit ? "" : " (view only)") +
      '</dd></dl><div class="acts sp"><button class="btn line sm" type="button" id="chpw">Change password</button></div></div>' +
      (me.canEdit ? '<div class="card sp"><h2>Data retention</h2><p style="font-size:14px;color:var(--muted);max-width:640px">Visit and click records older than the period below are deleted. Cookie choices are kept for at least two years. Enquiries are never touched.</p><div class="acts sp" style="align-items:end"><label class="fld" style="max-width:220px"><span>Keep analytics for</span><select id="keep"><option value="395" selected>13 months</option><option value="180">6 months</option><option value="90">90 days</option></select></label><button class="btn danger" type="button" id="purge">Delete older records</button></div></div>' : "");
    api("/rest/v1/admin_users?select=email,role,created_at&order=created_at").then(function (rows) {
      $("#team").innerHTML = (rows || []).map(function (r) { return '<div class="row"><span class="l">' + esc(r.email) + '</span><span class="r">' + esc(cap(r.role)) + "</span></div>"; }).join("") || '<div class="empty">No admins listed.</div>';
    }).catch(function (e) { $("#team").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
    $("#chpw").addEventListener("click", function () { showAuth("fNewPass"); });
    var p = $("#purge");
    if (p) p.addEventListener("click", function () {
      var days = +$("#keep").value;
      if (!confirm("Delete visit and click records older than " + $("#keep").selectedOptions[0].text + "? This can't be undone.")) return;
      busy(p, true, "Deleting…");
      rpc("purge_old_analytics", { p_days: days }).then(function (r) { toast("Deleted " + num(r.page_views) + " visits, " + num(r.events) + " clicks, " + num(r.consent_log) + " cookie records."); })
        .catch(function (e) { toast(e.message, true); }).then(function () { busy(p, false); });
    });
  }

  /* ---------- start ---------- */
  function start() {
    if (!URL_ || !KEY) { doc.body.innerHTML = '<p style="padding:24px">Admin is not configured. Check assets/js/config.js.</p>'; return; }
    initAuth();
    $("#scrim").addEventListener("click", closeDrawer);
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    addEventListener("hashchange", function () { if (!session || $("#app").hidden) return; if (location.hash.indexOf("#enquiries/") === 0 && current === "enquiries") return; closeDrawer(); route(); });
    doc.addEventListener("visibilitychange", function () { if (!doc.hidden && session && current === "overview") refreshBadge(); });

    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get("access_token")) {
      save({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_in: +h.get("expires_in") || 3600 });
      var type = h.get("type");
      history.replaceState(null, "", location.pathname + "#overview");
      authFetch("user", null, "GET", session.access_token).then(function (u) { session.user = u; save(session); if (type === "recovery" || type === "invite") showAuth("fNewPass"); else boot(); })
        .catch(function () { save(null); showAuth("fLogin"); $(".msg", $("#fLogin")).textContent = "That link has expired. Request a new one."; });
      return;
    }
    if (h.get("error_description")) { showAuth("fLogin"); $(".msg", $("#fLogin")).textContent = h.get("error_description").replace(/\+/g, " "); history.replaceState(null, "", location.pathname); return; }
    session = load();
    if (session && session.refresh_token) boot().catch(function () { signOut(true); }); else showAuth("fLogin");
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})();
