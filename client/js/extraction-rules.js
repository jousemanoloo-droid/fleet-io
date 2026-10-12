// Esquema compartido: el cliente lo usa para validar y presentar, nunca para conceder botín.
(function(root,factory){
  const node=typeof module==='object' && module.exports;
  const api=factory(node?require('./resource-types'):root.FleetResourceTypes,node?require('./ship-cargo-limits'):root.FleetShipCargoLimits);
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.FleetExtractionRules=api;
})(typeof window!=='undefined'?window:globalThis,function(Catalog,Limits){
  'use strict';
  const {RESOURCES}=Catalog,{CAPACITIES,capacity,MAX_CARGO}=Limits;
  const BASE_STASH=200,MAX_STASH=2000,STASH_STEP=100;
  const emptyStash=()=>({schemaVersion:2,capacity:BASE_STASH,items:{},revision:0});
  function validateItems(value,limit) {
    if(!value || typeof value!=='object' || Array.isArray(value))return null;
    const entries=Object.entries(value);if(entries.length>Object.keys(RESOURCES).length)return null;
    const items={};let used=0;
    for(const [id,quantity]of entries){
      if(!Object.hasOwn(RESOURCES,id) || !Number.isSafeInteger(quantity) || quantity<0 || quantity>MAX_STASH)return null;
      used+=quantity*RESOURCES[id].weight;if(used>limit)return null;
      if(quantity)items[id]=quantity;
    }
    return {items,used};
  }
  function validateStash(value) {
    if(!value || !Number.isSafeInteger(value.capacity) || value.capacity<BASE_STASH || value.capacity>MAX_STASH ||
      (value.capacity-BASE_STASH)%STASH_STEP || !Number.isSafeInteger(value.revision) || value.revision<0)return null;
    const valid=validateItems(value.items,value.capacity);
    return valid?{schemaVersion:2,capacity:value.capacity,items:valid.items,revision:value.revision}:null;
  }
  function migrateStash(value) {
    // Solo para archivos autoritativos guardados: nunca se aplica a RPC o cargas nuevas.
    if(!value || value.schemaVersion===2)return validateStash(value);
    if(!value.items || typeof value.items!=='object' || Array.isArray(value.items))return null;
    const items={},entries=Object.entries(value.items);if(entries.length>7)return null;
    for(const [old,count]of entries){
      const id=Object.hasOwn(Catalog.LEGACY,old)?Catalog.LEGACY[old]:old;
      if(!Catalog.isResource(id) || !Number.isSafeInteger(count) || count<0 || count>MAX_STASH)return null;
      items[id]=(items[id] || 0)+count;
    }
    return validateStash({...value,items});
  }
  const weight=items=>validateItems(items,MAX_STASH)?.used ?? Infinity;
  const upgradeCost=stash=>1000+(stash.capacity-BASE_STASH)*5;
  return {RESOURCES,CAPACITIES,MAX_CARGO,BASE_STASH,MAX_STASH,STASH_STEP,capacity,emptyStash,validateItems,validateStash,migrateStash,weight,upgradeCost};
});
