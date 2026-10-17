// Requirement-specific checks for UI-03/UI-05. The 30-calendar-day statistics
// stay fixed; only date separation and the display coordinate system change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const directory=path.dirname(fileURLToPath(import.meta.url));
const appFile=process.env.JOURNAL_TEST_APP||path.join(directory,"assets/app.js");
const source=fs.readFileSync(appFile,"utf8"),html=fs.readFileSync(path.join(path.dirname(appFile),"index.html"),"utf8");
assert.match(html,/id="history-axis"/);
assert.match(html,/value="calendar">按日历日期/);
assert.match(html,/value="records">按有效记录序号/);
assert.match(html,/窗口内已观察累计（非跨日余额）/);
assert.match(html,/近 30 日历日的日终结果/);
assert.match(html,/不是逐次跨日曲线/);
const context=vm.createContext({window:{},document:{getElementById:()=>({}),createElement:()=>({}),head:{appendChild(){}}},Intl,Date,Map,Set,Promise});
vm.runInContext(source,context);
const {summarize,layout,chart}=context.window.JournalHistory;
assert.equal(typeof layout,"function","The old implementation has no explicit history display coordinates");
assert.equal(typeof chart,"function");
const sequence=Array.from({length:30},(_,i)=>{
  const date=new Date("2026-10-16T00:00:00Z");date.setUTCDate(date.getUTCDate()-29+i);
  return {date:date.toISOString().slice(0,10),category:"C0001",observations:100,delta:100};
});
let summary=summarize(sequence,"2026-10-16","C0001"),original=JSON.stringify(summary);
let display=layout(summary);
assert.equal(summary.total,3000);assert.equal(summary.counts.valid,30);assert.equal(summary.rows.length,30);
assert.equal(display.axis,"calendar");assert.equal(display.points.length,30);
assert.equal(display.connections.length,29);assert.equal(display.gaps.length,0);
assert.equal(display.connections.every(c=>c.kind==="adjacent"),true,"A date change alone must not break a valid line");
let svg=chart(summary);
assert.equal((svg.match(/class="history-day-boundary"/g)||[]).length,29,"Ordinary dates use vertical dashed boundaries");
const mainPath=svg.match(/<path d="([^"]+)" class="chart-line"/)[1];
assert.equal((mainPath.match(/M/g)||[]).length,1);assert.equal((mainPath.match(/L/g)||[]).length,29);
assert.match(svg,/data-history-axis="calendar"/);assert.match(svg,/非跨日余额，非跨日日内曲线/);
assert.equal(JSON.stringify(summary),original,"Rendering cannot modify the underlying totals or daily observations");

const idle=sequence.map((row,i)=>i===10?{...row,observations:0,delta:0}:row);
summary=summarize(idle,"2026-10-16","C0001");display=layout(summary);
assert.equal(summary.total,2900);assert.equal(summary.counts.valid,29);assert.equal(summary.counts.inactive,1);
assert.equal(summary.rows[10].cumulative,null,"A known inactive date never becomes a zero-result sample");
assert.equal(display.points.length,29);assert.equal(display.connections.filter(c=>c.kind==="inactive").length,1);
assert.equal(display.connections.find(c=>c.kind==="inactive").skipped,1);
svg=chart(summary);assert.equal((svg.match(/class="history-inactive-bridge"/g)||[]).length,1);
assert.equal((svg.match(/class="history-point"/g)||[]).length,29,"A reading bridge must not create a daily point");

const gap=idle.filter((_,i)=>i!==11).map((row,i)=>row.date===sequence[16].date?{...row,delta:null}:row);
summary=summarize(gap,"2026-10-16","C0001");original=JSON.stringify(summary);
const calendar=layout(summary,"calendar"),records=layout(summary,"records");
assert.equal(summary.total,2700);assert.equal(summary.counts.valid,27);
assert.equal(summary.counts.missing,1);assert.equal(summary.counts.invalid,1);assert.equal(summary.counts.inactive,1);
assert.equal(calendar.gaps.length,2);assert.equal(records.gaps.length,2,"Compressing unknown dates cannot reconnect their line");
assert.equal(records.points.length,27);assert.equal(records.compressedDays,3);
assert.equal(records.points.every((p,i)=>p.position===i/26),true,"Record coordinates are equal spaced within the unchanged window");
assert.equal(records.points[11].date,calendar.points[11].date);
assert.notEqual(records.points[11].position,calendar.points[11].position);
assert.equal(records.connections.some(c=>c.from===9&&c.to===10),false,"Known inactivity plus a truly missing date is still a gap");
assert.match(chart(summary,"records"),/data-history-axis="records"/);
assert.match(chart(summary,"records"),/空档已压缩，非时间轴/);
assert.equal(JSON.stringify(summary),original);

const questionable=sequence.map((row,i)=>i===10?{...row,observations:0,delta:100}:row);
summary=summarize(questionable,"2026-10-16","C0001");
assert.equal(summary.counts.inactive,1,"Original inactive-count semantics stay unchanged");
assert.equal(layout(summary).connections.some(c=>c.kind==="inactive"),false,"Nonzero stale values do not verify an inactivity bridge");
assert.equal(layout(summary).gaps.length,1);

const future=[...sequence,{date:"2026-10-17",category:"C0002",observations:100,delta:999999}];
assert.equal(summarize(future,"2026-10-16","C0001").total,3000);
const replaced=[...sequence.slice(0,15),{...sequence[15],category:"C0002"},...sequence.slice(16)];
summary=summarize(replaced,"2026-10-16","C0001");display=layout(summary,"records");
assert.equal(summary.changedAt,sequence[15].date);assert.equal(summary.counts.excluded,16);
assert.equal(summary.total,1400);assert.equal(display.points[0].date,sequence[16].date);
assert.equal(display.points.some(p=>p.calendarIndex<16),false,"Returning category names cannot reconnect an earlier installation");
summary=summarize(sequence.map(row=>({...row,observations:0,delta:0})),"2026-10-16","C0001");
assert.equal(summary.total,null);assert.equal(layout(summary).points.length,0);
assert.match(chart(summary,"records"),/没有可累计的有效结果，不显示为零/);
summary=summarize([sequence.at(-1)],"2026-10-16","C0001");
assert.equal(layout(summary,"records").points[0].position,0.5);
assert.doesNotMatch(chart(summary,"records"),/NaN|Infinity/);
assert.equal(summarize([],"2024-03-01","C0001").start,"2024-02-01");
console.log("History readability checks passed (UI-03/UI-05; not browser visual QA).");
