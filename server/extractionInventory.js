'use strict';
const Rules=require('../client/js/extraction-rules');
const {capacity,MAX_CARGO}=require('./shipCargoLimits');
const {RESOURCES}=require('./resourceTypes');

// Un gestor por sala, sin intervalos propios ni listeners de sockets.
class ExtractionInventory {
  constructor(room,now=Date.now) {
    this.room=room;this.now=now;this.resources=new Map();this.sequence=0;this.step=0;
    // Las vinculaciones contienen solo accesores del wallet del servidor.
    this.bindings=new Map();
  }
  attach(player,binding) {
    this.bindings.set(player.id,binding);player.extractionInventory=this;
    player.inRunInventory={};player.inventoryRevision=0;
    // No se copia el stash al actor ni se incluye en snapshots públicos.
    Object.defineProperty(player,'secureStash',{configurable:true,get:()=>binding.read()?.secureStash || Rules.emptyStash()});
  }
  packet(player) {
    return {roomId:this.room.roomId,playerId:player.id,deathId:player.deathId,motionRevision:player.motionRevision || 0,
      revision:player.inventoryRevision || 0,items:{...player.inRunInventory},used:Rules.weight(player.inRunInventory || {}),capacity:capacity(player.shipClass)};
  }
  emit(event,player,data) {
    try {this.room.io.to(player.id).emit(event,data);}catch { /* El transporte no revierte una transacción completada. */ }
  }
  sync(player) {this.emit('inventory:update',player,this.packet(player));}
  reset(player) {
    player.inRunInventory={};player.inventoryRevision=(player.inventoryRevision || 0)+1;this.sync(player);
  }
  wipe(player,reason='death') {
    // Copiar y vaciar sin await: dos mensajes letales no pueden gastar el mismo botín.
    const lost=Rules.validateItems(player.inRunInventory || {},Rules.MAX_STASH)?.items || {};
    player.inRunInventory={};player.inventoryRevision=(player.inventoryRevision || 0)+1;
    this.emit('player:wipe-inventory',player,{...this.packet(player),lost,reason});
    return lost;
  }
  remove(player,reason='abandon') {
    if(!player)return;
    if(Object.keys(player.inRunInventory || {}).length)this.wipe(player,reason);
    this.bindings.delete(player.id);player.extractionInventory=null;delete player.secureStash;
  }
  collect(player,resource,quantity) {
    if(this.room.players.get(player?.id)!==player || !this.bindings.has(player.id) || !player.alive || player.hp<=0 || player.isBot || player.levelUpPending || player.evolutionPending ||
      typeof resource!=='string' || !Object.hasOwn(Rules.RESOURCES,resource) || !Number.isSafeInteger(quantity) || quantity<=0)return false;
    const valid=Rules.validateItems(player.inRunInventory || {},capacity(player.shipClass));
    if(!valid || valid.used+quantity*RESOURCES[resource].weight>capacity(player.shipClass))return false;
    player.inRunInventory={...valid.items,[resource]:(valid.items[resource] || 0)+quantity};
    player.inventoryRevision=(player.inventoryRevision || 0)+1;this.sync(player);return true;
  }
  drop(x,y,resource,quantity=1) {
    if(this.resources.size>=128 || !Number.isFinite(x) || !Number.isFinite(y) || typeof resource!=='string' || !Object.hasOwn(Rules.RESOURCES,resource) ||
      !Number.isSafeInteger(quantity) || quantity<=0 || quantity*RESOURCES[resource].weight>MAX_CARGO)return null;
    const id='resource_'+ ++this.sequence;
    this.resources.set(id,{id,x:Math.max(10,Math.min(this.room.world.width-10,x)),y:Math.max(10,Math.min(this.room.world.height-10,y)),resource,quantity,expires:this.now()+60000});
    return id;
  }
  update() {
    // Recogida a 15 Hz; movimiento, daño y el netcode previo mantienen su frecuencia.
    if(++this.step%2)return;
    const now=this.now();
    for(const [id,item]of this.resources){
      if(now>=item.expires){this.resources.delete(id);continue;}
      for(const p of this.room.players.values()){
        const reach=p.radius+18,dx=p.x-item.x,dy=p.y-item.y;
        if(dx*dx+dy*dy<=reach*reach && this.collect(p,item.resource,item.quantity)){
          this.resources.delete(id);break; // Un único ganador; si está lleno, el recurso sigue en el suelo.
        }
      }
    }
  }
  completeExtraction(player) {
    // API INTERNA. El controlador de puertas llama aquí solo después
    // de validar posición, tiempo de canalización y estado de combate en Node.
    if(this.room.players.get(player?.id)!==player || !player.alive || player.hp<=0)return {ok:false,error:'extraction.invalid'};
    const cargo=Rules.validateItems(player.inRunInventory,Rules.capacity(player.shipClass));
    const binding=this.bindings.get(player.id);
    if(!cargo || !cargo.used || !binding)return {ok:false,error:'extraction.empty'};
    const stash=Rules.validateStash(binding.read()?.secureStash);
    if(!stash || Rules.weight(stash.items)+cargo.used>stash.capacity)return {ok:false,error:'extraction.stashFull'};
    let result;
    try {result=binding.commit(cargo.items);}catch {return {ok:false,error:'extraction.persistence'};}
    if(!result?.ok)return result || {ok:false,error:'extraction.persistence'};
    // El commit durable precede al borrado; no se pierde carga ante un fallo de disco.
    this.reset(player);try{binding.notify?.();}catch{}return {ok:true,extracted:{...cargo.items}};
  }
  snapshot() {return [...this.resources.values()].map(o=>[o.id,Math.round(o.x),Math.round(o.y),o.resource,o.quantity]);}
  destroy() {
    for(const p of this.room.players.values())this.remove(p,'abandon');
    this.resources.clear();this.bindings.clear();this.room=null;
  }
}
module.exports={ExtractionInventory,...Rules};
