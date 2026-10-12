'use strict';
const DEFAULT_BLOCKED=['NAZI','HITLER','KKK','FUCK','SHIT','NIGGER','PUTA','PUTO'];
function normalizeTag(raw) {
  if(typeof raw!=='string' || raw.length>32)return null;
  const tag=raw.normalize('NFKC').trim().toUpperCase().replace(/^\[([A-Z0-9]+)\]$/,'$1');
  if(!/^[A-Z0-9]{2,8}$/.test(tag))return null;
  const folded=tag.replace(/[013457]/g,n=>({'0':'O','1':'I','3':'E','4':'A','5':'S','7':'T'}[n]));
  const blocked=[...DEFAULT_BLOCKED,...(process.env.CLAN_BLOCKED_TAGS || '').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)];
  if(blocked.some(word=>tag.includes(word) || folded.includes(word)))return null;
  return tag;
}
class Clans {
  constructor({maxClans=256,maxMembers=64}={}) {this.clans=new Map();this.memberships=new Map();this.maxClans=maxClans;this.maxMembers=maxMembers;}
  tag(id) {return this.memberships.get(id) || null;}
  join(id,raw) {
    const tag=normalizeTag(raw);if(!tag)return {ok:false,error:'error.clanTag'};
    if(this.tag(id)===tag)return {ok:true,tag};
    const group=this.clans.get(tag);
    const oldWillEmpty=this.clans.get(this.tag(id))?.size===1;
    if(group?.size>=this.maxMembers || !group && this.clans.size-(oldWillEmpty?1:0)>=this.maxClans)return {ok:false,error:'error.clanFull'};
    this.leave(id);
    const members=this.clans.get(tag) || new Set();members.add(id);this.clans.set(tag,members);this.memberships.set(id,tag);
    return {ok:true,tag};
  }
  leave(id) {
    const tag=this.tag(id);if(!tag)return;
    const members=this.clans.get(tag);members?.delete(id);if(!members?.size)this.clans.delete(tag);this.memberships.delete(id);
  }
  ranking(players) {
    const totals=new Map();
    for(const p of players) {
      const tag=this.tag(p.id);if(!tag || p.isBot)continue;
      const row=totals.get(tag) || [tag,0,0];
      row[1]+=Math.max(0,Math.floor(Number.isFinite(p.score)?p.score:0));row[2]++;totals.set(tag,row);
    }
    return [...totals.values()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,10);
  }
  destroy() {this.clans.clear();this.memberships.clear();}
}
module.exports={Clans,normalizeTag};
