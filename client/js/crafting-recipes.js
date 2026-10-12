// Shared display catalogue. Ownership and material consumption live on the server.
(function(root,factory){
  const api=factory();if(typeof module==='object' && module.exports)module.exports=api;else root.FleetCraftingRecipes=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const RECIPES=Object.freeze({
    void_stalker:Object.freeze({id:'void_stalker',rarity:'legendary',icon:'◆',kind:'skin',
      materials:Object.freeze({titanium_scrap:25,quantum_crystal:8,alien_tech_core:2})}),
    reinforced_shield:Object.freeze({id:'reinforced_shield',rarity:'epic',icon:'⬡',kind:'module',
      materials:Object.freeze({titanium_scrap:50,quantum_crystal:12})}),
    quantum_thruster:Object.freeze({id:'quantum_thruster',rarity:'legendary',icon:'✧',kind:'module',
      materials:Object.freeze({alien_tech_core:5,dark_matter_shard:4})}),
  });
  const recipe=id=>typeof id==='string' && Object.hasOwn(RECIPES,id)?RECIPES[id]:null;
  const sanitize=value=>Array.isArray(value)?[...new Set(value.filter(id=>!!recipe(id)))]:[];
  return Object.freeze({RECIPES,recipe,sanitize});
});
