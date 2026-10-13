// DOM-independent smoke test of rendering and data loading, not browser visual QA.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
function readData(relative) {
  let result;
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), "utf8"), {window:{JournalData:{deliver(_key,value){result=value;}}}});
  return result;
}
const snapshot=readData("data/index.js"), latest=readData(`data/days/${snapshot.latest_date}.js`);
const initial=latest.entities.find(r=>r.entity===633)||latest.entities.find(r=>r.observed)||latest.entities[0];
class Element {
  constructor(id) {this.id=id;this.value="";this.hidden=false;this.checked=false;this.events={};this.textContent="";this._html="";this.dataset={};this.classList={toggle(){}};}
  set innerHTML(v) {this._html=v; if(["date","category","archive-date"].includes(this.id)) this.value=v.match(/<option value="([^"]*)"/)?.[1]||"";}
  get innerHTML() {return this._html;}
  addEventListener(event, fn) {this.events[event]=fn;}
  remove() {}
  click() {}
  focus() {this.focused=true;}
  scrollIntoView() {this.scrolled=true;}
}
const elements=new Map(), nav=["daily","archive","about"].map(view=>{const e=new Element(view);e.dataset.view=view;return e;});
const get=id=>{if(!elements.has(id)) elements.set(id,new Element(id));return elements.get(id);};
get("sort").value="entity";get("error").hidden=true;
const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,Blob,URL,setTimeout,document:{
  getElementById:get, querySelectorAll:()=>nav, createElement:tag=>new Element(tag),
  head:{appendChild(script){queueMicrotask(()=>{try{const file=script.src.split("?")[0];vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),context);script.onload?.();}catch(e){console.error(e);script.onerror?.();}});}}
}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
vm.runInContext(fs.readFileSync(path.join(root,"app.js"),"utf8"),context);
await settle();
assert.equal(get("error").hidden,true,get("error").textContent);
const manifest=context.window.JournalData;
assert.ok(manifest);
assert.match(get("metrics").innerHTML,/当前筛选对象/);
assert.ok(get("entities").innerHTML.includes(`data-entity="${initial.entity}"`));
assert.equal(get("entity-title").textContent,`${initial.entity} 项`);
if(initial.curve.points.length) assert.match(get("intraday-chart").innerHTML,/采样/);
assert.equal(get("history-panel").hidden,false);
assert.equal(get("history-open").disabled,false);
assert.equal(get("history-title").textContent,`${initial.entity} 项 · 30 天累计历史`);
assert.equal((get("history-rows").innerHTML.match(/data-history-date=/g)||[]).length,30);
assert.match(get("history-range").textContent,new RegExp(snapshot.latest_date));
get("history-open").events.click();
assert.equal(get("history-panel").focused,true);
assert.equal(get("history-panel").scrolled,true);

// Calendar arithmetic and exclusion rules use synthetic records with known sums.
const summarize=context.window.JournalHistory.summarize;
const sequence=Array.from({length:30},(_,i)=>{
  const d=new Date("2026-10-12T00:00:00Z");d.setUTCDate(d.getUTCDate()-29+i);
  return {date:d.toISOString().slice(0,10),category:"C0001",observations:10,delta:100};
});
let result=summarize([...sequence].reverse(),"2026-10-12","C0001");
assert.equal(result.start,"2026-09-13");assert.equal(result.end,"2026-10-12");
assert.equal(result.total,3000);assert.equal(result.counts.valid,30);
assert.equal(result.observations,300);assert.equal(result.partial,false);
assert.equal(result.rows.at(-1).cumulative,3000);
const boundaries=[...sequence,
  {date:"2026-09-12",category:"C0001",observations:100,delta:999999},
  {date:"2026-10-13",category:"C0002",observations:100,delta:999999}];
assert.equal(summarize(boundaries,"2026-10-12","C0001").total,3000);
const gaps=sequence.filter(r=>r.date!=="2026-09-15").map(r=>({...r}));
gaps.find(r=>r.date==="2026-09-16").observations=0;
gaps.find(r=>r.date==="2026-09-17").delta=null;
gaps.find(r=>r.date==="2026-09-18").observations=null;
gaps.find(r=>r.date==="2026-09-19").delta=0;
gaps.find(r=>r.date==="2026-09-20").delta=-500;
result=summarize(gaps,"2026-10-12","C0001");
assert.equal(result.total,1900);assert.equal(result.observations,270);
assert.equal(result.counts.valid,26);assert.equal(result.counts.missing,1);
assert.equal(result.counts.inactive,1);assert.equal(result.counts.invalid,2);
assert.equal(result.rows.find(r=>r.date==="2026-09-15").cumulative,null);
assert.equal(result.rows.find(r=>r.date==="2026-09-19").cumulative,200);
assert.equal(result.rows.find(r=>r.date==="2026-09-20").cumulative,-300);
assert.equal(result.positiveDays,24);assert.equal(result.negativeDays,1);assert.equal(result.partial,true);
result=summarize(sequence.map(r=>({...r,observations:0})),"2026-10-12","C0001");
assert.equal(result.total,null);assert.equal(result.observations,null);assert.equal(result.counts.inactive,30);
result=summarize(sequence.map(r=>({...r,delta:0})),"2026-10-12","C0001");
assert.equal(result.total,0);assert.equal(result.counts.valid,30);
const swapped=[
  {date:"2026-09-13",category:"C0001",observations:10,delta:9000},
  {date:"2026-09-14",category:"C0002",observations:10,delta:7000},
  {date:"2026-09-15",category:"C0001",observations:10,delta:100},
  {date:"2026-09-16",category:"C0001",observations:0,delta:0},
  {date:"2026-09-17",category:"C0001",observations:10,delta:200}];
result=summarize(swapped,"2026-09-17","C0001");
assert.equal(result.total,300);assert.equal(result.changedAt,"2026-09-14");
assert.equal(result.counts.excluded,27);
assert.equal(result.rows.find(r=>r.date==="2026-09-13").status,"excluded");
assert.equal(summarize(swapped,"2026-09-13","C0001").total,9000);
assert.equal(summarize([],"2024-03-01","C0001").start,"2024-02-01");
assert.equal(summarize([],"2026-01-01","C0001").start,"2025-12-03");

// Rapid selections must end on the last clicked entity, without stale history.
const alternatives=latest.entities.filter(r=>r.entity!==initial.entity).slice(0,2);
for(const r of alternatives) get("entities").events.click({target:{closest:()=>({dataset:{entity:String(r.entity)}})}});
await settle();
assert.equal(get("history-title").textContent,`${alternatives.at(-1).entity} 项 · 30 天累计历史`);
get("entities").events.click({target:{closest:()=>({dataset:{entity:String(initial.entity)}})}});
await settle();
get("category").value=initial.category;get("category").events.change();await settle();
assert.equal(get("row-count").textContent,`${latest.entities.filter(r=>r.category===initial.category).length} 项`);
const unplayed=latest.entities.find(r=>r.observations===0);
if(unplayed) {
  get("category").value=unplayed.category;get("search").value=String(unplayed.entity);get("search").events.input();await settle();
  assert.equal(get("play-status").textContent,"未活动");
  assert.match(get("curve-note").textContent,/0 次观察/);
}
get("search").value="nonexistent-entity";get("search").events.input();await settle();
assert.equal(get("row-count").textContent,"0 项");
assert.equal(get("source-link").hidden,true);
assert.equal(get("history-panel").hidden,true);
assert.equal(get("history-open").disabled,true);
get("search").value="";get("category").value="";
const older=snapshot.days.find(d=>d.date<snapshot.latest_date).date;
get("date").value=older;await get("date").events.change();await settle();
assert.match(get("history-range").textContent,new RegExp(older));
const displayedDays=[...get("history-rows").innerHTML.matchAll(/data-history-date="([^"]+)"/g)].map(m=>m[1]);
assert.equal(displayedDays.length,30);assert.ok(displayedDays.every(day=>day<=older));
nav[1].events.click();await settle();
assert.equal(get("archive-view").hidden,false);
if(snapshot.archives.length) assert.match(get("predictions").innerHTML,/<tr>/);
nav[2].events.click();await settle();
assert.equal(get("about-view").hidden,false);
assert.ok(get("coverage").innerHTML.includes(snapshot.source_entity_days.toLocaleString("zh-CN")));
assert.equal(get("error").hidden,true,get("error").textContent);
console.log("Frontend data/render smoke checks passed (not a browser visual test).");
