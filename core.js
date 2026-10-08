// plo-core.js — pure PLO logic, no DOM. Correct-by-construction: the
// straight counter enforces the exactly-2+3 rule in code, so answers
// can't be miscounted. Tested with node (see core.test.js).
const RANKS = '23456789TJQKA';
const SUIT_LETTER = 'shdc';
const SUIT_SYM = ['♠','♥','♦','♣'];

function cardStr(c){ return RANKS[c.r] + SUIT_LETTER[c.s]; }
function parseHand(s){ // 'AsAhKsKh'
  const m={s:0,h:1,d:2,c:3}; const out=[];
  for(let i=0;i<s.length;i+=2) out.push({r:RANKS.indexOf(s[i]), s:m[s[i+1]]});
  return out;
}
function fullDeck(){ const d=[]; for(let r=0;r<13;r++) for(let s=0;s<4;s++) d.push({r,s}); return d; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; const t=a[i]; a[i]=a[j]; a[j]=t; } return a; }

function combos2(a){ const o=[]; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++) o.push([a[i],a[j]]); return o; }
function combos3(a){ const o=[]; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++) for(let k=j+1;k<a.length;k++) o.push([a[i],a[j],a[k]]); return o; }

function isStraight5(c5){
  const rs=[...new Set(c5.map(c=>c.r))].sort((a,b)=>a-b);
  if(rs.length!==5) return false;
  if(rs[4]-rs[0]===4) return true;
  return rs[0]===0&&rs[1]===1&&rs[2]===2&&rs[3]===3&&rs[4]===12; // wheel A-2-3-4-5
}
// Does hero make ANY 5-card straight using exactly 2 from hand + 3 from board?
function makesStraight(hero4, board){
  for(const h of combos2(hero4)) for(const b of combos3(board)){
    if(isStraight5(h.concat(b))) return true;
  }
  return false;
}
// All remaining deck cards that complete a straight on this flop. Exact by construction.
function straightOuts(hero4, flop3){
  const used=new Set(hero4.concat(flop3).map(c=>c.r*4+c.s));
  const outs=[];
  for(let r=0;r<13;r++) for(let s=0;s<4;s++){
    if(used.has(r*4+s)) continue;
    const c={r:r,s:s};
    if(makesStraight(hero4, flop3.concat([c]))) outs.push(c);
  }
  return outs;
}

// ---- 5-card evaluator (obviously correct; validated against 15 published/sim equities) ----
function eval5(c){
  const rs=c.map(x=>x.r).sort((a,b)=>b-a);
  const flush=c.every(x=>x.s===c[0].s);
  const u=[...new Set(rs)];
  let str=-1;
  if(u.length===5){
    if(u[0]-u[4]===4) str=u[0];
    else if(u[0]===12&&u[1]===3&&u[2]===2&&u[3]===1&&u[4]===0) str=3; // wheel
  }
  const cnt={}; rs.forEach(r=>cnt[r]=(cnt[r]||0)+1);
  const g=Object.keys(cnt).map(r=>({r:+r,n:cnt[r]})).sort((a,b)=>b.n-a.n||b.r-a.r);
  const kicker=g.slice(1).map(x=>x.r);
  let cat,tb;
  if(flush&&str>=0){cat=8;tb=[str];}
  else if(g[0].n===4){cat=7;tb=[g[0].r].concat(kicker);}
  else if(g[0].n===3&&g[1].n===2){cat=6;tb=[g[0].r,g[1].r];}
  else if(flush){cat=5;tb=rs;}
  else if(str>=0){cat=4;tb=[str];}
  else if(g[0].n===3){cat=3;tb=[g[0].r].concat(kicker);}
  else if(g[0].n===2&&g[1].n===2){cat=2;tb=[g[0].r,g[1].r].concat(kicker);}
  else if(g[0].n===2){cat=1;tb=[g[0].r].concat(kicker);}
  else{cat=0;tb=rs;}
  return {cat:cat,tb:tb};
}
function cmp5(a,b){
  if(a.cat!==b.cat) return a.cat-b.cat;
  for(let i=0;i<a.tb.length&&i<b.tb.length;i++) if(a.tb[i]!==b.tb[i]) return a.tb[i]-b.tb[i];
  return 0;
}
function combos3of5(a){ // C(5,3)=10
  const o=[]; for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<5;k++)o.push([a[i],a[j],a[k]]); return o;
}
// Best 5-card hand using exactly 2 from hand + 3 from board (board: 3, 4, or 5 cards)
function bestOnBoard(hand, board){
  let best=null;
  const h2=combos2(hand), b3=combos3(board);
  for(let i=0;i<h2.length;i++) for(let j=0;j<b3.length;j++){
    const e=eval5([h2[i][0],h2[i][1],b3[j][0],b3[j][1],b3[j][2]]);
    if(!best||cmp5(e,best)>0) best=e;
  }
  return best;
}
// Best PLO hand on a full 5-card board (exactly 2+3, 60 combos)
function ploBest(hero4, board5){
  let best=null;
  const h2=combos2(hero4), b3=combos3of5(board5);
  for(let i=0;i<h2.length;i++) for(let j=0;j<b3.length;j++){
    const e=eval5([h2[i][0],h2[i][1],b3[j][0],b3[j][1],b3[j][2]]);
    if(!best||cmp5(e,best)>0) best=e;
  }
  return best;
}
function equityVsRandom(hero4, iters){
  const base=fullDeck().filter(c=>!hero4.some(h=>h.r===c.r&&h.s===c.s));
  let win=0,tie=0;
  for(let i=0;i<iters;i++){
    // partial Fisher-Yates: only need 9 cards
    const d=base.slice();
    for(let k=0;k<9;k++){ const j=k+((Math.random()*(d.length-k))|0); const t=d[k]; d[k]=d[j]; d[j]=t; }
    const a=ploBest(hero4,[d[4],d[5],d[6],d[7],d[8]]);
    const b=ploBest([d[0],d[1],d[2],d[3]],[d[4],d[5],d[6],d[7],d[8]]);
    const cmp=cmp5(a,b);
    if(cmp>0)win++; else if(cmp===0)tie++;
  }
  return (win+tie/2)/iters;
}

function classify(h){
  const parts=[];
  const ranks=h.map(c=>c.r).sort((a,b)=>b-a);
  const rc={}; ranks.forEach(r=>rc[r]=(rc[r]||0)+1);
  const prs=Object.keys(rc).filter(r=>rc[r]>=2).map(Number).sort((a,b)=>b-a);
  if(prs.length>=2) parts.push('Two pair '+prs.slice(0,2).map(r=>RANKS[r]+RANKS[r]).join(' '));
  else if(prs.length===1){
    if(rc[prs[0]]===2) parts.push('Pair of '+RANKS[prs[0]]+'s');
    else if(rc[prs[0]]===3) parts.push('Trips '+RANKS[prs[0]]+'s (dead card!)');
    else parts.push('Quads (two dead cards!)');
  }
  const sc={}; h.forEach(c=>sc[c.s]=(sc[c.s]||0)+1);
  const cc=Object.values(sc).sort((a,b)=>b-a);
  parts.push(cc[0]===2&&cc[1]===2?'double-suited':(cc[0]>=2?'single-suited':'rainbow'));
  const dr=[...new Set(ranks)].sort((a,b)=>a-b);
  let best=1,cur=1;
  for(let i=1;i<dr.length;i++){ if(dr[i]===dr[i-1]+1){cur++; if(cur>best)best=cur;} else cur=1; }
  if(best>=4) parts.push(best+'-card rundown');
  else if(best===3) parts.push('3-connected');
  const nodraw = prs.length===0 && cc[0]<2 && best<3;
  if(nodraw) parts.push('unconnected');
  return parts.join(', ');
}

// First-in ranges, 9-handed: minimum preflop equity vs a random hand.
// Thresholds are the equity percentiles matching solver-derived first-in
// frequencies (measured from 400 sampled hands: top14%=56.9, top48%=50.3, …).
const POSITIONS=[
  {n:'UTG', eq:0.569},{n:'UTG+1', eq:0.562},{n:'MP', eq:0.556},
  {n:'HJ', eq:0.548},{n:'CO', eq:0.534},{n:'BTN', eq:0.503},{n:'SB', eq:0.526},
];

// Equity vs random, preflop — validated sim table (cross-checked vs published figures)
const EQUITY_BANK=[
  ['AsAhKsKh',71.1],['AsAhJsJh',70.9],['AsAhQsQh',70.8],
  ['AsKsAhKd',68.2],['KsKhQsQh',68.1],['AsKhAdKc',64.9],
  ['TsTh9s9h',63.0],['QsJsThTc',61.3],['AsKsQdJd',61.2],['AsAh7d2c',61.1],
  ['KsQsJdTd',59.2],['JsTs9d8d',55.5],['As9s8h7d',54.2],
  ['9s8s7d6d',50.6],['JsTh9d8c',49.2],
];

if(typeof module!=='undefined'){
  module.exports={RANKS,SUIT_LETTER,SUIT_SYM,cardStr,parseHand,fullDeck,shuffle,
    combos2,combos3,isStraight5,makesStraight,straightOuts,
    eval5,cmp5,ploBest,bestOnBoard,equityVsRandom,classify,
    POSITIONS,EQUITY_BANK};
}
