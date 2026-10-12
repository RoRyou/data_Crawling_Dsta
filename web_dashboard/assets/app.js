"use strict";
(() => {
  const cache = new Map(), pending = new Map();
  window.KiconaData = {deliver(key, value) {cache.set(key, value); pending.get(key)?.resolve(value); pending.delete(key);}};
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("zh-CN", {maximumFractionDigits: 1});
  const signed = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`;
  const tone = (n) => n == null || n === 0 ? "muted" : n > 0 ? "positive" : "negative";
  const percent = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  const qualityNames = {complete:"逐次计数完整", missing:"逐次表缺失", no_play:"未观察到游玩（0G）", invalid_daily:"日数据数值无效", invalid_events:"逐次记录无效或重复", identity_mismatch:"历史机种归属不一致，记录暂不使用", counter_mismatch:"逐次计数与日汇总不一致", invalid_start:"开奖圈数缺失或无效", invalid_time:"逐次时间不可用", ambiguous_order:"同一分钟内的先后顺序无法确定"};
  let index, dayData, selectedUnit, currentView = "daily", dayToken = 0, detailToken = 0, archiveToken = 0;

  function load(key, path) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key).promise;
    let resolve, reject;
    const promise = new Promise((res, rej) => {resolve = res; reject = rej;});
    pending.set(key, {promise, resolve, reject});
    const script = document.createElement("script");
    script.src = `${path}?v=${encodeURIComponent(index?.generated_at || Date.now())}`;
    script.onerror = () => {pending.delete(key); script.remove(); reject(new Error("数据文件读取失败，请重新打开页面；本地使用时需保留整个网页目录。"));};
    script.onload = () => {script.remove(); if (!cache.has(key)) {pending.delete(key); reject(new Error("数据文件格式不匹配。"));}};
    document.head.appendChild(script);
    return promise;
  }
  function fail(e) {$("error").textContent = e.message; $("error").hidden = false; $("loading").hidden = true;}
  function filtered() {
    const machine = $("machine").value, search = $("search").value.trim().toLowerCase();
    return (dayData?.units || []).filter(r => (!machine || r.machine === machine)
      && (!$("played-only").checked || r.played)
      && (!search || `${r.unit} ${r.machine}`.toLowerCase().includes(search)))
      .sort((a,b) => $("sort").value === "unit" ? a.unit-b.unit :
        (b[$("sort").value] ?? -Infinity) - (a[$("sort").value] ?? -Infinity) || a.unit-b.unit);
  }
  async function changeDay() {
    const token = ++dayToken;
    $("loading").hidden = false; $("error").hidden = true;
    const day = $("date").value;
    try {
      const value = await load(`day:${day}`, `data/days/${day}.js`);
      if (token !== dayToken) return;
      dayData = value;
      const prior = $("machine").value;
      const counts = new Map();
      value.units.forEach(r => counts.set(r.machine, (counts.get(r.machine) || 0)+1));
      $("machine").innerHTML = '<option value="">全部机种</option>' + [...counts].sort((a,b) => a[0].localeCompare(b[0], "ja")).map(([m,n]) => `<option value="${esc(m)}">${esc(m)} · ${n} 台</option>`).join("");
      if (counts.has(prior)) $("machine").value = prior;
      $("loading").hidden = true;
      renderDaily();
    } catch(e) {if (token === dayToken) fail(e);}
  }
  function renderDaily() {
    const data = filtered(), played = data.filter(r => r.played), diffs = played.map(r=>r.diff).filter(n=>n!==null).sort((a,b)=>a-b);
    const mid = Math.floor(diffs.length/2), median = diffs.length ? (diffs[mid]+diffs[Math.floor((diffs.length-1)/2)])/2 : null;
    const sum = diffs.reduce((a,b)=>a+b,0), games = data.reduce((a,b)=>a+(b.games||0),0);
    const cards = [
      ["当前筛选机台", fmt(data.length), `${new Set(data.map(r=>r.machine)).size} 个机种 · ${played.length} 台有游玩`],
      ["合计差枚 · 已游玩", signed(sum), "日终净差枚，不等于单次出玉", tone(sum)],
      ["差枚中位数 · 已游玩", signed(median), "未将 0G 当作观察零", tone(median)],
      ["总观察圈数", fmt(games), `${data.filter(r=>r.hits.quality === "complete").length} 台逐次计数完整`]
    ];
    $("metrics").innerHTML = cards.map(([label,value,note,cls])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${cls||""}">${value}</div><div class="metric-note">${note}</div></div>`).join("");
    if (!data.some(r=>r.unit===selectedUnit)) selectedUnit = data.find(r=>r.unit===633)?.unit ?? data.find(r=>r.played)?.unit ?? data[0]?.unit;
    $("row-count").textContent = `${data.length} 台`;
    $("units").innerHTML = data.length ? data.map(r=>`<tr class="unit-row ${r.unit===selectedUnit?"selected":""}" data-unit="${r.unit}"><td><button class="unit-link" data-unit="${r.unit}" aria-label="查看 ${r.unit} 台 ${esc(r.machine)}"><strong>${r.unit}</strong><small>${esc(r.machine)}</small></button></td><td>${fmt(r.games)}${r.games===0?'<small class="muted"> 未游玩</small>':""}</td><td class="${tone(r.diff)}">${signed(r.diff)}</td><td>${fmt(r.bb)} / ${fmt(r.rb)}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">没有符合筛选条件的机台</td></tr>';
    renderDetail().catch(fail);
  }
  function lineChart(points) {
    if (!points?.length) return '<div class="empty">当前没有可展示的曲线</div>';
    const w=570,h=186,left=44,right=10,top=12,bottom=24;
    const ys=points.map(p=>p[1]), lo=Math.min(0,...ys), hi=Math.max(0,...ys), span=hi-lo||100;
    const x0=points[0][0], dx=points.at(-1)[0]-x0||1;
    const x=(n)=>left+(n-x0)/dx*(w-left-right), y=(n)=>top+(hi-n)/span*(h-top-bottom);
    const path=points.map((p,i)=>`${i?"L":"M"}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(" ");
    const base=y(0).toFixed(2);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="当日差枚采样曲线，横轴为采样点序号，非真实时刻"><title>差枚曲线：${points.length} 个采样点，末点 ${signed(ys.at(-1))} 枚</title>${[hi,(hi+lo)/2,lo].map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" class="chart-grid"/><text x="${left-6}" y="${y(n)+3}" text-anchor="end" class="chart-axis">${fmt(Math.round(n))}</text>`).join("")}<path class="chart-fill" d="${path} L${x(points.at(-1)[0])},${base} L${left},${base} Z"/><line x1="${left}" x2="${w-right}" y1="${base}" y2="${base}" class="chart-zero"/><path class="chart-line" d="${path}"/><text x="${left}" y="${h-5}" class="chart-axis">点 ${x0}</text><text x="${w-right}" y="${h-5}" text-anchor="end" class="chart-axis">点 ${points.at(-1)[0]} · 时间轴待校准</text></svg>`;
  }
  function historyChart(history, day, machine) {
    const end = new Date(`${day}T00:00:00Z`), lookup = new Map(history.map(r=>[r.date,r]));
    const calendar = Array.from({length:30},(_,i)=>{const d=new Date(end); d.setUTCDate(d.getUTCDate()-29+i); const key=d.toISOString().slice(0,10); const r=lookup.get(key); return {date:key,value:r?.machine===machine && r.games>0?r.diff:null};});
    const ys = calendar.filter(r=>r.value!==null).map(r=>r.value);
    if (!ys.length) return '<div class="empty">当前机种没有可展示的历史观察</div>';
    const w=570,h=115,left=44,top=8,bottom=20,lo=Math.min(0,...ys),hi=Math.max(0,...ys),span=hi-lo||100;
    const y=n=>top+(hi-n)/span*(h-top-bottom), base=y(0), step=(w-left-10)/30;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="近30个日历日每日差枚，缺日、换机种与未游玩留空"><line x1="${left}" x2="560" y1="${base}" y2="${base}" class="chart-zero"/>${calendar.map((r,i)=>r.value===null?"":`<rect x="${left+i*step+2}" y="${Math.min(base,y(r.value))}" width="${step-4}" height="${Math.max(1,Math.abs(base-y(r.value)))}" fill="${r.value>=0?'#86a47a':'#c49276'}"><title>${r.date}：${signed(r.value)} 枚</title></rect>`).join("")}<text x="${left-6}" y="${top+4}" text-anchor="end" class="chart-axis">${fmt(hi)}</text><text x="${left-6}" y="${h-bottom}" text-anchor="end" class="chart-axis">${fmt(lo)}</text><text x="${left}" y="${h-3}" class="chart-axis">${calendar[0].date.slice(5)}</text><text x="560" y="${h-3}" text-anchor="end" class="chart-axis">${day.slice(5)}</text></svg>`;
  }
  async function renderDetail() {
    const token = ++detailToken, r = dayData?.units.find(r=>r.unit===selectedUnit && filtered().some(f=>f.unit===r.unit));
    if (!r) {
      $("unit-title").textContent="没有选中的机台";
      for (const id of ["unit-machine","unit-metrics","intraday-chart","history-chart","curve-note","events","event-title","event-quality","play-status"]) $(id).textContent="";
      $("source-link").hidden=true; return;
    }
    const day=dayData.date;
    $("unit-title").textContent=`${r.unit} 台`;
    $("unit-machine").textContent=r.machine;
    $("play-status").textContent=r.games===0?"未游玩":r.played?"有游玩记录":"圈数未知";
    $("unit-metrics").innerHTML=`<div><span>总 G 数</span><strong>${fmt(r.games)}</strong></div><div><span>最终差枚</span><strong class="${tone(r.diff)}">${signed(r.diff)}</strong></div><div><span>BB / RB</span><strong>${fmt(r.bb)} / ${fmt(r.rb)}</strong></div>`;
    $("intraday-chart").innerHTML=lineChart(r.curve.points);
    $("curve-note").textContent=r.curve.points.length ? `横轴为采样点，不是开奖圈数或时刻。曲线末点与日表相差 ${signed(r.curve.end_delta)} 枚${r.curve.quality==="end_mismatch"?"，超过核对容差，勿用于锚点判定":""}；可能存在采样或截顶误差。` : r.games===0?"0G：没有观察到游玩，不构造一条零出玉曲线。":"曲线缺失或无效，不填零，也不据此判为负样本。";
    $("event-title").textContent=`${day} · ${r.unit} 台`;
    $("event-quality").textContent=`${qualityNames[r.hits.quality] || r.hits.quality}。日表 BB/RB ${fmt(r.bb)}/${fmt(r.rb)}；可见逐次 BIG/REG ${fmt(r.hits.visible_bb)}/${fmt(r.hits.visible_rb)}。${r.hits.order_quality!==r.hits.quality?`顺序：${qualityNames[r.hits.order_quality]}。`:""}`;
    $("event-quality").className=`notice ${r.hits.quality==="complete" && r.hits.order_quality==="complete"?"good":""}`;
    $("events").innerHTML=r.hits.events.length?r.hits.events.map(e=>`<tr><td>${esc(e.time)}</td><td>${esc(e.signal)}</td><td>${fmt(e.g)}</td><td>${fmt(e.no)}</td><td class="muted">未提供</td></tr>`).join(""):'<tr><td colspan="5" class="empty">没有可归属到此机台的逐次记录</td></tr>';
    $("source-link").hidden=false; $("source-link").href=`https://papimo.jp/h/00042004/hit/view/${r.unit}/${day.replaceAll("-","")}`;
    $("history-chart").textContent="读取历史…";
    const history=await load(`unit:${r.unit}`,`data/units/${r.unit}.js`);
    if(token===detailToken) $("history-chart").innerHTML=historyChart(history,day,r.machine);
  }
  async function renderArchive() {
    if(!index.archives.length) {$("archive-cutoff").textContent="暂无预测存档"; return;}
    const token=++archiveToken, target=$("archive-date").value;
    const archive=await load(`archive:${target}`,`data/archives/${target}.js`);
    if(token!==archiveToken) return;
    $("archive-cutoff").textContent=`目标日 ${target} · 原任务数据截止日 ${archive.source_cutoff}`;
    const top=[...archive.candidates].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)).slice(0,10);
    const evaluated=top.filter(r=>r.hit!==null), successes=evaluated.filter(r=>r.hit).length;
    $("archive-outcome").textContent=evaluated.length?`TOP10 已观察 ${evaluated.length} 台 · 命中 ${successes} 台`:"实际结果尚不可复盘";
    $("predictions").innerHTML=top.map(r=>`<tr><td>${fmt(r.rank)}</td><td>${esc(r.machine)} · ${r.unit}</td><td>${percent(r.p_surge)}</td><td class="${tone(r.actual_diff)}">${signed(r.actual_diff)}</td><td>${r.hit===null?"未知 / 未游玩":r.hit?"命中":"未命中"}</td></tr>`).join("");
    $("auc").innerHTML=archive.auc.length?archive.auc.map(r=>`<tr><td>${esc(r.machine)}</td><td>${r.auc==null?"不可计算":r.auc.toFixed(3)}</td><td>${fmt(r.positives)} / ${fmt(r.negatives)}</td><td>${esc(r.start)} → ${esc(r.end)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">该日没有 AUC 存档</td></tr>';
    const status={partial_event_35pct_missing:"机种项未验证 · 0.35 未计入",insufficient_games:"游玩圈数不足",ok:"完整试验分"};
    $("weights").innerHTML=archive.weights.length?archive.weights.map(r=>`<tr><td>${esc(r.machine)} · ${fmt(r.unit)}</td><td>${r.score==null?"—":r.score.toFixed(3)}</td><td>${r.scope==="formal_eligible"?"正式范围内的试验评分":"指定例外 · 独立试验"}</td><td>${esc(status[r.status]||r.status)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">该日没有权重存档</td></tr>';
  }
  function renderAbout() {
    const latest=index.days[0];
    const entries=[["日数据范围",`${index.first_date} → ${index.latest_date}`],["已采集日期",`${index.days.length} 天`],["台日记录",fmt(index.source_unit_days)],["最新机台 / 机种",`${latest.units} / ${latest.machines}`],["逐次文件最新记录",index.latest_hits||"缺失"],["最新日逐次计数完整",`${latest.hits_complete} / ${latest.units} 台`],["Anaslo 最近任务",`${index.collection.anaslo?.status||"未知"}`],["PAPIMO 最近任务",`${index.collection.papimo?.status||"未知"}`]];
    $("coverage").innerHTML=entries.map(([a,b])=>`<div class="coverage-row"><span>${a}</span><strong>${esc(b)}</strong></div>`).join("");
    $("build-time").textContent=`网页数据导出时间：${index.generated_at}（日本时间）。`;
    $("dictionary").innerHTML=Object.entries(index.dictionary).map(([machine,r])=>`<article class="dict-item"><strong>${esc(machine)}</strong><p>${esc(r.meaning)}</p><p>证据类别：${esc(r.evidence)}</p>${/^https:\/\//.test(r.source_url||"")?`<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">查看资料 ↗</a>`:""}</article>`).join("");
  }
  function switchView(view) {
    if(!index) return;
    currentView=view;
    for(const name of ["daily","archive","about"]) $(`${name}-view`).hidden=name!==view;
    document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("page-title").innerHTML={daily:'每日数据观察台<span>把每一天，连起来看。</span>',archive:'预测与复盘存档<span>保留当时的判断，再看真实的结果。</span>',about:'数据与口径<span>知道数据从哪里来，也知道它的边界。</span>'}[view];
    if(view==="archive") renderArchive().catch(fail);
  }
  function download() {
    const header=["日期","机种","台号","G数","差枚","BB","RB","逐次质量"];
    const safe=v=>`"${String(v??"").replace(/^[=+\-@]/,"'$&").replaceAll('"','""')}"`;
    const lines=[header,...filtered().map(r=>[dayData.date,r.machine,r.unit,r.games,r.diff,r.bb,r.rb,qualityNames[r.hits.quality]])];
    const blob=new Blob(["\ufeff"+lines.map(a=>a.map(safe).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"),url=URL.createObjectURL(blob); a.href=url;a.download=`kicona-${dayData.date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function init() {
    index=await load("index","data/index.js");
    $("date").innerHTML=index.days.map(d=>`<option value="${d.date}">${d.date}</option>`).join("");
    $("archive-date").innerHTML=index.archives.map(d=>`<option value="${d}">${d}</option>`).join("");
    const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date());
    const age=(Date.parse(today)-Date.parse(index.latest_date))/86400000;
    $("freshness").innerHTML=`<strong><span class="dot"></span> 数据截至 ${index.latest_date}</strong>${index.days.length} 个采集日 · ${age>1?`落后 ${age} 天，请检查采集`:"最近已采集日"}`;
    $("freshness").classList.toggle("stale",age>1);
    $("daily-view").hidden=false;
    renderAbout();
    await changeDay();
    $("date").addEventListener("change",changeDay);
    for(const id of ["machine","played-only","sort"]) $(id).addEventListener("change",renderDaily);
    $("search").addEventListener("input",renderDaily);
    $("units").addEventListener("click",e=>{const row=e.target.closest("[data-unit]");if(row){selectedUnit=Number(row.dataset.unit);renderDaily();}});
    $("archive-date").addEventListener("change",()=>renderArchive().catch(fail));
    document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
    $("download").addEventListener("click",download);
  }
  init().catch(fail);
})();
