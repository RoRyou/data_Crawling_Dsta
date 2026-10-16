"use strict";
(() => {
  const cache = new Map(), pending = new Map();
  window.JournalData = {deliver(key, value) {cache.set(key, value); pending.get(key)?.resolve(value); pending.delete(key);}};
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("zh-CN", {maximumFractionDigits: 1});
  const signed = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`;
  const tone = (n) => n == null || n === 0 ? "muted" : n > 0 ? "positive" : "negative";
  const percent = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  const qualityNames = {complete:"逐次计数完整", missing:"逐次表缺失", no_observation:"未观察到活动（0 次观察）", invalid_daily:"日数据数值无效", invalid_events:"逐次记录无效或重复", identity_mismatch:"历史类别归属不一致，记录暂不使用", counter_mismatch:"逐次计数与日汇总不一致", invalid_start:"事件间隔缺失或无效", invalid_time:"逐次时间不可用", ambiguous_order:"同一分钟内的先后顺序无法确定"};
  const historyNames = {valid:"已计入", missing:"缺记录 · 不补零", inactive:"未活动 · 不计入", invalid:"数值未知 · 不计入", excluded:"早期 / 其他类别 · 不计入"};
  let index, dayData, selectedUnit, intervalContext, currentView = "daily", dayToken = 0, detailToken = 0, archiveToken = 0;

  function categoryName(code) {
    const label=index?.category_labels?.[code];
    return typeof label==="string" && label.trim() ? label : code ?? "—";
  }

  function summarizeHistory(history, day, category) {
    const past=history.filter(r=>r.date<=day), lookup=new Map(past.map(r=>[r.date,r]));
    // Do not join two installations just because the same category returns later.
    const changedAt=past.filter(r=>r.category!==category).map(r=>r.date).sort().at(-1);
    const end=new Date(`${day}T00:00:00Z`), counts={valid:0,missing:0,inactive:0,invalid:0,excluded:0};
    let total=0, observations=0, activityDays=0, positiveDays=0, negativeDays=0;
    const rows=Array.from({length:30},(_,i)=>{
      const date=new Date(end); date.setUTCDate(date.getUTCDate()-29+i);
      const key=date.toISOString().slice(0,10), r=lookup.get(key);
      let status=changedAt && key<=changedAt ? "excluded" : !r ? "missing" :
        r.observations===0 ? "inactive" :
        !Number.isFinite(r.observations) || r.observations<0 || !Number.isFinite(r.delta) ? "invalid" : "valid";
      counts[status]++;
      if(status!=="excluded" && r && Number.isFinite(r.observations) && r.observations>0) {
        observations+=r.observations; activityDays++;
      }
      if(status==="valid") {total+=r.delta; positiveDays+=r.delta>0; negativeDays+=r.delta<0;}
      return {date:key, category:r?.category ?? null, observations:r?.observations ?? null,
        delta:r?.delta ?? null, value:status==="valid"?r.delta:null,
        cumulative:status==="valid"?total:null, status};
    });
    return {rows, counts, changedAt, start:rows[0].date, end:day,
      total:counts.valid?total:null, observations:activityDays?observations:null,
      activityDays, positiveDays, negativeDays, partial:counts.missing+counts.invalid>0};
  }
  window.JournalHistory={summarize:summarizeHistory};

  function summarizeIntervals(history, day, category, options={}) {
    const days=[7,14,30].includes(Number(options.days))?Number(options.days):30;
    const signal=["E1","E2"].includes(options.signal)?options.signal:"all", includeShort=options.includeShort===true;
    const past=history.filter(r=>r.date<=day), lookup=new Map(past.map(r=>[r.date,r]));
    const changedAt=past.filter(r=>r.category!==category).map(r=>r.date).sort().at(-1);
    const end=new Date(`${day}T00:00:00Z`), start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);
    const counts={complete:0,missing:0,inactive:0,unavailable:0,excluded:0}, frequencies=new Map();
    let shortCount=0, rawCount=0;
    for(let i=0;i<days;i++) {
      const date=new Date(start);date.setUTCDate(date.getUTCDate()+i);
      const key=date.toISOString().slice(0,10), r=lookup.get(key), detail=r?.interval_detail;
      if((changedAt && key<=changedAt) || (r && r.category!==category)) {counts.excluded++;continue;}
      if(!r) {counts.missing++;continue;}
      if(r.observations===0) {counts.inactive++;continue;}
      // Frequency counts need complete counters, not an invented event ordering.
      const groups=detail?.groups;
      const valid=Number.isFinite(r.observations) && r.observations>0 && detail?.quality==="complete"
        && Array.isArray(groups) && groups.length===2 && new Set(groups.map(g=>g?.signal)).size===2
        && groups.every(g=>g && ["E1","E2"].includes(g.signal) && Array.isArray(g.values)
          && g.values.every(v=>Array.isArray(v) && v.length===2 && Number.isSafeInteger(v[0]) && v[0]>=0 && Number.isSafeInteger(v[1]) && v[1]>0)
          && new Set(g.values.map(v=>v[0])).size===g.values.length
          && Number.isSafeInteger(r[g.signal==="E1"?"counter_a":"counter_b"])
          && g.values.reduce((sum,v)=>sum+v[1],0)===r[g.signal==="E1"?"counter_a":"counter_b"]);
      if(!valid) {counts.unavailable++;continue;}
      counts.complete++;
      for(const group of groups) if(signal==="all" || group.signal===signal) {
        for(const [step,n] of group.values) {
          rawCount+=n;
          if(step<=1) shortCount+=n;
          if(includeShort || step>1) frequencies.set(step,(frequencies.get(step)||0)+n);
        }
      }
    }
    const values=[...frequencies].sort((a,b)=>a[0]-b[0]), n=values.reduce((sum,v)=>sum+v[1],0);
    const at=position=>{let seen=0;for(const [value,count] of values){seen+=count;if(seen>position)return value;}return null;};
    const share=limit=>n?values.filter(([v])=>v<=limit).reduce((sum,v)=>sum+v[1],0)/n:null;
    const bins=[...(includeShort?[{lo:0,hi:1,label:"0–1"}]:[]),{lo:2,hi:99,label:"2–99"},
      ...Array.from({length:9},(_,i)=>({lo:(i+1)*100,hi:(i+2)*100-1,label:`${(i+1)*100}–${(i+2)*100-1}`})),
      {lo:1000,hi:Infinity,label:"≥1,000"}].map(bin=>({...bin,
        count:values.filter(([v])=>v>=bin.lo && v<=bin.hi).reduce((sum,v)=>sum+v[1],0)}));
    return {days,start:start.toISOString().slice(0,10),end:day,changedAt,signal,includeShort,counts,shortCount,rawCount,n,bins,
      mean:n?values.reduce((sum,[value,count])=>sum+value*count,0)/n:null,
      median:n?(at(Math.floor((n-1)/2))+at(Math.floor(n/2)))/2:null,within100:share(100),within200:share(200)};
  }
  window.JournalIntervals={summarize:summarizeIntervals};

  // A confirmed first entry is not necessarily the first raw signal or the
  // cumulative distance from the start of the day. The exporter owns identity.
  function summarizeFirstOpen(history, day, category, options={}) {
    const days=[7,14,30].includes(Number(options.days))?Number(options.days):30;
    const past=history.filter(r=>r.date<=day), lookup=new Map(past.map(r=>[r.date,r]));
    const changedAt=past.filter(r=>r.category!==category).map(r=>r.date).sort().at(-1);
    const end=new Date(`${day}T00:00:00Z`), start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);
    const counts={complete:0,no_play:0,no_event:0,missing:0,unknown:0,excluded:0};
    const rows=Array.from({length:days},(_,i)=>{
      const date=new Date(start);date.setUTCDate(date.getUTCDate()+i);
      const key=date.toISOString().slice(0,10), r=lookup.get(key), detail=r?.first_open_detail;
      let status="unknown";
      if((changedAt && key<=changedAt) || (r && r.category!==category)) status="excluded";
      else if(!r) status="missing";
      else if(r.observations===0) status="no_play";
      else if(!Number.isFinite(r.observations) || r.observations<0) status="unknown";
      else if(detail?.quality==="complete") status="complete";
      else if(detail?.quality==="no_event") status="no_event";
      else if(!detail || detail.quality==="missing") status="missing";
      counts[status]++;
      const complete=status==="complete";
      const step=complete && detail?.step_quality==="observed" && Number.isSafeInteger(detail.step) && detail.step>=0 ? detail.step : null;
      const amount=complete && detail?.amount_quality==="estimated" && Number.isFinite(detail.amount) && detail.amount>=0 ? detail.amount : null;
      const lowerBound=complete && detail?.amount_quality==="lower_bound" && Number.isFinite(detail.amount) && detail.amount>=0 ? detail.amount : null;
      const depthBase=step!==null && Number.isFinite(detail?.depth_base) && detail.depth_base>0 ? detail.depth_base : null;
      // Display only a verified ratio supplied by the backend; never invent a baseline.
      const depthRatio=depthBase!==null && Number.isFinite(detail?.depth_ratio) && detail.depth_ratio>=0 ? detail.depth_ratio : null;
      return {date:key,status,step,amount,lowerBound,depthBase,depthRatio,
        entryTime:complete && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(detail?.entry_time||"")?detail.entry_time:null,
        quality:detail?.quality||"missing",reason:detail?.reason||null};
    });
    const describe=values=>{
      const sorted=[...values].sort((a,b)=>a-b), n=sorted.length;
      return {n,mean:n?sorted.reduce((a,b)=>a+b,0)/n:null,
        median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,
        min:n?sorted[0]:null,max:n?sorted.at(-1):null};
    };
    const steps=rows.filter(r=>r.step!==null).map(r=>r.step), amounts=rows.filter(r=>r.amount!==null).map(r=>r.amount);
    const step={...describe(steps),within100:steps.length?steps.filter(v=>v<=100).length/steps.length:null,
      within200:steps.length?steps.filter(v=>v<=200).length/steps.length:null};
    const amount={...describe(amounts),over3000:amounts.length?amounts.filter(v=>v>3000).length/amounts.length:null};
    const bins=(values,definitions)=>definitions.map(b=>{
      const count=values.filter(v=>v>=b.lo && v<b.hi).length;
      return {...b,count,share:values.length?count/values.length:null};
    });
    step.bins=bins(steps,[...Array.from({length:10},(_,i)=>({lo:i*100,hi:(i+1)*100,label:`${i*100}–${(i+1)*100-1}`})),
      {lo:1000,hi:Infinity,label:"≥1,000"}]);
    amount.bins=bins(amounts,[...Array.from({length:10},(_,i)=>({lo:i*500,hi:(i+1)*500,label:`${fmt(i*500)}–<${fmt((i+1)*500)}`})),
      {lo:5000,hi:Infinity,label:"≥5,000"}]);
    const depth={...describe(rows.filter(r=>r.depthRatio!==null).map(r=>r.depthRatio)),
      bases:[...new Set(rows.filter(r=>r.depthRatio!==null).map(r=>r.depthBase))].sort((a,b)=>a-b)};
    return {days,start:start.toISOString().slice(0,10),end:day,changedAt,counts,rows,step,amount,depth,
      lowerBoundDays:rows.filter(r=>r.lowerBound!==null).length};
  }
  window.JournalFirstOpen={summarize:summarizeFirstOpen};

  function firstOpenDistribution(metric, label, unit) {
    if(!metric.n) return `<div class="empty">本窗口暂无可确认的${label}，不显示为零次分布。</div>`;
    const bins=metric.bins, w=940,h=270,left=48,right=18,top=28,bottom=78;
    const max=Math.max(1,...bins.map(b=>b.count)), x=i=>left+i/(bins.length-1)*(w-left-right), y=n=>top+(max-n)/max*(h-top-bottom);
    const ticks=[...new Set([0,Math.ceil(max/2),max])].sort((a,b)=>a-b);
    const path=bins.map((b,i)=>`${i?"L":"M"}${x(i).toFixed(2)},${y(b.count).toFixed(2)}`).join(" ");
    const svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}分布，横轴为数值区间，纵轴为天数"><title>${label} · ${metric.n} 个有效日；区间按类别等距排列，首尾区间宽度不同</title><text x="${left}" y="14" class="chart-axis">天数</text>${ticks.map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" class="chart-grid"/><text x="${left-8}" y="${y(n)+4}" text-anchor="end" class="chart-axis">${n}</text>`).join("")}<path d="${path}" class="chart-line"/>${bins.map((b,i)=>`<circle cx="${x(i)}" cy="${y(b.count)}" r="4" class="history-point"><title>${b.label} ${unit}：${b.count} 天 / ${metric.n} 天 · ${percent(b.share)}</title></circle><text x="${x(i)}" y="${h-bottom+18}" text-anchor="end" transform="rotate(-35 ${x(i)} ${h-bottom+18})" class="chart-axis">${b.label}</text>`).join("")}<text x="${w-right}" y="${h-6}" text-anchor="end" class="chart-axis">数值区间（${unit}）</text></svg>`;
    return `<div class="first-open-plot">${svg}</div><details class="first-open-bins"><summary>查看各区间天数与占比（有效 ${metric.n} 天）</summary><div class="table-scroll"><table><thead><tr><th>区间（${unit}）</th><th>天数</th><th>占有效日</th></tr></thead><tbody>${bins.map(b=>`<tr><td>${b.label}</td><td>${b.count} / ${metric.n}</td><td>${percent(b.share)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }

  function renderFirstOpen() {
    if(!intervalContext) return;
    const {history,day,r}=intervalContext;
    const summary=summarizeFirstOpen(history,day,r.category,{days:$("first-open-window").value}), c=summary.counts;
    $("first-open-panel").hidden=false;$("first-open-open").disabled=false;
    $("first-open-title").textContent=`${r.entity} 项 · 每日首次事件与首轮`;
    $("first-open-range").textContent=`${summary.start} → ${summary.end} · ${categoryName(r.category)}`;
    const definitions=[
      ["首次确认入口间隔（步）",summary.step,fmt,`≤100 步 ${percent(summary.step.within100)} · ≤200 步 ${percent(summary.step.within200)}`],
      ["首轮净增量估算（单位）",summary.amount,signed,`估计值 >3,000 单位 ${percent(summary.amount.over3000)}`],
      ["入口间隔 / 已核实固定基准",summary.depth,percent,summary.depth.n?`固定基准 ${summary.depth.bases.map(fmt).join(" / ")} 步`:"无可用的已核实基准"]
    ];
    $("first-open-stats").innerHTML=definitions.map(([label,m,format,share])=>`<tr><th scope="row">${label}</th><td>${m.n} / ${summary.days}</td><td>${format(m.mean)}</td><td>${format(m.median)}</td><td>${format(m.min)}</td><td>${format(m.max)}</td><td>${share}</td></tr>`).join("");
    $("first-open-step-chart").innerHTML=firstOpenDistribution(summary.step,"首次确认入口间隔","步");
    $("first-open-amount-chart").innerHTML=firstOpenDistribution(summary.amount,"首轮净增量估算","单位");
    $("first-open-note").textContent=`每日最多一次，窗口为 ${summary.days} 个日历日，截至所选日期，不使用未来记录。间隔是首次成功独立入口对应记录的间隔，不是开店至首次事件的累计观察量；失败的阶段信号不单独当作入口。首轮净增量估算为首轮起点至结束窗口的可见峰值净上涨，不是精确支付额；接近区间界线时仍有图像偏差与估计误差，估计值 >3,000 的占比只是估计值分布，不替代已核验的锚点标签，也不能用于精准支付判断。各项均值和占比分母分别为自身有效日，属于已确认样本的历史分布，不是未来发生概率。未活动 ${c.no_play} 天、确认无入口 ${c.no_event} 天、缺记录 ${c.missing} 天、身份或数据未确认 ${c.unknown} 天、早期 / 其他类别 ${c.excluded} 天，均不补零。${summary.lowerBoundDays?`另有 ${summary.lowerBoundDays} 天仅能确定首轮净增量下界，只列明细，不计入估算统计。`:""}基准比例仅使用后端已核实值，单独显示有效日，不按类别名称自行套用。${summary.changedAt?`最近已知类别变更边界为 ${summary.changedAt}，该日及以前排除。`:""}`;
    $("first-open-note").textContent+=" 固定基准用于历史归一化，不代表当日设定、重置状态或实际触发上限；尚未单独核实计数口径的类别不计算该比例。";
    const names={complete:"入口身份已确认",no_play:"未活动 · 不计入",no_event:"确认无独立入口 · 不计入",missing:"缺记录 · 不补零",unknown:"未确认 · 不计入",excluded:"早期 / 其他类别 · 不计入"};
    const reasons={unsupported_mapping:"信号对应关系未核实",counter_mismatch:"计数不一致",ambiguous_order:"记录顺序未确认",invalid_time:"时刻不可用",invalid_start:"间隔不可用",missing:"缺记录",
      round_end_unconfirmed:"首轮结束边界未确认",graph_missing:"缺首轮图像",graph_identity_mismatch:"首轮图像归属不一致",
      graph_quality_unavailable:"首轮图像缺损或截断",graph_calibration_unverified:"图像时钟轴未核实",graph_opening_unavailable:"图像缺日初覆盖",
      graph_daily_mismatch:"图像末值与日表不符",round_time_boundary_ambiguous:"首轮时刻边界过近",graph_round_coverage_missing:"图像未覆盖完整首轮",
      round_net_rise_unresolved:"首轮上涨量无法分辨",leading_main_event_without_entry:"首段入口缺失，不能跳过",
      first_chain_boundary_unverified:"首段可能承接前序，边界未确认",daily_ordinal_sequence_unverified:"日初事件序号不完整"};
    $("first-open-rows").innerHTML=[...summary.rows].reverse().map(row=>{
      const detail=[names[row.status],...(row.status==="unknown"?[reasons[row.reason]||reasons[row.quality]||"数据口径未核实"]:
        row.status==="complete" && row.amount===null && row.lowerBound===null?[reasons[row.reason]||"首轮数值暂不可估"]:[])].join("；");
      const amount=row.amount!==null?`${signed(row.amount)}（估）`:row.lowerBound!==null?`≥${fmt(row.lowerBound)}（仅下界）`:"—";
      return `<tr data-first-open-date="${row.date}" data-first-open-status="${row.status}"><td>${row.date}</td><td>${row.entryTime||"—"}</td><td>${fmt(row.step)}</td><td>${amount}</td><td>${percent(row.depthRatio)}${row.depthRatio!==null?`<small class="first-open-base">基准 ${fmt(row.depthBase)} 步</small>`:""}</td><td>${detail}</td></tr>`;
    }).join("");
  }

  function renderIntervals() {
    if(!intervalContext) return;
    const {history,day,r}=intervalContext;
    const summary=summarizeIntervals(history,day,r.category,{days:$("interval-window").value,
      signal:$("interval-signal").value,includeShort:$("interval-short").checked}), c=summary.counts;
    $("interval-panel").hidden=false;
    $("interval-open").disabled=false;
    $("interval-title").textContent=`${r.entity} 项 · 近期事件间隔分布`;
    $("interval-range").textContent=`${summary.start} → ${summary.end} · ${categoryName(r.category)}`;
    const cards=[["当前样本数",fmt(summary.n),`${c.complete} 个计数完整日 / ${summary.days} 天`],
      ["平均间隔",fmt(summary.mean),"观察步数"],["间隔中位数",fmt(summary.median),"观察步数"],
      ["≤100 步占比",percent(summary.within100),"当前筛选内的历史占比"],
      ["≤200 步占比",percent(summary.within200),"不是下一次事件概率"]];
    $("interval-metrics").innerHTML=cards.map(([label,value,note])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join("");
    const max=Math.max(1,...summary.bins.map(b=>b.count));
    $("interval-chart").innerHTML=summary.n?`<div class="interval-bars" role="list" aria-label="事件间隔频数及占比">${summary.bins.map(b=>`<div class="interval-bin" role="listitem"><span>${b.label} 步</span><progress class="interval-track" value="${b.count}" max="${max}" aria-label="${b.label} 步，${b.count} 次">${percent(b.count/summary.n)}</progress><span>${fmt(b.count)} 次 · ${percent(b.count/summary.n)}</span></div>`).join("")}</div>`:
      `<div class="empty">${c.complete?"有效日期中没有符合当前筛选的记录。":"此时间范围没有可用的完整逐次记录，不显示为零次分布。"}</div>`;
    $("interval-note").textContent=`只统计同一编号、当前类别且逐次计数与日表一致的日期。缺日 ${c.missing} 天，未活动 ${c.inactive} 天，明细缺失或不合格 ${c.unavailable} 天，早期 / 其他类别 ${c.excluded} 天；均不补零。当前信号范围共有 ${summary.rawCount} 条，0–1 步短间隔 ${summary.shortCount} 条${summary.includeShort?"已单列计入":"未计入上方统计，可勾选查看"}。E1/E2 是原始信号，≥2 步也不保证是首次事件；本图不是已确认的首次事件或阶段成功率。相同分钟先后不明不影响频数统计，但不推断序列。${summary.changedAt?`最近已知类别变更前的记录已排除（边界 ${summary.changedAt}）。`:""}`;
  }

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
    const category = $("category").value, search = $("search").value.trim().toLowerCase();
    return (dayData?.entities || []).filter(r => (!category || r.category === category)
      && (!$("observed-only").checked || r.observed)
      && (!search || `${r.entity} ${r.category} ${categoryName(r.category)}`.toLowerCase().includes(search)))
      .sort((a,b) => $("sort").value === "entity" ? a.entity-b.entity :
        (b[$("sort").value] ?? -Infinity) - (a[$("sort").value] ?? -Infinity) || a.entity-b.entity);
  }
  async function changeDay() {
    const token = ++dayToken;
    ++detailToken;
    intervalContext=null;
    $("interval-panel").hidden=true;
    $("interval-open").disabled=true;
    $("first-open-panel").hidden=true;
    $("first-open-open").disabled=true;
    $("history-panel").hidden=true;
    $("history-open").disabled=true;
    $("loading").hidden = false; $("error").hidden = true;
    const day = $("date").value;
    try {
      const value = await load(`day:${day}`, `data/days/${day}.js`);
      if (token !== dayToken) return;
      dayData = value;
      const prior = $("category").value;
      const counts = new Map();
      value.entities.forEach(r => counts.set(r.category, (counts.get(r.category) || 0)+1));
      $("category").innerHTML = '<option value="">全部类别</option>' + [...counts].sort((a,b) => b[1]-a[1] || categoryName(a[0]).localeCompare(categoryName(b[0]), "ja") || a[0].localeCompare(b[0])).map(([m,n]) => `<option value="${esc(m)}">${esc(categoryName(m))} · ${n} 项</option>`).join("");
      if (counts.has(prior)) $("category").value = prior;
      $("loading").hidden = true;
      renderDaily();
    } catch(e) {if (token === dayToken) fail(e);}
  }
  function renderDaily() {
    const data = filtered(), observed = data.filter(r => r.observed), deltas = observed.map(r=>r.delta).filter(n=>n!==null).sort((a,b)=>a-b);
    const mid = Math.floor(deltas.length/2), median = deltas.length ? (deltas[mid]+deltas[Math.floor((deltas.length-1)/2)])/2 : null;
    const sum = deltas.reduce((a,b)=>a+b,0), observations = data.reduce((a,b)=>a+(b.observations||0),0);
    const cards = [
      ["当前筛选对象", fmt(data.length), `${new Set(data.map(r=>r.category)).size} 个类别 · ${observed.length} 项有活动`],
      ["合计净变化 · 已活动", signed(sum), "日终净变化，不等于单次事件增量", tone(sum)],
      ["净变化中位数 · 已活动", signed(median), "未将 0 次观察 当作观察零", tone(median)],
      ["总观察量", fmt(observations), `${data.filter(r=>r.event_detail.quality === "complete").length} 项逐次计数完整`]
    ];
    $("metrics").innerHTML = cards.map(([label,value,note,cls])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${cls||""}">${value}</div><div class="metric-note">${note}</div></div>`).join("");
    if (!data.some(r=>r.entity===selectedUnit)) selectedUnit = data.find(r=>r.entity===633)?.entity ?? data.find(r=>r.observed)?.entity ?? data[0]?.entity;
    $("row-count").textContent = `${data.length} 项`;
    $("entities").innerHTML = data.length ? data.map(r=>`<tr class="entity-row ${r.entity===selectedUnit?"selected":""}" data-entity="${r.entity}"><td><button class="entity-link" data-entity="${r.entity}" aria-label="查看 ${r.entity} 项 ${esc(categoryName(r.category))}"><strong>${r.entity}</strong><small>${esc(categoryName(r.category))}</small></button></td><td>${fmt(r.observations)}${r.observations===0?'<small class="muted"> 未活动</small>':""}</td><td class="${tone(r.delta)}">${signed(r.delta)}</td><td>${fmt(r.counter_a)} / ${fmt(r.counter_b)}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">没有符合筛选条件的对象</td></tr>';
    renderDetail().catch(fail);
  }
  function changedCurve(rawPoints) {
    if(!Array.isArray(rawPoints) || rawPoints.some(p=>!Array.isArray(p) || p.length!==2
      || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return {points:[],rawCount:0,removed:0};
    const kept=rawPoints.filter((p,i)=>i===0 || p[1]!==rawPoints[i-1][1]);
    return {points:kept.map((p,i)=>[i,p[1]]),rawCount:rawPoints.length,removed:rawPoints.length-kept.length};
  }
  window.JournalCurve={compress:changedCurve};
  function lineChart(rawPoints) {
    const {points}=changedCurve(rawPoints);
    if (!points.length) return '<div class="empty">当前没有可展示的曲线</div>';
    const w=570,h=186,left=44,right=10,top=12,bottom=24;
    const ys=points.map(p=>p[1]), lo=Math.min(0,...ys), hi=Math.max(0,...ys), span=hi-lo||100;
    const x0=points[0][0], dx=points.at(-1)[0]-x0||1;
    const x=(n)=>left+(n-x0)/dx*(w-left-right), y=(n)=>top+(hi-n)/span*(h-top-bottom);
    const path=points.map((p,i)=>`${i?"L":"M"}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(" ");
    const base=y(0).toFixed(2);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="当日净变化曲线，连续相同值已合并，横轴为变化序号，不代表时间或观察步数"><title>净变化曲线：起点 + ${points.length-1} 次数值变化，末点 ${signed(ys.at(-1))} 单位</title>${[hi,(hi+lo)/2,lo].map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" class="chart-grid"/><text x="${left-6}" y="${y(n)+3}" text-anchor="end" class="chart-axis">${fmt(Math.round(n))}</text>`).join("")}<path class="chart-fill" d="${path} L${x(points.at(-1)[0])},${base} L${left},${base} Z"/><line x1="${left}" x2="${w-right}" y1="${base}" y2="${base}" class="chart-zero"/><path class="chart-line" d="${path}"/>${points.length===1?`<circle cx="${left}" cy="${y(ys[0])}" r="4" class="history-point"/>`:""}<text x="${left}" y="${h-5}" class="chart-axis">起点</text><text x="${w-right}" y="${h-5}" text-anchor="end" class="chart-axis">${points.length-1} 次变化 · 非时间轴</text></svg>`;
  }
  function historyChart(summary) {
    const calendar=summary.rows, day=summary.end;
    const ys = calendar.filter(r=>r.value!==null).map(r=>r.value);
    if (!ys.length) return '<div class="empty">当前类别没有可展示的历史观察</div>';
    const w=570,h=115,left=44,top=8,bottom=20,lo=Math.min(0,...ys),hi=Math.max(0,...ys),span=hi-lo||100;
    const y=n=>top+(hi-n)/span*(h-top-bottom), base=y(0), step=(w-left-10)/30;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="近30个日历日每日净变化，缺日、换类别与未活动留空"><line x1="${left}" x2="560" y1="${base}" y2="${base}" class="chart-zero"/>${calendar.map((r,i)=>r.value===null?"":`<rect x="${left+i*step+2}" y="${Math.min(base,y(r.value))}" width="${step-4}" height="${Math.max(1,Math.abs(base-y(r.value)))}" fill="${r.value>=0?'#86a47a':'#c49276'}"><title>${r.date}：${signed(r.value)} 单位</title></rect>`).join("")}<text x="${left-6}" y="${top+4}" text-anchor="end" class="chart-axis">${fmt(hi)}</text><text x="${left-6}" y="${h-bottom}" text-anchor="end" class="chart-axis">${fmt(lo)}</text><text x="${left}" y="${h-3}" class="chart-axis">${calendar[0].date.slice(5)}</text><text x="560" y="${h-3}" text-anchor="end" class="chart-axis">${day.slice(5)}</text></svg>`;
  }
  function cumulativeChart(summary) {
    const rows=summary.rows, values=rows.filter(r=>r.cumulative!==null).map(r=>r.cumulative);
    if(!values.length) return '<div class="empty">这 30 天没有可累计的有效结果，不显示为零。</div>';
    const w=900,h=225,left=64,right=20,top=20,bottom=32;
    const lo=Math.min(0,...values),hi=Math.max(0,...values),span=hi-lo||100;
    const x=i=>left+i/29*(w-left-right), y=n=>top+(hi-n)/span*(h-top-bottom);
    let path="", connected=false;
    rows.forEach((r,i)=>{
      if(r.cumulative===null) {connected=false; return;}
      path+=`${connected?"L":"M"}${x(i).toFixed(2)},${y(r.cumulative).toFixed(2)} `; connected=true;
    });
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="近30天已观察累计净变化；断点不跨接，缺记录不填零"><title>${summary.start} 至 ${summary.end} · 已观察合计 ${signed(summary.total)} 单位</title>${[hi,(hi+lo)/2,lo].map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" class="chart-grid"/><text x="${left-8}" y="${y(n)+4}" text-anchor="end" class="chart-axis">${fmt(Math.round(n))}</text>`).join("")}<line x1="${left}" x2="${w-right}" y1="${y(0)}" y2="${y(0)}" class="chart-zero"/><path d="${path.trim()}" class="chart-line"/>${rows.map((r,i)=>r.cumulative===null?"":`<circle cx="${x(i)}" cy="${y(r.cumulative)}" r="3.5" class="history-point"><title>${r.date} · 当日 ${signed(r.delta)} · 已观察累计 ${signed(r.cumulative)}</title></circle>`).join("")}${[0,7,14,21,29].map(i=>`<text x="${x(i)}" y="${h-7}" text-anchor="${i===0?"start":i===29?"end":"middle"}" class="chart-axis">${rows[i].date.slice(5)}</text>`).join("")}</svg>`;
  }
  function renderHistory(history, day, r) {
    const summary=summarizeHistory(history,day,r.category), c=summary.counts;
    $("history-chart").innerHTML=historyChart(summary);
    $("history-panel").hidden=false;
    $("history-open").disabled=false;
    $("history-title").textContent=`${r.entity} 项 · 30 天累计历史`;
    $("history-range").textContent=`${summary.start} → ${day} · ${categoryName(r.category)}`;
    const cards=[
      ["已观察累计净变化",signed(summary.total),summary.partial?"部分合计 · 仍有未知日期":"当前类别范围的有效日合计",tone(summary.total)],
      ["有效结果天数",`${c.valid} / 30`,`${c.missing} 天缺记录 · ${c.inactive} 天未活动`],
      ["累计观察量",fmt(summary.observations),`${summary.activityDays} 个已知活动日`],
      ["正值 / 负值天数",`${summary.positiveDays} / ${summary.negativeDays}`,"仅统计有效结果，不代表未来概率"]
    ];
    $("history-metrics").innerHTML=cards.map(([label,value,note,cls])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${cls||""}">${value}</div><div class="metric-note">${note}</div></div>`).join("");
    $("history-note").textContent=`从窗口起点累加已知的有效日净变化，并非跨日保留的余额或状态。缺记录 ${c.missing} 天、数值不可用 ${c.invalid} 天均不补零；未活动 ${c.inactive} 天不作为有效结果。${summary.changedAt?`最近一次已知不同类别日期为 ${summary.changedAt}，该日及以前不计入当前累计（窗口内 ${c.excluded} 天）。`:"仅统计当前类别。"} 曲线在无有效结果处断开；之后的数值继续表示已知日合计，不代表缺失日已被补齐。`;
    $("cumulative-chart").innerHTML=cumulativeChart(summary);
    $("history-rows").innerHTML=[...summary.rows].reverse().map(row=>`<tr data-history-date="${row.date}" data-history-status="${row.status}"><td>${row.date}</td><td>${esc(categoryName(row.category))}</td><td>${fmt(row.observations)}</td><td class="${tone(row.delta)}">${signed(row.delta)}</td><td class="${tone(row.cumulative)}">${signed(row.cumulative)}</td><td class="${row.status==="valid"?"":"muted"}">${historyNames[row.status]}</td></tr>`).join("");
    intervalContext={history,day,r};
    renderFirstOpen();
    renderIntervals();
  }
  async function renderDetail() {
    const token = ++detailToken, r = dayData?.entities.find(r=>r.entity===selectedUnit && filtered().some(f=>f.entity===r.entity));
    intervalContext=null;
    $("interval-panel").hidden=true;
    $("interval-open").disabled=true;
    $("first-open-panel").hidden=true;
    $("first-open-open").disabled=true;
    if (!r) {
      $("entity-title").textContent="没有选中的对象";
      for (const id of ["entity-category","entity-metrics","intraday-chart","history-chart","curve-note","events","event-title","event-quality","play-status"]) $(id).textContent="";
      $("history-panel").hidden=true; $("history-open").disabled=true;
      $("source-link").hidden=true; return;
    }
    const day=dayData.date;
    $("entity-title").textContent=`${r.entity} 项`;
    $("entity-category").textContent=categoryName(r.category);
    $("play-status").textContent=r.observations===0?"未活动":r.observed?"有活动记录":"观察步数未知";
    $("entity-metrics").innerHTML=`<div><span>总 观察量</span><strong>${fmt(r.observations)}</strong></div><div><span>最终净变化</span><strong class="${tone(r.delta)}">${signed(r.delta)}</strong></div><div><span>A / B</span><strong>${fmt(r.counter_a)} / ${fmt(r.counter_b)}</strong></div>`;
    const compressed=changedCurve(r.curve.points);
    $("intraday-chart").innerHTML=r.observations===0?'<div class="empty">未观察到活动，不构造零曲线。</div>':lineChart(r.curve.points);
    $("curve-note").textContent=r.observations===0?"0 次观察：没有观察到活动，不构造一条零事件增量曲线。":compressed.points.length ? `原始 ${compressed.rawCount} 点 → 起点 + ${compressed.points.length-1} 次变化；合并 ${compressed.removed} 个连续同值点，原始数据保留。横轴按变化序号等距排列，不代表时间、时长或观察步数；同值也不等于确认未活动。${compressed.points.length===1?"本日可见数据未出现数值变化。":""}曲线末点与日表相差 ${signed(r.curve.end_delta)} 单位${r.curve.quality==="end_mismatch"?"，超过核对容差，勿用于锚点判定":""}；可能存在采样或截顶误差。` : "曲线缺失或无效，不填零，也不据此判为负样本。";
    $("event-title").textContent=`${day} · ${r.entity} 项`;
    $("event-quality").textContent=`${qualityNames[r.event_detail.quality] || r.event_detail.quality}。日表 A/B ${fmt(r.counter_a)}/${fmt(r.counter_b)}；可见逐次 E1/E2 ${fmt(r.event_detail.visible_a)}/${fmt(r.event_detail.visible_b)}。${r.event_detail.order_quality!==r.event_detail.quality?`顺序：${qualityNames[r.event_detail.order_quality]}。`:""}`;
    $("event-quality").className=`notice ${r.event_detail.quality==="complete" && r.event_detail.order_quality==="complete"?"good":""}`;
    $("events").innerHTML=r.event_detail.events.length?r.event_detail.events.map(e=>`<tr><td>${esc(e.time)}</td><td>${esc(e.signal)}</td><td>${fmt(e.step)}</td><td>${fmt(e.no)}</td><td class="muted">未提供</td></tr>`).join(""):'<tr><td colspan="5" class="empty">没有可归属到此对象的逐次记录</td></tr>';
    $("source-link").hidden=true;
    $("history-panel").hidden=true;
    $("history-open").disabled=true;
    $("history-chart").textContent="读取历史…";
    try {
      const history=await load(`entity:${r.entity}`,`data/units/${r.entity}.js`);
      if(token===detailToken) renderHistory(history,day,r);
    } catch(e) {if(token===detailToken) fail(e);}
  }
  async function renderArchive() {
    if(!index.archives.length) {$("archive-cutoff").textContent="暂无预测存档"; return;}
    const token=++archiveToken, target=$("archive-date").value;
    const archive=await load(`archive:${target}`,`data/archives/${target}.js`);
    if(token!==archiveToken) return;
    $("archive-cutoff").textContent=`目标日 ${target} · 原任务数据截止日 ${archive.source_cutoff}`;
    const top=[...archive.candidates].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)).slice(0,10);
    const evaluated=top.filter(r=>r.matched!==null), successes=evaluated.filter(r=>r.matched).length;
    $("archive-outcome").textContent=evaluated.length?`TOP10 已观察 ${evaluated.length} 项 · 命中 ${successes} 项`:"实际结果尚不可复盘";
    $("predictions").innerHTML=top.map(r=>`<tr><td>${fmt(r.rank)}</td><td>${esc(categoryName(r.category))} · ${r.entity}</td><td>${percent(r.p_high)}</td><td class="${tone(r.actual_delta)}">${signed(r.actual_delta)}</td><td>${r.matched===null?"未知 / 未活动":r.matched?"命中":"未命中"}</td></tr>`).join("");
    $("auc").innerHTML=archive.auc.length?archive.auc.map(r=>`<tr><td>${esc(categoryName(r.category))}</td><td>${r.auc==null?"不可计算":r.auc.toFixed(3)}</td><td>${fmt(r.positives)} / ${fmt(r.negatives)}</td><td>${esc(r.start)} → ${esc(r.end)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">该日没有 AUC 存档</td></tr>';
    const status={partial_event_35pct_missing:"类别项未验证 · 0.35 未计入",insufficient_observations:"活动观察步数不足",ok:"完整试验分"};
    $("weights").innerHTML=archive.weights.length?archive.weights.map(r=>`<tr><td>${esc(categoryName(r.category))} · ${fmt(r.entity)}</td><td>${r.score==null?"—":r.score.toFixed(3)}</td><td>${r.scope==="formal_eligible"?"正式范围内的试验评分":"指定例外 · 独立试验"}</td><td>${esc(status[r.status]||r.status)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">该日没有权重存档</td></tr>';
  }
  function renderAbout() {
    const latest=index.days[0];
    const entries=[["日数据范围",`${index.first_date} → ${index.latest_date}`],["已采集日期",`${index.days.length} 天`],["对象日记录",fmt(index.source_entity_days)],["最新对象 / 类别",`${latest.entities} / ${latest.categories}`],["逐次文件最新记录",index.latest_events||"缺失"],["最新日逐次计数完整",`${latest.events_complete} / ${latest.entities} 项`],["来源 A 最近任务",`${index.collection.source_a?.status||"未知"}`],["来源 B 最近任务",`${index.collection.source_b?.status||"未知"}`]];
    $("coverage").innerHTML=entries.map(([a,b])=>`<div class="coverage-row"><span>${a}</span><strong>${esc(b)}</strong></div>`).join("");
    $("build-time").textContent=`网页数据导出时间：${index.generated_at}（日本时间）。`;
    $("dictionary").textContent="类别以简短名称显示，内部代号用于筛选和历史关联。简短显示名随网页公开；完整本地辞典、采集来源链接及私有配置不随网页发布。";
  }
  function switchView(view) {
    if(!index) return;
    currentView=view;
    for(const name of ["daily","archive","about"]) $(`${name}-view`).hidden=name!==view;
    document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("page-title").innerHTML={daily:'每日数据观察台<span>把每一天，连起来看。</span>',archive:'预测与复盘存档<span>保留当时的判断，再看真实的结果。</span>',about:'数据与口径<span>知道数据从哪里来，也知道它的边界。</span>'}[view];
    if(view==="archive") renderArchive().catch(fail);
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
    for(const id of ["interval-window","interval-signal","interval-short"]) $(id).addEventListener("change",renderIntervals);
    $("first-open-window").addEventListener("change",renderFirstOpen);
    $("first-open-open").addEventListener("click",()=>{
      if($("first-open-panel").hidden) return;
      $("first-open-panel").focus({preventScroll:true});
      $("first-open-panel").scrollIntoView({behavior:"auto",block:"start"});
    });
    $("interval-open").addEventListener("click",()=>{
      if($("interval-panel").hidden) return;
      $("interval-panel").focus({preventScroll:true});
      $("interval-panel").scrollIntoView({behavior:"auto",block:"start"});
    });
    for(const id of ["category","observed-only","sort"]) $(id).addEventListener("change",renderDaily);
    $("search").addEventListener("input",renderDaily);
    $("entities").addEventListener("click",e=>{const row=e.target.closest("[data-entity]");if(row){selectedUnit=Number(row.dataset.entity);renderDaily();}});
    $("history-open").addEventListener("click",()=>{
      if($("history-panel").hidden) return;
      $("history-panel").focus({preventScroll:true});
      $("history-panel").scrollIntoView({behavior:"auto",block:"start"});
    });
    $("archive-date").addEventListener("change",()=>renderArchive().catch(fail));
    document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  }
  init().catch(fail);
})();
