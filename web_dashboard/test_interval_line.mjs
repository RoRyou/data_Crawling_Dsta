// Outcome-specific checks: interval frequencies are a line, not the old bars.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const directory=path.dirname(fileURLToPath(import.meta.url));
const appFile=process.env.JOURNAL_TEST_APP || path.join(directory,"assets","app.js");
const source=fs.readFileSync(appFile,"utf8");
const context=vm.createContext({window:{},console,Intl,Date,Map,Set,Promise,document:{
  createElement:()=>({}),head:{appendChild(){}}
}});
// The pending index load does not resolve; exported pure functions need no data or DOM.
vm.runInContext(source,context);
const {summarize,chart}=context.window.JournalIntervals;
assert.equal(typeof chart,"function","The original interval panel exposes its frequency-line renderer");

const profile=(e1,e2)=>({quality:"complete",order_quality:"complete",groups:[
  {signal:"E1",values:e1},{signal:"E2",values:e2}]});
const row=(date,e1,e2,extra={})=>({date,category:"C0001",observations:1000,
  counter_a:e1.reduce((n,v)=>n+v[1],0),counter_b:e2.reduce((n,v)=>n+v[1],0),
  interval_detail:profile(e1,e2),...extra});
const history=[
  row("2026-10-12",[[0,2],[1,3],[99,1],[100,1],[200,2],[201,1],[1000,1]],[[50,1],[300,1]]),
  row("2026-10-11",[[2,1]],[[100,1]],{interval_detail:{...profile([[2,1]],[[100,1]]),order_quality:"ambiguous_order"}}),
  row("2026-10-10",[[9999,1]],[],{observations:0}),
  row("2026-10-09",[[9999,1]],[],{interval_detail:{quality:"counter_mismatch",groups:[]}}),
  row("2026-09-01",[[9999,1]],[]),
  row("2026-10-13",[[9999,1]],[],{category:"C0002"})
];
const before=JSON.stringify(history);
let summary=summarize(history,"2026-10-12","C0001",{days:7});
assert.equal(summary.start,"2026-10-06");assert.equal(summary.end,"2026-10-12");
assert.equal(summary.n,10);assert.equal(summary.rawCount,15);assert.equal(summary.shortCount,5);
assert.equal(JSON.stringify(summary.counts),JSON.stringify({complete:2,missing:3,inactive:1,unavailable:1,excluded:0}));
assert.equal(summary.mean,225.2);assert.equal(summary.median,150);
assert.equal(summary.within100,.5);assert.equal(summary.within200,.7);
assert.equal(JSON.stringify(summary.bins.map(b=>[b.label,b.count])),JSON.stringify([
  ["2–99",3],["100–199",2],["200–299",3],["300–399",1],["400–499",0],
  ["500–599",0],["600–699",0],["700–799",0],["800–899",0],["900–999",0],["≥1,000",1]
]));

function acceptFrequencyLine(html,expected) {
  assert.doesNotMatch(html,/<progress\b|interval-bars|interval-track/,
    "The removed progress-bar representation must not survive the release");
  assert.match(html,/<svg[^>]+role="img"[^>]+aria-label="[^"]*横轴为间隔区间，纵轴为整数次数"/);
  assert.match(html,/<path d="M[^\"]+ L[^\"]+" class="chart-line"\/>/);
  assert.equal((html.match(/class="history-point"/g)||[]).length,expected.bins.length);
  assert.equal((html.match(/data-interval-bin=/g)||[]).length,expected.bins.length);
  assert.match(html,/<details[^>]*>[\s\S]*查看每档次数与占比/);
  assert.match(html,/按类别等距排列[\s\S]*开放[\s\S]*区间宽度不同/);
  assert.doesNotMatch(html,/\bstyle=/,"The line remains compatible with style-src self");
  for(const bin of expected.bins) {
    const percent=`${(bin.count/expected.n*100).toFixed(1)}%`;
    assert.ok(html.includes(`${bin.label} 步：${bin.count} 次 / ${expected.n} 次 · ${percent}`),
      "Every plotted point has its original bin, count, and natural share in the tooltip");
    assert.ok(html.includes(`<td>${bin.count} / ${expected.n}</td><td>${percent}</td>`),
      "The expandable table uses the same count and denominator as the chart");
  }
  const xPositions=[...html.matchAll(/<circle cx="([\d.]+)"/g)].map(m=>Number(m[1]));
  const spacing=xPositions[1]-xPositions[0];
  assert.ok(xPositions.slice(1).every((x,i)=>Math.abs(x-xPositions[i]-spacing)<1e-9),
    "Open and closed bins are equally spaced categories, not an invented numeric scale");
  const yTicks=[...html.matchAll(/<text x="40" y="[\d.]+" text-anchor="end" class="chart-axis">([^<]*)<\/text>/g)].map(m=>Number(m[1].replaceAll(",","")));
  assert.ok(yTicks.length>=2 && yTicks.includes(0));
  assert.ok(yTicks.every(Number.isSafeInteger),"Frequency ticks are integers even for a one-event window");
  acceptVisibleShares(html,expected);
}

function shareTextNodes(html) {
  const svg=html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)?.[0] || "";
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].filter(match=>
    /\bclass="[^"]*\binterval-share-label\b[^"]*"/.test(match[1]));
}

function acceptVisibleShares(html,expected) {
  const labels=shareTextNodes(html);
  assert.equal(labels.length,expected.bins.length,
    "Every interval bin, including zero-count bins, has a visible SVG percentage label");
  for(const [i,label] of labels.entries()) {
    const attributes=label[1],text=label[2],bin=expected.bins[i];
    assert.equal(attributes.match(/\bdata-share-count="([^"]+)"/)?.[1],String(bin.count),
      "The visible percentage numerator is the plotted bin count");
    assert.equal(attributes.match(/\bdata-share-total="([^"]+)"/)?.[1],String(expected.n),
      "The visible percentage denominator is the current filtered valid sample count, not days or raw events");
    assert.equal(text,`${(bin.count/expected.n*100).toFixed(1)}%`,
      "The percentage is directly readable on the SVG, without tooltip or table expansion");
    assert.doesNotMatch(attributes,/\bhidden(?:\s|=|$)|\baria-hidden="true"|\bdisplay="none"|\bvisibility="hidden"/,
      "The SVG percentage label must not be hidden");
  }
}
const html=chart(summary);
acceptFrequencyLine(html,summary);
assert.match(html,/>0\.0%<\/text>/,"An empty bin in an observed distribution still displays its zero share");
// Percentages already existed in the tooltip and table. Those alone do not satisfy
// the new request: removing only the plotted labels must fail acceptance.
const tooltipAndTableOnly=html.replace(/<text\b[^>]*\bclass="[^"]*\binterval-share-label\b[^"]*"[^>]*>[\s\S]*?<\/text>/g,"");
assert.throws(()=>acceptVisibleShares(tooltipAndTableOnly,summary),assert.AssertionError,
  "The former line with only tooltip/table shares is insufficient");
const rawCountDenominator=html.replace(/\bdata-share-total="10"/g,'data-share-total="15"');
assert.throws(()=>acceptVisibleShares(rawCountDenominator,summary),assert.AssertionError,
  "Metadata that substitutes the pre-filter event count for n is rejected");
const dayCountDenominator=html.replace(/\bdata-share-total="10"/g,'data-share-total="7"');
assert.throws(()=>acceptVisibleShares(dayCountDenominator,summary),assert.AssertionError,
  "Metadata that substitutes the calendar-day count for n is rejected");
// The actual former renderer's progress markup must fail the new outcome check.
const oldBars=`<div class="interval-bars" role="list">${summary.bins.map(b=>`<div class="interval-bin"><span>${b.label} 步</span><progress class="interval-track" value="${b.count}" max="3"></progress></div>`).join("")}</div>`;
assert.throws(()=>acceptFrequencyLine(oldBars,summary),assert.AssertionError,
  "The acceptance check must reject the previous unwanted bar implementation");
assert.match(source,/\$\("interval-chart"\)\.innerHTML=intervalFrequencyChart\(summary\)/,
  "The existing interval panel uses this renderer, not only a new independent chart");
assert.doesNotMatch(fs.readFileSync(path.join(path.dirname(appFile),"index.html"),"utf8"),/条长按次数缩放/);

for(const days of [7,14,30]) {
  for(const signal of ["all","E1","E2"]) for(const includeShort of [false,true]) {
    summary=summarize(history,"2026-10-12","C0001",{days,signal,includeShort});
    assert.equal(summary.days,days);
    assert.equal(summary.n,signal==="E2"?3:signal==="E1"?(includeShort?12:7):(includeShort?15:10));
    if(signal==="E2") {assert.equal(summary.mean,150);assert.equal(summary.median,100);}
    acceptFrequencyLine(chart(summary),summary);
  }
}
summary=summarize(history,"2026-10-12","C0001",{days:7,includeShort:true});
assert.equal(summary.n,15);assert.equal(summary.bins[0].label,"0–1");assert.equal(summary.bins[0].count,5);
assert.equal(summary.median,99);assert.equal(summary.within200,12/15);acceptFrequencyLine(chart(summary),summary);
summary=summarize([row("2026-10-12",[[99,1]],[])],"2026-10-12","C0001");
acceptFrequencyLine(chart(summary),summary);
summary=summarize([row("2026-10-12",[],[[300,1]])],"2026-10-12","C0001",{signal:"E1"});
assert.equal(summary.n,0);assert.equal(summary.mean,null);assert.equal(summary.within100,null);
assert.match(chart(summary),/有效日期中没有符合当前筛选的记录/);assert.doesNotMatch(chart(summary),/<svg|<progress|<table/);
assert.equal(shareTextNodes(chart(summary)).length,0);assert.doesNotMatch(chart(summary),/%|data-share-count|data-share-total/,
  "No selected-signal samples means unavailable shares, not zero percentages");
summary=summarize([],"2026-10-12","C0001");
assert.match(chart(summary),/不显示为零次分布/);assert.doesNotMatch(chart(summary),/<svg|<progress|<table/);
assert.equal(shareTextNodes(chart(summary)).length,0);assert.doesNotMatch(chart(summary),/%|data-share-count|data-share-total/,
  "No valid observed days must not produce plotted shares");
assert.equal(JSON.stringify(history),before,"Rendering preserves the original observations and definitions");
console.log("Interval frequency-line and visible-share checks passed; former bars and tooltip/table-only shares rejected.");
