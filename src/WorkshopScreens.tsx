// @ts-nocheck
// Partner workshop screens: requests inbox, quote form, my quotes, business profile.
// Same hyperscript style as LemonCheckApp; shared UI primitives arrive through props.ui.
import React, { useState, useEffect, useRef } from 'react';
import * as Data from './lib/data';

var h = React.createElement;
var errMsg = function (e) { return (e && e.message) || 'Something went wrong. Try again.'; };
var inputStyle = function () { return { width: '100%', fontFamily: 'inherit', fontSize: 'var(--fs-body)' }; };
var timeLeft = function (iso) {
  var ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  var d = Math.floor(ms / 86400000), hrs = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? d + (d === 1 ? ' day' : ' days') + ' left' : Math.max(hrs, 1) + 'h left';
};

function Pill(props) {
  var C = props.ui.C;
  var map = { good: [C.greenDim, C.green], warn: [C.amberDim, C.amber], bad: [C.redDim, C.red], neutral: [C.s3, C.t2] };
  var c = map[props.tone || 'neutral'];
  return h('span', { style: { background: c[0], color: c[1], fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap' } }, props.label);
}
function Title(props) {
  var C = props.ui.C;
  return h('div', { style: { padding: 'var(--safe-top) 20px 0' } },
    props.onBack && h(props.ui.BackBtn, { onClick: props.onBack }),
    h('p', { style: { fontSize: 24, fontWeight: 800, color: C.t, letterSpacing: '-.03em', marginTop: props.onBack ? 0 : 20, marginBottom: 4 } }, props.title),
    props.sub && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, lineHeight: 1.6, marginBottom: 16 } }, props.sub));
}
function Banner(props) {
  var C = props.ui.C;
  return h('div', { style: { background: props.tone === 'bad' ? C.redDim : C.amberDim, color: props.tone === 'bad' ? C.red : C.amber, borderRadius: 12, padding: '12px 14px', fontSize: 'var(--fs-caption)', lineHeight: 1.55, marginBottom: 12 } }, props.children);
}
function IssueList(props) {
  var C = props.ui.C;
  return h('div', { style: { margin: '10px 0' } }, props.issues.map(function (i, k) {
    return h('div', { key: k, style: { padding: '8px 0', borderTop: k ? '1px solid var(--b)' : 'none' } },
      h('p', { style: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: C.t } }, i.title, i.state ? h('span', { style: { fontWeight: 500, color: C.t3 } }, ' · ' + i.state) : null),
      i.note && h('p', { style: { fontSize: 12, color: C.t2, marginTop: 2, lineHeight: 1.5 } }, i.note));
  }));
}

/* ------------------------------------------------------------ INBOX */
export function WorkshopInboxScreen(props) {
  var ui = props.ui, C = ui.C, user = props.user;
  var s = useState({ loading: true, error: null, rows: [] }), st = s[0], set = s[1];
  var d = useState(undefined), details = d[0], setDetails = d[1];
  var seen = useRef(null);
  function load(quiet) {
    return Data.fetchOpenRepairRequests().then(function (rows) {
      if (seen.current !== null && rows.some(function (r) { return !seen.current[r.id]; })) props.showToast('New repair request');
      seen.current = {}; rows.forEach(function (r) { seen.current[r.id] = 1; });
      set({ loading: false, error: null, rows: rows });
    }).catch(function (e) { if (!quiet) set({ loading: false, error: errMsg(e), rows: [] }); });
  }
  useEffect(function () {
    Data.fetchMyWorkshopDetails().then(setDetails).catch(function () { setDetails(null); });
    load(false);
    var iv = setInterval(function () { if (!document.hidden) load(true); }, 8000);
    return function () { clearInterval(iv); };
  }, []);

  var needsProfile = details === null;
  return h('div', { style: { minHeight: '100vh', background: C.bg, paddingBottom: 130 } },
    h(Title, { ui: ui, title: 'Repair requests', sub: 'Buyers asking for quotes on faults found in inspection reports.' }),
    h('div', { style: { padding: '0 20px' } },
      !user.approved && h(Banner, { ui: ui }, 'Your workshop is awaiting approval. Once CheckVertical approves you, requests will appear here.'),
      needsProfile && h(Banner, { ui: ui }, 'Add your business details first. ', h('button', { onClick: function () { props.nav('wprofile'); }, style: { textDecoration: 'underline', color: 'inherit', background: 'none', border: 'none', fontWeight: 700 } }, 'Open profile')),
      st.error && h(Banner, { ui: ui, tone: 'bad' }, st.error),
      st.loading ? h('div', { style: { display: 'flex', justifyContent: 'center', padding: 40 } }, h(ui.Spin, { size: 24 })) : null,
      !st.loading && user.approved && st.rows.length === 0 && !st.error && h('p', { style: { color: C.t3, textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-caption)' } }, 'No open requests right now. New ones appear here automatically.'),
      user.approved && st.rows.map(function (r) {
        var q = r.my_quote && r.my_quote.status === 'submitted' ? r.my_quote : null;
        return h(ui.Card, { key: r.id, style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' } },
            h('div', null,
              h('p', { style: { fontWeight: 800, fontSize: 16, color: C.t, letterSpacing: '-.02em' } }, r.vehicle_label),
              h('p', { style: { fontSize: 12, color: C.t3, marginTop: 2 } }, r.area + (r.buyer_first_name ? ' · from ' + r.buyer_first_name : ''))),
            h(Pill, { ui: ui, tone: 'neutral', label: timeLeft(r.expires_at) })),
          h(IssueList, { ui: ui, issues: r.issues }),
          r.note && h('p', { style: { fontSize: 12, color: C.t2, background: C.s2, borderRadius: 10, padding: '8px 12px', marginBottom: 10 } }, '"' + r.note + '"'),
          q ? h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 } },
            h('div', null, h(Pill, { ui: ui, tone: 'good', label: 'Quote sent' }), h('p', { style: { fontSize: 13, fontWeight: 700, color: C.t, marginTop: 6 } }, ui.R(q.total) + ' · ' + q.days + (q.days === 1 ? ' day' : ' days'))),
            h(ui.GBtn, { label: 'Edit quote', onClick: function () { props.setWreq(r); props.nav('wquote'); } }))
            : h(ui.PBtn, { label: 'Send quote', onClick: function () { props.setWreq(r); props.nav('wquote'); } })));
      })));
}

/* ------------------------------------------------------------ QUOTE FORM */
export function WorkshopQuoteScreen(props) {
  var ui = props.ui, C = ui.C, req = props.request;
  if (!req) { return h('div', { style: { padding: 40 } }, h(ui.GBtn, { label: 'Back to requests', onClick: function () { props.nav('wrequests'); } })); }
  var prior = req.my_quote && req.my_quote.status === 'submitted' ? req.my_quote : null;
  var priceOf = function (k) { var l = prior && prior.lines.filter(function (x) { return x.key === k; })[0]; return l ? String(l.price) : ''; };
  var p = useState(function () { var o = {}; req.issues.forEach(function (i) { o[i.key || i.title] = priceOf(i.key); }); return o; }), prices = p[0], setPrices = p[1];
  var dd = useState(prior ? String(prior.days) : '2'), days = dd[0], setDays = dd[1];
  var nn = useState(prior && prior.note ? prior.note : ''), note = nn[0], setNote = nn[1];
  var bb = useState(false), busy = bb[0], setBusy = bb[1];
  var ee = useState(''), err = ee[0], setErr = ee[1];

  var total = req.issues.reduce(function (a, i) { return a + (parseInt(prices[i.key || i.title], 10) || 0); }, 0);
  var daysN = parseInt(days, 10);
  var ok = total > 0 && daysN >= 0 && daysN <= 60;

  function send() {
    setErr(''); setBusy(true);
    var lines = req.issues.map(function (i) { return { key: i.key || '', title: i.title, price: parseInt(prices[i.key || i.title], 10) || 0 }; });
    Data.submitRepairQuote({ requestId: req.id, total: total, lines: lines, days: daysN, note: note })
      .then(function () { props.showToast(prior ? 'Quote updated' : 'Quote sent'); props.nav('wrequests'); })
      .catch(function (e) { setBusy(false); setErr(errMsg(e)); });
  }
  return h('div', { style: { minHeight: '100vh', background: C.bg, paddingBottom: 130 } },
    h(Title, { ui: ui, title: 'Your quote', sub: req.vehicle_label + ' · ' + req.area, onBack: function () { props.nav('wrequests'); } }),
    h('div', { style: { padding: '0 20px' } },
      h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
        h('p', { style: { fontWeight: 700, color: C.t, marginBottom: 4 } }, 'Price each fault'),
        h('p', { style: { fontSize: 12, color: C.t3, marginBottom: 12, lineHeight: 1.5 } }, 'Include parts and labour, VAT included. Leave a fault at R0 if you will not fix it.'),
        req.issues.map(function (i) {
          var k = i.key || i.title;
          return h('label', { key: k, style: { display: 'block', marginBottom: 12 } },
            h('span', { style: { display: 'block', fontSize: 13, fontWeight: 700, color: C.t, marginBottom: 2 } }, i.title),
            i.note && h('span', { style: { display: 'block', fontSize: 12, color: C.t3, marginBottom: 5 } }, i.note),
            h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 500000, placeholder: 'R', value: prices[k], 'aria-label': 'Price for ' + i.title,
              onChange: function (e) { var v = e.target.value; setPrices(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }, style: inputStyle() }));
        }),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--b)', paddingTop: 12 } },
          h('span', { style: { fontSize: 12, color: C.t3 } }, 'Total'), h('span', { style: { fontSize: 26, fontWeight: 800, color: C.t, letterSpacing: '-.03em' } }, ui.R(total))))),
      h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
        h('label', { style: { display: 'block', marginBottom: 12 } },
          h('span', { style: { display: 'block', fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 5 } }, 'Days needed for the work'),
          h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 60, value: days, onChange: function (e) { setDays(e.target.value); }, style: inputStyle() })),
        h('label', { style: { display: 'block' } },
          h('span', { style: { display: 'block', fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 5 } }, 'Note to the buyer (optional)'),
          h('textarea', { rows: 3, maxLength: 500, value: note, placeholder: 'Parts availability, warranty, when you can start…', onChange: function (e) { setNote(e.target.value); }, style: inputStyle() })))),
      h('p', { style: { fontSize: 12, color: C.t3, lineHeight: 1.6, marginBottom: 14 } }, 'Quotes stay valid for 7 days. CheckVertical charges a referral fee only if the buyer accepts your quote.'),
      err && h(Banner, { ui: ui, tone: 'bad' }, err),
      h(ui.PBtn, { label: prior ? 'Update quote' : 'Send quote', onClick: send, loading: busy, disabled: !ok })));
}

/* ------------------------------------------------------------ MY QUOTES */
var QS = { submitted: ['Waiting for buyer', 'warn'], accepted: ['Accepted', 'good'], rejected: ['Not selected', 'neutral'], withdrawn: ['Withdrawn', 'neutral'] };
export function WorkshopQuotesScreen(props) {
  var ui = props.ui, C = ui.C;
  var s = useState({ loading: true, error: null, rows: [] }), st = s[0], set = s[1];
  var bb = useState(null), busy = bb[0], setBusy = bb[1];
  function load() {
    return Data.fetchMyRepairQuotes().then(function (rows) { set({ loading: false, error: null, rows: rows }); })
      .catch(function (e) { set({ loading: false, error: errMsg(e), rows: [] }); });
  }
  useEffect(function () { load(); var iv = setInterval(function () { if (!document.hidden) load(); }, 10000); return function () { clearInterval(iv); }; }, []);
  function withdraw(q) {
    setBusy(q.id);
    Data.withdrawRepairQuote(q.id).then(function () { props.showToast('Quote withdrawn'); return load(); })
      .catch(function (e) { props.showToast(errMsg(e), true); }).then(function () { setBusy(null); });
  }
  var won = st.rows.filter(function (q) { return q.status === 'accepted'; });
  var wonTotal = won.reduce(function (a, q) { return a + (q.workshop_payout || 0); }, 0);
  return h('div', { style: { minHeight: '100vh', background: C.bg, paddingBottom: 130 } },
    h(Title, { ui: ui, title: 'My quotes', sub: won.length ? won.length + ' accepted · ' + ui.R(wonTotal) + ' to be paid out' : 'Quotes you have sent and where they stand.' }),
    h('div', { style: { padding: '0 20px' } },
      st.error && h(Banner, { ui: ui, tone: 'bad' }, st.error),
      st.loading && h('div', { style: { display: 'flex', justifyContent: 'center', padding: 40 } }, h(ui.Spin, { size: 24 })),
      !st.loading && !st.rows.length && !st.error && h('p', { style: { color: C.t3, textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-caption)' } }, 'You have not sent any quotes yet.'),
      st.rows.map(function (q) {
        var m = QS[q.status] || ['', 'neutral'];
        return h(ui.Card, { key: q.id, style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
            h('div', null, h('p', { style: { fontWeight: 800, color: C.t } }, q.vehicle_label), h('p', { style: { fontSize: 12, color: C.t3, marginTop: 2 } }, q.area + (q.buyer_first_name ? ' · ' + q.buyer_first_name : ''))),
            h(Pill, { ui: ui, tone: m[1], label: m[0] })),
          h('p', { style: { fontSize: 22, fontWeight: 800, color: C.t, letterSpacing: '-.03em', margin: '10px 0 2px' } }, ui.R(q.total)),
          h('p', { style: { fontSize: 12, color: C.t3 } }, q.days + (q.days === 1 ? ' day' : ' days') + (q.status === 'accepted' && q.workshop_payout != null ? ' · you receive ' + ui.R(q.workshop_payout) : '')),
          h(IssueList, { ui: ui, issues: q.issues }),
          q.status === 'submitted' && h(ui.GBtn, { label: busy === q.id ? 'Please wait…' : 'Withdraw quote', onClick: function () { withdraw(q); } })));
      })));
}

/* ------------------------------------------------------------ PROFILE */
export function WorkshopProfileScreen(props) {
  var ui = props.ui, C = ui.C, user = props.user;
  var f = useState({ business_name: '', area: '', address: '', services: '', brands: '' }), form = f[0], setForm = f[1];
  var ld = useState(true), loading = ld[0], setLoading = ld[1];
  var bb = useState(false), busy = bb[0], setBusy = bb[1];
  var ee = useState(''), err = ee[0], setErr = ee[1];
  useEffect(function () {
    Data.fetchMyWorkshopDetails().then(function (d) {
      if (d) setForm({ business_name: d.business_name || '', area: d.area || '', address: d.address || '', services: d.services || '', brands: d.brands || '' });
      else setForm(function (x) { return Object.assign({}, x, { business_name: user.name || '' }); });
    }).catch(function () {}).then(function () { setLoading(false); });
  }, []);
  var up = function (k) { return function (e) { var v = e.target.value; setForm(function (x) { var n = Object.assign({}, x); n[k] = v; return n; }); }; };
  function save() {
    setErr(''); setBusy(true);
    Data.saveMyWorkshopDetails(form).then(function () { setBusy(false); props.showToast('Business details saved'); })
      .catch(function (e) { setBusy(false); setErr(errMsg(e)); });
  }
  var field = function (label, k, ph, multi) {
    return h('label', { style: { display: 'block', marginBottom: 12 } },
      h('span', { style: { display: 'block', fontSize: 11, fontWeight: 700, color: C.t3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 } }, label),
      multi ? h('textarea', { rows: 3, maxLength: 500, value: form[k], placeholder: ph, onChange: up(k), style: inputStyle() })
        : h('input', { value: form[k], maxLength: 300, placeholder: ph, onChange: up(k), style: inputStyle() }));
  };
  return h('div', { style: { minHeight: '100vh', background: C.bg, paddingBottom: 130 } },
    h(Title, { ui: ui, title: user.name, sub: 'Partner workshop' }),
    h('div', { style: { padding: '0 20px' } },
      h('div', { style: { display: 'flex', gap: 6, marginBottom: 14 } }, h(Pill, { ui: ui, tone: user.approved ? 'good' : 'warn', label: user.approved ? 'Approved by CheckVertical' : 'Awaiting approval' })),
      !user.approved && h(Banner, { ui: ui }, 'Complete your business details. CheckVertical reviews and approves workshops before they can send quotes.'),
      h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
        h('p', { style: { fontWeight: 700, color: C.t, marginBottom: 12 } }, 'Business details'),
        loading ? h(ui.Spin, { size: 18 }) : [
          field('Business name', 'business_name', 'e.g. Sandton Auto Repairs'),
          field('Area you serve', 'area', 'e.g. Sandton, Randburg, Midrand'),
          field('Workshop address', 'address', 'Street, suburb, city'),
          field('Services', 'services', 'Brakes, suspension, aircon, panel beating…', true),
          field('Brands you work on', 'brands', 'e.g. All makes, German, Toyota')],
        err && h(Banner, { ui: ui, tone: 'bad' }, err),
        h(ui.PBtn, { label: 'Save details', onClick: save, loading: busy, disabled: loading || form.business_name.trim().length < 2 }))),
      h(ui.GBtn, { label: 'Help & support', onClick: function () { props.nav('support'); } }),
      h(ui.GBtn, { label: 'Log out', onClick: props.logout })));
}
