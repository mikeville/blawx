import test from 'node:test';
import assert from 'node:assert/strict';
import { mountGenerationProgress } from '../src/generation-progress.js';

function harness(estimateRange = null, elapsedHost = null) {
  let now=0, tick, cleared=false, cancelled=0;
  const item=()=>({dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}});
  const items=Array.from({length:3},item),elapsed={remove(){this.removed=true;}},live={},events=new Map();
  const internalElapsedHost={remove(){this.removed=true;}};
  const statusHost={};
  const cancel={addEventListener(k,v){events.set(k,v);},removeEventListener(k){events.delete(k);}};
  const root={querySelectorAll(){return items;},querySelector(selector){return {'.generation-elapsed':elapsed,'.generation-elapsed-slot':internalElapsedHost,'.generation-phase-live':live,'.generation-cancel':cancel,'.generation-actions':statusHost}[selector];},insertBefore(node){this.inserted=node;}};
  const host={innerHTML:'',querySelector(){return root;},replaceChildren(){this.empty=true;}};
  const progress=mountGenerationProgress(host,{estimateRange,elapsedHost,now:()=>now,onCancel:()=>cancelled++,setIntervalFn(fn){tick=fn;return 1;},clearIntervalFn(){cleared=true;}});
  return {items,elapsed,internalElapsedHost,statusHost,root,live,events,host,progress,advance(ms){now=ms;tick();},get cleared(){return cleared;},get cancelled(){return cancelled;}};
}

test('elapsed time never fabricates phase completion',()=>{
  const h=harness();
  h.advance(120000);
  assert.deepEqual(h.items.map(i=>i.dataset.state),['current','future','future']);
  assert.equal(h.live.textContent,'Designing');
  assert.equal(h.elapsed.textContent,'2:00 elapsed');
  h.progress.setPhase('bricks');
  assert.deepEqual(h.items.map(i=>i.dataset.state),['complete','current','future']);
  assert.equal(h.live.textContent,'Stacking bricks');
  h.progress.setPhase('guide');
  assert.equal(h.items[2].attributes['aria-current'],'step');
  h.progress.complete();
  assert.ok(h.cleared && h.host.empty);
  assert.equal(h.events.size,0);
});

test('an external prompt status hosts only the temporary elapsed timer',()=>{
  const elapsedHost={append(node){this.child=node;}};
  const h=harness(null,elapsedHost);
  assert.equal(elapsedHost.child,h.elapsed);
  assert.equal(h.internalElapsedHost.removed,true);
  assert.equal(h.progress.statusHost,h.statusHost);
  h.progress.complete();
  assert.equal(h.elapsed.removed,true);
});

test('a supplied measured range gives way to overrun copy without inventing a new estimate',()=>{
  const h=harness([25,45]);
  h.advance(30000);assert.equal(h.elapsed.textContent,'0:30 elapsed · usually 25–45s');
  h.advance(46000);assert.equal(h.elapsed.textContent,'0:46 elapsed · longer than estimated');
  assert.equal(h.live.textContent,'Designing');
  h.events.get('click')();assert.equal(h.cancelled,1);
  h.progress.dispose();
  const invalid=harness([60,20]);
  invalid.advance(10000);assert.equal(invalid.elapsed.textContent,'0:10 elapsed');
  invalid.progress.dispose();
});
