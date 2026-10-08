const {Game} = require('./engine.js');
let pass=0, fail=0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('FAIL', name); } }
function mkCb(){ return {feed(){}, update(){}, heroTurn(){}, grade(){}, handEnd(){}}; }

// Play a full hand with a scripted hero strategy. Returns the game.
function playHand(heroStrat){
  const cb=mkCb();
  let heroTurns=0;
  const g=new Game(cb);
  g.startHand();
  let guard=0;
  while(!g.handDone && guard++<500){
    const r=g.step();
    if (r.t==='hero'){
      heroTurns++;
      const a=g.legalActions(0);
      heroStrat(g, a);
    }
  }
  ok('hand completes', g.handDone);
  ok('guard not hit', guard<500);
  // chip conservation
  const tot=g.stacks.reduce((x,y)=>x+y,0);
  ok('chips conserved (600)', Math.abs(tot-600)<0.05);
  return {g, heroTurns};
}

const foldAlways=(g,a)=>{ if(a.canFold) g.heroDo('fold'); else if(a.canCall) g.heroDo('call'); else g.heroDo('check'); };
const callAlways=(g,a)=>{ if(a.canCall) g.heroDo('call'); else if(a.canCheck) g.heroDo('check'); else g.heroDo('fold'); };
const aggro=(g,a)=>{ // bet pot when free, call when facing bet
  if(a.canRaise && a.toCall<=0.001) g.heroDo('bet', a.maxTo);
  else if(a.canCall) g.heroDo('call');
  else if(a.canCheck) g.heroDo('check');
  else g.heroDo('fold');
};

console.log('--- 30 hands: hero folds ---');
for(let i=0;i<30;i++) playHand(foldAlways);
console.log('--- 30 hands: hero calls down ---');
for(let i=0;i<30;i++) playHand(callAlways);
console.log('--- 30 hands: hero bets pot ---');
for(let i=0;i<30;i++) playHand(aggro);

// Pot-limit math checks
{
  const g=new Game(mkCb()); g.startHand();
  // find UTG (first to act preflop)
  const utg=(g.button+3)%6;
  if (utg===0){
    const a=g.legalActions(0);
    // pot=1.5, currentBet=1, toCall=1 → maxTo = 1+1.5+1 = 3.5
    ok('UTG max open 3.5', Math.abs(a.maxTo-3.5)<0.01);
    ok('UTG min open 2', Math.abs(a.minTo-2)<0.01);
  } else console.log('(skip: hero not UTG this deal)');
}
// Facing a pot bet: max raise = 4x-ish. Construct: force state.
{
  const g=new Game(mkCb()); g.startHand();
  // manually: give hero the button-ish spot postflop. Simpler: check formula directly.
  // pot=20 (incl 10 bet), currentBet=10, streetBet=0, toCall=10 → maxTo=10+20+10=40
  g.handBet=[20,0,0,0,0,0]; g.streetBet=[10,0,0,0,0,0]; g.currentBet=10;
  g.stacks=[100,100,100,100,100,100];
  const a=g.legalActions(1);
  ok('vs pot bet maxTo=40', Math.abs(a.maxTo-40)<0.01);
}
// Side pot: short stack all-in
{
  const g=new Game(mkCb()); g.startHand();
  g.handBet=[100,100,30,0,0,0]; // seats 0,1 all-in 100; seat2 all-in 30
  g.folded=[false,false,false,true,true,true];
  const pots=g._pots();
  ok('two pots', pots.length===2);
  ok('main pot 90', Math.abs(pots[0].amount-90)<0.01);
  ok('side pot 140', Math.abs(pots[1].amount-140)<0.01);
  ok('main elig 3', pots[0].elig.length===3);
  ok('side elig 2', pots[1].elig.length===2);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
