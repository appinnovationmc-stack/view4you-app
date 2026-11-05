// @ts-nocheck
// Buyer: ask partner workshops to quote on the faults in a report, compare and accept.
import React, { useState, useEffect } from 'react';
import * as Data from './lib/data';

var h = React.createElement;
var errMsg = function (e) { return (e && e.message) || 'Something went wrong. Try again.'; };
var URG = { now: 'Fix now', soon: 'Fix soon', watch: 'Keep an eye on' };

export default function RepairQuotes(props) {
  var ui = props.ui, C = ui.C;
  var ld = useState(true), loading = ld[0], setLoading = ld[1];
  var rq = useState(null), req = rq[0], setReq = rq[1];
  var qs = useState([]), quotes = qs[0], setQuotes = qs[1];
  var ee = useState(''), err = ee[0], setErr = ee[1];
  var bb = useState(false), busy = bb[0], setBusy = bb[1];
  var cf = useState(null), confirmId = cf[0], setConfirmId = cf[1];
  var ar = useState(''), area = ar[0], setArea = ar[1];
  var nt = useState(''), note = nt[0], setNote = nt[1];
  var issues = props.issues.filter(function (i) { return i.urgency !== 'watch'; });
  var sel0 = useState(function () { var o = {}; issues.forEach(function (i) { o[i.key] = true; }); return o; }), sel = sel0[0], setSel = sel0[1];

  function load(quiet) {
    return Data.fetchMyRepairRequests().then(function (rows) {
      var mine = rows.filter(function (r) { return r.inspection_id === props.inspectionId && (r.status === 'open' || r.status === 'accepted'); })[0] || null;
      setReq(mine);
      if (mine) return Data.fetchRepairQuotes(mine.id).then(setQuotes);
      setQuotes([]);
    }).catch(function (e) { if (!quiet) setErr(errMsg(e)); }).then(function () { setLoading(false); });
  }
  useEffect(function () {
    load(false);
    var iv = setInterval(function () { if (!document.hidden) load(true); }, 8000);
    return function () { clearInterval(iv); };
  }, [props.inspectionId]);

  function request() {
    var chosen = issues.filter(function (i) { return sel[i.key]; }).map(function (i) { return { key: i.key, title: i.title, state: i.state, note: i.note || '' }; });
    setErr(''); setBusy(true);
    Data.createRepairRequest({ inspectionId: props.inspectionId, issues: chosen, area: area, note: note })
      .then(function () { props.showToast('Quotes requested'); return load(false); })
      .catch(function (e) { setErr(errMsg(e)); }).then(function () { setBusy(false); });
  }
  function accept(q) {
    setErr(''); setBusy(true);
    Data.acceptRepairQuote(q.id).then(function () { setConfirmId(null); props.showToast('Quote accepted'); return load(false); })
      .catch(function (e) { setErr(errMsg(e)); }).then(function () { setBusy(false); });
  }

  var wrap = function (kids) {
    return h('div', { className: 'noprint', style: { padding: '0 20px 24px' } }, h(ui.Card, null, h('div', { style: { padding: 18 } }, kids)));
  };
  var title = function (t, s) {
    return [h('p', { key: 't', style: { fontWeight: 800, fontSize: 17, color: C.t, letterSpacing: '-.02em', marginBottom: 4 } }, t),
      s && h('p', { key: 's', style: { fontSize: 'var(--fs-caption)', color: C.t3, lineHeight: 1.6, marginBottom: 14 } }, s)];
  };
  var errBox = err && h('p', { role: 'alert', style: { color: C.red, fontSize: 'var(--fs-caption)', margin: '0 0 12px' } }, err);

  if (loading) return wrap(h('div', { style: { display: 'flex', justifyContent: 'center' } }, h(ui.Spin, { size: 20 })));
  if (!issues.length && !req) return null;

  /* No request yet */
  if (!req) {
    var count = issues.filter(function (i) { return sel[i.key]; }).length;
    return wrap([].concat(title('Get real repair quotes', 'Partner workshops price the faults in this report. Compare quotes and accept one. It is free to ask.'),
      issues.map(function (i) {
        return h('label', { key: i.key, style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--b)' } },
          h('input', { type: 'checkbox', checked: !!sel[i.key], onChange: function (e) { var v = e.target.checked; setSel(function (o) { var n = Object.assign({}, o); n[i.key] = v; return n; }); }, style: { width: 22, height: 22, flexShrink: 0, marginTop: 1 } }),
          h('span', null, h('span', { style: { display: 'block', fontSize: 'var(--fs-caption)', fontWeight: 700, color: C.t } }, i.title),
            h('span', { style: { display: 'block', fontSize: 12, color: C.t3 } }, URG[i.urgency] + (i.note ? ' · ' + i.note : ''))));
      }),
      h('label', { key: 'area', style: { display: 'block', margin: '12px 0' } },
        h('span', { style: { display: 'block', fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 5 } }, 'Your suburb or area'),
        h('input', { value: area, maxLength: 120, placeholder: 'e.g. Sandton', onChange: function (e) { setArea(e.target.value); }, style: { width: '100%', fontSize: 16 } })),
      h('label', { key: 'note', style: { display: 'block', marginBottom: 14 } },
        h('span', { style: { display: 'block', fontSize: 12, fontWeight: 700, color: C.t3, marginBottom: 5 } }, 'Note for workshops (optional)'),
        h('textarea', { rows: 2, maxLength: 500, value: note, onChange: function (e) { setNote(e.target.value); }, style: { width: '100%', fontSize: 16 } })),
      errBox,
      h(ui.PBtn, { key: 'go', label: 'Request quotes', onClick: request, loading: busy, disabled: !count || area.trim().length < 2 })));
  }

  /* Accepted */
  if (req.status === 'accepted') {
    var won = quotes.filter(function (q) { return q.status === 'accepted'; })[0];
    return wrap([].concat(title('Quote accepted'),
      won ? [h('p', { key: 'w', style: { fontWeight: 700, color: C.t } }, won.workshop.name),
        h('p', { key: 'p', style: { fontSize: 26, fontWeight: 800, color: C.t, letterSpacing: '-.03em', margin: '4px 0' } }, ui.R(won.total)),
        h('p', { key: 'd', style: { fontSize: 'var(--fs-caption)', color: C.t3, lineHeight: 1.6 } }, won.days + (won.days === 1 ? ' day' : ' days') + ' of work' + (won.workshop.area ? ' · ' + won.workshop.area : '') + '. The workshop has been told.'),
        h('p', { key: 'c', style: { fontSize: 'var(--fs-caption)', color: C.t, lineHeight: 1.7, marginTop: 10 } }, won.workshop.address ? won.workshop.address : null, won.workshop.address && won.workshop.phone ? h('br') : null, won.workshop.phone ? h('a', { href: 'tel:' + won.workshop.phone, style: { color: C.t, fontWeight: 700 } }, 'Call ' + won.workshop.phone) : null)] : null));
  }

  /* Open: compare */
  var cheapest = quotes.length ? quotes[0].id : null;
  return wrap([].concat(title('Repair quotes', quotes.length ? quotes.length + (quotes.length === 1 ? ' quote' : ' quotes') + ' so far, cheapest first. New ones appear here automatically.' : 'Waiting for workshops to quote. This usually takes a few hours. We will notify you.'),
    errBox,
    quotes.map(function (q) {
      var w = q.workshop;
      return h('div', { key: q.id, style: { borderTop: '1px solid var(--b)', padding: '14px 0' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' } },
          h('p', { style: { fontWeight: 700, color: C.t } }, w.name),
          h('p', { style: { fontSize: 20, fontWeight: 800, color: C.t, letterSpacing: '-.03em' } }, ui.R(q.total))),
        h('p', { style: { fontSize: 12, color: C.t3, margin: '2px 0 8px' } },
          [q.id === cheapest && quotes.length > 1 ? 'Lowest price' : null, q.days + (q.days === 1 ? ' day' : ' days'), w.area, w.brands, w.jobs ? w.jobs + ' jobs' : null].filter(Boolean).join(' · ')),
        q.note && h('p', { style: { fontSize: 12, color: C.t2, lineHeight: 1.5, marginBottom: 8 } }, '"' + q.note + '"'),
        confirmId === q.id
          ? h('div', { style: { display: 'flex', gap: 8 } }, h(ui.PBtn, { label: 'Confirm ' + ui.R(q.total), onClick: function () { accept(q); }, loading: busy }), h(ui.GBtn, { label: 'Cancel', onClick: function () { setConfirmId(null); } }))
          : h(ui.GBtn, { label: 'Accept this quote', onClick: function () { setConfirmId(q.id); } }));
    }),
    h('p', { key: 'f', style: { fontSize: 12, color: C.t3, lineHeight: 1.6, marginTop: 6 } }, 'Quotes stay valid for 7 days. Accepting one tells the other workshops you chose someone else.')));
}
