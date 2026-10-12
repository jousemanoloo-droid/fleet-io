'use strict';
const Catalog=require('../client/js/resource-types');
const {MAX_CARGO}=require('./shipCargoLimits');
const DARK_MATTER_CHANCE=0.03;

function burst(inventory,x,y,type,quantity) {
  if(!inventory || !Catalog.isResource(type) || !Number.isSafeInteger(quantity) || quantity<=0)return [];
  const stackLimit=Math.floor(MAX_CARGO/Catalog.RESOURCES[type].weight);
  const stacks=Math.min(4,quantity,Math.ceil(quantity/3)),ids=[];
  for(let i=0;i<stacks;i++){
    const count=Math.min(stackLimit,Math.floor(quantity/stacks)+(i<quantity%stacks?1:0));
    const theta=i*2.399963,id=inventory.drop(x+Math.cos(theta)*32,y+Math.sin(theta)*32,type,count);
    if(id)ids.push(id);
  }
  return ids;
}
function asteroidLoot(inventory,rock,random=Math.random) {
  const hp=Number.isFinite(rock.maxHp)?rock.maxHp:100;
  burst(inventory,rock.x,rock.y,'titanium_scrap',Math.min(12,Math.max(2,Math.ceil(hp/100)*2)));
  // La rareza no depende de una tirada del navegador ni de un valor del atacante.
  if((rock.gold || rock.energyRich || rock.volatile) && random()<(rock.gold?0.45:0.25))
    burst(inventory,rock.x+40,rock.y,'quantum_crystal',rock.gold?2:1);
}
function shipLoot(inventory,p,killer) {
  if(!killer || killer.id===p.id)return;
  const difficulty=Math.floor(p.level/10)+Math.ceil(p.maxHp/100)+Math.min(3,Math.floor((p.deathState?.drones || 0)/4));
  burst(inventory,p.x,p.y,'titanium_scrap',Math.max(2,Math.min(12,difficulty)));
}
function globalBossLoot(inventory,boss) {
  const rank=Math.max(1,Math.min(4,Math.ceil(boss.maxHp/3000)));
  burst(inventory,boss.x,boss.y,'titanium_scrap',rank*3);
  burst(inventory,boss.x+45,boss.y,'quantum_crystal',rank);
  burst(inventory,boss.x-45,boss.y,'alien_tech_core',Math.max(1,Math.ceil(rank/2)));
}
function blackHoleLoot(inventory,zone,random=Math.random) {
  if(zone.type!=='BLACK_HOLE' || random()>=DARK_MATTER_CHANCE)return [];
  return burst(inventory,zone.x,zone.y,'dark_matter_shard',1);
}
module.exports={...Catalog,DARK_MATTER_CHANCE,burst,asteroidLoot,shipLoot,globalBossLoot,blackHoleLoot};
