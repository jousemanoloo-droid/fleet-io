(function(global){
  'use strict';
  function updateDroneCount(count){
    if(!Number.isSafeInteger(count) || count<0 || count>64)return false;
    const node=document.getElementById('escort-drones-count') || document.getElementById('hud-drones');
    if(node && node.textContent!==String(count))global.FleetI18n.render(node,String(count));return true;
  }
  global.FleetHUDUI={updateDroneCount};
})(window);
