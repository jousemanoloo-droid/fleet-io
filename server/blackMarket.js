'use strict';
const Recipes=require('./craftingRecipes');
const Inventory=require('../client/js/extraction-rules');
const Classes=require('../client/js/ship-classes');

class BlackMarket {
  constructor(accounts){this.accounts=accounts;}
  request(socketId,data,{player}={}) {
    const accounts=this.accounts,session=accounts.sessions.get(socketId);
    if(!session || !data || typeof data!=='object' || Array.isArray(data) ||
      !Object.hasOwn(data,'recipeId') || Object.keys(data).some(key=>key!=='recipeId') || !Recipes.recipe(data.recipeId))return {ok:false,error:'craft.invalid'};
    if(player?.alive && player.hp>0)return {ok:false,error:'craft.inRun'};
    const recipe=Recipes.recipe(data.recipeId),old=session.record.state,owned=Recipes.sanitize(old.crafted);
    // Lost acknowledgements and concurrent tabs cannot consume a recipe twice.
    if(owned.includes(recipe.id))return {...accounts.snapshot(session),alreadyOwned:true};
    if(!accounts.file || accounts.storageError)return {ok:false,error:'extraction.persistence'};
    const stash=Inventory.validateStash(old.secureStash);
    if(!stash)return {ok:false,error:'craft.invalid'};
    if(Object.entries(recipe.materials).some(([id,n])=>(stash.items[id] || 0)<n))return {ok:false,error:'craft.materials'};
    const items={...stash.items};
    for(const [id,n]of Object.entries(recipe.materials)){items[id]-=n;if(!items[id])delete items[id];}
    const state={...old,crafted:[...owned,recipe.id],secureStash:{...stash,items,revision:stash.revision+1}};
    if(recipe.kind==='skin')state.skins=[...new Set([...old.skins,recipe.id])];
    session.record.state=state;
    // One synchronous commit contains BOTH consumption and ownership. No await boundary.
    try{accounts.flush();}catch{session.record.state=old;return {ok:false,error:'extraction.persistence'};}
    if(accounts.storageError){session.record.state=old;return {ok:false,error:'extraction.persistence'};}
    session.record.revision++;
    for(const peer of accounts.sessions.values())if(peer.record===session.record){
      try{peer.socket.emit('accountState',accounts.snapshot(peer));}catch{}
    }
    return {...accounts.snapshot(session),crafted:recipe.id};
  }
}

function applyPassives(player,crafted) {
  const owned=Recipes.sanitize(crafted),base=owned.includes('reinforced_shield')?15:0;
  const old=player._craftedShieldBase || 0,ratio=player.maxHp>0?player.hp/player.maxHp:0;
  // +15% of the 100-point BASE shield; tactical points/mutations keep their own bonuses.
  // Class transformations already scale maxHp, so store the unscaled base addition.
  player.maxHp+=(base-old)*(Classes.definition(player.shipClass)?.hp || 1);
  player.hp=player.maxHp*Math.max(0,Math.min(1,ratio));player._craftedShieldBase=base;
  player.permanentUpgrades=owned;
  player.extractionDuration=owned.includes('quantum_thruster')?3000:4000;
}
module.exports={BlackMarket,applyPassives};
