(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.FleetShipCargoLimits=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const CAPACITIES=Object.freeze({starter:60,hunter:30,battleship:120,carrier:75,stealth:40});
  const capacity=id=>typeof id==='string' && Object.hasOwn(CAPACITIES,id)?CAPACITIES[id]:CAPACITIES.starter;
  return Object.freeze({CAPACITIES,capacity,MAX_CARGO:120});
});
