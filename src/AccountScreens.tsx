// @ts-nocheck
// Money-out and help screens: withdraw to bank, support tickets, inspector documents.
// Same hyperscript style as LemonCheckApp; shared UI primitives arrive through props.ui.
import React, { useState, useEffect, useRef } from 'react';
import * as Data from './lib/data';

var h = React.createElement;
var fmtDate = function (d) { return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }); };
var errMsg = function (e) { return (e && e.message) || 'Something went wrong. Try again.'; };

function useLoad(fn, deps) {
  var s = useState({ loading: true, error: null, data: null });
  var st = s[0], set = s[1];
  var reload = function () {
    set(function (x) { return { loading: true, error: null, data: x.data }; });
    return fn().then(function (data) { set({ loading: false, error: null, data: data }); })
      .catch(function (e) { set({ loading: false, error: errMsg(e), data: null }); });
  };
  useEffect(function () { reload(); }, deps || []);
  return [st, reload];
}

function Page(props) {
  var ui = props.ui, C = ui.C;
  return h('div', { style: { minHeight: '100vh', background: C.bg, padding: 'var(--safe-top) 20px 40px' } },
    h(ui.BackBtn, { onClick: props.onBack }),
    h('p', { style: { fontSize: 22, fontWeight: 800, color: C.t, letterSpacing: '-.03em', marginBottom: 4 } }, props.title),
    props.sub && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginBottom: 16, lineHeight: 1.6 } }, props.sub),
    props.children);
}

function Field(props) {
  var C = props.ui.C;
  return h('label', { style: { display: 'block', marginBottom: 12 } },
    h('span', { style: { display: 'block', fontSize: 11, fontWeight: 700, color: C.t3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 } }, props.label),
    props.options
      ? h('select', { value: props.value, onChange: function (e) { props.onChange(e.target.value); }, style: inputStyle(C) },
        props.options.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); }))
      : props.multiline
        ? h('textarea', { value: props.value, rows: 4, maxLength: props.maxLength, onChange: function (e) { props.onChange(e.target.value); }, style: inputStyle(C) })
        : h('input', { value: props.value, inputMode: props.inputMode, maxLength: props.maxLength, placeholder: props.placeholder, autoComplete: 'off',
          onChange: function (e) { props.onChange(e.target.value); }, style: inputStyle(C) }));
}
function inputStyle(C) {
  return { width: '100%', background: C.s2, color: C.t, border: '1px solid var(--b)', borderRadius: 10, padding: '12px 14px', fontSize: 'var(--fs-body)', fontFamily: 'inherit' };
}
function Pill(props) {
  var C = props.ui.C;
  var map = { good: [C.greenDim, C.green], warn: [C.amberDim, C.amber], bad: [C.redDim, C.red], neutral: [C.s3, C.t2] };
  var c = map[props.tone || 'neutral'];
  return h('span', { style: { background: c[0], color: c[1], fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap' } }, props.label);
}
function ErrorBox(props) {
  var C = props.ui.C;
  return h('div', { role: 'alert', style: { background: C.redDim, color: C.red, borderRadius: 10, padding: '12px 14px', fontSize: 'var(--fs-caption)', marginBottom: 12 } },
    props.msg, props.retry && h('button', { onClick: props.retry, style: { marginLeft: 10, textDecoration: 'underline', color: C.red, background: 'none', border: 'none' } }, 'Retry'));
}

/* ---------------------------------------------------------------- WITHDRAW */
var BANKS = ['ABSA', 'African Bank', 'Capitec', 'Discovery Bank', 'FNB', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank', 'Other'];
var WD = { requested: ['In progress', 'warn'], paid: ['Paid', 'good'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', 'neutral'] };

export function WithdrawScreen(props) {
  var ui = props.ui, C = ui.C, R = ui.R;
  var back = function () { props.navBack(props.backTo); };
  var e = useLoad(function () { return Promise.all([Data.fetchMyEarnings(), Data.fetchMyPayoutAccount(), Data.fetchMyWithdrawals()]); }, []);
  var st = e[0], reload = e[1];
  var amt = useState(''), amount = amt[0], setAmount = amt[1];
  var edit = useState(false), editing = edit[0], setEditing = edit[1];
  var busy = useState(false), working = busy[0], setWorking = busy[1];
  var form = useState({ holder: '', bank: 'FNB', number: '', branch: '', type: 'cheque' }), f = form[0], setF = form[1];
  var up = function (k) { return function (v) { setF(Object.assign({}, f, (function () { var o = {}; o[k] = v; return o; })())); }; };

  if (st.loading && !st.data) return h(Page, { ui: ui, title: 'Withdraw', onBack: back }, h(ui.Spin, { size: 24 }));
  if (st.error) return h(Page, { ui: ui, title: 'Withdraw', onBack: back }, h(ErrorBox, { ui: ui, msg: st.error, retry: reload }));
  var earn = st.data[0], acc = st.data[1], wds = st.data[2];
  var open = wds.filter(function (w) { return w.status === 'requested'; })[0];
  var n = parseInt(amount, 10);
  var amountErr = !amount ? '' : !(n > 0) ? 'Enter a whole number of rand'
    : n < earn.min_payout ? 'The minimum withdrawal is ' + R(earn.min_payout)
      : n > earn.available ? 'That is more than your available balance' : '';

  var run = function (fn, ok) {
    setWorking(true);
    return fn().then(function () { props.showToast(ok); return reload(); })
      .catch(function (x) { props.showToast(errMsg(x), true); })
      .then(function () { setWorking(false); });
  };
  var saveAccount = function () {
    run(function () { return Data.savePayoutAccount(f); }, 'Bank details saved').then(function () { setEditing(false); setF(Object.assign({}, f, { number: '' })); });
  };
  var submit = function () {
    run(function () { return Data.requestWithdrawal(n); }, 'Withdrawal requested').then(function () { setAmount(''); });
  };

  var showForm = !acc || editing;
  return h(Page, { ui: ui, title: 'Withdraw', sub: 'Withdrawals are paid by EFT to your bank account after review.', onBack: back },
    h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
        h('div', null, h('p', { style: { fontSize: 11, color: C.t3, fontWeight: 700, textTransform: 'uppercase' } }, 'Available'),
          h('p', { style: { fontSize: 28, fontWeight: 800, color: C.t, letterSpacing: '-.03em' } }, R(earn.available))),
        earn.pending_withdrawal > 0 && h('div', { style: { textAlign: 'right' } }, h('p', { style: { fontSize: 11, color: C.t3 } }, 'Pending'),
          h('p', { style: { fontSize: 'var(--fs-body)', fontWeight: 700, color: C.amber } }, R(earn.pending_withdrawal)))))),

    showForm
      ? h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
        h('p', { style: { fontWeight: 700, color: C.t, marginBottom: 12 } }, 'Bank details'),
        h(Field, { ui: ui, label: 'Account holder', value: f.holder, onChange: up('holder'), maxLength: 80 }),
        h(Field, { ui: ui, label: 'Bank', value: f.bank, onChange: up('bank'), options: BANKS.map(function (b) { return [b, b]; }) }),
        h(Field, { ui: ui, label: 'Account number', value: f.number, onChange: up('number'), inputMode: 'numeric', maxLength: 20 }),
        h(Field, { ui: ui, label: 'Branch code', value: f.branch, onChange: up('branch'), inputMode: 'numeric', maxLength: 8 }),
        h(Field, { ui: ui, label: 'Account type', value: f.type, onChange: up('type'), options: [['cheque', 'Cheque / current'], ['savings', 'Savings'], ['transmission', 'Transmission']] }),
        h(ui.PBtn, { label: 'Save bank details', loading: working, disabled: !f.holder || !f.number || !f.branch, onClick: saveAccount }),
        acc && h('div', { style: { marginTop: 8 } }, h(ui.GBtn, { label: 'Cancel', onClick: function () { setEditing(false); } }))))
      : h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
          h('div', null, h('p', { style: { fontWeight: 700, color: C.t } }, acc.bank_name + ' ····' + acc.account_last4),
            h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3 } }, acc.account_holder)),
          !open && h('button', { onClick: function () { setEditing(true); }, style: { color: C.t2, textDecoration: 'underline', background: 'none', border: 'none', fontSize: 'var(--fs-caption)' } }, 'Change')),
        open
          ? h('div', null,
            h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t2, lineHeight: 1.6, marginBottom: 10 } }, 'Your withdrawal of ' + R(open.amount) + ' is being processed.'),
            h(ui.GBtn, { label: 'Cancel this withdrawal', danger: true, onClick: function () { run(function () { return Data.cancelMyWithdrawal(open.id); }, 'Withdrawal cancelled'); } }))
          : h('div', null,
            h(Field, { ui: ui, label: 'Amount (R)', value: amount, onChange: function (v) { setAmount(v.replace(/\D/g, '')); }, inputMode: 'numeric', placeholder: 'Minimum ' + earn.min_payout, maxLength: 7 }),
            amountErr && h('p', { style: { color: C.red, fontSize: 'var(--fs-caption)', marginTop: -6, marginBottom: 10 } }, amountErr),
            h(ui.PBtn, { label: 'Request withdrawal', loading: working, disabled: !amount || !!amountErr, onClick: submit })))),

    wds.length > 0 && h('div', { style: { marginTop: 8 } },
      h('p', { style: { fontWeight: 700, color: C.t, marginBottom: 8 } }, 'Withdrawals'),
      h(ui.Card, null, wds.map(function (w, i) {
        var m = WD[w.status] || ['', 'neutral'];
        return h('div', { key: w.id, style: { padding: '14px 18px', borderBottom: i < wds.length - 1 ? '1px solid var(--b)' : 'none' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('p', { style: { fontWeight: 700, color: C.t } }, R(w.amount)), h(Pill, { ui: ui, label: m[0], tone: m[1] })),
          h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginTop: 2 } }, fmtDate(w.requested_at) + (w.reference ? ' · Ref ' + w.reference : '')),
          w.status === 'rejected' && w.reject_reason && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.red, marginTop: 4 } }, w.reject_reason));
      }))),

    earn.entries.length > 0 && h('div', { style: { marginTop: 16 } },
      h('p', { style: { fontWeight: 700, color: C.t, marginBottom: 8 } }, 'Earnings history'),
      h(ui.Card, null, earn.entries.map(function (x, i) {
        return h('div', { key: x.id, style: { padding: '12px 18px', display: 'flex', justifyContent: 'space-between', borderBottom: i < earn.entries.length - 1 ? '1px solid var(--b)' : 'none' } },
          h('div', null, h('p', { style: { fontSize: 'var(--fs-body)', color: C.t } }, x.note || x.kind.replace(/_/g, ' ')),
            h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3 } }, fmtDate(x.created_at))),
          h('p', { style: { fontWeight: 800, color: x.amount < 0 ? C.t2 : C.green } }, (x.amount < 0 ? '−' : '+') + R(Math.abs(x.amount))));
      }))));
}


/* -------------------------------------------------------------------- FAQ */
var FAQ = [
  ['General', [
    ['What types of vehicles do you inspect?',
     'Passenger cars (sedans, hatchbacks, SUVs, coupes, convertibles), luxury and performance vehicles including electric vehicles, and company or rental fleet vehicles that need regular safety and reliability checks.'],
    ['How long does an inspection take?',
     'A condition report takes about 45 to 60 minutes on site.'],
    ['Is this a full mechanical evaluation?',
     'No. The report focuses on roadworthy-relevant condition and a high-level cosmetic assessment. It is not a full mechanical evaluation and is not designed to test how the engine and gearbox perform over time.'],
  ]],
  ['What is in a report', [
    ['What does the condition report include?',
     'Brake performance test, shock absorber test, slip and alignment test, tyre specifications and measurements, a component-by-component checklist with the inspector’s notes, photos of the vehicle that highlight anything needing repair or maintenance, a cosmetic description, and a roadworthy result (pass or fail).'],
    ['Who sees my report?',
     'Only you, the inspector who wrote it and anyone who buys it. A buyer sees the score, price and area results first and unlocks the full detail after paying.'],
  ]],
  ['Understanding ratings', [
    ['What do the condition ratings mean?',
     'Every report gets a score out of 100 and a rating. Good (80 to 100): above average condition for its age, with no significant faults found. Fair (60 to 79): average condition. Some items need attention or monitoring and may need repair soon. Poor (below 60): below average. Several faults were found and the vehicle needs reconditioning, so allow for repair costs when you negotiate.'],
    ['What does the roadworthy result mean?',
     'It is separate from the score. Pass means the inspector found no roadworthy-relevant faults at inspection time. Fail means one or more roadworthy-relevant faults must be repaired before the vehicle can legally be driven. A vehicle can score well and still fail on a single critical item such as brakes or tyres.'],
    ['Is a Pass the same as an official roadworthy certificate?',
     'No. It is an inspector’s assessment on the day, not a certificate issued by a testing station. You still need an official roadworthy certificate to transfer or license a vehicle.'],
  ]],
];

function FaqList(props) {
  var ui = props.ui, C = ui.C;
  return h('div', { style: { marginBottom: 18 } },
    h('p', { style: { fontSize: 18, fontWeight: 800, color: C.t, letterSpacing: '-.02em', margin: '6px 0 10px' } }, 'Frequently asked questions'),
    FAQ.map(function (g) {
      return h('div', { key: g[0], style: { marginBottom: 12 } },
        h('p', { className: 'lc-cap', style: { margin: '0 0 6px' } }, g[0]),
        h(ui.Card, null, g[1].map(function (qa, i) {
          return h('details', { key: qa[0], style: { padding: '14px 18px', borderBottom: i < g[1].length - 1 ? '1px solid var(--b)' : 'none' } },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600, color: C.t, lineHeight: 1.4 } }, qa[0]),
            h('p', { style: { color: C.t2, fontSize: 'var(--fs-body)', lineHeight: 1.6, marginTop: 8 } }, qa[1]));
        })));
    }));
}

/* ----------------------------------------------------------------- SUPPORT */
var TK = { open: ['Open', 'warn'], answered: ['Answered', 'good'], resolved: ['Resolved', 'neutral'] };

export function SupportScreen(props) {
  var ui = props.ui, C = ui.C;
  var back = function () { props.navBack(props.backTo); };
  var sel = useState(null), ticketId = sel[0], setTicketId = sel[1];
  var cr = useState(false), creating = cr[0], setCreating = cr[1];
  var l = useLoad(function () { return Data.fetchMyTickets(); }, []);
  var st = l[0], reload = l[1];
  if (ticketId) return h(TicketThread, { ui: ui, id: ticketId, showToast: props.showToast, onBack: function () { setTicketId(null); reload(); } });
  if (creating) return h(NewTicket, { ui: ui, showToast: props.showToast, onBack: function () { setCreating(false); },
    onCreated: function (id) { setCreating(false); setTicketId(id); } });
  return h(Page, { ui: ui, title: 'Help', sub: 'Answers to common questions, or send us a request and we reply here.', onBack: back },
    h(FaqList, { ui: ui }),
    h('p', { style: { fontSize: 18, fontWeight: 800, color: C.t, letterSpacing: '-.02em', margin: '6px 0 10px' } }, 'Still need help?'),
    h(ui.PBtn, { label: 'New support request', onClick: function () { setCreating(true); }, style: { marginBottom: 14 } }),
    st.loading && !st.data && h(ui.Spin, { size: 24 }),
    st.error && h(ErrorBox, { ui: ui, msg: st.error, retry: reload }),
    st.data && st.data.length === 0 && h('p', { style: { color: C.t3, fontSize: 'var(--fs-caption)' } }, 'No support requests yet.'),
    st.data && st.data.length > 0 && h(ui.Card, null, st.data.map(function (t, i) {
      var m = TK[t.status] || ['', 'neutral'];
      return h('button', { key: t.id, onClick: function () { setTicketId(t.id); }, style: { width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '14px 18px', borderBottom: i < st.data.length - 1 ? '1px solid var(--b)' : 'none' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
          h('p', { style: { fontWeight: 600, color: C.t } }, t.subject), h(Pill, { ui: ui, label: m[0], tone: m[1] })),
        h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginTop: 2 } }, 'Updated ' + fmtDate(t.updated_at) + ' · ' + t.messages + ' message' + (t.messages === 1 ? '' : 's')));
    })));
}

function NewTicket(props) {
  var ui = props.ui;
  var s = useState(''), subject = s[0], setSubject = s[1];
  var b = useState(''), body = b[0], setBody = b[1];
  var w = useState(false), working = w[0], setWorking = w[1];
  var go = function () {
    setWorking(true);
    Data.openTicket(subject, body).then(function (id) { props.showToast('Request sent'); props.onCreated(id); })
      .catch(function (e) { props.showToast(errMsg(e), true); setWorking(false); });
  };
  return h(Page, { ui: ui, title: 'New request', onBack: props.onBack },
    h(Field, { ui: ui, label: 'Subject', value: subject, onChange: setSubject, maxLength: 150 }),
    h(Field, { ui: ui, label: 'Message', value: body, onChange: setBody, multiline: true, maxLength: 4000 }),
    h(ui.PBtn, { label: 'Send', loading: working, disabled: subject.trim().length < 3 || !body.trim(), onClick: go }));
}

function TicketThread(props) {
  var ui = props.ui, C = ui.C;
  var l = useLoad(function () { return Promise.all([Data.fetchMyTickets(), Data.fetchMyTicketThread(props.id)]); }, [props.id]);
  var st = l[0], reload = l[1];
  var r = useState(''), reply = r[0], setReply = r[1];
  var w = useState(false), working = w[0], setWorking = w[1];
  var send = function () {
    setWorking(true);
    Data.replyMyTicket(props.id, reply).then(function () { setReply(''); return reload(); })
      .catch(function (e) { props.showToast(errMsg(e), true); }).then(function () { setWorking(false); });
  };
  var ticket = st.data && st.data[0].filter(function (t) { return t.id === props.id; })[0];
  return h(Page, { ui: ui, title: ticket ? ticket.subject : 'Support', onBack: props.onBack },
    st.loading && !st.data && h(ui.Spin, { size: 24 }),
    st.error && h(ErrorBox, { ui: ui, msg: st.error, retry: reload }),
    st.data && st.data[1].map(function (m) {
      return h('div', { key: m.id, style: { display: 'flex', justifyContent: m.from_staff ? 'flex-start' : 'flex-end', marginBottom: 8 } },
        h('div', { style: { maxWidth: '82%', background: m.from_staff ? C.s2 : C.s3, borderRadius: 14, padding: '10px 14px' } },
          h('p', { style: { fontSize: 11, color: C.t3, fontWeight: 700, marginBottom: 2 } }, (m.from_staff ? 'Support' : 'You') + ' · ' + fmtDate(m.created_at)),
          h('p', { style: { color: C.t, fontSize: 'var(--fs-body)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, m.body)));
    }),
    st.data && h('div', { style: { marginTop: 14 } },
      ticket && ticket.status === 'resolved' && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginBottom: 8 } }, 'This request is resolved. Replying will reopen it.'),
      h(Field, { ui: ui, label: 'Reply', value: reply, onChange: setReply, multiline: true, maxLength: 4000 }),
      h(ui.PBtn, { label: 'Send reply', loading: working, disabled: !reply.trim(), onClick: send })));
}

/* --------------------------------------------------------------- DOCUMENTS */
var KINDS = [['id', 'ID document'], ['licence', 'Licence / certificate'], ['proof_of_address', 'Proof of address'], ['other', 'Other']];
var DS = { pending: ['In review', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'bad'] };

export function DocumentsScreen(props) {
  var ui = props.ui, C = ui.C;
  var back = function () { props.navBack(props.backTo); };
  var l = useLoad(function () { return Data.fetchMyDocuments(); }, []);
  var st = l[0], reload = l[1];
  var k = useState('id'), kind = k[0], setKind = k[1];
  var w = useState(false), working = w[0], setWorking = w[1];
  var input = useRef(null);
  var onFile = function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    setWorking(true);
    Data.uploadMyDocument(props.user.id, kind, file).then(function () { props.showToast('Uploaded. We will review it shortly.'); return reload(); })
      .catch(function (e) { props.showToast(errMsg(e), true); }).then(function () { setWorking(false); });
  };
  var docs = st.data || [];
  var has = function (kk, s) { return docs.some(function (d) { return d.kind === kk && d.status === s; }); };
  return h(Page, { ui: ui, title: 'Documents', sub: 'Upload your ID and licence or certificate. Both must be approved before you can take jobs. PDF, JPG, PNG or WebP, up to 10 MB.', onBack: back },
    h(ui.Card, { style: { marginBottom: 12 } }, h('div', { style: { padding: 18 } },
      h(Field, { ui: ui, label: 'Document type', value: kind, onChange: setKind, options: KINDS }),
      h('input', { ref: input, type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp', onChange: onFile, style: { display: 'none' }, 'aria-label': 'Choose a file' }),
      h(ui.PBtn, { label: 'Choose file and upload', loading: working, onClick: function () { if (input.current) input.current.click(); } }))),
    st.loading && !st.data && h(ui.Spin, { size: 24 }),
    st.error && h(ErrorBox, { ui: ui, msg: st.error, retry: reload }),
    st.data && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginBottom: 10 } },
      'ID: ' + (has('id', 'approved') ? 'approved' : 'not yet approved') + ' · Licence: ' + (has('licence', 'approved') ? 'approved' : 'not yet approved')),
    docs.length > 0 && h(ui.Card, null, docs.map(function (d, i) {
      var m = DS[d.status] || ['', 'neutral'];
      var label = (KINDS.filter(function (x) { return x[0] === d.kind; })[0] || [0, d.kind])[1];
      return h('div', { key: d.id, style: { padding: '14px 18px', borderBottom: i < docs.length - 1 ? '1px solid var(--b)' : 'none' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
          h('p', { style: { fontWeight: 600, color: C.t, overflowWrap: 'anywhere' } }, label), h(Pill, { ui: ui, label: m[0], tone: m[1] })),
        h('p', { style: { fontSize: 'var(--fs-caption)', color: C.t3, marginTop: 2, overflowWrap: 'anywhere' } }, d.file_name + ' · ' + fmtDate(d.created_at)),
        d.status === 'rejected' && d.reject_reason && h('p', { style: { fontSize: 'var(--fs-caption)', color: C.red, marginTop: 4 } }, d.reject_reason));
    })));
}
