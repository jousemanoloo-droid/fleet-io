// Catálogo único para Node y presentación. La concesión de recursos vive en Node.
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.FleetResourceTypes=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const RESOURCES=Object.freeze({
    titanium_scrap:Object.freeze({rarity:'common',weight:1,baseCredits:10,icon:'⬡',color:0x75dfff}),
    quantum_crystal:Object.freeze({rarity:'rare',weight:3,baseCredits:75,icon:'◇',color:0x658cff}),
    alien_tech_core:Object.freeze({rarity:'epic',weight:8,baseCredits:400,icon:'✧',color:0xc896ff}),
    dark_matter_shard:Object.freeze({rarity:'legendary',weight:15,baseCredits:2000,icon:'◆',color:0xffce54}),
  });
  const LEGACY=Object.freeze({titanium:'titanium_scrap',plasma_core:'quantum_crystal',alien_relig:'alien_tech_core'});
  const isResource=id=>typeof id==='string' && Object.hasOwn(RESOURCES,id);
  return Object.freeze({RESOURCES,LEGACY,isResource});
});
