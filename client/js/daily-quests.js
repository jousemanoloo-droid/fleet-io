// Pure UTC retention rules; all state lives in the economy's single save.
(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.FleetDailyQuests=api;
})(typeof window!=='undefined'?window:globalThis,function() {
  'use strict';
  const DAY=86400000;
  const POOL=Object.freeze([
    {id:'kills',kind:'kills',target:10,reward:300},
    {id:'score',kind:'score',target:2000,reward:250},
    {id:'survive',kind:'seconds',target:180,reward:200},
    {id:'hunter',kind:'class',target:1,reward:150},
    {id:'carrier',kind:'class',target:1,reward:150},
    {id:'stealth',kind:'class',target:1,reward:150}
  ]);
  function sanitize(data) {
    if (!data || typeof data!=='object') return null;
    const day = Number.isSafeInteger(data.day) && data.day>=0 && data.day<1000000 ? data.day : -1;
    const lastClaimDay = Number.isSafeInteger(data.lastClaimDay) && data.lastClaimDay>=0 && data.lastClaimDay<1000000 ? data.lastClaimDay : -1;
    const quests=[];
    for (const q of Array.isArray(data.quests)?data.quests:[]) {
      const rule=POOL.find(item=>item.id===q?.id);
      if (!rule || quests.some(item=>item.id===rule.id) || quests.length>=3) continue;
      quests.push({...rule,progress:Number.isSafeInteger(q.progress)?Math.max(0,Math.min(rule.target,q.progress)):0,claimed:q.claimed===true});
    }
    return {day,lastClaimDay,streak:Number.isSafeInteger(data.streak)?Math.max(0,Math.min(7,data.streak)):0,quests};
  }
  function ensure(state, now) {
    const day=Math.floor(now/DAY);
    let r=state.retention=sanitize(state.retention) || {day:-1,lastClaimDay:-1,streak:0,quests:[]};
    if (day>r.day || r.day===day && r.quests.length!==3) {
      let seed=day;
      for(const char of state.profileId || 'guest') seed=(Math.imul(seed,31)+char.charCodeAt(0))|0;
      const shuffled=POOL.slice();
      for(let i=shuffled.length-1;i>0;i--) {
        seed=(Math.imul(seed,1664525)+1013904223)|0;
        const j=(seed>>>0)%(i+1); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
      }
      r.day=day; r.quests=shuffled.slice(0,3).map(q=>({...q,progress:0,claimed:false}));
    }
    return r;
  }
  function advance(r, delta, shipClass) {
    for(const q of r.quests) {
      const amount=q.kind==='class' ? (shipClass===q.id?1:0) : (delta[q.kind] || 0);
      q.progress=Math.min(q.target,q.progress+Math.max(0,amount));
    }
  }
  function claimQuest(economy,id) {
    if(economy.persistent) economy.load();
    const now=economy.utcNow(); if(now===null) return false;
    const r=ensure(economy.state,now); if(r.day!==Math.floor(now/DAY)) return false;
    const q=r.quests.find(q=>q.id===id);
    if(!q || q.claimed || q.progress<q.target) return false;
    q.claimed=true; economy.state.coins=Math.min(Number.MAX_SAFE_INTEGER,economy.state.coins+q.reward); economy.save(); return true;
  }
  function claimStreak(economy) {
    if(economy.persistent) economy.load();
    const now=economy.utcNow(); if(now===null) return false;
    const r=ensure(economy.state,now), day=Math.floor(now/DAY);
    if(day<=r.lastClaimDay || r.day!==day) return false;
    r.streak=day===r.lastClaimDay+1 ? r.streak%7+1 : 1; r.lastClaimDay=day;
    if(r.streak===7) {
      if(!economy.state.skins.includes('starlight')) economy.state.skins.push('starlight');
    } else economy.state.coins=Math.min(Number.MAX_SAFE_INTEGER,economy.state.coins+[0,100,150,200,250,300,400][r.streak]);
    economy.save(); return true;
  }
  return {DAY,POOL,sanitize,ensure,advance,claimQuest,claimStreak};
});
