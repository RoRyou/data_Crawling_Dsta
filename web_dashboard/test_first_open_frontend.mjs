// First-entry statistics and a DOM-independent rendering check. No source requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const directory=path.dirname(fileURLToPath(import.meta.url));
const appFile=process.env.JOURNAL_TEST_APP||path.join(directory,"assets/app.js");
const appSource=fs.readFileSync(appFile,"utf8");
const htmlSource=fs.readFileSync(path.join(path.dirname(appFile),"index.html"),"utf8");
assert.match(htmlSource,/id="first-open-panel"/);
assert.match(htmlSource,/id="first-open-window"/);
assert.match(htmlSource,/入口间隔，不是开店累计/);

class Element {
  constructor(id) {this.id=id;this.value=id==="first-open-window"?"30":"";this.hidden=false;this.checked=false;this.events={};this.textContent="";this._html="";this.dataset={};this.classList={toggle(){}};}
  set innerHTML(value) {this._html=value;if(["date","category","archive-date"].includes(this.id)) this.value=value.match(/<option value="([^"]*)"/)?.[1]||"";}
  get innerHTML() {return this._html;}
  addEventListener(event,fn) {this.events[event]=fn;}
  remove() {}
  focus() {this.focused=true;}
  scrollIntoView() {this.scrolled=true;}
}
const detail=(step,amount,extra={})=>({quality:"complete",step,step_quality:"observed",amount,amount_quality:"estimated",
  depth_base:600,depth_ratio:step/600,entry_time:"10:20",reason:"confirmed",...extra});
const row=(date,first,extra={})=>({date,category:"C0001",observations:1000,delta:0,counter_a:1,counter_b:1,
  first_open_detail:first,...extra});
const history=[
  row("2026-10-16",detail(100,3000)),
  row("2026-10-15",detail(200,3500,{depth_base:null,depth_ratio:null})),
  row("2026-10-14",detail(0,4000,{amount_quality:"lower_bound"})),
  row("2026-10-13",{quality:"no_event"}),
  row("2026-10-12",{quality:"no_play"},{observations:0}),
  row("2026-10-11",{quality:"unsupported_mapping"}),
  row("2026-10-17",detail(99999,99999),{category:"C0002"}),
  row("2026-09-01",detail(99999,99999))
];
const entity={...history[0],entity:633,observed:true,curve:{points:[],end_delta:null},
  event_detail:{quality:"missing",order_quality:"missing",visible_a:0,visible_b:0,events:[]}};
const values={
  index:{latest_date:"2026-10-16",first_date:"2026-09-01",generated_at:"2026-10-16 12:00:00",days:[{date:"2026-10-16",entities:1,categories:1,events_complete:0}],
    archives:[],source_entity_days:7,collection:{},category_labels:{C0001:"短名称"}},
  "day:2026-10-16":{date:"2026-10-16",entities:[entity]},
  "entity:633":history
};
const elements=new Map(),get=id=>{if(!elements.has(id)) elements.set(id,new Element(id));return elements.get(id);};
get("sort").value="entity";get("error").hidden=true;
const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,setTimeout,document:{
  getElementById:get,querySelectorAll:()=>[],createElement:tag=>new Element(tag),
  head:{appendChild(script){queueMicrotask(()=>{
    const file=script.src.split("?")[0];
    const key=file==="data/index.js"?"index":file.startsWith("data/days/")?`day:${path.basename(file,".js")}`:`entity:${path.basename(file,".js")}`;
    context.window.JournalData.deliver(key,structuredClone(values[key]));script.onload?.();
  });}}
}});
vm.runInContext(appSource,context);
await new Promise(resolve=>setTimeout(resolve,30));
const summarize=context.window.JournalFirstOpen.summarize;
let summary=summarize(history,"2026-10-16","C0001",{days:7});
assert.equal(summary.start,"2026-10-10");assert.equal(summary.end,"2026-10-16");
assert.equal(summary.counts.complete,3);assert.equal(summary.counts.no_event,1);
assert.equal(summary.counts.no_play,1);assert.equal(summary.counts.unknown,1);assert.equal(summary.counts.missing,1);
assert.equal(summary.step.n,3);assert.equal(summary.step.mean,100);assert.equal(summary.step.median,100);
assert.equal(summary.step.min,0);assert.equal(summary.step.max,200);
assert.equal(summary.step.within100,2/3);assert.equal(summary.step.within200,1);
assert.equal(summary.amount.n,2);assert.equal(summary.amount.mean,3250);assert.equal(summary.amount.median,3250);
assert.equal(summary.amount.min,3000);assert.equal(summary.amount.max,3500);
assert.equal(summary.amount.over3000,0.5,"Strictly greater than 3,000 excludes exactly 3,000");
assert.equal(summary.lowerBoundDays,1);assert.equal(summary.depth.n,2);
assert.equal(summary.depth.mean,1/12);assert.equal(summary.changedAt,undefined,"Future category changes cannot affect the cutoff");
assert.equal(summary.step.bins.reduce((n,b)=>n+b.count,0),3);
assert.equal(summary.amount.bins.reduce((n,b)=>n+b.count,0),2);
assert.equal(summary.amount.bins.filter(b=>b.count).every(b=>b.share===0.5),true);
assert.equal(summary.rows.find(r=>r.date==="2026-10-14").amount,null);
assert.equal(summary.rows.find(r=>r.date==="2026-10-14").lowerBound,4000);

const replacement=[row("2026-10-10",detail(99999,99999)),
  row("2026-10-11",detail(99999,99999),{category:"C0002"}),row("2026-10-12",detail(120,500)),row("2026-10-16",detail(140,1000))];
summary=summarize(replacement,"2026-10-16","C0001",{days:7});
assert.equal(summary.changedAt,"2026-10-11");assert.equal(summary.counts.excluded,2);
assert.equal(summary.step.n,2);assert.equal(summary.step.mean,130);
for(const first of [undefined,{quality:"complete"},detail(null,null),detail(-1,undefined),detail("100","500"),
  detail(100,500,{quality:"counter_mismatch"}),detail(100,500,{quality:"ambiguous_order"}),
  detail(100,500,{step_quality:"unavailable",amount_quality:"unavailable"})]) {
  const invalid=summarize([row("2026-10-16",first)],"2026-10-16","C0001");
  assert.equal(invalid.step.n,0);assert.equal(invalid.amount.n,0);assert.equal(invalid.depth.n,0);
}
summary=summarize([row("2026-10-16",detail(99,0,{depth_base:null,depth_ratio:0.2}))],"2026-10-16","C0001");
assert.equal(summary.depth.n,0,"A ratio without a verified baseline is not displayed");
assert.equal(summary.amount.n,1);assert.equal(summary.amount.mean,0,"Observed zero amount is not a missing value");
summary=summarize([row("2026-10-16",detail(100,-1))],"2026-10-16","C0001");
assert.equal(summary.amount.n,0,"Negative values are invalid for a visible peak rise");
assert.equal(summary.amount.bins[0].lo,0,"The distribution starts at zero without a negative bin");
assert.equal(summary.amount.bins.length,11);
assert.equal(summarize([],"2024-03-01","C0001").start,"2024-02-01");
assert.equal(summarize([],"2026-01-01","C0001").start,"2025-12-03");
assert.equal(summarize([],"2026-10-16","C0001",{days:999}).days,30);

assert.equal(get("error").hidden,true,get("error").textContent);
assert.equal(get("first-open-panel").hidden,false);
assert.equal(get("first-open-title").textContent,"633 项 · 每日首次事件与首轮");
assert.match(get("first-open-range").textContent,/2026-10-16 · 短名称/);
assert.match(get("first-open-stats").innerHTML,/3 \/ 30/);
assert.match(get("first-open-step-chart").innerHTML,/<svg/);
assert.match(get("first-open-step-chart").innerHTML,/纵轴为天数/);
assert.match(get("first-open-step-chart").innerHTML,/3 天/);
assert.doesNotMatch(get("first-open-step-chart").innerHTML,/style=/,"CSP does not permit inline styles");
assert.match(get("first-open-note").textContent,/不是开店至首次事件的累计观察量/);
assert.match(get("first-open-note").textContent,/不替代已核验的锚点标签/);
assert.match(get("first-open-stats").innerHTML,/估计值 &gt;3,000|估计值 >3,000/);
assert.match(get("first-open-rows").innerHTML,/≥4,000（仅下界）/);
assert.equal((get("first-open-rows").innerHTML.match(/data-first-open-date=/g)||[]).length,30);
get("first-open-open").events.click();assert.equal(get("first-open-panel").scrolled,true);
get("first-open-window").value="7";get("first-open-window").events.change();
assert.match(get("first-open-stats").innerHTML,/3 \/ 7/);
get("search").value="not-an-entity";get("search").events.input();
assert.equal(get("first-open-panel").hidden,true);
assert.equal(get("first-open-open").disabled,true);
console.log("First-entry frontend checks passed");
