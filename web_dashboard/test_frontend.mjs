// DOM-independent smoke test of rendering and data loading, not browser visual QA.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const appFile=process.env.JOURNAL_TEST_APP || path.join(root,"app.js");
const appSource=fs.readFileSync(appFile,"utf8");
const htmlSource=fs.readFileSync(path.join(path.dirname(appFile),"index.html"),"utf8");
assert.doesNotMatch(htmlSource,/\bid\s*=\s*(["'])download\1/i,"The export control is removed from the page");
assert.doesNotMatch(htmlSource,/导出表格|下载\s*CSV/i,"The page no longer offers table downloads");
assert.doesNotMatch(appSource,/\$\(["']download["']\)|function\s+download\s*\(|new\s+Blob\b|createObjectURL|text\/csv|\.download\s*=/,
  "The app no longer binds the export control or constructs downloadable CSV");
assert.doesNotMatch(htmlSource,/\bid\s*=\s*(["'])metrics\1/i,"The four global summary cards are removed, not hidden");
assert.doesNotMatch(appSource,/\$\(["']metrics["']\)|当前筛选对象|合计净变化 · 已活动|净变化中位数 · 已活动/,
  "The app no longer computes or renders the removed global summary row");
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
  focus() {this.focused=true;}
  scrollIntoView() {this.scrolled=true;}
}
function runApp(overrides=new Map()) {
  const elements=new Map(), nav=["daily","archive","about"].map(view=>{const e=new Element(view);e.dataset.view=view;return e;});
  const get=id=>{if(!elements.has(id)) elements.set(id,new Element(id));return elements.get(id);};
  get("sort").value="entity";get("error").hidden=true;
  const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,setTimeout,document:{
      getElementById:get, querySelectorAll:()=>nav, createElement:tag=>new Element(tag),
      head:{appendChild(script){queueMicrotask(()=>{try{
        const file=script.src.split("?")[0], replacement=overrides.get(file);
        if(replacement) context.window.JournalData.deliver(replacement.key,structuredClone(replacement.value));
        else vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),context);
        script.onload?.();
      }catch(e){console.error(e);script.onerror?.();}});}}
    }});
  vm.runInContext(appSource,context);
  return {context,get,nav};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const {context,get,nav}=runApp();
await settle();
assert.equal(get("error").hidden,true,get("error").textContent);
const manifest=context.window.JournalData;
assert.ok(manifest);
assert.ok(!htmlSource.includes('id="metrics"'));
assert.ok(get("entities").innerHTML.includes(`data-entity="${initial.entity}"`));
assert.equal(get("entity-title").textContent,`${initial.entity} 项`);
const labelFor=(manifest,code)=>manifest.category_labels?.[code] || code;
const initialName=labelFor(snapshot,initial.category);
const escaped=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function assertCategoryOrder(viewGet,records,manifest) {
  const counts=new Map();
  for(const record of records) counts.set(record.category,(counts.get(record.category)||0)+1);
  const expected=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)
    || labelFor(manifest,a).localeCompare(labelFor(manifest,b),"ja") || a.localeCompare(b));
  const options=[...viewGet("category").innerHTML.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
  assert.deepEqual(options.map(m=>m[1]),["",...expected],"Category values retain IDs in daily-count/name/ID order");
  assert.equal(options[0][2],"全部类别","All categories stays first");
  for(let i=0;i<expected.length;i++) {
    const code=expected[i];
    assert.equal(options[i+1][2],`${escaped(labelFor(manifest,code))} · ${counts.get(code)} 项`);
  }
}
assertCategoryOrder(get,latest.entities,snapshot);
assert.equal(get("entity-category").textContent,initialName);
assert.ok(get("entities").innerHTML.includes(`<small>${escaped(initialName)}</small>`));
assert.ok(get("category").innerHTML.includes(`<option value="${initial.category}">${escaped(initialName)} · `));
if(initial.curve.points.length && initial.observations>0) assert.match(get("intraday-chart").innerHTML,/变化序号/);
// Only consecutive equal values are collapsed. Returns to an earlier value
// remain visible, and displayed spacing never pretends to be time or G.
const rawCurve=[[0,0],[5,0],[20,10],[21,10],[30,-5],[31,-5],[80,0]], beforeCurve=JSON.stringify(rawCurve);
const compressed=context.window.JournalCurve.compress(rawCurve);
assert.equal(JSON.stringify(compressed.points),JSON.stringify([[0,0],[1,10],[2,-5],[3,0]]));
assert.equal(compressed.rawCount,7);assert.equal(compressed.removed,3);
assert.equal(JSON.stringify(rawCurve),beforeCurve,"Display compression does not alter source values");
assert.equal(context.window.JournalCurve.compress([[1,50],[2,50],[3,50]]).points.length,1);
assert.equal(context.window.JournalCurve.compress([]).points.length,0);
assert.equal(context.window.JournalCurve.compress([[1,null],[2,20]]).points.length,0);
assert.equal(get("history-panel").hidden,false);
assert.equal(get("history-open").disabled,false);
assert.equal(get("history-title").textContent,`${initial.entity} 项 · 30 天累计历史`);
assert.equal((get("history-rows").innerHTML.match(/data-history-date=/g)||[]).length,30);
assert.match(get("history-range").textContent,new RegExp(snapshot.latest_date));
assert.ok(get("history-range").textContent.endsWith(` · ${initialName}`));
assert.ok(get("history-rows").innerHTML.includes(`<td>${escaped(initialName)}</td>`));
assert.equal(get("interval-panel").hidden,false);
assert.equal(get("interval-open").disabled,false);
get("interval-open").events.click();
assert.equal(get("interval-panel").scrolled,true);
assert.equal(get("interval-title").textContent,`${initial.entity} 项 · 近期事件间隔分布`);
assert.match(get("interval-range").textContent,new RegExp(snapshot.latest_date));
assert.ok(get("interval-range").textContent.endsWith(` · ${initialName}`));
assert.match(get("interval-metrics").innerHTML,/当前样本数/);
assert.match(get("interval-note").textContent,/不保证是首次事件/);
if(!get("interval-chart").innerHTML.includes('class="empty"')) {
  assert.match(get("interval-chart").innerHTML,/<svg/);
  assert.match(get("interval-chart").innerHTML,/横轴为间隔区间，纵轴为整数次数/);
  assert.doesNotMatch(get("interval-chart").innerHTML,/<progress\b/);
  assert.doesNotMatch(get("interval-chart").innerHTML,/style=/); // Compatible with style-src 'self'.
}
get("history-open").events.click();
assert.equal(get("history-panel").focused,true);
assert.equal(get("history-panel").scrolled,true);

// Display names participate in search; stable identifiers remain valid inputs.
for(const search of [initialName,initial.category.toLowerCase(),String(initial.entity)]) {
  get("search").value=search;get("search").events.input();await settle();
  const expected=latest.entities.filter(r=>`${r.entity} ${r.category} ${labelFor(snapshot,r.category)}`.toLowerCase().includes(search.toLowerCase()));
  assert.equal(get("row-count").textContent,`${expected.length} 项`);
  assert.ok(get("entities").innerHTML.includes(`data-entity="${initial.entity}"`));
}
get("search").value="";get("category").value=initial.category;get("category").events.change();await settle();
assert.equal(get("category").value,initial.category);
assert.equal(get("row-count").textContent,`${latest.entities.filter(r=>r.category===initial.category).length} 项`);
assert.equal(initial.category,latest.entities.find(r=>r.entity===initial.entity).category);
get("category").value="";get("category").events.change();await settle();

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

// Interval frequencies preserve natural event counts; unavailable days never add zero events.
const intervals=context.window.JournalIntervals.summarize;
const profile=(e1,e2)=>({quality:"complete",order_quality:"complete",groups:[
  {signal:"E1",values:e1},{signal:"E2",values:e2}]});
const intervalRow=(date,e1,e2,extra={})=>({date,category:"C0001",observations:1000,
  counter_a:e1.reduce((n,v)=>n+v[1],0),counter_b:e2.reduce((n,v)=>n+v[1],0),
  interval_detail:profile(e1,e2),...extra});
const intervalHistory=[
  intervalRow("2026-10-12",[[0,2],[1,3],[99,1],[100,1],[200,2],[201,1],[1000,1]],[[50,1],[300,1]]),
  intervalRow("2026-10-11",[[2,1]],[[100,1]],{interval_detail:{...profile([[2,1]],[[100,1]]),order_quality:"ambiguous_order"}}),
  intervalRow("2026-10-10",[[9999,1]],[],{observations:0}),
  intervalRow("2026-10-09",[[9999,1]],[],{interval_detail:{quality:"counter_mismatch",groups:[]}}),
  intervalRow("2026-09-01",[[9999,1]],[]), // Outside the window.
  intervalRow("2026-10-13",[[9999,1]],[],{category:"C0002"}) // Future category cannot affect boundary.
];
let distribution=intervals(intervalHistory,"2026-10-12","C0001",{days:7});
assert.equal(distribution.start,"2026-10-06");assert.equal(distribution.end,"2026-10-12");
assert.equal(distribution.n,10);assert.equal(distribution.rawCount,15);assert.equal(distribution.shortCount,5);
assert.equal(distribution.counts.complete,2);assert.equal(distribution.counts.inactive,1);
assert.equal(distribution.counts.unavailable,1);assert.equal(distribution.counts.missing,3);
assert.equal(distribution.mean,225.2);assert.equal(distribution.median,150);
assert.equal(distribution.within100,0.5);assert.equal(distribution.within200,0.7);
assert.equal(distribution.bins.find(b=>b.label==="2–99").count,3);
assert.equal(distribution.bins.find(b=>b.label==="100–199").count,2);
assert.equal(distribution.bins.find(b=>b.label==="200–299").count,3);
assert.equal(distribution.bins.find(b=>b.label==="≥1,000").count,1);
distribution=intervals(intervalHistory,"2026-10-12","C0001",{days:7,signal:"E2"});
assert.equal(distribution.n,3);assert.equal(distribution.mean,150);assert.equal(distribution.median,100);
distribution=intervals(intervalHistory,"2026-10-12","C0001",{days:7,includeShort:true});
assert.equal(distribution.n,15);assert.equal(distribution.bins[0].count,5);
assert.equal(distribution.median,99);assert.equal(distribution.within200,12/15);
const replacement=[intervalRow("2026-10-09",[[9999,1]],[]),
  intervalRow("2026-10-10",[[9999,1]],[],{category:"C0002"}),intervalRow("2026-10-11",[[200,1]],[])];
distribution=intervals(replacement,"2026-10-12","C0001",{days:7});
assert.equal(distribution.n,1);assert.equal(distribution.mean,200);assert.equal(distribution.changedAt,"2026-10-10");
assert.equal(distribution.counts.excluded,5);
for(const detail of [undefined,{quality:"complete",groups:[]},profile([[2,0]],[]),profile([[2,1],[2,1]],[]),
  profile([[null,1]],[]),{quality:"complete",groups:[null,{signal:"E2",values:[]}]},profile([null],[])]) {
  distribution=intervals([intervalRow("2026-10-12",[[2,1]],[],{interval_detail:detail})],"2026-10-12","C0001");
  assert.equal(distribution.n,0);assert.equal(distribution.counts.unavailable,1);assert.equal(distribution.mean,null);
}
distribution=intervals([intervalRow("2026-10-12",[],[[300,1]])],"2026-10-12","C0001",{signal:"E1"});
assert.equal(distribution.n,0);assert.equal(distribution.counts.complete,1);assert.equal(distribution.within100,null);
assert.equal(intervals([],"2024-03-01","C0001",{days:30}).start,"2024-02-01");
get("interval-window").value="7";get("interval-window").events.change();
assert.match(get("interval-metrics").innerHTML,/7 天/);
get("interval-signal").value="E2";get("interval-signal").events.change();
assert.equal(get("error").hidden,true,get("error").textContent);
get("interval-short").checked=true;get("interval-short").events.change();
assert.match(get("interval-note").textContent,/已单列计入/);
get("interval-window").value="30";get("interval-signal").value="all";get("interval-short").checked=false;

// Rapid selections must end on the last clicked entity, without stale history.
const alternatives=latest.entities.filter(r=>r.entity!==initial.entity).slice(0,2);
for(const r of alternatives) get("entities").events.click({target:{closest:()=>({dataset:{entity:String(r.entity)}})}});
await settle();
assert.equal(get("history-title").textContent,`${alternatives.at(-1).entity} 项 · 30 天累计历史`);
assert.equal(get("interval-title").textContent,`${alternatives.at(-1).entity} 项 · 近期事件间隔分布`);
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
assert.equal(get("interval-panel").hidden,true);
assert.equal(get("interval-open").disabled,true);
get("search").value="";get("category").value="";
const older=snapshot.days.find(d=>d.date<snapshot.latest_date).date;
get("date").value=older;await get("date").events.change();await settle();
assertCategoryOrder(get,readData(`data/days/${older}.js`).entities,snapshot);
assert.match(get("history-range").textContent,new RegExp(older));
assert.match(get("interval-range").textContent,new RegExp(older));
const displayedDays=[...get("history-rows").innerHTML.matchAll(/data-history-date="([^"]+)"/g)].map(m=>m[1]);
assert.equal(displayedDays.length,30);assert.ok(displayedDays.every(day=>day<=older));
nav[1].events.click();await settle();
assert.equal(get("archive-view").hidden,false);
if(snapshot.archives.length) assert.match(get("predictions").innerHTML,/<tr>/);
nav[2].events.click();await settle();
assert.equal(get("about-view").hidden,false);
assert.ok(get("coverage").innerHTML.includes(snapshot.source_entity_days.toLocaleString("zh-CN")));
assert.equal(get("error").hidden,true,get("error").textContent);

// Labels are text, even in option/aria/table HTML.
const hostileName='=Fixture <img src=x onerror="bad()"> & \'quoted\'', fixtureTarget=snapshot.archives[0]||snapshot.latest_date;
const fixtureLabels={...snapshot.category_labels,[initial.category]:hostileName};
const fallback=latest.entities.find(r=>r.category!==initial.category);
if(fallback) delete fixtureLabels[fallback.category];
const fixtureIndex={...snapshot,category_labels:fixtureLabels,archives:[fixtureTarget]};
const fixtureArchive={source_cutoff:snapshot.latest_date,
  candidates:[{category:initial.category,entity:initial.entity,rank:1,p_high:0.2,actual_delta:300,matched:false}],
  auc:[{category:initial.category,auc:0.6,positives:10,negatives:20,start:snapshot.first_date,end:snapshot.latest_date}],
  weights:[{category:initial.category,entity:initial.entity,score:0.2,scope:"formal_eligible",status:"ok"}]};
const fixture=runApp(new Map([
  ["data/index.js",{key:"index",value:fixtureIndex}],
  [`data/archives/${fixtureTarget}.js`,{key:`archive:${fixtureTarget}`,value:fixtureArchive}]
]));
await settle();
assert.equal(fixture.get("error").hidden,true,fixture.get("error").textContent);
assert.equal(fixture.get("entity-category").textContent,hostileName);
for(const id of ["entities","category","history-rows"]) {
  assert.ok(fixture.get(id).innerHTML.includes(escaped(hostileName)),id);
  assert.doesNotMatch(fixture.get(id).innerHTML,/<img\b/,id);
}
assert.ok(fixture.get("category").innerHTML.includes(`<option value="${initial.category}">${escaped(hostileName)}`));
if(fallback) assert.ok(fixture.get("category").innerHTML.includes(`<option value="${fallback.category}">${fallback.category} · `));
fixture.get("search").value=hostileName;fixture.get("search").events.input();await settle();
assert.equal(fixture.get("row-count").textContent,`${latest.entities.filter(r=>r.category===initial.category).length} 项`);
fixture.get("category").value=initial.category;fixture.get("category").events.change();await settle();
assert.equal(fixture.get("category").value,initial.category);
fixture.nav[1].events.click();await settle();
for(const id of ["predictions","auc","weights"]) {
  assert.ok(fixture.get(id).innerHTML.includes(escaped(hostileName)),id);
  assert.doesNotMatch(fixture.get(id).innerHTML,/<img\b/,id);
}
assert.equal(fixture.get("error").hidden,true,fixture.get("error").textContent);

// Equal counts and equal labels must still produce a stable identifier order.
const countGroups=new Map();
for(const code of new Set(latest.entities.map(r=>r.category))) {
  const count=latest.entities.filter(r=>r.category===code).length;
  if(!countGroups.has(count)) countGroups.set(count,[]);
  countGroups.get(count).push(code);
}
const tiedCodes=[...countGroups.values()].find(codes=>codes.length>=2)?.slice(0,2);
assert.ok(tiedCodes,"The fixture includes categories with equal installed counts");
const tiedIndex={...snapshot,category_labels:{...snapshot.category_labels,
  [tiedCodes[0]]:"Sort fixture",[tiedCodes[1]]:"Sort fixture"}};
const tied=runApp(new Map([["data/index.js",{key:"index",value:tiedIndex}]]));
await settle();
assert.equal(tied.get("error").hidden,true,tied.get("error").textContent);
assertCategoryOrder(tied.get,latest.entities,tiedIndex);
console.log("Frontend data/render smoke checks passed (not a browser visual test).");
await import("./test_first_open_frontend.mjs");
await import("./test_interval_line.mjs");
await import("./test_history_readability.mjs");
await import("./test_archive_navigation.mjs");
