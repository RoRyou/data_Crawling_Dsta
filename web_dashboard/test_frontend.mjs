// DOM-independent smoke test of rendering and data loading, not browser visual QA.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
function readData(relative) {
  let result;
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), "utf8"), {window:{KiconaData:{deliver(_key,value){result=value;}}}});
  return result;
}
const snapshot=readData("data/index.js"), latest=readData(`data/days/${snapshot.latest_date}.js`);
const initial=latest.units.find(r=>r.unit===633)||latest.units.find(r=>r.played)||latest.units[0];
class Element {
  constructor(id) {this.id=id;this.value="";this.hidden=false;this.checked=false;this.events={};this.textContent="";this._html="";this.dataset={};this.classList={toggle(){}};}
  set innerHTML(v) {this._html=v; if(["date","machine","archive-date"].includes(this.id)) this.value=v.match(/<option value="([^"]*)"/)?.[1]||"";}
  get innerHTML() {return this._html;}
  addEventListener(event, fn) {this.events[event]=fn;}
  remove() {}
  click() {}
}
const elements=new Map(), nav=["daily","archive","about"].map(view=>{const e=new Element(view);e.dataset.view=view;return e;});
const get=id=>{if(!elements.has(id)) elements.set(id,new Element(id));return elements.get(id);};
get("sort").value="unit";get("error").hidden=true;
const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,Blob,URL,setTimeout,document:{
  getElementById:get, querySelectorAll:()=>nav, createElement:tag=>new Element(tag),
  head:{appendChild(script){queueMicrotask(()=>{try{const file=script.src.split("?")[0];vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),context);script.onload?.();}catch(e){console.error(e);script.onerror?.();}});}}
}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
vm.runInContext(fs.readFileSync(path.join(root,"app.js"),"utf8"),context);
await settle();
assert.equal(get("error").hidden,true,get("error").textContent);
const manifest=context.window.KiconaData;
assert.ok(manifest);
assert.match(get("metrics").innerHTML,/当前筛选机台/);
assert.ok(get("units").innerHTML.includes(`data-unit="${initial.unit}"`));
assert.equal(get("unit-title").textContent,`${initial.unit} 台`);
if(initial.curve.points.length) assert.match(get("intraday-chart").innerHTML,/采样/);
get("machine").value=initial.machine;get("machine").events.change();await settle();
assert.equal(get("row-count").textContent,`${latest.units.filter(r=>r.machine===initial.machine).length} 台`);
const unplayed=latest.units.find(r=>r.games===0);
if(unplayed) {
  get("machine").value=unplayed.machine;get("search").value=String(unplayed.unit);get("search").events.input();await settle();
  assert.equal(get("play-status").textContent,"未游玩");
  assert.match(get("curve-note").textContent,/0G/);
}
get("search").value="nonexistent-unit";get("search").events.input();await settle();
assert.equal(get("row-count").textContent,"0 台");
assert.equal(get("source-link").hidden,true);
nav[1].events.click();await settle();
assert.equal(get("archive-view").hidden,false);
if(snapshot.archives.length) assert.match(get("predictions").innerHTML,/<tr>/);
nav[2].events.click();await settle();
assert.equal(get("about-view").hidden,false);
assert.ok(get("coverage").innerHTML.includes(snapshot.source_unit_days.toLocaleString("zh-CN")));
assert.equal(get("error").hidden,true,get("error").textContent);
console.log("Frontend data/render smoke checks passed (not a browser visual test).");
