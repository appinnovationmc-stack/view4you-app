// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import * as Data from './lib/data';
import InspectionForm from './InspectionForm';
import ReportView from './ReportView';

var h = React.createElement;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FIX: HAPTICS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function haptic(type) {
  if (!navigator.vibrate) return;
  var patterns = { light:[8], medium:[18], success:[8,40,8], error:[25,15,25], selection:[6] };
  navigator.vibrate(patterns[type] || [8]);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PALETTE (shorthand object)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
var C = {
  bg:'#0A0A0A', s1:'#141414', s2:'#1C1C1C', s3:'#242424',
  b:'rgba(255,255,255,.08)', b2:'rgba(255,255,255,.14)',
  t:'#FFFFFF', t2:'rgba(255,255,255,.6)', t3:'rgba(255,255,255,.32)',
  lime:'#D4F72A', limeDim:'rgba(212,247,42,.12)', limeDim2:'rgba(212,247,42,.06)',
  green:'#32D74B', greenDim:'rgba(50,215,75,.14)',
  red:'#FF453A', redDim:'rgba(255,69,58,.14)',
  amber:'#FF9F0A', amberDim:'rgba(255,159,10,.14)',
  blue:'#0A84FF', blueDim:'rgba(10,132,255,.14)',
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DATA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
var MAKES = ['BMW','Ford','Honda','Hyundai','Kia','Mazda','Mercedes-Benz','Nissan','Toyota','Volkswagen'];
var AREAS = ['Engine','Transmission','Brakes','Tyres','Suspension','Electricals','Body & Paint','Interior','Lights','Exhaust','Battery','Charging System'];

/* FIX: these were static demo arrays/objects. They're now mutable module
   bindings that App() repopulates from Supabase (see Data.* calls wired
   into each screen below) using the exact shapes the screens already
   expect. Screens read them at render time (no memoization anywhere in
   this file), so reassigning + forcing a re-render is enough to reflect
   real data with zero changes to screen bodies themselves. */
var INSPECTORS = [];
var VEHICLES = {};
var SA_HIST = {};
var JOBS = [];
var TXNS = [];
var NOTIFS_INIT = [];
var BUYER = null;
var INSP_USER = null;

/* Onboarding copy per role */
var ONBOARD = {
  buyer:[
    {icon:'🔍',title:'Search any car',       body:'Enter a South African VIN to see full inspection history, accident records, and eNaTIS data — before you commit to a single rand.'},
    {icon:'⚡',title:'Inspector in minutes', body:'Choose from certified inspectors near the car. They arrive within the hour — no waiting rooms, no scheduling delays.'},
    {icon:'💰',title:'Earn while you sleep', body:'Once you commission an inspection, you earn R180 every time another buyer purchases that same report. Passively. Forever.'},
  ],
  insp:[
    {icon:'📋',title:'Accept nearby jobs',   body:'Inspection requests appear in real time. Accept the ones that fit your location and schedule — no commitment required.'},
    {icon:'🔧',title:'Complete the checklist',body:'Work through the full checklist on your phone: condition buttons, brake and tyre readings, photos. Submit on-site when done.'},
    {icon:'🍋',title:'Earn twice per job',   body:'Collect R1,800–R2,100 per inspection, plus R70 every time your report is resold. Passive income that compounds over time.'},
  ],
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPERS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function greet() { var h=new Date().getHours(); return h<12?'Good morning':h<17?'Good afternoon':'Good evening'; }
function R(n)    { return 'R\u00a0'+Number(n).toLocaleString(); }
function sm(s)   { return s>=80?{col:C.green,dim:C.greenDim,lbl:'Good',   sub:'Above average'}
                        : s>=60?{col:C.amber,dim:C.amberDim,lbl:'Fair',   sub:'Average'}
                               :{col:C.red,  dim:C.redDim,  lbl:'Poor',   sub:'Below average'}; }

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FIX: CANVAS MAP  (replaces CSS grid)
   Draws a stylised city block layout.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/* roundRect polyfill for canvas */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    this.beginPath();this.moveTo(x+r,y);this.lineTo(x+w-r,y);
    this.arcTo(x+w,y,x+w,y+r,r);this.lineTo(x+w,y+h-r);
    this.arcTo(x+w,y+h,x+w-r,y+h,r);this.lineTo(x+r,y+h);
    this.arcTo(x,y+h,x,y+h-r,r);this.lineTo(x,y+r);
    this.arcTo(x,y,x+r,y,r);this.closePath();return this;
  };
}
function drawMap(canvas) {
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var W = canvas.offsetWidth, H = canvas.offsetHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  /* Base */
  ctx.fillStyle = '#0C1B0B'; ctx.fillRect(0,0,W,H);

  /* Park zone */
  ctx.fillStyle = '#0E2410';
  ctx.beginPath(); ctx.roundRect(W*.52,H*.04,W*.22,H*.18,6); ctx.fill();

  /* Water body */
  ctx.fillStyle = '#071420';
  ctx.beginPath();
  ctx.moveTo(0,H*.60); ctx.lineTo(W*.18,H*.60); ctx.lineTo(W*.20,H*.72);
  ctx.lineTo(W*.16,H*.92); ctx.lineTo(0,H*.92); ctx.closePath(); ctx.fill();

  /* City blocks */
  var blocks = [
    [.02,.04,.14,.10],[.18,.04,.10,.10],[.30,.04,.16,.08],[.78,.04,.12,.13],
    [.02,.18,.11,.12],[.15,.18,.13,.12],[.30,.14,.12,.08],[.56,.06,.12,.08],
    [.44,.04,.09,.13],[.44,.21,.10,.11],[.58,.18,.09,.08],[.69,.18,.13,.07],
    [.02,.36,.09,.12],[.13,.36,.14,.09],[.30,.28,.11,.10],[.44,.36,.13,.10],
    [.59,.30,.11,.12],[.72,.28,.14,.10],[.02,.54,.08,.08],[.24,.48,.12,.12],
    [.38,.50,.10,.08],[.54,.48,.12,.10],[.68,.46,.12,.09],[.82,.46,.10,.14],
    [.24,.66,.10,.10],[.36,.64,.13,.07],[.52,.64,.11,.08],[.65,.62,.13,.10],
    [.80,.66,.12,.08],[.24,.80,.11,.08],[.37,.80,.10,.10],[.50,.78,.13,.09],
    [.65,.78,.11,.07],[.78,.80,.14,.08],
  ];
  ctx.fillStyle = '#0F1E0E';
  blocks.forEach(function(b) {
    ctx.beginPath(); ctx.roundRect(b[0]*W,b[1]*H,b[2]*W,b[3]*H,3); ctx.fill();
  });

  /* Block highlight faces */
  ctx.fillStyle = '#142012';
  [[.03,.05,.05,.04],[.09,.05,.04,.05],[.19,.05,.04,.04],[.32,.05,.06,.04],
   [.45,.05,.04,.05],[.57,.07,.05,.04],[.79,.05,.05,.05],[.08,.23,.05,.04]].forEach(function(b){
    ctx.fillRect(b[0]*W,b[1]*H,b[2]*W,b[3]*H);
  });

  /* Major roads */
  ctx.strokeStyle = '#1A2E18'; ctx.lineWidth = 8; ctx.lineCap = 'square';
  [[0,.27],[0,.51],[0,.75]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(0,r[1]*H); ctx.lineTo(W,r[1]*H); ctx.stroke(); });
  [[.30,0],[.58,0]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(r[0]*W,0); ctx.lineTo(r[0]*W,H); ctx.stroke(); });

  /* Minor roads */
  ctx.strokeStyle = '#142212'; ctx.lineWidth = 3;
  [[0,.13],[0,.39],[0,.64],[0,.88]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(0,r[1]*H); ctx.lineTo(W,r[1]*H); ctx.stroke(); });
  [[.13,0],[.44,0],[.70,0],[.88,0]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(r[0]*W,0); ctx.lineTo(r[0]*W,H); ctx.stroke(); });

  /* Centre-line dashes */
  ctx.strokeStyle = 'rgba(255,255,255,.022)'; ctx.lineWidth = 1; ctx.setLineDash([12,18]);
  [[0,.27],[0,.51],[0,.75]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(0,r[1]*H); ctx.lineTo(W,r[1]*H); ctx.stroke(); });
  [[.30,0],[.58,0]].forEach(function(r){ ctx.beginPath(); ctx.moveTo(r[0]*W,0); ctx.lineTo(r[0]*W,H); ctx.stroke(); });
  ctx.setLineDash([]);

  /* Vignette */
  var vg = ctx.createRadialGradient(W/2,H/2,H*.06,W/2,H/2,H*.78);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.38)');
  ctx.fillStyle = vg; ctx.fillRect(0,0,W,H);
}

function MapView(props) {
  var ref = useRef(null);
  useEffect(function(){ if (ref.current) drawMap(ref.current); }, []);
  return h('div', {style:{position:'relative',height:props.height||'52vh',overflow:'hidden',background:'#0C1B0B'}},
    h('canvas', {ref:ref, style:{position:'absolute',inset:0,width:'100%',height:'100%'}}),
    h('div', {style:{position:'absolute',inset:0}}, props.children));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ATOMS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function Spin(props) {
  var sz = (props && props.size) || 18;
  return h('div', {style:{width:sz,height:sz,border:'2px solid rgba(255,255,255,.1)',borderTop:'2px solid '+C.t,borderRadius:'50%',animation:'sp .65s linear infinite',flexShrink:0}});
}

/* FIX: Skeleton shimmer replaces universal spinner for data loading */
function Skeleton(props) {
  return h('div', {className:'skeleton', style:{width:props.w||'100%',height:props.h||16,borderRadius:props.r||8}});
}
function SkeletonVehicleCard() {
  return h('div', {style:{background:C.s1,borderRadius:'var(--rl)',border:'1px solid var(--b)',padding:'18px'},className:'fi'},
    h('div', {style:{display:'flex',justifyContent:'space-between'}},
      h('div', {style:{flex:1,marginRight:16}},
        h(Skeleton,{w:'40%',h:11,r:4}), h('div',{style:{height:8}}),
        h(Skeleton,{w:'70%',h:22}),     h('div',{style:{height:8}}),
        h(Skeleton,{w:'55%',h:13}),     h('div',{style:{height:14}}),
        h('div',{style:{display:'flex',gap:8}},
          h(Skeleton,{w:90,h:26,r:99}), h(Skeleton,{w:70,h:26,r:99}))),
      h(Skeleton,{w:72,h:72,r:36})));
}
function SkeletonHistoryCard() {
  return h('div', {style:{background:C.s1,borderRadius:'var(--rl)',border:'1px solid var(--b)',padding:'18px',display:'flex',flexDirection:'column',gap:12},className:'fi'},
    h(Skeleton,{w:'50%',h:16}),
    h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}},
      [1,2,3,4,5,6].map(function(i){ return h('div',{key:i,style:{background:C.s2,borderRadius:8,padding:10}},h(Skeleton,{w:'60%',h:11}),h('div',{style:{height:6}}),h(Skeleton,{w:'80%',h:14})); })));
}
function SkeletonInspectorList() {
  return h('div', {style:{display:'flex',flexDirection:'column',gap:8}},
    [1,2,3].map(function(i){
      return h('div',{key:i,style:{background:C.s1,border:'1px solid var(--b)',borderRadius:'var(--rl)',padding:'14px',display:'flex',alignItems:'center',gap:12},className:'fi',style2:{animationDelay:(i-1)*0.06+'s'}},
        h(Skeleton,{w:44,h:44,r:22}),
        h('div',{style:{flex:1}},
          h(Skeleton,{w:'55%',h:15}), h('div',{style:{height:8}}),
          h(Skeleton,{w:'40%',h:12}), h('div',{style:{height:8}}),
          h('div',{style:{display:'flex',gap:6}},h(Skeleton,{w:72,h:22,r:99}),h(Skeleton,{w:60,h:22,r:99}))));
    }));
}

function Av(props) {
  var sz = props.size || 40;
  var pals = ['#1A1A2E','#16213E','#1B4332','#2D2D2D','#1A0A2E','#2A1A0E'];
  var idx  = props.label ? props.label.charCodeAt(0) % pals.length : 0;
  return h('div', {style:{width:sz,height:sz,borderRadius:'50%',background:props.bg||pals[idx],border:'1px solid var(--b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:sz*.36,fontWeight:700,color:C.t,flexShrink:0,letterSpacing:'-.02em'}}, props.label);
}

/* FIX: Ring — animated fill on mount, sub-label for context, thicker fill stroke */
function Ring(props) {
  var sz = props.size || 72, sc = props.score, m = sm(sc);
  var r   = sz * .38;
  var cir = 2 * Math.PI * r;
  var fill = (sc / 100) * cir;
  var cx  = sz / 2, cy = sz / 2;

  return h('div', {style:{flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:4}},  /* showLabel=true adds sub text */
    h('svg', {width:sz, height:sz, viewBox:'0 0 '+sz+' '+sz,
              role:'img', 'aria-label':'Condition score: '+sc+' out of 100 — '+m.sub},
      /* Track */
      h('circle', {cx:cx,cy:cy,r:r,fill:'none',stroke:'rgba(255,255,255,.08)',strokeWidth:3.5}),
      /* FIX: fill stroke is thicker (5) than track (3.5), ring-fill animation */
      h('circle', {cx:cx,cy:cy,r:r,fill:'none',stroke:m.col,strokeWidth:5,
                   strokeDasharray:cir+' '+cir,strokeDashoffset:cir-fill,strokeLinecap:'round',
                   transform:'rotate(-90 '+cx+' '+cy+')',
                   style:{'--ring-cir':cir,'--ring-gap':cir-fill,strokeDashoffset:cir-fill,animation:'ring-draw .85s cubic-bezier(.22,1,.36,1) both'}}),
      h('text', {x:cx,y:cy-sz*.05,textAnchor:'middle',dominantBaseline:'middle',fill:C.t,fontSize:sz*.26,fontWeight:800,fontFamily:"'Inter',sans-serif",letterSpacing:'-.03em'}, sc),
      /* FIX: sub-label inside ring for context */
      h('text', {x:cx,y:cy+sz*.21,textAnchor:'middle',fill:C.t3,fontSize:sz*.115,fontFamily:"'Inter',sans-serif"}, '/ 100')),
    props.showLabel && h('span', {style:{fontSize:10,fontWeight:700,color:m.col,textTransform:'uppercase',letterSpacing:'.07em',whiteSpace:'nowrap'}}, m.sub));
}

function SBadge(props) {
  var mp = {
    pass:{bg:C.greenDim,c:C.green,l:'PASS'},
    warn:{bg:C.amberDim,c:C.amber,l:'ADVISORY'},
    fail:{bg:C.redDim,  c:C.red,  l:'FAIL'},
  };
  var s = mp[props.s] || {bg:C.s3,c:C.t3,l:String(props.s).toUpperCase()};
  return h('span', {style:{background:s.bg,color:s.c,fontSize:10,fontWeight:700,padding:'4px 9px',borderRadius:99,letterSpacing:'.05em',whiteSpace:'nowrap'}}, s.l);
}

/* FIX: Tag default color is blue-info, not lime */
function Tag(props) {
  return h('span', {style:{display:'inline-flex',alignItems:'center',gap:4,
    background:props.bg||C.blueDim, color:props.c||C.blue,
    fontSize:11,fontWeight:600,padding:'4px 10px',borderRadius:99,whiteSpace:'nowrap',letterSpacing:'.01em'}}, props.label);
}

function Card(props) {
  return h('div', {
    onClick: props.onClick && function(e){ haptic('light'); props.onClick(e); },
    className: (props.className||'') + (props.onClick?' pressable':''),
    style: Object.assign({background:C.s1,borderRadius:'var(--rl)',border:'1px solid var(--b)',overflow:'hidden',
      cursor:props.onClick?'pointer':'default'}, props.style||{})},
    props.children);
}

/* FIX: lime ONLY on primary CTA */
function PBtn(props) {
  var dis = props.disabled || props.loading;
  return h('button', {
    disabled: dis,
    'aria-label': props.ariaLabel || props.label,
    onClick: props.onClick && function(e){ haptic(props.danger?'error':'medium'); props.onClick(e); },
    style: Object.assign({
      width:'100%',
      background: dis ? (props.dark?C.s3:'rgba(212,247,42,.28)') : (props.dark?C.s2:C.lime),
      color: dis ? C.t3 : (props.dark?C.t:'#0A0A0A'),
      border: props.dark ? '1px solid var(--b)' : 'none',
      borderRadius:'var(--r)', padding:'16px 22px',
      fontSize:'var(--fs-body)', fontWeight:700,
      display:'flex',alignItems:'center',justifyContent:'center',gap:8,
      letterSpacing:'-.01em', opacity:dis?.45:1,
    }, props.style||{})},
    props.loading && h(Spin), props.label);
}

function GBtn(props) {
  return h('button', {
    onClick: props.onClick && function(e){ haptic('selection'); props.onClick(e); },
    style: Object.assign({width:'100%',background:'transparent',color:props.danger?C.red:C.t2,
      border:'1px solid '+(props.danger?C.redDim:'var(--b)'),
      borderRadius:'var(--r)',padding:'16px 22px',
      fontSize:'var(--fs-caption)',fontWeight:600,letterSpacing:'-.01em'}, props.style||{})},
    props.label);
}

function BackBtn(props) {
  return h('button', {
    onClick:function(){ haptic('selection'); props.onClick(); },
    'aria-label': 'Go back',
    style:{width:40,height:40,borderRadius:'50%',background:C.s2,border:'1px solid var(--b)',
      display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
      marginBottom: props.mb != null ? props.mb : 20}},
    h('svg',{width:16,height:16,viewBox:'0 0 16 16',fill:'none','aria-hidden':'true'},
      h('path',{d:'M10 3L5 8L10 13',stroke:C.t,strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'})));
}

/* FIX: Proper SVG ✕ icon — replaces the bare 'x' character */
function XIcon(props) {
  var sz = props.size || 18;
  return h('svg',{width:sz,height:sz,viewBox:'0 0 24 24',fill:'none','aria-hidden':'true'},
    h('path',{d:'M18 6L6 18M6 6l12 12',stroke:props.col||C.t3,strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}));
}

function Hr(props) { return h('div',{style:{height:'1px',background:'var(--b)',margin:((props&&props.my)||14)+'px 0'}}); }

function SecTitle(props) {
  return h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}},
    h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:700,color:C.t,letterSpacing:'-.02em'}}, props.title),
    props.action && h('button',{onClick:props.onAct,style:{fontSize:'var(--fs-caption)',fontWeight:600,color:C.t3}}, props.action));
}

function Toast(props) {
  if (!props.t) return null;
  return h('div',{style:{position:'fixed',top:0,left:0,right:0,maxWidth:430,margin:'0 auto',zIndex:9999,padding:'14px',pointerEvents:'none'},className:'fu'},
    h('div',{role:'alert','aria-live':'polite',style:{background:C.s3,border:'1px solid var(--b2)',color:C.t,borderRadius:'var(--r)',padding:'13px 16px',fontSize:'var(--fs-caption)',fontWeight:500,display:'flex',alignItems:'center',gap:10,boxShadow:'0 20px 60px rgba(0,0,0,.6)'}},
      h('div',{style:{width:6,height:6,borderRadius:3,background:props.t.err?C.red:C.lime,flexShrink:0}}),
      props.t.msg));
}

function NBadge(props) {
  if (!props.n) return null;
  return h('div',{style:{position:'absolute',top:-3,right:-3,background:C.red,color:C.t,fontSize:9,fontWeight:800,minWidth:16,height:16,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--bg)',padding:'0 3px'}},props.n>9?'9+':props.n);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FIX: ONBOARDING  (first-run, per role)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function Onboarding(props) {
  var _s = useState(0); var step = _s[0]; var setStep = _s[1];
  var slides = ONBOARD[props.role] || ONBOARD.buyer;
  var cur    = slides[step];
  var isLast = step === slides.length - 1;

  return h('div',{style:{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'64px 28px 48px'}},
    h('div',null,
      h('div',{style:{width:44,height:44,borderRadius:12,background:C.lime,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,marginBottom:40}}, '🍋'),
      h('div',{key:step,className:'fu',style:{animation:'onb .32s cubic-bezier(.22,1,.36,1) both'}},
        h('div',{style:{fontSize:44,marginBottom:24}}, cur.icon),
        h('h1',{style:{fontSize:30,fontWeight:800,color:C.t,letterSpacing:'-.04em',lineHeight:1.1,marginBottom:12}}, cur.title),
        h('p',{style:{fontSize:'var(--fs-body)',color:C.t2,lineHeight:1.7}}, cur.body))),
    h('div',null,
      /* Progress dots */
      h('div',{style:{display:'flex',gap:6,justifyContent:'center',marginBottom:32}},
        slides.map(function(_,i){
          return h('div',{key:i,style:{height:6,borderRadius:3,background:i===step?C.lime:C.s3,width:i===step?22:6,transition:'width .25s, background .25s'}});
        })),
      h(PBtn,{label:isLast?'Get started':'Continue',onClick:function(){ haptic('light'); isLast?props.onDone():setStep(function(s){return s+1;}); }}),
      h('button',{onClick:props.onDone,style:{width:'100%',marginTop:12,padding:12,fontSize:'var(--fs-caption)',color:C.t3,background:'none',border:'none'}}, 'Skip')));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   BOTTOM NAV
   FIX: 12px labels (was 10px), min-height 44px tap targets
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function Nav(props) {
  var sc = props.sc, nav = props.nav, role = props.role, nc = props.nc||0;
  var bTabs = [
    {id:'home',   l:'Home',    d:'M4 10.5L12 3L20 10.5V19.5C20 20.6 19.1 21.5 18 21.5H15V16H9V21.5H6C4.9 21.5 4 20.6 4 19.5V10.5Z'},
    {id:'search', l:'Search',  d:'M21 21L15.5 15.5M18 11C18 15 14.4 18.5 10.5 18.5C6.6 18.5 3 15 3 11C3 7 6.6 3.5 10.5 3.5C14.4 3.5 18 7 18 11Z'},
    {id:'book',   l:'Book',    d:'M12 5V19M5 12H19'},
    {id:'alerts', l:'Alerts',  badge:nc, d:'M18 8A6 6 0 0 0 6 8C6 14 3 16 3 16H21C21 16 18 14 18 8ZM13.7 21A2 2 0 0 1 10.3 21'},
    {id:'earn',   l:'Earn',    d:'M12 2V22M17 5H9.5A3.5 3.5 0 0 0 9.5 12H14.5A3.5 3.5 0 0 1 14.5 19H6'},
  ];
  var iTabs = [
    {id:'ijobs',     l:'Jobs',     d:'M9 5H7C5.9 5 5 5.9 5 7V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V7C19 5.9 18.1 5 17 5H15M9 5A2 2 0 0 0 11 7H13A2 2 0 0 0 15 5M9 5A2 2 0 0 1 11 3H13A2 2 0 0 1 15 5'},
    {id:'iearnings', l:'Earnings', d:'M12 2V22M17 5H9.5A3.5 3.5 0 0 0 9.5 12H14.5A3.5 3.5 0 0 1 14.5 19H6'},
    {id:'iprofile',  l:'Profile',  d:'M20 21V19C20 16.8 18.2 15 16 15H8C5.8 15 4 16.8 4 19V21M12 11A4 4 0 1 0 12 3A4 4 0 0 0 12 11Z'},
  ];
  var tabs = role === 'insp' ? iTabs : bTabs;

  return h('nav',{role:'navigation','aria-label':'Main navigation',
    style:{position:'fixed',bottom:0,left:0,right:0,maxWidth:430,margin:'0 auto',
      background:'rgba(10,10,10,.93)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',
      borderTop:'1px solid var(--b)',display:'flex',zIndex:300,
      height:'var(--nav)',paddingBottom:'var(--safe-bot)'}},
    tabs.map(function(t){
      var active = sc === t.id;
      return h('button',{key:t.id,
        onClick:function(){ haptic('selection'); nav(t.id); },
        'aria-label': t.l, 'aria-current': active?'page':undefined,
        style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
          gap:4,border:'none',background:'none',position:'relative',color:active?C.t:C.t3,
          /* FIX: min 44px touch target */
          minHeight:44}},
        h('div',{style:{position:'relative'}},
          h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',
                   strokeWidth:active?2.2:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
            h('path',{d:t.d})),
          t.badge && h(NBadge,{n:t.badge})),
        /* FIX: 12px label (was 10px) */
        h('span',{style:{fontSize:'var(--fs-caption)',fontWeight:active?700:400}}, t.l),
        active && h('div',{style:{position:'absolute',bottom:0,left:'50%',transform:'translateX(-50%)',width:18,height:2,borderRadius:1,background:C.lime}}));
    }));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AUTH SCREEN
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function AuthScreen(props) {
  var _role = useState(null);      var pickedRole = _role[0]; var setPickedRole = _role[1];
  var _mode = useState('signin');  var mode = _mode[0];       var setMode = _mode[1];
  var _email = useState('');       var email = _email[0];     var setEmail = _email[1];
  var _pw = useState('');          var pw = _pw[0];            var setPw = _pw[1];
  var _name = useState('');        var name = _name[0];        var setName = _name[1];
  var _loading = useState(false);  var loading = _loading[0];  var setLoading = _loading[1];
  var _err = useState('');         var err = _err[0];          var setErr = _err[1];

  function submit() {
    setErr(''); setLoading(true);
    var p = mode === 'signup'
      ? Data.signUp({ email: email, password: pw, role: pickedRole === 'insp' ? 'inspector' : 'buyer', name: name || email.split('@')[0] })
      : Data.signIn(email, pw);
    p.then(function(profile){ setLoading(false); props.login(profile); })
     .catch(function(e){ setLoading(false); setErr((e && e.message) || 'Something went wrong.'); });
  }

  var LBL = {fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.08em',display:'block',marginBottom:8};

  if (!pickedRole) return h('div',{style:{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}},
    h('div',{style:{position:'absolute',top:-200,right:-100,width:500,height:500,borderRadius:'50%',background:'radial-gradient(circle,rgba(212,247,42,.05) 0%,transparent 70%)',pointerEvents:'none'}}),
    h('div',{style:{flex:1,display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'0 24px 48px'},className:'fu'},
      h('div',{style:{marginBottom:56}},
        h('div',{style:{display:'flex',alignItems:'center',gap:12,marginBottom:32}},
          h('div',{style:{width:44,height:44,borderRadius:12,background:C.lime,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}, '🍋'),
          h('span',{style:{fontSize:24,fontWeight:800,color:C.t,letterSpacing:'-.04em'}}, 'LemonCheck')),
        h('h1',{style:{fontSize:'var(--fs-display)',fontWeight:900,color:C.t,letterSpacing:'-.05em',lineHeight:1.08,marginBottom:14}}, 'Car inspections,\non demand.'),
        h('p',{style:{fontSize:'var(--fs-body)',color:C.t2,lineHeight:1.6,maxWidth:280}}, 'Certified inspectors at your location. Real reports. Passive income.')),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10}},
        h('button',{onClick:function(){haptic('selection');setPickedRole('buyer');},'aria-label':'Continue as buyer',
          style:{background:C.lime,border:'none',borderRadius:'var(--rx)',padding:'20px 22px',display:'flex',alignItems:'center',gap:14,textAlign:'left'}},
          h('div',{style:{width:44,height:44,borderRadius:12,background:'rgba(0,0,0,.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}, '🚗'),
          h('div',{style:{flex:1}},
            h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:'#0A0A0A',letterSpacing:'-.02em'}}, 'I need an inspection'),
            h('p',{style:{fontSize:'var(--fs-caption)',color:'rgba(0,0,0,.5)',marginTop:3}}, 'Book in 60 seconds. Pay securely.')),
          h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'rgba(0,0,0,.35)',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
            h('path',{d:'M9 18l6-6-6-6'}))),
        h('button',{onClick:function(){haptic('selection');setPickedRole('insp');},'aria-label':'Continue as inspector',
          style:{background:C.s2,border:'1px solid var(--b2)',borderRadius:'var(--rx)',padding:'20px 22px',display:'flex',alignItems:'center',gap:14,textAlign:'left'}},
          h('div',{style:{width:44,height:44,borderRadius:12,background:C.s3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}, '🔧'),
          h('div',{style:{flex:1}},
            h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.02em'}}, "I'm an inspector"),
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:3}}, 'Accept jobs. Earn per inspection + resales.')),
          h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:C.t3,strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
            h('path',{d:'M9 18l6-6-6-6'})))),
      h('p',{style:{textAlign:'center',fontSize:'var(--fs-caption)',color:C.t3,marginTop:24}}, 'Secured by PayFast · 🇿🇦 South Africa')));

  /* Credentials step */
  return h('div',{style:{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',padding:'var(--safe-top) 24px 40px'},className:'fu'},
    h(BackBtn,{onClick:function(){setPickedRole(null);setErr('');}}),
    h('div',{style:{flex:1}},
      h('h1',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em',marginBottom:6}}, mode==='signup'?'Create your account':'Welcome back'),
      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:24}}, pickedRole==='buyer'?'Buyer account':'Inspector account'),
      mode==='signup' && h('div',{style:{marginBottom:12}},
        h('label',{style:LBL},'Full name'),
        h('input',{value:name,onChange:function(e){setName(e.target.value);},placeholder:'Thabo Mokoena','aria-label':'Full name'})),
      h('div',{style:{marginBottom:12}},
        h('label',{style:LBL},'Email'),
        h('input',{value:email,onChange:function(e){setEmail(e.target.value);},type:'email',placeholder:'you@email.com','aria-label':'Email',autoCapitalize:'none'})),
      h('div',{style:{marginBottom:8}},
        h('label',{style:LBL},'Password'),
        h('input',{value:pw,onChange:function(e){setPw(e.target.value);},type:'password',placeholder:'••••••••','aria-label':'Password',onKeyDown:function(e){if(e.key==='Enter')submit();}})),
      err && h('p',{style:{fontSize:'var(--fs-caption)',color:C.red,marginTop:6}}, err)),
    h(PBtn,{label:loading?'Please wait…':(mode==='signup'?'Create account':'Sign in'),onClick:submit,loading:loading,disabled:!email||!pw||(mode==='signup'&&!name)}),
    h('button',{onClick:function(){setMode(mode==='signup'?'signin':'signup');setErr('');},style:{width:'100%',marginTop:14,padding:12,fontSize:'var(--fs-caption)',color:C.t3,background:'none',border:'none'}},
      mode==='signup'?'Already have an account? Sign in':"Don't have an account? Sign up"));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HOME SCREEN
   FIX: safe-top, lime only on earnings number, green tags for pass status
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function HomeScreen(props) {
  var nav = props.nav, user = props.user, notifs = props.notifs;
  var unread = notifs.filter(function(n){ return !n.read; }).length;
  var total  = TXNS.reduce(function(a,t){ return a+t.amount; }, 0);

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 20px'}},
      /* Header */
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}},
        h('div',null,
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,fontWeight:500,marginBottom:4}}, greet()),
          h('h1',{style:{fontSize:28,fontWeight:800,color:C.t,letterSpacing:'-.04em'}}, user.first)),
        h('div',{style:{display:'flex',gap:10,alignItems:'center'}},
          h('button',{onClick:function(){nav('alerts');},'aria-label':(unread||'No')+' unread notifications',
            style:{position:'relative',width:40,height:40,borderRadius:'50%',background:C.s2,border:'1px solid var(--b)',display:'flex',alignItems:'center',justifyContent:'center'}},
            h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:unread>0?C.t:C.t2,strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
              h('path',{d:'M18 8A6 6 0 0 0 6 8C6 14 3 16 3 16H21C21 16 18 14 18 8ZM13.7 21A2 2 0 0 1 10.3 21'})),
            unread > 0 && h(NBadge,{n:unread})),
          h(Av,{label:user.init,size:40}))),

      /* Earnings card — lime on money figures only */
      h('div',{className:'fu pressable',onClick:function(){nav('earn');},
        style:{background:'linear-gradient(135deg,'+C.s2+','+C.s1+')',borderRadius:'var(--rx)',border:'1px solid var(--b)',padding:22,marginBottom:12,cursor:'pointer',position:'relative',overflow:'hidden'}},
        h('div',{style:{position:'absolute',top:-40,right:-40,width:180,height:180,borderRadius:'50%',background:'radial-gradient(circle,rgba(212,247,42,.06) 0%,transparent 70%)'}}),
        h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}},
          h('div',null,
            h('p',{style:{fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}, 'Passive earnings'),
            /* Lime = money ✓ */
            h('p',{style:{fontSize:'var(--fs-display)',fontWeight:900,color:C.lime,letterSpacing:'-.05em',lineHeight:1}}, R(total))),
          h('div',{style:{background:C.limeDim2,borderRadius:10,padding:'9px 12px',border:'1px solid var(--lime-dim)'}},
            h('p',{style:{fontSize:18,marginBottom:2}}, '💰'),
            h('p',{style:{fontSize:11,color:C.lime,fontWeight:700}}, 'View'))),
        h('div',{style:{display:'flex',gap:8}},
          [{v:String(TXNS.length),l:'Resales'},{v:String(Object.keys(VEHICLES).length),l:'Cars tracked'},{v:total>0?('+R'+total):'R0',l:'Total earned'}].map(function(s){
            return h('div',{key:s.l,style:{flex:1,background:'rgba(255,255,255,.04)',borderRadius:10,padding:12,border:'1px solid var(--b)'}},
              h('p',{style:{fontSize:16,fontWeight:800,color:C.lime,letterSpacing:'-.03em'}}, s.v),
              h('p',{style:{fontSize:11,color:C.t3,marginTop:3}}, s.l));
          }))),

      /* Quick actions */
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12},className:'fu d1'},
        [{e:'🔍',t:'Search VIN',s:'Reports & history',id:'search',bg:C.blueDim},
         {e:'⚡',t:'Book now',  s:'Inspector in minutes',id:'book',bg:C.limeDim2}]
        .map(function(a){
          return h('button',{key:a.id,onClick:function(){nav(a.id);},className:'pressable',
            style:{background:C.s1,borderRadius:'var(--rl)',padding:'18px 14px',textAlign:'left',border:'1px solid var(--b)',display:'flex',flexDirection:'column',gap:12}},
            h('div',{style:{width:40,height:40,borderRadius:10,background:a.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}, a.e),
            h('div',null,
              h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:2}}, a.t),
              h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}}, a.s)));
        })),

      /* My cars */
      h('div',{className:'fu d2'},
        h(SecTitle,{title:'My Cars',action:'+ Add',onAct:function(){nav('search');}}),
        h(Card,{onClick:function(){nav('report');},style:{marginBottom:8}},
          h('div',{style:{padding:'16px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('div',{style:{flex:1,marginRight:14}},
              h('p',{style:{fontWeight:700,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.02em',marginBottom:4}}, '2019 Toyota Corolla'),
              h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:10}}, 'ABC123GP · 87 500 km'),
              /* FIX: green tags for pass status, not lime */
              h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                h(Tag,{label:'1 inspection',bg:C.greenDim,c:C.green}),
                h(Tag,{label:'Score 82',    bg:C.greenDim,c:C.green}))),
            h(Ring,{score:82,size:66}))))),
    h(Nav,{sc:'home',nav:nav,role:'buyer',nc:unread}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SEARCH SCREEN
   FIX: XIcon, skeleton loading, safe-top, aria roles
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SearchScreen(props) {
  var nav = props.nav, setCarData = props.setCarData, showToast = props.showToast;
  var _v = useState('');    var vin     = _v[0];     var setVin     = _v[1];
  var _r = useState(null);  var result  = _r[0];     var setResult  = _r[1];
  var _hi= useState(null);  var hist    = _hi[0];    var setHist    = _hi[1];
  var _s = useState(false); var searched= _s[0];     var setSearched= _s[1];
  var _l = useState(false); var loading = _l[0];     var setLoading = _l[1];
  var _hl= useState(false); var hload   = _hl[0];    var setHload   = _hl[1];
  var _t = useState('report'); var tab  = _t[0];     var setTab     = _t[1];

  function doSearch(v) {
    var q = (v || vin).trim().toUpperCase();
    if (!q) return;
    setVin(q); setLoading(true); setResult(null); setHist(null); setSearched(false); setTab('report');
    Data.fetchVehicleWithLatestInspection(q).then(function(row){
      if (!row) { setResult(null); setSearched(true); setLoading(false); return; }
      var adapted = Object.assign({}, row.vehicle, {
        inspections: row.inspection ? [{
          id: row.inspection.id,
          date: new Date(row.inspection.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}),
          inspector: row.inspection.inspector_name,
          location: '',
          score: row.inspection.score,
          fullPrice: row.inspection.full_price,
          reportPrice: row.inspection.report_price,
          payer: 'the original buyer',
          payerCut: row.inspection.payer_cut,
          findings: (row.inspection.findings||[]).map(function(f){ return {area:f.area, s:f.status, note:f.note}; }),
          verdict: row.inspection.verdict,
        }] : [],
      });
      VEHICLES[q] = adapted;
      setResult(adapted); setSearched(true); setLoading(false);
    }).catch(function(err){ console.error(err); setResult(null); setSearched(true); setLoading(false); showToast('Search failed. Try again.', true); });
  }
  function runHist() {
    setHload(true);
    Data.fetchVehicleHistory(vin).then(function(row){
      if (!row.history) { setHist({found:false}); setHload(false); setTab('history'); return; }
      var adapted = {
        found: true, src: row.history.source, owners: row.history.owners,
        reg: row.history.first_registered, province: row.history.province,
        stolen: row.history.stolen, taxi: row.history.taxi_history,
        cc: row.history.colour_changes, finance: row.history.outstanding_finance,
        fb: row.history.finance_house || '',
        accidents: row.accidents.map(function(a){ return {date:new Date(a.date).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}), sev:a.severity, desc:a.description}; }),
        odo: row.odometer.map(function(o){ return {date:new Date(o.date).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'}), km:o.km}; }),
      };
      SA_HIST[vin] = adapted;
      setHist(adapted); setHload(false); setTab('history');
    }).catch(function(err){ console.error(err); setHist({found:false}); setHload(false); setTab('history'); showToast('History lookup failed.', true); });
  }

  var insp = result && result.inspections[0];

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    /* Header */
    h('div',{style:{padding:'var(--safe-top) 20px 0'}},
      h('h1',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em',marginBottom:4}}, 'Search VIN'),
      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:18}}, 'Inspection reports & SA vehicle history'),

      /* Search bar */
      h('div',{style:{display:'flex',gap:8,marginBottom:10}},
        h('div',{style:{flex:1,position:'relative'}},
          h('input',{value:vin,
            onChange:function(e){ setVin(e.target.value.toUpperCase()); },
            placeholder:'Enter VIN · e.g. ABC123GP',maxLength:17,
            'aria-label':'Vehicle identification number',
            onKeyDown:function(e){ if(e.key==='Enter') doSearch(); },
            style:{fontWeight:600,letterSpacing:'.04em',paddingRight:46}}),
          /* FIX: SVG ✕ icon, not the letter 'x' */
          vin && h('button',{
            onClick:function(){ setVin(''); setSearched(false); setResult(null); setHist(null); },
            'aria-label':'Clear search',
            style:{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',padding:4,display:'flex',alignItems:'center',lineHeight:0}},
            h(XIcon,{size:18,col:C.t3}))),
        h('button',{onClick:function(){doSearch();},disabled:loading||!vin.trim(),'aria-label':'Search VIN',
          style:{background:C.lime,color:'#0A0A0A',border:'none',borderRadius:'var(--r)',padding:'0 20px',fontSize:'var(--fs-caption)',fontWeight:700,opacity:loading||!vin.trim()?.4:1,display:'flex',alignItems:'center',gap:6,flexShrink:0}},
          loading ? h(Spin,{size:16}) : 'Search')),

      /* Quick-try chips */
      h('div',{style:{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}},
        h('span',{style:{fontSize:'var(--fs-caption)',color:C.t3}}, 'Try:'),
        ['ABC123GP','XYZ789WC','DEF456GP'].map(function(v){
          return h('button',{key:v,onClick:function(){doSearch(v);},
            style:{background:C.s2,color:C.t2,fontSize:'var(--fs-caption)',fontWeight:600,padding:'4px 10px',borderRadius:99,border:'1px solid var(--b)'}}, v);
        }))),

    /* FIX: Skeleton while loading, not just a spinner */
    loading && h('div',{style:{padding:'14px 20px'}}, h(SkeletonVehicleCard)),

    /* Results */
    searched && !loading && h('div',{style:{padding:'14px 20px 0'},className:'fu'},
      result
        ? h('div',null,
            /* Tabs */
            h('div',{style:{display:'flex',background:C.s2,borderRadius:10,padding:3,marginBottom:14,border:'1px solid var(--b)'},role:'tablist'},
              [{id:'report',l:'Inspection'},{id:'history',l:'SA History'}].map(function(t){
                return h('button',{key:t.id,onClick:function(){setTab(t.id);},
                  role:'tab','aria-selected':tab===t.id,
                  style:{flex:1,background:tab===t.id?C.s3:'none',border:tab===t.id?'1px solid var(--b2)':'1px solid transparent',borderRadius:8,padding:'9px 0',fontSize:'var(--fs-caption)',fontWeight:tab===t.id?700:500,color:tab===t.id?C.t:C.t3,transition:'all .15s'}}, t.l);
              })),

            /* Inspection tab */
            tab === 'report' && h('div',{className:'fi',role:'tabpanel'},
              h(Card,{style:{marginBottom:10}},
                h('div',{style:{padding:'18px'}},
                  h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}},
                    h('div',{style:{flex:1,marginRight:12}},
                      h('p',{style:{fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.07em',marginBottom:6}}, 'Vehicle'),
                      h('p',{style:{fontSize:20,fontWeight:800,color:C.t,letterSpacing:'-.03em',marginBottom:4}}, result.year+' '+result.make+' '+result.model),
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:10}}, result.vin+' · '+result.colour+' · '+result.mileage.toLocaleString()+' km'),
                      h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                        h(Tag,{label:result.engine,      bg:C.s3,c:C.t2}),
                        h(Tag,{label:result.transmission,bg:C.s3,c:C.t2}))),
                    insp && h(Ring,{score:insp.score,size:70,showLabel:true})),
                  insp && h('div',null,
                    h(Hr,{my:12}),
                    h('div',{style:{display:'flex',gap:8,alignItems:'center'}},
                      h(Tag,{label:'Inspected '+insp.date,bg:C.greenDim,c:C.green}),
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}}, 'by '+insp.inspector)))),
                insp && h('div',{style:{padding:'12px 18px',background:C.limeDim2,borderTop:'1px solid rgba(212,247,42,.08)'}},
                  h('p',{style:{fontSize:'var(--fs-caption)',color:'rgba(212,247,42,.8)',lineHeight:1.6}},
                    '🍋 Buy for ', h('strong',{style:{color:C.lime}}, R(insp.reportPrice)),
                    ' instead of '+R(insp.fullPrice)+'. '+insp.payer+' earns '+R(insp.payerCut)+' every resale.'))),
              insp
                ? h(PBtn,{label:'View full report',onClick:function(){ setCarData(result); nav('report'); }})
                : h('div',null,
                    h('div',{style:{background:C.blueDim,border:'1px solid rgba(10,132,255,.15)',borderRadius:'var(--r)',padding:'14px',marginBottom:10}},
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.blue,lineHeight:1.6}}, 'No inspections yet. Be the first and earn every time your report is resold.')),
                    h(PBtn,{label:'Book inspection now',onClick:function(){nav('book');}}))),

            /* History tab */
            tab === 'history' && h('div',{className:'fi',role:'tabpanel'},
              /* FIX: skeleton while fetching history */
              hload && h(SkeletonHistoryCard),
              !hist && !hload && h(Card,{style:{overflow:'hidden'}},
                h('div',{style:{padding:'24px 18px',textAlign:'center'}},
                  /* FIX: SVG illustration, not emoji */
                  h('svg',{width:56,height:56,viewBox:'0 0 56 56',fill:'none',style:{margin:'0 auto 16px',display:'block'}},
                    h('rect',{x:4,y:4,width:48,height:48,rx:12,fill:C.blueDim,stroke:C.blue,strokeWidth:.75}),
                    h('path',{d:'M18 28h20M28 18v20',stroke:C.blue,strokeWidth:2,strokeLinecap:'round',opacity:.4}),
                    h('circle',{cx:28,cy:28,r:8,stroke:C.blue,strokeWidth:1.5,fill:'none'}),
                    h('path',{d:'M34 34l6 6',stroke:C.blue,strokeWidth:2,strokeLinecap:'round'})),
                  h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.03em',marginBottom:6}}, 'SA Vehicle History'),
                  h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,lineHeight:1.65,marginBottom:20}}, 'Records from eNaTIS, TransUnion AutoInfo and SAPS.'),
                  h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:20,textAlign:'left'}},
                    ['Accident history','Finance & liens','Owner changes','Roadworthy history','SAPS stolen check','Odometer verify'].map(function(f){
                      return h('div',{key:f,style:{background:C.s2,borderRadius:8,padding:'10px',display:'flex',alignItems:'center',gap:7,border:'1px solid var(--b)'}},
                        h('div',{style:{width:6,height:6,borderRadius:3,background:C.green,flexShrink:0}}),
                        h('p',{style:{fontSize:'var(--fs-caption)',color:C.t2}}, f));
                    })),
                  h(PBtn,{label:'Run history check  ·  R249',onClick:runHist})),
                h('div',{style:{padding:'10px 18px',background:C.s2,borderTop:'1px solid var(--b)'}},
                  h('p',{style:{fontSize:11,color:C.t3,textAlign:'center'}}, 'Data from eNaTIS, TransUnion & SAPS. Verify independently.'))),

              hist && hist.found && h('div',null,
                /* Flags */
                (hist.accidents.length>0 || hist.finance || hist.cc>0) &&
                  h('div',{style:{background:C.redDim,border:'1px solid rgba(255,69,58,.18)',borderRadius:'var(--r)',padding:'14px',marginBottom:10}},
                    h('p',{style:{fontWeight:800,fontSize:'var(--fs-caption)',color:C.red,marginBottom:6}}, 'Flags detected'),
                    hist.accidents.length>0 && h('p',{style:{fontSize:'var(--fs-caption)',color:C.red,marginBottom:3}}, '• '+hist.accidents.length+' accident'+(hist.accidents.length>1?'s':'')+' on record'),
                    hist.finance && h('p',{style:{fontSize:'var(--fs-caption)',color:C.red,marginBottom:3}}, '• Outstanding finance — '+hist.fb),
                    hist.cc>0 && h('p',{style:{fontSize:'var(--fs-caption)',color:C.red}}, '• '+hist.cc+' colour change(s)')),
                h(Card,{style:{marginBottom:10}},
                  h('div',{style:{padding:'18px'}},
                    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}},
                      h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em'}}, 'Overview'),
                      h(Tag,{label:hist.src,bg:C.blueDim,c:C.blue})),
                    h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}},
                      [{l:'First registered',v:hist.reg},{l:'Province',v:hist.province},{l:'Owner changes',v:String(hist.owners)},{l:'Colour changes',v:hist.cc===0?'None':String(hist.cc)},{l:'Stolen',v:hist.stolen?'YES':'Clear'},{l:'Taxi history',v:hist.taxi?'Yes':'None'}]
                      .map(function(x){
                        return h('div',{key:x.l,style:{background:C.s2,borderRadius:8,padding:'10px',border:'1px solid var(--b)'}},
                          h('p',{style:{fontSize:10,color:C.t3,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}, x.l),
                          h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:(x.l==='Stolen'&&hist.stolen)?C.red:C.t}}, x.v));
                      }))),
                  h('div',{style:{padding:'18px',borderTop:'1px solid var(--b)'}},
                    h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,marginBottom:10,letterSpacing:'-.01em'}}, 'Accidents'),
                    hist.accidents.length===0
                      ? h('p',{style:{fontSize:'var(--fs-caption)',color:C.green,fontWeight:600}}, 'None recorded')
                      : hist.accidents.map(function(a,i){
                          return h('div',{key:i,style:{background:a.sev==='Major'?C.redDim:C.amberDim,borderRadius:10,padding:'12px',marginBottom:i<hist.accidents.length-1?8:0,border:'1px solid '+(a.sev==='Major'?'rgba(255,69,58,.2)':'rgba(255,159,10,.2)')}},
                            h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:4}},
                              h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:a.sev==='Major'?C.red:C.amber}}, a.date),
                              h('span',{style:{background:a.sev==='Major'?C.red:C.amber,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:99}}, a.sev.toUpperCase())),
                            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t2,lineHeight:1.5}}, a.desc));
                        })),
                  hist.finance && h('div',{style:{padding:'18px',borderTop:'1px solid var(--b)'}},
                    h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,marginBottom:8}}, 'Finance'),
                    h('div',{style:{background:C.redDim,borderRadius:10,padding:'12px',border:'1px solid rgba(255,69,58,.15)'}},
                      h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.red,marginBottom:3}}, 'Outstanding finance'),
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t2}}, 'Lender: '+hist.fb))),
                  hist.odo.length>0 && h('div',{style:{padding:'18px',borderTop:'1px solid var(--b)'}},
                    h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,marginBottom:10}}, 'Odometer history'),
                    hist.odo.map(function(o,i){
                      return h('div',{key:i,style:{display:'flex',justifyContent:'space-between',marginBottom:i<hist.odo.length-1?8:0}},
                        h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}}, o.date),
                        h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t}}, o.km.toLocaleString()+' km'));
                    })))),

              hist && !hist.found && h('div',{style:{textAlign:'center',padding:'44px 0'},className:'fi'},
                h('svg',{width:56,height:56,viewBox:'0 0 56 56',fill:'none',style:{margin:'0 auto 12px',display:'block'}},
                  h('rect',{x:4,y:4,width:48,height:48,rx:12,fill:C.s2,stroke:'var(--b)',strokeWidth:.75}),
                  h('path',{d:'M20 20l16 16M36 20L20 36',stroke:C.t3,strokeWidth:2,strokeLinecap:'round'})),
                h('p',{style:{fontWeight:700,fontSize:'var(--fs-headline)',color:C.t,marginBottom:6}}, 'No records found'),
                h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,lineHeight:1.6}}, 'This VIN has no history in eNaTIS or TransUnion.'))))

        /* FIX: Better empty state for no VIN match */
        : h('div',{style:{textAlign:'center',padding:'44px 0'},className:'fi'},
            h('svg',{width:60,height:60,viewBox:'0 0 60 60',fill:'none',style:{margin:'0 auto 16px',display:'block'}},
              h('rect',{x:4,y:4,width:52,height:52,rx:14,fill:C.s2,stroke:'var(--b)',strokeWidth:.75}),
              h('circle',{cx:28,cy:27,r:10,stroke:C.t3,strokeWidth:1.5,fill:'none'}),
              h('path',{d:'M35 34l7 7',stroke:C.t3,strokeWidth:2,strokeLinecap:'round'}),
              h('path',{d:'M24 27h8M28 23v8',stroke:C.t3,strokeWidth:1.5,strokeLinecap:'round',opacity:.4})),
            h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.03em',marginBottom:6}}, 'No inspection found'),
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,lineHeight:1.6,marginBottom:22,maxWidth:220,margin:'0 auto 22px'}}, 'Be the first to inspect this car — you\'ll earn R180 every time another buyer purchases your report.'),
            h(PBtn,{label:'Book an inspection',onClick:function(){nav('book');}}))),
    h(Nav,{sc:'search',nav:nav,role:'buyer'}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   APP SHELL  (routing + state)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   BOOK SCREEN
   FIX: collapsed confirm screen, map, skeleton inspector list,
        filter chips, lime only on pay CTA, safe-top
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function BookScreen(props) {
  var nav = props.nav, showToast = props.showToast;
  var _step = useState('input'); var step = _step[0]; var setStep = _step[1];
  var _vin  = useState('');     var vin  = _vin[0];  var setVin  = _vin[1];
  var _make = useState('');     var make = _make[0]; var setMake = _make[1];
  var _model= useState('');     var model= _model[0];var setModel= _model[1];
  var _year = useState('');     var year = _year[0]; var setYear = _year[1];
  var _loc  = useState('');     var loc  = _loc[0];  var setLoc  = _loc[1];
  var _notes= useState('');     var notes= _notes[0];var setNotes= _notes[1];
  var _insp = useState(null);   var inspector=_insp[0]; var setInspector=_insp[1];
  var _sort = useState('eta');  var sort = _sort[0]; var setSort = _sort[1];
  var _choosing = useState(false); var choosing = _choosing[0]; var setChoosing = _choosing[1];
  var _card = useState('saved');var card = _card[0]; var setCard = _card[1];
  var _load = useState(false);  var loading=_load[0];var setLoading=_load[1];
  var _secs = useState(0);      var secs = _secs[0]; var setSecs = _secs[1];
  var _bkid = useState(null);   var bookingId=_bkid[0]; var setBookingId=_bkid[1];

  useEffect(function(){
    if (step!=='tracking'||!inspector) return;
    setSecs(inspector.eta*60);
    var iv = setInterval(function(){
      setSecs(function(p){ if(p<=1){clearInterval(iv);return 0;} return p-1; });
    },1000);
    return function(){ clearInterval(iv); };
  },[step]);

  var ready = vin.trim()&&make&&model&&year&&loc.trim();
  var LBL = {fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.08em',display:'block',marginBottom:8};

  /* FIX: sort inspectors */
  var online = INSPECTORS.filter(function(i){ return i.online; });
  var sorted = online.slice().sort(function(a,b){
    return sort==='price'?a.price-b.price : sort==='rating'?b.rating-a.rating : a.eta-b.eta;
  });

  function confirm() {
    setLoading(true);
    Data.createBooking({
      buyerId: props.user.id, vin: vin, make: make, model: model, year: Number(year),
      location: loc, notes: notes, inspectorId: inspector.id, inspectionFee: inspector.price,
    }).then(function(booking){
      setBookingId(booking.id);
      setLoading(false); setStep('tracking'); showToast(inspector.name+' is on the way'); haptic('success');
    }).catch(function(err){
      console.error(err); setLoading(false); showToast('Booking failed. Try again.', true);
    });
  }

  /* ── INPUT ── */
  if (step==='input') return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:40}},
    h('div',{style:{padding:'var(--safe-top) 20px 0'},className:'fu'},
      h('div',{style:{display:'flex',alignItems:'center',gap:14,marginBottom:24}},
        h(BackBtn,{onClick:function(){nav('home');},mb:0}),
        h('h1',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em'}},'Book inspection')),
      h('div',{style:{marginBottom:12}},h('label',{style:LBL},'Where is the car?'),
        h('input',{value:loc,onChange:function(e){setLoc(e.target.value);},placeholder:'Dealer, address or any location…','aria-label':'Location'})),
      h('div',{style:{marginBottom:12}},h('label',{style:LBL},'VIN number'),
        h('input',{value:vin,onChange:function(e){setVin(e.target.value.toUpperCase());},placeholder:'e.g. ABC123GP',maxLength:17,'aria-label':'VIN',style:{fontWeight:600,letterSpacing:'.04em'}})),
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}},
        h('div',null,h('label',{style:LBL},'Make'),
          h('select',{value:make,onChange:function(e){setMake(e.target.value);},'aria-label':'Make'},
            h('option',{value:'',disabled:true},'Select'),
            MAKES.map(function(m){ return h('option',{key:m,value:m},m); }))),
        h('div',null,h('label',{style:LBL},'Model'),
          h('input',{value:model,onChange:function(e){setModel(e.target.value);},placeholder:'e.g. Corolla','aria-label':'Model'}))),
      h('div',{style:{marginBottom:12}},h('label',{style:LBL},'Year'),
        h('input',{value:year,onChange:function(e){setYear(e.target.value);},placeholder:'2021',type:'number',min:1995,max:2026,'aria-label':'Year'})),
      h('div',{style:{marginBottom:24}},h('label',{style:LBL},'Notes for inspector'),
        h('textarea',{value:notes,onChange:function(e){setNotes(e.target.value);},placeholder:'Warning lights, concerns, anything the inspector should know…',rows:3,'aria-label':'Notes'})),
      h(PBtn,{label:'Find nearby inspectors',onClick:function(){
        setChoosing(true);
        setTimeout(function(){ setChoosing(false); setStep('choose'); }, 900);
      },loading:choosing,disabled:!ready||choosing})));

  /* ── CHOOSE INSPECTOR ── */
  if (step==='choose') return h('div',{style:{minHeight:'100vh',background:C.bg}},
    h(MapView,{height:'48vh'},
      /* Inspector pins */
      sorted.map(function(insp,i){
        var pos=[{top:'24%',left:'34%'},{top:'50%',left:'62%'},{top:'35%',left:'72%'}];
        var pp=pos[i]||{top:'30%',left:'50%'};
        return h('div',{key:insp.id,style:{position:'absolute',top:pp.top,left:pp.left}},
          h('div',{style:{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',gap:5}},
            h('div',{style:{position:'absolute',width:36,height:36,borderRadius:'50%',background:C.limeDim,animation:'rp 2s '+(i*.6)+'s infinite'}}),
            h('div',{style:{width:36,height:36,borderRadius:'50%',background:C.lime,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,color:'#0A0A0A',boxShadow:'0 4px 16px rgba(212,247,42,.4)',position:'relative',zIndex:1}},insp.init[0]),
            h('div',{style:{background:'rgba(0,0,0,.72)',borderRadius:99,padding:'2px 7px',backdropFilter:'blur(8px)'}},
              h('p',{style:{fontSize:10,fontWeight:700,color:C.t,whiteSpace:'nowrap'}},insp.eta+' min'))));
      }),
      /* User dot */
      h('div',{style:{position:'absolute',top:'52%',left:'46%',transform:'translate(-50%,-50%)'}},
        h('div',{style:{position:'relative'}},
          h('div',{style:{position:'absolute',inset:-6,borderRadius:'50%',background:'rgba(10,132,255,.2)',animation:'rp 2s .4s infinite'}}),
          h('div',{style:{width:14,height:14,borderRadius:'50%',background:C.blue,border:'3px solid '+C.t,boxShadow:'0 0 0 3px rgba(10,132,255,.3)',position:'relative',zIndex:1}}))),
      /* Location pill */
      h('div',{style:{position:'absolute',bottom:14,left:14,right:14}},
        h('div',{style:{background:'rgba(10,10,10,.82)',backdropFilter:'blur(16px)',borderRadius:10,padding:'9px 14px',border:'1px solid var(--b)',display:'flex',alignItems:'center',gap:8}},
          h('div',{style:{width:7,height:7,borderRadius:4,background:C.lime,flexShrink:0}}),
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},loc)))),

    h('div',{style:{background:C.bg,borderRadius:'22px 22px 0 0',marginTop:-14,paddingBottom:32,boxShadow:'0 -1px 0 rgba(255,255,255,.06)'},className:'su'},
      h('div',{style:{width:34,height:4,borderRadius:2,background:C.s3,margin:'12px auto 0'}}),
      h('div',{style:{padding:'14px 18px 10px',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        h('div',null,
          h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.03em'}},'Nearby inspectors'),
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},year+' '+make+' '+model)),
        h('button',{onClick:function(){setStep('input');},style:{fontSize:'var(--fs-caption)',fontWeight:600,color:C.t3}},'Edit')),

      /* FIX: sort filter chips */
      h('div',{style:{display:'flex',gap:8,padding:'0 18px 12px',overflowX:'auto'}},
        [{id:'eta',l:'Nearest'},{id:'rating',l:'Top rated'},{id:'price',l:'Lowest price'}].map(function(s){
          var active = sort===s.id;
          return h('button',{key:s.id,onClick:function(){setSort(s.id);},
            style:{background:active?C.limeDim:C.s2,color:active?C.lime:C.t3,border:'1px solid '+(active?'rgba(212,247,42,.25)':'var(--b)'),
              borderRadius:99,padding:'6px 14px',fontSize:'var(--fs-caption)',fontWeight:600,whiteSpace:'nowrap',flexShrink:0,
              transition:'all .15s'}}, s.l);
        })),

      h('div',{style:{padding:'0 14px',display:'flex',flexDirection:'column',gap:8}},
        sorted.map(function(insp){
          return h('button',{key:insp.id,onClick:function(){setInspector(insp);setStep('confirm');},className:'pressable',
            style:{width:'100%',background:C.s1,border:'1px solid var(--b)',borderRadius:'var(--rl)',padding:'14px',display:'flex',alignItems:'center',gap:12,textAlign:'left'}},
            h(Av,{label:insp.init,size:44}),
            h('div',{style:{flex:1,minWidth:0}},
              h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}},
                h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.02em'}},insp.name),
                /* Lime = price CTA */
                h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.lime,letterSpacing:'-.03em',flexShrink:0}},R(insp.price))),
              h('div',{style:{display:'flex',alignItems:'center',gap:6,marginBottom:6}},
                h('span',{style:{color:'#F59E0B',fontSize:12}},'★'),
                h('span',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t}},insp.rating.toFixed(2)),
                h('span',{style:{fontSize:'var(--fs-caption)',color:C.t3}},' · '+insp.jobs+' jobs')),
              h('div',{style:{display:'flex',gap:5,flexWrap:'wrap'}},
                h(Tag,{label:'ETA '+insp.eta+' min',bg:C.greenDim,c:C.green}),
                insp.top&&h(Tag,{label:'Top rated',bg:C.limeDim,c:C.lime}),
                h(Tag,{label:insp.spec,bg:C.s3,c:C.t3}))));
        }),
        /* Offline inspector — greyed, separate */
        h(Hr,{my:8}),
        INSPECTORS.filter(function(i){return !i.online;}).map(function(insp){
          return h('div',{key:insp.id,style:{background:C.s1,border:'1px solid var(--b)',borderRadius:'var(--rl)',padding:'14px',display:'flex',alignItems:'center',gap:12,opacity:.45}},
            h(Av,{label:insp.init,size:44}),
            h('div',{style:{flex:1}},
              h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t}},insp.name),
              h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:3}},'Currently offline'),
              h('div',{style:{marginTop:8}},h(Tag,{label:'Notify when online',bg:C.s3,c:C.t3}))));
        }))));

  /* ── CONFIRM (collapsed — was 5 cards, now 2) ── */
  if (step==='confirm') return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:40},className:'fu'},
    h('div',{style:{padding:'var(--safe-top) 20px 0'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:14,marginBottom:24}},
        h(BackBtn,{onClick:function(){setStep('choose');},mb:0}),
        h('h1',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em'}},'Confirm booking')),

      /* Inspector hero row */
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px',display:'flex',alignItems:'center',gap:14}},
          h(Av,{label:inspector.init,size:52}),
          h('div',{style:{flex:1}},
            h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.02em',marginBottom:4}},inspector.name),
            h('div',{style:{display:'flex',alignItems:'center',gap:6,marginBottom:8}},
              h('span',{style:{color:'#F59E0B',fontSize:13}},'★'),
              h('span',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t}},inspector.rating.toFixed(2)),
              h('span',{style:{fontSize:'var(--fs-caption)',color:C.t3}},' · '+inspector.jobs+' inspections')),
            h('div',{style:{display:'flex',gap:5}},
              h(Tag,{label:inspector.cert,bg:C.s3,c:C.t2}),
              h(Tag,{label:'ETA '+inspector.eta+' min',bg:C.greenDim,c:C.green}))))),

      /* Summary + price — collapsed into one card */
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:4}},year+' '+make+' '+model),
          h('p',{style:{fontWeight:600,fontSize:'var(--fs-body)',color:C.t,marginBottom:2}},loc),
          notes&&h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:4,fontStyle:'italic'}},'Note: '+notes),
          h(Hr,{my:12}),
          /* Price breakdown */
          [{l:'Inspection fee',v:R(inspector.price)},{l:'Travel',v:R(100)},{l:'Platform',v:R(75)}].map(function(row){
            return h('div',{key:row.l,style:{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-caption)',marginBottom:7}},
              h('p',{style:{color:C.t3}},row.l),h('p',{style:{color:C.t,fontWeight:600}},row.v));
          }),
          h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-headline)',fontWeight:800,color:C.t,paddingTop:10,borderTop:'1px solid var(--b)',marginTop:7}},
            h('span',null,'Total'),h('span',{style:{color:C.lime}},R(inspector.price+175))))),

      /* Payment */
      h(Card,{style:{marginBottom:12}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:12}},'Payment'),
          ['saved','new'].map(function(opt){
            var sel=card===opt;
            return h('button',{key:opt,onClick:function(){setCard(opt);},
              style:{width:'100%',background:sel?C.limeDim2:C.s2,border:'1px solid '+(sel?'rgba(212,247,42,.25)':'var(--b)'),borderRadius:10,padding:'13px 14px',textAlign:'left',marginBottom:7,display:'flex',alignItems:'center',gap:10}},
              h('div',{style:{width:18,height:18,borderRadius:9,border:'2px solid '+(sel?C.lime:'rgba(255,255,255,.2)'),display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}},
                sel&&h('div',{style:{width:9,height:9,borderRadius:5,background:C.lime}})),
              opt==='saved'
                ?h('div',null,h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t}},'Visa ending 4242'),h('p',{style:{fontSize:11,color:C.t3,marginTop:1}},'Expires 12/27'))
                :h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:600,color:C.t2}},'Add card via PayFast'));
          }))),

      /* Passive income note — shown after payment, not blocking it */
      h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.08)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:16}},
        h('p',{style:{fontSize:'var(--fs-caption)',color:C.lime,lineHeight:1.6}},'🍋  Your report goes live after the inspection. Earn R180 every time another buyer purchases it.')),
      h(PBtn,{label:loading?'Confirming…':'Pay '+R(inspector.price+175)+' via PayFast',onClick:confirm,loading:loading})));

  /* ── TRACKING ── */
  if (step==='tracking') {
    var mins=Math.floor(secs/60), ss2=secs%60, arrived=secs===0;
    return h('div',{style:{minHeight:'100vh',background:C.bg}},
      h(MapView,{height:'56vh'},
        /* Inspector moving dot */
        h('div',{style:{position:'absolute',top:'28%',left:'36%'}},
          h('div',{style:{position:'relative'}},
            h('div',{style:{position:'absolute',inset:-12,borderRadius:'50%',background:C.limeDim,animation:'rp 2s infinite'}}),
            h('div',{style:{width:50,height:50,borderRadius:'50%',background:C.lime,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:800,color:'#0A0A0A',boxShadow:'0 6px 24px rgba(212,247,42,.5)',position:'relative',zIndex:1}},inspector.init[0]))),
        h('div',{style:{position:'absolute',top:'52%',left:'50%',transform:'translate(-50%,-50%)'}},
          h('div',{style:{width:14,height:14,borderRadius:'50%',background:C.blue,border:'3px solid '+C.t,boxShadow:'0 0 0 3px rgba(10,132,255,.3)'}})),
        /* ETA badge */
        h('div',{style:{position:'absolute',top:18,left:'50%',transform:'translateX(-50%)'},role:'timer','aria-live':'polite'},
          arrived
            ?h('div',{style:{background:C.green,color:C.t,borderRadius:99,padding:'9px 20px',fontWeight:800,fontSize:'var(--fs-body)',boxShadow:'0 4px 20px rgba(50,215,75,.5)'}},'Inspector arrived!')
            :h('div',{style:{background:'rgba(0,0,0,.75)',backdropFilter:'blur(16px)',color:C.t,borderRadius:99,padding:'9px 20px',fontWeight:800,fontSize:'var(--fs-headline)',border:'1px solid var(--b)'}},
                mins+'m '+String(ss2).padStart(2,'0')+'s'))),
      h('div',{style:{background:C.bg,borderRadius:'22px 22px 0 0',marginTop:-14},className:'su'},
        h('div',{style:{width:34,height:4,borderRadius:2,background:C.s3,margin:'12px auto 0'}}),
        arrived
          ? h('div',{style:{padding:'24px 20px 40px',textAlign:'center'}},
              h('div',{style:{fontSize:48,marginBottom:14}},'🎉'),
              h('p',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em',marginBottom:8}},'Inspector arrived'),
              h('p',{style:{fontSize:'var(--fs-body)',color:C.t3,marginBottom:24}},'Your inspection is underway.'),
              h(PBtn,{label:'Back to home',onClick:function(){nav('home');}}))
          : h('div',{style:{padding:'18px 18px 36px'}},
              h('div',{style:{display:'flex',alignItems:'center',gap:12,marginBottom:18}},
                h(Av,{label:inspector.init,size:50}),
                h('div',{style:{flex:1}},
                  h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.02em',marginBottom:3}},inspector.name),
                  h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'En route to '+loc),
                  h('div',{style:{display:'flex',gap:5,marginTop:8}},
                    h(Tag,{label:'★ '+inspector.rating.toFixed(2),bg:C.s3,c:C.t2}),
                    h(Tag,{label:inspector.cert,bg:C.s3,c:C.t2})))),
              h('div',{style:{background:C.s1,borderRadius:'var(--r)',padding:'14px',marginBottom:18,border:'1px solid var(--b)'}},
                h('p',{style:{fontSize:10,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:10}},'Will cover'),
                h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}},
                  ['Engine','Transmission','Brakes','Tyres','Body & Paint','Interior','Electricals','Suspension'].map(function(a){
                    return h('div',{key:a,style:{display:'flex',alignItems:'center',gap:7}},
                      h('div',{style:{width:6,height:6,borderRadius:3,background:C.green,flexShrink:0}}),
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t2}},a));
                  }))),
              h('div',{style:{display:'flex',gap:8}},
                h('button',{onClick:function(){setStep('input');},style:{flex:'0 0 95px',background:C.redDim,color:C.red,border:'1px solid rgba(255,69,58,.2)',borderRadius:'var(--r)',padding:'16px',fontSize:'var(--fs-caption)',fontWeight:700}},'Cancel'),
                h('button',{style:{flex:1,background:C.s2,color:C.t,border:'1px solid var(--b)',borderRadius:'var(--r)',padding:'16px',fontSize:'var(--fs-caption)',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',gap:7}},
                  h('svg',{width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
                    h('path',{d:'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.15 14 19.79 19.79 0 011.08 5.42 2 2 0 013.07 3h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 10a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 17z'})),
                  'Call '+inspector.name.split(' ')[0])))));
  }

  /* Done state */
  if (bookingId) { Data.markBookingPaid(bookingId).catch(function(e){ console.error(e); }); }
  return h('div',{style:{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center'},className:'fu'},
    h('div',{style:{width:80,height:80,borderRadius:40,background:C.greenDim,display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,marginBottom:24,border:'1px solid rgba(50,215,75,.2)'}},'✅'),
    h('p',{style:{fontSize:26,fontWeight:900,color:C.t,letterSpacing:'-.05em',marginBottom:10}},'Inspection complete'),
    h('p',{style:{fontSize:'var(--fs-body)',color:C.t3,lineHeight:1.7,marginBottom:24,maxWidth:260}},'Your report will be ready within 30 minutes.'),
    h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.1)',borderRadius:'var(--rl)',padding:'18px',marginBottom:24,textAlign:'left',width:'100%'}},
      h('p',{style:{fontSize:'var(--fs-body)',color:C.lime,lineHeight:1.65}},'🍋  Your report is live. You\'ll earn R180 every time another buyer purchases it.')),
    h(PBtn,{label:'Back to home',onClick:function(){nav('home');}}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   REPORT SCREEN
   FIX: animated ring, green tags, verdict paywall, fixed bottom bar
        with proper safe-bot padding
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function ReportScreen(props) {
  var nav=props.nav, car=props.car, showToast=props.showToast;
  var _paid=useState(false); var paid=_paid[0];var setPaid=_paid[1];
  var _pl=useState(false); var pl=_pl[0];var setPl=_pl[1];
  var _tab=useState('overview'); var tab=_tab[0];var setTab=_tab[1];
  var _detail=useState(null); var detail=_detail[0];var setDetail=_detail[1];
  var _dl=useState(false); var dl=_dl[0];var setDl=_dl[1];
  if (!car) return null;
  var insp=car.inspections[0];
  if (!insp) return null;
  var m=sm(insp.score);

  function loadDetailed() {
    if (!insp.id || !props.user) return;
    setDl(true);
    Data.fetchDetailedReport(insp.id).then(function(report){
      if (report) setDetail(report);
    }).catch(function(err){
      // Unpurchased reports are intentionally denied by detailed-report RLS.
      console.debug('Detailed report unavailable until unlocked', err);
    }).finally(function(){ setDl(false); });
  }

  React.useEffect(function(){ loadDetailed(); }, [insp.id, props.user && props.user.id]);

  function pay(){
    setPl(true);
    Data.purchaseReport(insp.id, props.user.id).then(function(payment){
      var form=document.createElement('form');
      form.method='POST';
      form.action=payment.action;
      form.style.display='none';
      Object.keys(payment.fields||{}).forEach(function(key){
        var input=document.createElement('input');
        input.type='hidden';
        input.name=key;
        input.value=payment.fields[key];
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }).catch(function(err){
      console.error(err); setPl(false);
      showToast(String(err && err.message || 'Payment could not be started.'), true);
    });
  }

  if (detail) {
    return h('div',{style:{minHeight:'100vh',background:'#fff'}},
      h('div',{style:{maxWidth:820,margin:'0 auto',padding:'12px 16px',background:'#111',display:'flex',justifyContent:'space-between',alignItems:'center'}},
        h('button',{onClick:function(){nav('search');},style:{background:'transparent',border:'1px solid rgba(255,255,255,.2)',color:'#fff',borderRadius:8,padding:'8px 12px',fontWeight:700}},'← Back'),
        h('span',{style:{color:'#fff',fontSize:12,fontWeight:700}},'LEMONCHECK REPORT')),
      h(ReportView,detail));
  }

  var passC=(insp.findings||[]).filter(function(f){return f.s==='pass';}).length;
  var warnC=(insp.findings||[]).filter(function(f){return f.s==='warn';}).length;
  var failC=(insp.findings||[]).filter(function(f){return f.s==='fail';}).length;

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:130}},
    h('div',{style:{padding:'var(--safe-top) 20px 0'}},
      h(BackBtn,{onClick:function(){nav('search');}}),
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}},
        h('div',{style:{flex:1,marginRight:14}},
          h('p',{style:{fontSize:11,fontWeight:700,color:m.col,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:7}},m.lbl+' CONDITION'),
          h('p',{style:{fontSize:22,fontWeight:800,color:C.t,letterSpacing:'-.03em',lineHeight:1.15,marginBottom:5}},car.year+' '+car.make+' '+car.model),
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:10}},car.vin+' · '+Number(car.mileage||0).toLocaleString()+' km')),
        h(Ring,{score:insp.score,size:74,showLabel:true})),
      h(Card,{style:{marginBottom:12}},
        h('div',{style:{padding:'14px 18px',display:'flex',alignItems:'center',gap:12}},
          h(Av,{label:'LC',size:42}),
          h('div',{style:{flex:1}},
            h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t}},insp.inspector||'LemonCheck Inspector'),
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},insp.date||'Inspection report')),
          h(Tag,{label:'Inspection complete',bg:C.greenDim,c:C.green}))),
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,marginBottom:12}},'Inspection summary'),
          h('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}},
            [{v:passC,l:'Passed',c:C.green,bg:C.greenDim},{v:warnC,l:'Advisory',c:C.amber,bg:C.amberDim},{v:failC,l:'Failed',c:C.red,bg:C.redDim}].map(function(x){
              return h('div',{key:x.l,style:{background:x.bg,borderRadius:10,padding:'12px',textAlign:'center'}},
                h('p',{style:{fontSize:26,fontWeight:900,color:x.c}},x.v),
                h('p',{style:{fontSize:10,fontWeight:700,color:x.c,textTransform:'uppercase'}},x.l));
            })))),
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,marginBottom:8}},'Detailed report'),
          h('p',{style:{fontSize:'var(--fs-body)',color:C.t3,lineHeight:1.6}},
            'The full LemonCheck report contains the complete 115-point inspection, measurements, tyre data, notes and inspection photographs.'),
          dl && h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:10}},'Checking report access…'))),
      h('div',{style:{position:'fixed',bottom:0,left:0,right:0,maxWidth:430,margin:'0 auto',background:'rgba(10,10,10,.96)',backdropFilter:'blur(24px)',padding:'12px 20px',paddingBottom:'max(20px,var(--safe-bot))',borderTop:'1px solid var(--b)',zIndex:100}},
        h(PBtn,{label:paid?'Opening report…':'Unlock full report  ·  '+R(insp.reportPrice),onClick:pay,loading:pl||paid,disabled:dl}))));
}

function AlertsScreen(props) {
  var nav=props.nav, notifs=props.notifs, onRead=props.onRead;
  var unread=notifs.filter(function(n){return !n.read;}).length;
  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 20px'}},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22}},
        h('h1',{style:{fontSize:'var(--fs-title)',fontWeight:800,color:C.t,letterSpacing:'-.04em'}},'Notifications'),
        unread>0&&h('button',{onClick:onRead,'aria-label':'Mark all notifications as read',
          style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t3,background:C.s2,border:'1px solid var(--b)',padding:'5px 12px',borderRadius:99}},'Mark read')),
      notifs.length===0
        ?h('div',{style:{textAlign:'center',padding:'48px 0'}},
            h('svg',{width:56,height:56,viewBox:'0 0 56 56',fill:'none',style:{margin:'0 auto 12px',display:'block'}},
              h('rect',{x:4,y:4,width:48,height:48,rx:12,fill:C.s2,stroke:'var(--b)',strokeWidth:.75}),
              h('path',{d:'M20 34c4.4-4 12-4 16 0M22 24h12M28 18v2',stroke:C.t3,strokeWidth:1.5,strokeLinecap:'round'})),
            h('p',{style:{fontSize:'var(--fs-body)',fontWeight:600,color:C.t3}},'All caught up'))
        :h(Card,{style:{overflow:'hidden'}},
            notifs.map(function(n,i){
              return h('div',{key:n.id,role:'article','aria-label':n.title+(n.read?'':' — unread'),
                style:{padding:'16px 18px',borderBottom:i<notifs.length-1?'1px solid var(--b)':'none',background:n.read?'transparent':C.limeDim2,display:'flex',gap:12,alignItems:'flex-start'}},
                h('div',{style:{width:40,height:40,borderRadius:10,background:n.read?C.s3:C.s2,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,border:'1px solid var(--b)'}},n.icon),
                h('div',{style:{flex:1}},
                  h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em',marginBottom:3}},n.title),
                  h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,lineHeight:1.5,marginBottom:3}},n.body),
                  h('p',{style:{fontSize:11,color:C.t3,fontWeight:600,letterSpacing:'.02em'}},n.time)),
                !n.read&&h('div',{style:{width:7,height:7,borderRadius:4,background:C.lime,marginTop:4,flexShrink:0}}));
            }))),
    h(Nav,{sc:'alerts',nav:nav,role:'buyer',nc:unread}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EARN SCREEN
   FIX: lime on money only, green for positive stats,
        grouped bar chart showing inspection + resale split
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function EarnScreen(props) {
  var nav=props.nav;
  var total=TXNS.reduce(function(a,t){return a+t.amount;},0);
  /* FIX: stacked bars — inspection fee + resale */
  var week=[
    {insp:0,   resale:0  },
    {insp:1950,resale:180},
    {insp:2100,resale:180},
    {insp:0,   resale:0  },
    {insp:1800,resale:0  },
    {insp:1950,resale:180},
    {insp:2200,resale:180},
  ];
  var days=['M','T','W','T','F','S','S'];
  var maxW=Math.max.apply(null,week.map(function(w){return w.insp+w.resale;}));

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 24px',background:'linear-gradient(180deg,#0C180C 0%,'+C.bg+' 100%)'}},
      h('p',{style:{fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}},'Passive income 2025'),
      h('p',{style:{fontSize:'var(--fs-display)',fontWeight:900,color:C.lime,letterSpacing:'-.06em',lineHeight:1,marginBottom:6}},R(total)),
      h('p',{style:{fontSize:'var(--fs-body)',color:C.t3,marginBottom:18}},'From '+TXNS.length+' report resale'+(TXNS.length===1?'':'s')+' · '+R(total)+' total'),
      h('div',{style:{display:'flex',gap:8}},
        [{v:String(TXNS.length),l:'Resales'},{v:String(Object.keys(VEHICLES).length),l:'Cars tracked'},{v:total>0?('+'+R(total)):'R0',l:'Total earned'}].map(function(s){
          return h('div',{key:s.l,style:{flex:1,background:C.limeDim2,borderRadius:10,padding:'12px 10px',border:'1px solid rgba(212,247,42,.1)'}},
            h('p',{style:{fontSize:18,fontWeight:800,color:C.lime,letterSpacing:'-.03em'}},s.v),
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},s.l));
        }))),

    h('div',{style:{padding:'0 20px'},className:'fu'},
      /* FIX: Grouped bar chart */
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:14}},'This week'),
          h('div',{style:{display:'flex',alignItems:'flex-end',gap:5,height:72,marginBottom:8}},
            week.map(function(w,i){
              var total=w.insp+w.resale;
              var inspH=total>0?Math.round((w.insp/maxW)*60)+4:4;
              var resaleH=w.resale>0?Math.round((w.resale/maxW)*60):0;
              return h('div',{key:i,style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}},
                h('div',{style:{width:'100%',display:'flex',flexDirection:'column',alignItems:'stretch',gap:1}},
                  w.resale>0&&h('div',{style:{height:resaleH,background:C.green,borderRadius:'3px 3px 0 0',opacity:.75}}),
                  h('div',{style:{height:total>0?inspH:4,background:total>0?C.lime:'rgba(255,255,255,.06)',borderRadius:w.resale>0?0:'3px 3px 0 0'}})),
                h('p',{style:{fontSize:10,fontWeight:600,color:C.t3,letterSpacing:'.02em'}},days[i]));
            })),
          /* Legend */
          h('div',{style:{display:'flex',gap:16,marginBottom:10}},
            h('div',{style:{display:'flex',alignItems:'center',gap:5}},h('div',{style:{width:10,height:10,borderRadius:2,background:C.lime}}),h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Inspection')),
            h('div',{style:{display:'flex',alignItems:'center',gap:5}},h('div',{style:{width:10,height:10,borderRadius:2,background:C.green,opacity:.75}}),h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Resale'))),
          h(Hr,{my:10}),
          h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Week total'),
            h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:800,color:C.lime,letterSpacing:'-.03em'}},
              R(week.reduce(function(a,w){return a+w.insp+w.resale;},0)))))),

      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:10}},'How passive income works'),
          h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.08)',borderRadius:10,padding:'12px',marginBottom:10}},
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.lime,lineHeight:1.65}},'🍋  When you commission an inspection, you earn 18% (R180) every time another buyer purchases that report.')),
          h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'3 resales on Corolla'),
            h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:800,color:C.lime,letterSpacing:'-.03em'}},R(total))))),

      h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em',marginBottom:8}},'Transactions'),
      h(Card,{style:{overflow:'hidden',marginBottom:10}},
        TXNS.map(function(t,i){
          return h('div',{key:t.id,style:{padding:'14px 18px',borderBottom:i<TXNS.length-1?'1px solid var(--b)':'none',display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('div',null,
              h('p',{style:{fontWeight:600,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em'}},t.buyer),
              h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},t.car+' · '+t.date)),
            h('p',{style:{fontSize:'var(--fs-body)',fontWeight:800,color:C.green,letterSpacing:'-.02em'}},'+'+R(t.amount)));
        })),
      h(GBtn,{label:'Withdraw to bank account',onClick:function(){}})),
    h(Nav,{sc:'earn',nav:nav,role:'buyer'}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INSPECTOR HOME
   FIX: safe-top, lime on pay amounts, green for status tags,
        online/offline toggle, proper caption sizes
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function InspHomeScreen(props) {
  var nav=props.nav, user=props.user, setJob=props.setJob;
  var _on=useState(!!(user && user.online)); var online=_on[0]; var setOnline=_on[1];
  var pending=JOBS.filter(function(j){return j.status==='pending';});
  var done   =JOBS.filter(function(j){return j.status==='done';});

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 20px',background:'linear-gradient(180deg,#0C180C 0%,'+C.bg+' 100%)'}},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}},
        h('div',null,
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginBottom:3}},greet()),
          h('p',{style:{fontSize:26,fontWeight:800,color:C.t,letterSpacing:'-.04em'}},user.first)),
        h('div',{style:{display:'flex',gap:8,alignItems:'center'}},
          /* Online/Offline toggle */
          h('button',{onClick:function(){ haptic('selection'); setOnline(function(v){ var nv=!v; Data.setOnlineStatus(user.id, nv).catch(function(e){console.error(e);}); return nv; }); },
            'aria-pressed':online,'aria-label':online?'Go offline':'Go online',
            style:{display:'flex',alignItems:'center',gap:7,background:online?C.greenDim:C.s2,border:'1px solid '+(online?'rgba(50,215,75,.25)':'var(--b)'),borderRadius:99,padding:'7px 12px',transition:'all .2s'}},
            h('div',{style:{width:7,height:7,borderRadius:4,background:online?C.green:C.t3,animation:online?'pg 2s infinite':'none'}}),
            h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:online?C.green:C.t3}},online?'Online':'Offline')),
          h(Av,{label:user.init,size:36}))),
      h('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:4}},
        [{v:String(user.jobs),l:'Jobs'},{v:user.rating.toFixed(2)+'★',l:'Rating'},{v:R(user.earned),l:'Earned'}].map(function(s){
          return h(Card,{key:s.l,style:{textAlign:'center',padding:'14px 6px'}},
            h('p',{style:{fontSize:'var(--fs-body)',fontWeight:800,color:C.t,letterSpacing:'-.02em',marginBottom:2}},s.v),
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},s.l));
        }))),

    h('div',{style:{padding:'12px 20px 0'},className:'fu'},
      h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:10}},
        h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.02em'}},'Incoming'),
        h('div',{style:{background:C.amberDim,borderRadius:99,padding:'3px 9px',border:'1px solid rgba(255,159,10,.2)'}},
          h('p',{style:{fontSize:11,fontWeight:700,color:C.amber}},pending.length))),

      pending.length===0
        ?h(Card,{style:{padding:'24px',textAlign:'center',marginBottom:10}},
            h('p',{style:{color:C.t3,fontSize:'var(--fs-body)'}},'No pending requests'))
        :pending.map(function(job){
            return h(Card,{key:job.id,style:{marginBottom:10,overflow:'hidden'}},
              h('div',{style:{padding:'16px 18px'}},
                h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}},
                  h('div',{style:{flex:1,marginRight:10}},
                    h('p',{style:{fontWeight:800,fontSize:'var(--fs-headline)',color:C.t,letterSpacing:'-.02em',marginBottom:3}},job.year+' '+job.make+' '+job.model),
                    h('p',{style:{fontSize:11,fontWeight:700,color:C.t3,letterSpacing:'.02em',marginBottom:7}},'VIN: '+job.vin),
                    h('div',{style:{display:'flex',alignItems:'center',gap:5,marginBottom:3}},
                      h('svg',{width:11,height:11,viewBox:'0 0 24 24',fill:'none',stroke:C.t3,strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
                        h('path',{d:'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z'}),h('circle',{cx:12,cy:10,r:3})),
                      h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},job.location)),
                    h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'From '+job.customer+' · '+job.date),
                    job.notes&&h('div',{style:{background:C.blueDim,borderRadius:7,padding:'7px 10px',marginTop:8,border:'1px solid rgba(10,132,255,.14)'}},
                      h('p',{style:{fontSize:11,color:C.blue,lineHeight:1.45}},'"'+job.notes+'"'))),
                  /* Lime = money */
                  h('p',{style:{fontSize:22,fontWeight:900,color:C.lime,letterSpacing:'-.04em',flexShrink:0}},R(job.pay))),
                h('div',{style:{display:'flex',gap:8}},
                  h('button',{onClick:function(){
                    haptic('error');
                    Data.declineBooking(job.id,user.id).then(function(){ showToast('Request declined.'); return Data.fetchInspectorJobs(user.id); }).then(function(rows){
                      JOBS=rows.map(function(j){ return {id:j.id,vin:j.vin,make:j.vehicle.make,model:j.vehicle.model,year:j.vehicle.year,colour:j.vehicle.colour,customer:j.buyer_name,location:j.location,date:new Date(j.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}),status:j.status==='done'?'done':'pending',pay:j.inspection_fee,notes:j.notes||''}; });
                      setDataVersion(function(x){return x+1;});
                    }).catch(function(e){console.error(e);showToast('Could not decline request.',true);});
                  },style:{flex:'0 0 82px',background:C.redDim,color:C.red,border:'1px solid rgba(255,69,58,.18)',borderRadius:'var(--r)',padding:'13px',fontSize:'var(--fs-caption)',fontWeight:700}},'Decline'),
                  h(PBtn,{label:'Accept',onClick:function(){
                    setJob(job);
                    Data.acceptBooking(job.id,user.id).then(function(){ nav('ijob'); }).catch(function(e){ console.error(e); showToast(e.message||'Could not accept request.',true); });
                  },style:{flex:1,padding:'13px'}}))));
          }),

      h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.02em',marginBottom:8}},'Completed'),
      h(Card,{style:{overflow:'hidden'}},
        done.length===0
          ?h('div',{style:{padding:'20px',textAlign:'center'}},h('p',{style:{color:C.t3,fontSize:'var(--fs-caption)'}},'No completed jobs yet'))
          :done.map(function(job,i){
              return h('div',{key:job.id,style:{padding:'14px 18px',borderBottom:i<done.length-1?'1px solid var(--b)':'none',display:'flex',justifyContent:'space-between',alignItems:'center'}},
                h('div',null,
                  h('p',{style:{fontWeight:600,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em'}},job.year+' '+job.make+' '+job.model),
                  h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},job.location+' · '+job.date)),
                h('div',{style:{textAlign:'right',display:'flex',flexDirection:'column',gap:5,alignItems:'flex-end'}},
                  h('p',{style:{fontSize:'var(--fs-body)',fontWeight:800,color:C.lime,letterSpacing:'-.02em'}},R(job.pay)),
                  job.score&&h(Tag,{label:'Score '+job.score,bg:C.greenDim,c:C.green})));
            }))),
    h(Nav,{sc:'ijobs',nav:nav,role:'insp'}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   JOB DETAIL SCREEN
   FIX: safe-top, lime on pay CTA, green status dots,
        fixed bottom bar with safe-bot, XIcon, aria labels
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function JobScreen(props) {
  var nav=props.nav, job=props.job, showToast=props.showToast;
  var initF=function(){var o={};AREAS.forEach(function(a){o[a]='pass';});return o;};
  var initN=function(){var o={};AREAS.forEach(function(a){o[a]='';});return o;};
  var _f=useState(initF);var findings=_f[0];var setFindings=_f[1];
  var _n=useState(initN);var fnotes=_n[0];var setFnotes=_n[1];
  var _a=useState(null); var active=_a[0]; var setActive=_a[1];
  var _d=useState(false);var done=_d[0];   var setDone=_d[1];
  var _l=useState(false);var loading=_l[0];var setLoading=_l[1];
  if (!job) return null;

  var vals=Object.keys(findings).map(function(k){return findings[k];});
  var score=Math.round(vals.reduce(function(a,f){return a+(f==='pass'?10:f==='warn'?5:0);},0)/AREAS.length*10);
  var m=sm(score);

  function submit(){
    setLoading(true);
    Data.submitInspection({
      bookingId: job.id, vin: job.vin, inspectorId: props.user.id,
      findings: findings, notes: fnotes, score: score, fullPrice: job.pay,
    }).then(function(){
      setDone(true); setLoading(false); haptic('success'); showToast('Report submitted. Payment within 24h.');
    }).catch(function(err){
      console.error(err); setLoading(false); showToast('Submission failed. Try again.', true);
    });
  }

  if (done) return h('div',{style:{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center'},className:'fu'},
    h('div',{style:{width:80,height:80,borderRadius:40,background:C.greenDim,display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,marginBottom:22,border:'1px solid rgba(50,215,75,.18)'}},'🎉'),
    h('p',{style:{fontSize:26,fontWeight:900,color:C.t,letterSpacing:'-.05em',marginBottom:8}},'Report submitted'),
    h('p',{style:{fontSize:'var(--fs-body)',color:C.t3,lineHeight:1.7,marginBottom:6}},
      'Score: ',h('strong',{style:{color:m.col,fontWeight:800}},score+'/100'),
      '. Payment of ',h('strong',{style:{color:C.lime}},R(job.pay)),' within 24 hrs.'),
    h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.1)',borderRadius:'var(--rl)',padding:'18px',marginBottom:24,textAlign:'left',width:'100%'}},
      h('p',{style:{fontSize:'var(--fs-body)',color:C.lime,lineHeight:1.65}},'🍋  You earn R70 every time this report is resold. Passively, forever.')),
    h(PBtn,{label:'Back to jobs',onClick:function(){nav('ijobs');}}));

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:110}},
    h('div',{style:{padding:'var(--safe-top) 20px 0'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:14,marginBottom:18}},
        h(BackBtn,{onClick:function(){nav('ijobs');},mb:0}),
        h('div',{style:{flex:1}},
          h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:800,color:C.t,letterSpacing:'-.02em',lineHeight:1.2}},job.year+' '+job.make+' '+job.model),
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:3}},'VIN: '+job.vin)),
        h(Ring,{score:score,size:58})),

      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'12px 16px',display:'flex',gap:7,flexWrap:'wrap'}},
          h(Tag,{label:'📍 '+job.location,bg:C.s3,c:C.t2}),
          h(Tag,{label:'From '+job.customer,bg:C.s3,c:C.t2}),
          h(Tag,{label:job.date,bg:C.s3,c:C.t2}))),

      job.notes&&h('div',{style:{background:C.blueDim,border:'1px solid rgba(10,132,255,.14)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:10}},
        h('p',{style:{fontSize:'var(--fs-caption)',color:C.blue,lineHeight:1.5}},'"'+job.notes+'"')),

      /* Photo slots */
      h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:7,marginBottom:10}},
        ['Engine','Tyres','Body','Interior'].map(function(a){
          return h('div',{key:a,'aria-label':'Add photo for '+a,style:{background:C.s2,borderRadius:10,aspectRatio:'1',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,border:'1px dashed var(--b)',cursor:'pointer'}},
            h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:C.t3,strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true'},
              h('path',{d:'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z'}),
              h('circle',{cx:12,cy:13,r:4})),
            h('span',{style:{fontSize:9,color:C.t3,fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'}},a));
        })),

      h('p',{style:{fontWeight:700,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em',marginBottom:8}},'Inspection checklist'),
      h(Card,{style:{overflow:'hidden',marginBottom:10}},
        AREAS.map(function(area,i){
          var isA=active===area;
          var scol={pass:C.green,warn:C.amber,fail:C.red}[findings[area]]||C.t3;
          return h('div',{key:area,style:{borderBottom:i<AREAS.length-1?'1px solid var(--b)':'none'}},
            h('div',{onClick:function(){setActive(isA?null:area);},'aria-expanded':isA,
              style:{padding:'13px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}},
              h('div',{style:{display:'flex',alignItems:'center',gap:10}},
                h('div',{style:{width:9,height:9,borderRadius:'50%',background:scol,flexShrink:0,transition:'background .2s'}}),
                h('p',{style:{fontWeight:600,fontSize:'var(--fs-body)',color:C.t,letterSpacing:'-.01em'}},area)),
              h('div',{style:{display:'flex',alignItems:'center',gap:7}},
                h(SBadge,{s:findings[area]}),
                h('svg',{width:13,height:13,viewBox:'0 0 24 24',fill:'none',stroke:C.t3,strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round',style:{transform:isA?'rotate(180deg)':'none',transition:'transform .2s'},'aria-hidden':'true'},
                  h('path',{d:'M6 9l6 6 6-6'})))),
            isA&&h('div',{style:{padding:'10px 18px 14px',background:C.s2,borderTop:'1px solid var(--b)'},className:'fu'},
              h('div',{style:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}},
                [['pass',C.green,C.greenDim,'Pass'],['warn',C.amber,C.amberDim,'Advisory'],['fail',C.red,C.redDim,'Fail']].map(function(o){
                  var sel=findings[area]===o[0];
                  return h('button',{key:o[0],'aria-pressed':sel,
                    onClick:function(){haptic('selection');var nf=Object.assign({},findings);nf[area]=o[0];setFindings(nf);},
                    style:{background:sel?o[2]:C.s3,border:'1px solid '+(sel?o[1]:'var(--b)'),borderRadius:8,padding:'9px',fontSize:'var(--fs-caption)',fontWeight:700,color:sel?o[1]:C.t3,transition:'all .15s'}},o[3]);
                })),
              h('input',{'aria-label':'Notes for '+area,placeholder:'Add notes…',value:fnotes[area],
                onChange:function(e){var v=e.target.value;var nn=Object.assign({},fnotes);nn[area]=v;setFnotes(nn);},
                style:{fontSize:'var(--fs-caption)',borderRadius:8,background:C.s3,border:'1px solid var(--b)'}})));
        })),

      h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.08)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:10}},
        h('p',{style:{fontSize:'var(--fs-caption)',color:C.lime,lineHeight:1.5}},'🍋  After submission you earn R70 every time this report is resold.'))),

    /* Fixed bottom — safe-bot */
    h('div',{style:{position:'fixed',bottom:0,left:0,right:0,maxWidth:430,margin:'0 auto',
      background:'rgba(10,10,10,.95)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',
      borderTop:'1px solid var(--b)',padding:'12px 20px',
      paddingBottom:'max(20px, var(--safe-bot))',zIndex:100}},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}},
        h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Live score'),
        h('p',{style:{fontSize:19,fontWeight:900,color:m.col,letterSpacing:'-.04em',},'aria-live':'polite'},score+' / 100')),
      h(PBtn,{label:'Submit report  ·  Earn '+R(job.pay),onClick:submit,loading:loading})));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INSPECTOR EARNINGS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function InspEarnScreen(props) {
  var nav=props.nav, user=props.user;
  var week=[{insp:0,resale:0},{insp:1950,resale:0},{insp:2100,resale:70},{insp:0,resale:0},{insp:1800,resale:0},{insp:1950,resale:70},{insp:2200,resale:70}];
  var days=['M','T','W','T','F','S','S'];
  var maxW=Math.max.apply(null,week.map(function(w){return w.insp+w.resale;}));

  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 24px',background:'linear-gradient(180deg,#0C180C 0%,'+C.bg+' 100%)'}},
      h('p',{style:{fontSize:11,fontWeight:700,color:C.t3,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}},'Total earned'),
      h('p',{style:{fontSize:'var(--fs-display)',fontWeight:900,color:C.lime,letterSpacing:'-.06em',lineHeight:1,marginBottom:5}},R(user.earned)),
      h('p',{style:{fontSize:'var(--fs-body)',color:C.t3}},user.jobs+' completed inspections')),
    h('div',{style:{padding:'0 20px'},className:'fu'},
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:14}},'This week'),
          h('div',{style:{display:'flex',alignItems:'flex-end',gap:5,height:72,marginBottom:8}},
            week.map(function(w,i){
              var tot=w.insp+w.resale;
              var inspH=tot>0?Math.round((w.insp/maxW)*60)+4:4;
              var resaleH=w.resale>0?Math.round((w.resale/maxW)*60):0;
              return h('div',{key:i,style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}},
                h('div',{style:{width:'100%',display:'flex',flexDirection:'column',alignItems:'stretch',gap:1}},
                  w.resale>0&&h('div',{style:{height:resaleH,background:C.green,borderRadius:'3px 3px 0 0',opacity:.75}}),
                  h('div',{style:{height:tot>0?inspH:4,background:tot>0?C.lime:'rgba(255,255,255,.06)',borderRadius:w.resale>0?0:'3px 3px 0 0'}})),
                h('p',{style:{fontSize:10,fontWeight:600,color:C.t3,letterSpacing:'.02em'}},days[i]));
            })),
          h('div',{style:{display:'flex',gap:16,marginBottom:10}},
            h('div',{style:{display:'flex',alignItems:'center',gap:5}},h('div',{style:{width:10,height:10,borderRadius:2,background:C.lime}}),h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Inspection fee')),
            h('div',{style:{display:'flex',alignItems:'center',gap:5}},h('div',{style:{width:10,height:10,borderRadius:2,background:C.green,opacity:.75}}),h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Resale cut'))),
          h(Hr,{my:10}),
          h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3}},'Week total'),
            h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:800,color:C.lime,letterSpacing:'-.03em'}},
              R(week.reduce(function(a,w){return a+w.insp+w.resale;},0)))))),
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:10}},'Resale income'),
          h('div',{style:{background:C.limeDim2,border:'1px solid rgba(212,247,42,.08)',borderRadius:10,padding:'12px',marginBottom:10}},
            h('p',{style:{fontSize:'var(--fs-caption)',color:C.lime,lineHeight:1.6}},'🍋  You earn R70 (20%) every time a buyer purchases a report from one of your inspections.')),
          h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
            h('div',null,
              h('p',{style:{fontSize:'var(--fs-body)',fontWeight:600,color:C.t}},'Passive earnings'),
              h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,marginTop:2}},'3 resales this month')),
            h('p',{style:{fontSize:'var(--fs-headline)',fontWeight:800,color:C.green,letterSpacing:'-.03em'}},R(210))))),
      h(GBtn,{label:'Withdraw to bank account',onClick:function(){}})),
    h(Nav,{sc:'iearnings',nav:nav,role:'insp'}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INSPECTOR PROFILE
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function InspProfileScreen(props) {
  var nav=props.nav, user=props.user, logout=props.logout;
  return h('div',{style:{minHeight:'100vh',background:C.bg,paddingBottom:'var(--nav)'}},
    h('div',{style:{padding:'var(--safe-top) 20px 0'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:14,marginBottom:22}},
        h(Av,{label:user.init,size:60}),
        h('div',null,
          h('p',{style:{fontSize:20,fontWeight:800,color:C.t,letterSpacing:'-.03em',marginBottom:5}},user.name),
          h('div',{style:{display:'flex',gap:5,flexWrap:'wrap'}},
            h(Tag,{label:'★ '+user.rating.toFixed(2),bg:C.s3,c:'#F59E0B'}),
            h(Tag,{label:'Verified',bg:C.greenDim,c:C.green})))),
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}},
            [{l:'Licence',v:user.licence},{l:'Cert',v:user.cert},{l:'Experience',v:user.exp},{l:'Region',v:user.region}].map(function(d){
              return h('div',{key:d.l,style:{background:C.s2,borderRadius:8,padding:'10px',border:'1px solid var(--b)'}},
                h('p',{style:{fontSize:10,color:C.t3,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}},d.l),
                h('p',{style:{fontSize:'var(--fs-caption)',fontWeight:700,color:C.t,letterSpacing:'-.01em'}},d.v));
            })),
          h('p',{style:{fontSize:'var(--fs-caption)',color:C.t3,lineHeight:1.65}},user.bio))),
      h(Card,{style:{marginBottom:10}},
        h('div',{style:{padding:'18px'}},
          h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:C.t,letterSpacing:'-.01em',marginBottom:12}},'How you earn'),
          [['🔧','Per inspection','R1,800–R2,100 per inspection',false],
           ['🍋','Resale cut','+R70 every time your report is rebought',true]].map(function(r,i){
            return h('div',{key:r[1],style:{display:'flex',gap:12,alignItems:'center',padding:'12px',background:r[3]?C.limeDim2:C.s2,borderRadius:10,marginBottom:i===0?8:0,border:'1px solid '+(r[3]?'rgba(212,247,42,.08)':'var(--b)')}},
              h('span',{style:{fontSize:20,flexShrink:0}},r[0]),
              h('div',null,
                h('p',{style:{fontWeight:700,fontSize:'var(--fs-caption)',color:r[3]?C.lime:C.t,letterSpacing:'-.01em'}},r[1]),
                h('p',{style:{fontSize:11,color:C.t3,marginTop:2}},r[2])));
          }))),
      h(GBtn,{label:'Log out',onClick:logout,danger:true})),
    h(Nav,{sc:'iprofile',nav:nav,role:'insp'}));
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   APP SHELL — fully wired
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function App() {
  var _sc    = useState('boot');       var screen  = _sc[0];    var setScreen  = _sc[1];
  var _role  = useState(null);         var role    = _role[0];  var setRole    = _role[1];
  var _user  = useState(null);         var user    = _user[0];  var setUser    = _user[1];
  var _onb   = useState(false);        var showOnb = _onb[0];   var setShowOnb = _onb[1];
  var _car   = useState(null);         var carData = _car[0];   var setCarData = _car[1];
  var _job   = useState(null);         var job     = _job[0];   var setJob     = _job[1];
  var _notifs= useState(NOTIFS_INIT);  var notifs  = _notifs[0];var setNotifs  = _notifs[1];
  var _toast = useState(null);         var toast   = _toast[0]; var setToast   = _toast[1];
  var _dv    = useState(0);            var setDataVersion = _dv[1]; /* bump to force re-render after Data.* loads */
  var _boot  = useState(true);         var booting  = _boot[0];  var setBooting  = _boot[1];

  function showToast(msg,err){ setToast({msg:msg,err:!!err}); setTimeout(function(){setToast(null);},3200); }
  var _hist = React.useRef([]);
  function nav(s){
    _hist.current.push(screen);
    setScreen(s);
    window.scrollTo(0,0);
  }
  function navBack(s){
    _hist.current.pop();
    setScreen(s);
    window.scrollTo(0,0);
  }

  // Restore Supabase session + role on every cold start / refresh
  useEffect(function(){
    var cancelled = false;
    Data.getCurrentProfile().then(function(profile){
      if (cancelled) return;
      if (profile) {
        var r = profile.role === 'inspector' ? 'insp' : 'buyer';
        var adapted = Object.assign({}, profile, {
          first: profile.first_name, exp: profile.experience,
          jobs: profile.jobs_completed, earned: 0, rating: Number(profile.rating || 5),
        });
        setRole(r);
        setUser(adapted);
        setShowOnb(false); // skip onboarding on restore
        if (r === 'buyer') {
          loadBuyerData(profile);
          setScreen('home');
        } else {
          loadInspectorData(profile);
          setScreen('ijobs');
        }
      } else {
        setScreen('auth');
      }
      setBooting(false);
    }).catch(function(err){
      console.error('Session restore failed', err);
      if (!cancelled) {
        setScreen('auth');
        setBooting(false);
      }
    });
    return function(){ cancelled = true; };
  }, []);

  function timeAgo(iso){
    var mins = Math.round((Date.now()-new Date(iso).getTime())/60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins+'m ago';
    var hrs = Math.round(mins/60);
    if (hrs < 24) return hrs+'h ago';
    return Math.round(hrs/24)+'d ago';
  }
  function mapNotif(n){ return {id:n.id, type:n.type, icon:n.icon, title:n.title, body:n.body, time:timeAgo(n.created_at), read:n.read}; }
  function mapInspector(p){ return {id:p.id, name:p.name, cert:p.cert||'Certified', rating:Number(p.rating), jobs:p.jobs_completed, eta:p.eta_minutes||15, price:p.price||1800, spec:p.specialty||'All makes', online:p.online, top:p.top_rated, init:p.init}; }

  function loadBuyerData(profile){
    Promise.all([
      Data.fetchOnlineInspectors(), Data.fetchOfflineInspectors(),
      Data.fetchNotifications(profile.id), Data.fetchBuyerEarnings(profile.id),
      Data.fetchMyVehicles(profile.id),
    ]).then(function(res){
      INSPECTORS = res[0].map(mapInspector).concat(res[1].map(mapInspector));
      NOTIFS_INIT = res[2].map(mapNotif);
      TXNS = res[3].map(function(e){
        var v = e.inspections && e.inspections.vehicles;
        return {id:e.id, buyer:'Buyer', car:v?(v.make+' '+v.model):'', date:new Date(e.purchased_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}), amount:e.payer_earning};
      });
      res[4].forEach(function(v){
        VEHICLES[v.vin] = Object.assign({}, v, {inspections: v.latestScore!=null ? [{score:v.latestScore}] : []});
      });
      setNotifs(NOTIFS_INIT.slice());
      setDataVersion(function(x){return x+1;});
    }).catch(function(e){ console.error(e); });
  }

  function loadInspectorData(profile){
    Promise.all([
      Data.fetchInspectorJobs(profile.id), Data.fetchNotifications(profile.id),
      Data.fetchInspectorEarnings(profile.id),
    ]).then(function(res){
      JOBS = res[0].map(function(j){
        return {
          id:j.id, vin:j.vin, make:j.vehicle.make, model:j.vehicle.model, year:j.vehicle.year,
          colour:j.vehicle.colour, customer:j.buyer_name, location:j.location,
          date:new Date(j.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}),
          status: j.status==='done'?'done':'pending', pay:j.inspection_fee, notes:j.notes||'',
        };
      });
      NOTIFS_INIT = res[1].map(mapNotif);
      TXNS = res[2].map(function(e){ return {id:e.id, buyer:'Buyer', car:'', date:new Date(e.purchased_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}), amount:e.inspector_earning}; });
      var doneTotal = JOBS.filter(function(j){return j.status==='done';}).reduce(function(a,j){return a+j.pay;},0);
      var resaleTotal = TXNS.reduce(function(a,t){return a+t.amount;},0);
      setUser(function(u){ return u && Object.assign({}, u, {earned: doneTotal+resaleTotal}); });
      setNotifs(NOTIFS_INIT.slice());
      setDataVersion(function(x){return x+1;});
    }).catch(function(e){ console.error(e); });
  }

  function login(profile){
    var r = profile.role === 'inspector' ? 'insp' : 'buyer';
    var adapted = Object.assign({}, profile, {
      first: profile.first_name, exp: profile.experience,
      jobs: profile.jobs_completed, earned: 0, rating: Number(profile.rating || 5),
    });
    setRole(r); setUser(adapted); setShowOnb(true);
    if (r === 'buyer') loadBuyerData(profile); else loadInspectorData(profile);
  }
  function doneOnb(){ setShowOnb(false); setScreen(role==='buyer'?'home':'ijobs'); }
  function logout(){ Data.signOut(); setRole(null); setUser(null); setScreen('auth'); }
  function markRead(){
    setNotifs(function(ns){ return ns.map(function(n){ return Object.assign({},n,{read:true}); }); });
    if (user) Data.markAllNotificationsRead(user.id).catch(function(e){ console.error(e); });
  }

  var nc = notifs.filter(function(n){ return !n.read; }).length;
  var sh = {nav:nav, navBack:navBack, showToast:showToast, user:user, logout:logout};

  if (booting || screen === 'boot') {
    return h('div', {style:{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}},
      h(Spin, {size:28}),
      h('p', {style:{color:C.t3,fontSize:13,fontWeight:600,letterSpacing:'.04em'}}, 'LEMONCHECK'));
  }
  if (showOnb) return h('div',null,h(Toast,{t:toast}),h(Onboarding,{role:role,onDone:doneOnb}));
  if (screen==='auth') return h('div',null,h(Toast,{t:toast}),h(AuthScreen,{login:login}));

  var screens = {
    home:      function(){ return h(HomeScreen,    Object.assign({},sh,{notifs:notifs})); },
    search:    function(){ return h(SearchScreen,  Object.assign({},sh,{setCarData:setCarData})); },
    book:      function(){ return h(BookScreen,    sh); },
    report:    function(){ return h(ReportScreen,  Object.assign({},sh,{car:carData || Object.values(VEHICLES)[0] || null})); },
    alerts:    function(){ return h(AlertsScreen,  Object.assign({},sh,{notifs:notifs,onRead:markRead})); },
    earn:      function(){ return h(EarnScreen,    sh); },
    ijobs:     function(){ return h(InspHomeScreen,Object.assign({},sh,{setJob:setJob})); },
    /* Detailed checklist report (InspectionForm). The legacy 12-area JobScreen above is kept for rollback. */
    ijob:      function(){ return h(InspectionForm, {job:job||JOBS[0], nav:nav, showToast:showToast, onSubmitted:function(){ if (user) loadInspectorData(user); }}); },
    iearnings: function(){ return h(InspEarnScreen,sh); },
    iprofile:  function(){ return h(InspProfileScreen,sh); },
  };

  var isModal = ['book','report','ijob'].indexOf(screen) !== -1;
  var animCls = isModal ? 'sheet-up' : 'screen-push';
  return h('div',null,
    h(Toast,{t:toast}),
    h('div',{key:screen,className:animCls},
      (screens[screen]||screens.home)()));
}

export default App;
