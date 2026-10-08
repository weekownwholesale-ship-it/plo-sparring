// engine.js — 9-handed single-board PLO sparring engine.
// Hero (seat 0) vs 5 equity-driven bots. Pot-limit, 100bb, full streets, side pots.
// Requires core.js (globals in browser, require in node).
'use strict';
const CORE = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : window;


const N = 9, SB_AMT = 0.5, BB_AMT = 1, START_STACK = 100;
const SEAT_POS = ['BTN','SB','BB','UTG','UTG+1','MP1','MP2','HJ','CO']; // (seat - button + 9) % 9
function posName(seat, button){ return SEAT_POS[(seat - button + N) % N]; }

// Hero/bot equity vs nOpp random hands from this point (board 0/3/4/5 cards).
function equityVsField(hand, board, nOpp, iters){
  if (nOpp <= 0) return 1;
  const used = new Set(hand.concat(board).map(c => c.r*4+c.s));
  const base = CORE.fullDeck().filter(c => !used.has(c.r*4+c.s));
  const runN = 5 - board.length;
  let share = 0;
  for (let i=0;i<iters;i++){
    const d = base.slice();
    const need = 4*nOpp + runN;
    for (let k=0;k<need;k++){ const j=k+((Math.random()*(d.length-k))|0); const t=d[k]; d[k]=d[j]; d[j]=t; }
    const b = board.concat(d.slice(4*nOpp, 4*nOpp+runN));
    const hb = CORE.ploBest(hand, b);
    let best = hb, winners = 1, heroBest = true;
    for (let p=0;p<nOpp;p++){
      const ob = CORE.ploBest([d[4*p],d[4*p+1],d[4*p+2],d[4*p+3]], b);
      const cmp = CORE.cmp5(ob, best);
      if (cmp>0){ best=ob; winners=1; heroBest=false; }
      else if (cmp===0) winners++;
    }
    if (heroBest) share += 1/winners;
  }
  return share/iters;
}

// Fast hand assessment for bot tiers. Returns 'strong'|'good'|'marginal'|'weak'.
function assess(hand, board, preEq){
  if (board.length === 0){
    if (preEq >= 0.60) return 'strong';
    if (preEq >= 0.55) return 'good';
    if (preEq >= 0.52) return 'marginal';
    return 'weak';
  }
  const cat = CORE.bestOnBoard(hand, board).cat;
  const sOuts = CORE.straightOuts(hand, board).length;
  let fDraw = false, nutFD = false;
  for (let s=0;s<4;s++){
    const ih = hand.filter(c=>c.s===s).length, ob = board.filter(c=>c.s===s).length;
    if (ih>=2 && ih+ob>=4){ fDraw = true; if (hand.some(c=>c.s===s&&c.r===12)) nutFD = true; }
  }
  if (cat>=3 || cat===5 || sOuts>=13) return 'strong';
  if (cat===2 || cat===4 || sOuts>=8 || nutFD) return 'good';
  if (cat===1 || sOuts>=4 || fDraw) return 'marginal';
  return 'weak';
}

class Game {
  constructor(cb){
    this.cb = cb;
    this.button = (Math.random()*N)|0;
    this.stacks = new Array(N).fill(START_STACK);
    this.heroSeat = 0;
    this.handNum = 0;
    this.sessHands = 0; this.sessNet = 0; this.sessCost = 0; this.sessGrades = [];
    try {
      const s = JSON.parse(localStorage.getItem('spar_sess')||'null');
      if (s){ this.sessHands=s.h; this.sessNet=s.n; this.sessCost=s.c; this.sessGrades=s.g||[]; }
    } catch(e){}
  }
  saveSess(){ try{ localStorage.setItem('spar_sess', JSON.stringify({h:this.sessHands,n:this.sessNet,c:this.sessCost,g:this.sessGrades.slice(-200)})); }catch(e){} }

  startHand(){
    // reset stacks if anyone is broke (rebuy to 100)
    for (let s=0;s<N;s++) if (this.stacks[s] < BB_AMT) this.stacks[s] = START_STACK;
    this.handNum++;
    this.button = (this.button+1)%N;
    const deck = CORE.shuffle(CORE.fullDeck());
    this.hole = [];
    for (let s=0;s<N;s++) this.hole.push([deck.pop(),deck.pop(),deck.pop(),deck.pop()]);
    this.deck = deck;
    this.board = [];
    this.street = 0;
    this.handBet = new Array(N).fill(0);
    this.streetBet = new Array(N).fill(0);
    this.folded = new Array(N).fill(false);
    this.allIn = new Array(N).fill(false);
    this.acted = new Array(N).fill(false);
    this.handDone = false;
    this.awaitingHero = false;
    this.grades = [];
    this.heroStartStack = this.stacks[0];
    this.winners = null;
    this.preEq = [];
    for (let s=0;s<N;s++) this.preEq.push(CORE.equityVsRandom(this.hole[s], 120));
    const sb=(this.button+1)%N, bb=(this.button+2)%N;
    this._post(sb, SB_AMT); this._post(bb, BB_AMT);
    this.currentBet = BB_AMT; this.lastRaise = BB_AMT; this.raisesThisRound = 0;
    this.actionPos = bb; // _nextToAct starts at actionPos+1 = UTG
    this.cb.feed(`<b>Hand #${this.handNum}</b> — you are <b>${posName(0,this.button)}</b>`);
    this.cb.update();
  }

  _post(s, amt){
    const a = Math.min(amt, this.stacks[s]);
    this.stacks[s]-=a; this.streetBet[s]+=a; this.handBet[s]+=a;
    if (this.stacks[s]<=0.001) this.allIn[s]=true;
  }
  _pot(){ return this.handBet.reduce((a,b)=>a+b,0); }
  _live(){ let n=0; for(let s=0;s<N;s++) if(!this.folded[s]) n++; return n; }
  _canAct(){ let n=0; for(let s=0;s<N;s++) if(!this.folded[s]&&!this.allIn[s]) n++; return n; }

  step(){
    if (this.handDone) return {t:'end'};
    if (this._live()<=1){ this._awardUncontested(); return {t:'end'}; }
    if (this._canAct()<=1){ this._dealOut(); this._showdown(); return {t:'end'}; }
    const s = this._nextToAct();
    if (s===-1){ this._endStreet(); return {t:'street'}; }
    if (s===this.heroSeat){
      this.awaitingHero = true;
      const a = this.legalActions(s);
      this.cb.heroTurn(a);
      return {t:'hero'};
    }
    const act = this._botAction(s);
    this._apply(s, act.type, act.to);
    return {t:'bot', seat:s, act};
  }

  _nextToAct(){
    for (let i=1;i<=N;i++){
      const s=(this.actionPos+i)%N;
      if (!this.folded[s] && !this.allIn[s] && !this.acted[s]) return s;
    }
    return -1;
  }

  legalActions(seat){
    const toCall = this.currentBet - this.streetBet[seat];
    const stack = this.stacks[seat];
    const pot = this._pot();
    const r = {toCall, stack, pot, canCheck:false, canFold:false, canCall:false, callAmt:0,
               canRaise:false, minTo:0, maxTo:0, isBet:false,
               currentBet:this.currentBet, streetBet:this.streetBet[seat]};
    if (toCall > 0.001){
      r.canFold = true; r.canCall = true; r.callAmt = Math.min(toCall, stack);
      if (stack > toCall + 0.001){
        r.canRaise = true;
        r.minTo = Math.min(this.currentBet + this.lastRaise, this.streetBet[seat]+stack);
        r.maxTo = Math.min(this.currentBet + pot + toCall, this.streetBet[seat]+stack);
        if (r.maxTo < r.minTo) r.minTo = r.maxTo;
      }
    } else {
      r.canCheck = true; r.isBet = true;
      if (stack > 0.001){
        r.canRaise = true;
        r.minTo = Math.min(Math.max(BB_AMT, this.lastRaise), stack);
        r.maxTo = Math.min(Math.max(pot, BB_AMT), stack);
        if (r.maxTo < r.minTo) r.minTo = r.maxTo;
      }
    }
    return r;
  }

  heroDo(type, to){
    if (!this.awaitingHero || this.handDone) return;
    this.awaitingHero = false;
    const snap = {
      pot:this._pot(), toCall:this.currentBet - this.streetBet[0],
      streetBet:this.streetBet[0], currentBet:this.currentBet,
      stack:this.stacks[0], minTo:0, maxTo:0,
      activeOpp:[], street:this.street,
    };
    const la = this.legalActions(0);
    snap.minTo=la.minTo; snap.maxTo=la.maxTo;
    for (let s=0;s<N;s++) if (s!==0 && !this.folded[s]) snap.activeOpp.push(s);
    // validate
    if (type==='fold' && !la.canFold) return;
    if (type==='check' && !la.canCheck) return;
    if (type==='call' && !la.canCall) return;
    if ((type==='bet'||type==='raise')){
      if (!la.canRaise) return;
      to = Math.max(la.minTo, Math.min(la.maxTo, to));
    }
    this._apply(0, type, to);
    this._gradeHero(snap, type, to);
    this.cb.update();
  }

  _apply(seat, type, to){
    const toCall = this.currentBet - this.streetBet[seat];
    const label = posName(seat,this.button)+(seat===0?' (you)':'');
    if (type==='fold'){
      this.folded[seat]=true; this.acted[seat]=true;
      this.cb.feed(`${label} folds`);
    } else if (type==='check'){
      this.acted[seat]=true;
      this.cb.feed(`${label} checks`);
    } else if (type==='call'){
      const amt=Math.min(toCall, this.stacks[seat]);
      this.stacks[seat]-=amt; this.streetBet[seat]+=amt; this.handBet[seat]+=amt;
      if (this.stacks[seat]<=0.001) this.allIn[seat]=true;
      this.acted[seat]=true;
      this.cb.feed(`${label} calls ${amt.toFixed(1)}`);
    } else if (type==='bet' || type==='raise'){
      const prevBet=this.currentBet, prevRaise=this.lastRaise;
      const add=Math.min(to-this.streetBet[seat], this.stacks[seat]);
      const newTo=this.streetBet[seat]+add;
      this.stacks[seat]-=add; this.streetBet[seat]=newTo; this.handBet[seat]+=add;
      const inc=newTo-prevBet;
      this.currentBet=newTo;
      const isAll=this.stacks[seat]<=0.001;
      if (isAll) this.allIn[seat]=true;
      const fullRaise = !isAll || inc>=prevRaise;
      if (fullRaise){
        this.lastRaise=inc; this.raisesThisRound++;
        for (let s=0;s<N;s++) if (s!==seat && !this.folded[s] && !this.allIn[s]) this.acted[s]=false;
      }
      this.acted[seat]=true;
      this.cb.feed(`${label} ${type}s to ${newTo.toFixed(1)}`);
    }
    this.actionPos=seat;
  }

  _endStreet(){
    if (this.street>=3){ this._showdown(); return; }
    this.street++;
    const n = this.street===1?3:1;
    for (let i=0;i<n;i++) this.board.push(this.deck.pop());
    this.streetBet=new Array(N).fill(0);
    this.acted=new Array(N).fill(false);
    this.currentBet=0; this.lastRaise=BB_AMT; this.raisesThisRound=0;
    // first to act: first live, non-allin left of button
    let first=-1;
    for (let i=1;i<=N;i++){ const s=(this.button+i)%N; if(!this.folded[s]&&!this.allIn[s]){first=s;break;} }
    this.actionPos = first===-1 ? this.button : (first-1+N)%N;
    const nm=['preflop','FLOP','TURN','RIVER'][this.street];
    this.cb.feed(`<b>— ${nm} —</b>`);
    this.cb.update();
  }

  _dealOut(){
    while (this.street<3){
      this.street++;
      const n=this.street===1?3:1;
      for (let i=0;i<n;i++) this.board.push(this.deck.pop());
    }
    this.cb.feed(`<b>— runout —</b>`);
  }

  _pots(){
    const levels=[...new Set(this.handBet.filter(x=>x>0.001))].sort((a,b)=>a-b);
    const pots=[]; let prev=0;
    for (const lv of levels){
      const n=this.handBet.filter(x=>x>=lv-0.001).length;
      const elig=[];
      for (let s=0;s<N;s++) if(!this.folded[s]&&this.handBet[s]>=lv-0.001) elig.push(s);
      pots.push({amount:(lv-prev)*n, elig});
      prev=lv;
    }
    return pots;
  }

  _showdown(){
    const pots=this._pots();
    const res=[];
    for (const p of pots){
      let best=null, win=[];
      for (const s of p.elig){
        const v=CORE.bestOnBoard(this.hole[s], this.board);
        if (!best||CORE.cmp5(v,best)>0){ best=v; win=[s]; }
        else if (CORE.cmp5(v,best)===0) win.push(s);
      }
      const share=p.amount/win.length;
      // odd chips: first winner clockwise from button
      let rem=Math.round((p.amount-share*win.length)*100)/100;
      const ordered=win.slice().sort((a,b)=>((a-this.button+N)%N)-((b-this.button+N)%N));
      for (const s of win){
        let a=share;
        if (rem>0.001){ a+=Math.min(rem,0.01); rem-=0.01; }
        this.stacks[s]+=a;
      }
      res.push({amount:p.amount, winners:win});
    }
    this.winners=res;
    this.handDone=true;
    const net=this.stacks[0]-this.heroStartStack;
    this.sessHands++; this.sessNet+=net;
    let totCost=0; for (const g of this.grades) totCost+=g.cost;
    this.sessCost+=totCost;
    this.sessGrades.push(...this.grades.map(g=>g.grade));
    this.saveSess();
    this.cb.handEnd({net, pots:res, grades:this.grades});
  }

  _awardUncontested(){
    let w=-1;
    for (let s=0;s<N;s++) if(!this.folded[s]) w=s;
    const pot=this._pot();
    this.stacks[w]+=pot;
    this.winners=[{amount:pot, winners:[w], uncontested:true}];
    this.handDone=true;
    const net=this.stacks[0]-this.heroStartStack;
    this.sessHands++; this.sessNet+=net;
    let totCost=0; for (const g of this.grades) totCost+=g.cost;
    this.sessCost+=totCost;
    this.sessGrades.push(...this.grades.map(g=>g.grade));
    this.saveSess();
    this.cb.handEnd({net, pots:this.winners, grades:this.grades, uncontested:w});
  }

  // ---- bot AI ----
  _botAction(seat){
    const la=this.legalActions(seat);
    const pos=posName(seat,this.button);
    const eq=this.preEq[seat];
    const OPEN_T={UTG:0.56,MP:0.55,CO:0.535,BTN:0.505,SB:0.52,BB:0.56};
    if (this.street===0){
      if (la.toCall>0.001){
        if (eq>=0.62 && this.raisesThisRound<2 && la.canRaise)
          return {type:'raise', to:la.maxTo};
        if (eq>=0.535 || (la.toCall<=0.05*la.pot && eq>=0.50))
          return {type:'call'};
        return {type:'fold'};
      } else {
        // first in (or BB/SB option)
        if ((pos==='SB'&&eq<0.48) || (pos==='BB'&&this.raisesThisRound===0)) {
          if (pos==='SB') return {type:'fold'};
          return {type:'check'};
        }
        if (eq>=(OPEN_T[pos]||0.55) && la.canRaise) return {type:'raise', to:la.maxTo};
        if (pos==='SB'&&eq>=0.48) return {type:'call'};
        if (pos==='BB') return {type:'check'};
        return {type:'fold'};
      }
    }
    const tier=assess(this.hole[seat], this.board, eq);
    if (la.toCall>0.001){
      const odds=la.toCall/(la.pot+la.toCall);
      if (tier==='strong'){
        if (la.canRaise && this.raisesThisRound<2 && la.toCall<0.5*la.pot) return {type:'raise', to:la.maxTo};
        return {type:'call'};
      }
      if (tier==='good') return {type:'call'};
      if (tier==='marginal' && odds<=0.28) return {type:'call'};
      if (tier==='weak' && odds<=0.06) return {type:'call'};
      return {type:'fold'};
    } else {
      if (tier==='strong' && la.canRaise) return {type:'bet', to:la.maxTo};
      if (tier==='good' && la.canRaise) return {type:'bet', to:Math.max(la.minTo,Math.min(la.maxTo,la.pot*0.65))};
      return {type:'check'};
    }
  }

  _contProb(seat, add, pot){
    const t=assess(this.hole[seat], this.board, this.preEq[seat]);
    if (t==='strong') return 0.95;
    if (t==='good') return 0.8;
    if (t==='marginal') return add < 0.3*pot ? 0.55 : 0.2;
    return 0.05;
  }

  _gradeHero(snap, type, to){
    const eq=equityVsField(this.hole[0], this.board, snap.activeOpp.length, 150);
    const pot=snap.pot, toCall=snap.toCall;
    const cont=seat=>this._contProb(seat, 0, pot); // placeholder
    const evAgg=(add)=>{
      const ps=snap.activeOpp.map(s=>this._contProb(s, add, pot));
      const pF=ps.reduce((a,p)=>a*(1-p),1);
      const eC=ps.reduce((a,p)=>a+p,0);
      const potIfCalled=pot+add+eC*add;
      return pF*pot+(1-pF)*(eq*potIfCalled-add);
    };
    const opts=[{kind:'fold', ev:0, to:0}];
    if (toCall<=0.001) opts.push({kind:'check', ev:eq*pot, to:0});
    else opts.push({kind:'call', ev:eq*(pot+toCall)-toCall, to:0});
    // candidate sizes
    const cands=[];
    if (toCall<=0.001){
      cands.push({kind:'bet', to:Math.min(snap.maxTo, Math.max(snap.minTo, pot*0.5))});
      cands.push({kind:'bet', to:snap.maxTo});
    } else {
      const halfRaise=snap.currentBet+0.5*(pot+toCall);
      cands.push({kind:'raise', to:Math.min(snap.maxTo, Math.max(snap.minTo, halfRaise))});
      cands.push({kind:'raise', to:snap.maxTo});
    }
    if (snap.stack>0.001) cands.push({kind:toCall>0.001?'raise':'bet', to:snap.streetBet+snap.stack, allin:true});
    for (const c of cands){
      if (c.to<=snap.streetBet+0.001) continue;
      const add=c.to-snap.streetBet;
      opts.push({kind:c.kind+(c.allin?'(allin)':''), ev:evAgg(add), to:c.to});
    }
    const best=opts.reduce((a,b)=>b.ev>a.ev?a:b);
    // hero's actual
    let chosen;
    if (type==='fold') chosen=opts[0];
    else if (type==='check') chosen=opts.find(o=>o.kind==='check');
    else if (type==='call') chosen=opts.find(o=>o.kind==='call');
    else {
      const add=to-snap.streetBet;
      chosen={kind:type, ev:evAgg(add), to};
    }
    const cost=Math.max(0, best.ev-chosen.ev);
    const grade = cost<=0.02*pot?'A':cost<=0.05*pot?'B':cost<=0.10*pot?'C':cost<=0.20*pot?'D':'F';
    const g={grade, cost, best:best.kind.replace('(allin)',''), eq, street:this.street};
    this.grades.push(g);
    this.cb.grade(g);
  }
}

if (typeof module!=='undefined'){ module.exports={Game, equityVsField, assess, posName, N, START_STACK}; }
else { window.SparGame=Game; window.sparEngine={equityVsField, assess, posName}; }
