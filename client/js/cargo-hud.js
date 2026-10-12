// Componente de presentación: solo muestra volumen confirmado por el servidor.
(function(global){
  'use strict';
  const I=global.FleetI18n;
  class CargoHUD {
    constructor(){
      this.element=document.createElement('div');this.element.className='cargo-hud';
      this.label=document.createElement('div');this.meter=document.createElement('div');
      this.meter.className='cargo-meter';this.meter.setAttribute('role','progressbar');this.meter.setAttribute('aria-valuemin','0');
      this.fill=document.createElement('div');this.fill.className='cargo-fill';this.meter.append(this.fill);
      this.element.append(this.label,this.meter);document.body.append(this.element);
    }
    static status(used,capacity){
      const ratio=used/capacity;
      return ratio<0.7?'normal':ratio<0.9?'warning':ratio<1?'danger':'full';
    }
    update(used,capacity,visible=true){
      if(!Number.isSafeInteger(used) || used<0 || !Number.isSafeInteger(capacity) || capacity<=0 || used>capacity)return false;
      this.element.className='cargo-hud cargo-'+CargoHUD.status(used,capacity);
      I.render(this.label,I.m('extraction.cargo',{used,capacity}));
      this.fill.style.width=(used/capacity*100)+'%';this.element.hidden=!visible;
      this.meter.setAttribute('aria-valuenow',String(used));this.meter.setAttribute('aria-valuemax',String(capacity));
      I.render(this.meter,I.m('extraction.cargo',{used,capacity}),'@aria-label');return true;
    }
    destroy(){for(const n of [this.element,this.label,this.meter,this.fill])I.unbind(n);this.element.remove();}
    static generateTextures(scene){
      if(!scene.textures?.exists || !scene.make?.graphics)return;
      for(const [id,rule]of Object.entries(global.FleetResourceTypes.RESOURCES)){
        const key='fleet-resource-'+id;if(scene.textures.exists(key))continue;
        const g=scene.make.graphics({x:0,y:0},false);
        g.fillStyle(rule.color,0.1).fillCircle(16,16,15);
        g.fillStyle(rule.color,0.25).fillCircle(16,16,10);
        g.lineStyle(2,rule.color,1);
        if(rule.rarity==='common')g.strokeCircle(16,16,6);
        else {
          g.beginPath().moveTo(16,5).lineTo(25,16).lineTo(16,27).lineTo(7,16).closePath().strokePath();
          if(rule.rarity==='legendary')g.lineStyle(1,0xfff1ad,1).strokeCircle(16,16,13);
        }
        g.fillStyle(0xffffff,1).fillCircle(16,16,2);g.generateTexture(key,32,32);g.destroy();
      }
    }
  }
  global.FleetCargoHUD=CargoHUD;
})(window);
