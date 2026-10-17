// UI-06/UI-07: links preserve archived cutoffs, categories, probabilities and scores.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const folder=path.dirname(fileURLToPath(import.meta.url));
const appFile=process.env.JOURNAL_TEST_APP||path.join(folder,"assets/app.js");
const source=fs.readFileSync(appFile,"utf8"),html=fs.readFileSync(path.join(path.dirname(appFile),"index.html"),"utf8");
assert.match(html,/id="history-navigation-note"/);
assert.match(html,/id="weight-explanation"/);
assert.doesNotMatch(source,/类别项未验证 · 0\.35 未计入/);

class Element {
  constructor(id){this.id=id;this.value="";this.hidden=false;this.checked=false;this.events={};this.textContent="";this.dataset={};this._html="";this.classList={toggle(){}};}
  set innerHTML(value){this._html=value;if(["date","category","archive-date"].includes(this.id))this.value=value.match(/<option value="([^"]*)"/)?.[1]||"";}
  get innerHTML(){return this._html;}
  addEventListener(type,fn){this.events[type]=fn;}
  remove(){}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
}
const row=(date,entity,category,observations=100)=>({date,entity,category,observations,delta:50,counter_a:1,counter_b:0,
  observed:observations>0,curve:{points:[],end_delta:null},event_detail:{quality:"missing",order_quality:"missing",events:[]}});
const unit10=[row("2026-10-14",10,"C0001"),row("2026-10-15",10,"C0001"),row("2026-10-16",10,"C0001"),row("2026-10-17",10,"C0002")];
const unit20=[row("2026-10-14",20,"C0001",0),row("2026-10-15",20,"C0002"),row("2026-10-16",20,"C0002")];
const unit30=[row("2026-10-16",30,"C0002")];
const archive={target_date:"2026-10-17",source_cutoff:"2026-10-16",
  candidates:[{entity:10,category:"C0001",rank:1,p_high:.42,actual_delta:null,matched:null}],auc:[],
  weights:[{entity:10,category:"C0001",score:.234,scope:"formal_eligible",status:"full_ghoul_experimental",asof:"2026-10-15"},
    {entity:20,category:"C0002",score:.123,scope:"formal_eligible",status:"partial_event_35pct_missing",asof:"2026-10-16"},
    {entity:30,category:"C0002",score:null,scope:"independent_experiment",status:"low_exposure_under_500g",asof:"2026-10-16"}]};
const originals=JSON.stringify({unit10,unit20,unit30,archive});
const manifest={latest_date:"2026-10-16",first_date:"2026-10-14",generated_at:"2026-10-17T02:00:00+09:00",archives:["2026-10-17","2026-10-16"],
  source_entity_days:7,collection:{},category_labels:{C0001:"Alpha",C0002:"Beta"},days:["2026-10-16","2026-10-15","2026-10-14"].map(date=>({date,entities:date==="2026-10-16"?3:2,categories:2,events_complete:0}))};
const data={index:manifest,"entity:10":unit10,"entity:20":unit20,"entity:30":unit30,"archive:2026-10-17":archive};
data["archive:2026-10-16"]={...structuredClone(archive),target_date:"2026-10-16",source_cutoff:"2026-10-15",weights:[]};
for(const date of ["2026-10-16","2026-10-15","2026-10-14"])data[`day:${date}`]={date,entities:[...unit10,...unit20,...unit30].filter(r=>r.date===date)};
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
const nav=["daily","archive","about"].map(view=>{const e=new Element(view);e.dataset.view=view;return e;});
get("sort").value="entity";get("error").hidden=true;
const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,setTimeout,document:{getElementById:get,querySelectorAll:()=>nav,
  createElement:tag=>new Element(tag),head:{appendChild(script){queueMicrotask(()=>{
    const filename=script.src.split("?")[0],type=filename.startsWith("data/units/")?"entity":filename.startsWith("data/days/")?"day":filename.startsWith("data/archives/")?"archive":"index";
    const key=type==="index"?type:`${type}:${path.basename(filename,".js")}`;
    context.window.JournalData.deliver(key,structuredClone(data[key]));script.onload?.();
  });}}}});
vm.runInContext(source,context);
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
await settle();
assert.equal(get("error").hidden,true,get("error").textContent);
const {resolve,open}=context.window.JournalNavigation;
assert.equal(typeof resolve,"function","The former static tables cannot navigate to machine history");
let resolved=resolve(unit10,"C0001","2026-10-16",manifest.days.map(r=>r.date));
assert.equal(resolved.date,"2026-10-16");assert.equal(resolved.categoryChanged,false);
resolved=resolve(unit20,"C0001","2026-10-16",manifest.days.map(r=>r.date));
assert.equal(resolved.date,"2026-10-14");assert.equal(resolved.categoryChanged,true);assert.equal(resolved.earlierThanCutoff,true);
assert.equal(resolve(unit30,"C0001","2026-10-16",manifest.days.map(r=>r.date)),null);
assert.equal(resolve(unit10,"C0001","2026-10-13",manifest.days.map(r=>r.date)),null);
assert.equal(resolve(unit10,"C0001","2026-10-16",["2026-10-14"]).date,"2026-10-14");

nav[1].events.click();await settle();
assert.match(get("predictions").innerHTML,/data-history-entity="10"/);
assert.match(get("predictions").innerHTML,/data-history-cutoff="2026-10-16"/);
assert.match(get("predictions").innerHTML,/42\.0%/);
assert.match(get("weights").innerHTML,/0\.234/);assert.match(get("weights").innerHTML,/0\.123/);
assert.match(get("weights").innerHTML,/完整固定试验分（非概率）/);
assert.match(get("weights").innerHTML,/专属系数 0\.35 未启用/);
assert.match(get("weights").innerHTML,/前日观察量低于 500 · 未评分/);
assert.doesNotMatch(get("weights").innerHTML,/类别项未验证|full_ghoul_experimental|low_exposure_under_500g/);
assert.match(get("weight-explanation").textContent,/不是缺失了 35% 的数据/);
assert.match(get("weight-explanation").textContent,/不会除以 0\.65/);
assert.match(get("weight-explanation").textContent,/完整固定评分的类别：Alpha/);
assert.match(get("weight-explanation").textContent,/不对所有类别重新套用 500 门槛/);

const click=(container,entity,category,cutoff)=>get(container).events.click({target:{closest:selector=>{
  assert.equal(selector,"[data-history-entity]");return {dataset:{historyEntity:String(entity),historyCategory:category,historyCutoff:cutoff,historyTarget:"2026-10-17"}};
}}});
await click("predictions",10,"C0001","2026-10-16");
assert.equal(get("daily-view").hidden,false);assert.equal(get("archive-view").hidden,true);
assert.equal(get("date").value,"2026-10-16");assert.equal(get("entity-title").textContent,"10 项");
assert.equal(get("history-panel").scrolled,true);
assert.match(get("history-navigation-note").textContent,/不使用预测目标日或其后的数据/);
assert.ok([...get("history-rows").innerHTML.matchAll(/data-history-date="([^"]+)"/g)].every(m=>m[1]<="2026-10-16"));
nav[1].events.click();await settle();
await click("weights",10,"C0001","2026-10-15");
assert.equal(get("date").value,"2026-10-15","Weight history uses its archived as-of, not a later date");
nav[1].events.click();await settle();
await click("predictions",20,"C0001","2026-10-16");
assert.equal(get("date").value,"2026-10-14");assert.equal(get("entity-title").textContent,"20 项");
assert.equal(get("play-status").textContent,"未活动","0G history is navigable, not replaced by an active unit");
assert.match(get("history-navigation-note").textContent,/已回溯/);assert.match(get("history-navigation-note").textContent,/类别变化/);
nav[1].events.click();await settle();
const before=get("date").value;
assert.equal(await open({entity:30,category:"C0001",cutoff:"2026-10-16",target:"2026-10-17"}),null);
assert.equal(get("archive-view").hidden,false);assert.equal(get("date").value,before);
assert.match(get("history-navigation-note").textContent,/没有可用的同类别历史/);
assert.equal(await open({entity:10,category:"C0001",cutoff:"2026-10-17",target:"2026-10-17"}),null,"No target-day feature window");
const results=await Promise.all([open({entity:10,category:"C0001",cutoff:"2026-10-15",target:"2026-10-17"}),
  open({entity:20,category:"C0002",cutoff:"2026-10-16",target:"2026-10-17"})]);
assert.equal(results[0],null);assert.equal(results[1].date,"2026-10-16");assert.equal(get("entity-title").textContent,"20 项");
nav[1].events.click();await settle();
const pendingOldArchive=open({entity:10,category:"C0001",cutoff:"2026-10-16",target:"2026-10-17"});
get("archive-date").value="2026-10-16";get("archive-date").events.change();
assert.equal(await pendingOldArchive,null,"Changing the archive target cancels its older pending history navigation");
await settle();
assert.equal(get("archive-view").hidden,false);assert.equal(get("history-navigation-note").hidden,true);
assert.match(get("archive-cutoff").textContent,/目标日 2026-10-16/);
assert.equal(get("error").hidden,true,get("error").textContent);
assert.equal(JSON.stringify({unit10,unit20,unit30,archive}),originals,"Navigation and explanations cannot change archived values");
console.log("Archive navigation and fixed-weight explanation checks passed (UI-06/UI-07).");
