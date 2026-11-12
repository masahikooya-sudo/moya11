// レポート（FR-059〜065）
'use strict';

// 直近6か月のラベル（最後が当月）
function monthLabels() {
  const d = new Date(), out = [];
  for (let i = 5; i >= 0; i--) out.push(`${new Date(d.getFullYear(), d.getMonth() - i, 1).getMonth() + 1}月`);
  return out;
}

function reportData() {
  const cases = state.cases, quoted = cases.filter(c => c.quotes);
  const sums = cases.map(c => checkSummary(c));
  const savingOf = c => (c.quotes.base - c.quotes.items[c.quotes.adopt].amount) / c.quotes.base * 100;
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const total = quoted.reduce((a, c) => a + c.quotes.items[c.quotes.adopt].amount, 0);
  const saving = avg(quoted.map(savingOf));
  // 採用予定先の評価（レーダーチャート用、各100点満点）
  const radar = quoted.length ? [
    ['条件適合', avg(quoted.map(c => (c.candidates.find(x => x.id === c.quotes.adopt) || { fit: 0 }).fit))],
    ['納期', avg(quoted.map(c => { const l = daysLeft(c); return l === null ? 70 : c.quotes.items[c.quotes.adopt].lead <= l ? 100 : 40; }))],
    ['価格', Math.max(0, Math.min(100, 50 + saving * 5))],
    ['取引実績', avg(quoted.map(c => Math.min(supplier(c.quotes.adopt).deals, 10) * 10))],
    ['社内評価', avg(quoted.map(c => supplier(c.quotes.adopt).rating * 20))],
  ] : null;
  return {
    cases, quoted, sums, total, saving, radar, savingOf,
    warn: sums.reduce((a, s) => a + s.warn + s.ask, 0),
    progress: Math.round(avg(sums.map(s => s.rate))),
    months: monthLabels(),
    monthlyCases: [...REPORT_HISTORY.map(h => h.cases), cases.length],
    monthlySaving: [...REPORT_HISTORY.map(h => h.saving), +saving.toFixed(1)],
  };
}

// ---------- グラフ（SVG） ----------
const W = 440, H = 240, PAD = { l: 44, r: 14, t: 22, b: 32 };
function axis(max, unit) {
  const ticks = [0, max / 2, max];
  return ticks.map(t => { const y = H - PAD.b - (t / max) * (H - PAD.t - PAD.b);
    return `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="tick" x="${PAD.l - 6}" y="${y + 5}" text-anchor="end">${t}${unit}</text>`; }).join('');
}
const niceMax = v => { const m = Math.max(...v, 1), step = m <= 5 ? 1 : m <= 10 ? 2 : 5; return Math.ceil(m / step) * step; };

function barChart(labels, values, unit, title) {
  const max = niceMax(values), slot = (W - PAD.l - PAD.r) / values.length, bw = Math.min(26, slot * 0.5), ph = H - PAD.t - PAD.b;
  const bars = values.map((v, i) => {
    const h = Math.max(v / max * ph, 1), x = PAD.l + slot * i + (slot - bw) / 2, y = H - PAD.b - h, last = i === values.length - 1;
    return `<g data-tip="${labels[i]}：${v}${unit}"><rect class="hit" x="${PAD.l + slot * i}" y="${PAD.t}" width="${slot}" height="${ph}"/>
      <path class="bar-mark${last ? ' now' : ''}" d="M${x},${y + h} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${y + h} Z"/>
      ${last ? `<text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${v}${unit}</text>` : ''}
      <text class="tick" x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${labels[i]}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${axis(max, '')}${bars}</svg>`;
}

function lineChart(labels, values, unit, title) {
  const max = niceMax(values), slot = (W - PAD.l - PAD.r) / values.length, ph = H - PAD.t - PAD.b;
  const pt = (v, i) => [PAD.l + slot * i + slot / 2, H - PAD.b - Math.max(v, 0) / max * ph];
  const pts = values.map(pt), n = pts.length - 1;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${axis(max, unit)}
    <polyline class="line-mark" points="${pts.map(p => p.join(',')).join(' ')}"/>
    ${pts.map((p, i) => `<g data-tip="${labels[i]}：${values[i]}${unit}"><rect class="hit" x="${p[0] - slot / 2}" y="${PAD.t}" width="${slot}" height="${ph}"/>
      <circle class="dot" cx="${p[0]}" cy="${p[1]}" r="${i === n ? 5 : 4}"/><text class="tick" x="${p[0]}" y="${H - 10}" text-anchor="middle">${labels[i]}</text></g>`).join('')}
    <text class="val" x="${pts[n][0]}" y="${pts[n][1] + (n && values[n] < values[n - 1] ? 22 : -11)}" text-anchor="middle">${values[n]}${unit}</text></svg>`;
}

function radarChart(axes, title) {
  const cx = W / 2, cy = 124, R = 80, n = axes.length;
  const pos = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const ring = k => `<polygon class="grid" points="${axes.map((_, i) => pos(i, R * k).join(',')).join(' ')}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
    ${[0.25, 0.5, 0.75, 1].map(ring).join('')}${axes.map((_, i) => `<line class="grid" x1="${cx}" y1="${cy}" x2="${pos(i, R)[0]}" y2="${pos(i, R)[1]}"/>`).join('')}
    <polygon class="radar-mark" points="${axes.map((a, i) => pos(i, R * a[1] / 100).join(',')).join(' ')}"/>
    ${axes.map((a, i) => { const p = pos(i, R * a[1] / 100), l = pos(i, R + 18);
      return `<g data-tip="${a[0]}：${Math.round(a[1])}点"><circle class="hit" cx="${p[0]}" cy="${p[1]}" r="14"/><circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4"/>
        <text class="tick" x="${l[0]}" y="${l[1] + 4}" text-anchor="${Math.abs(l[0] - cx) < 5 ? 'middle' : l[0] > cx ? 'start' : 'end'}">${a[0]} ${Math.round(a[1])}</text></g>`; }).join('')}</svg>`;
}

// ---------- 画面 ----------
function renderReport() {
  if (!state.cases.length) return emptyState('レポート出力', '案件がありません。', `<div class="actions center">${sampleButton}</div>`);
  const d = reportData();
  const todo = d.cases.flatMap((c, i) => d.sums[i].list.filter(k => k.status === '注意' || k.status === '要確認').map(k => ({ c, k })))
    .sort((a, b) => (a.k.status === '注意' ? 0 : 1) - (b.k.status === '注意' ? 0 : 1));
  const dataTable = `<details class="chart-data"><summary>グラフの数値を表で見る</summary><div class="table-wrap"><table class="table">
    <thead><tr><th>月</th>${d.months.map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>
    <tr><th scope="row">見積依頼件数</th>${d.monthlyCases.map(v => `<td>${v}件</td>`).join('')}</tr>
    <tr><th scope="row">平均削減率</th>${d.monthlySaving.map(v => `<td>${v}%</td>`).join('')}</tr></tbody></table></div></details>`;
  return `<div class="page-head"><div><h1>ソーシング状況レポート</h1><p class="muted">${today()} 時点。当月の値は登録案件から集計し、過去月の値はダミーです。</p></div>
      <div class="actions no-print"><button class="btn ghost" data-a="csv">CSV出力</button><button class="btn primary" data-a="print">レポート出力（印刷 / PDF）</button></div></div>
    <div class="kpi-row">
      <div class="card kpi"><span>案件数</span><b>${d.cases.length}件</b><small>うち見積比較済 ${d.quoted.length}件</small></div>
      <div class="card kpi"><span>総金額（採用予定）</span><b>${yen(d.total)}</b><small>平均削減率 ${d.saving.toFixed(1)}%</small></div>
      <div class="card kpi ${d.warn ? 'tone-ng' : ''}"><span>注意・警告件数</span><b>${d.warn}件</b><small>注意と要確認の合計</small></div>
      <div class="card kpi"><span>進捗率</span><b>${d.progress}%</b><div class="bar big"><i style="width:${d.progress}%"></i></div></div>
    </div>
    <div class="charts">
      <div class="card"><h2>月別の見積依頼件数</h2>${barChart(d.months, d.monthlyCases, '件', '月別の見積依頼件数の棒グラフ')}</div>
      <div class="card"><h2>平均削減率の推移</h2>${lineChart(d.months, d.monthlySaving, '%', '平均削減率の推移の折れ線グラフ')}</div>
      <div class="card"><h2>採用予定先の評価（平均）</h2>${d.radar ? radarChart(d.radar, '採用予定先の評価のレーダーチャート') : '<div class="empty">見積比較済の案件がありません。</div>'}</div>
    </div>
    ${dataTable}
    <div class="card"><h2>案件別の状況</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>案件</th><th>進行状況</th><th>採用予定先</th><th class="right">見積金額</th><th class="right">削減率</th><th style="width:16%">実施率</th></tr></thead>
      <tbody>${d.cases.map((c, i) => `<tr><td><b>${esc(c.title)}</b></td><td><span class="chip">${esc(stageOf(c))}</span></td>
        <td>${c.quotes ? esc(supplier(c.quotes.adopt).name) : '<span class="muted">—</span>'}</td>
        <td class="right">${c.quotes ? yen(c.quotes.items[c.quotes.adopt].amount) : '<span class="muted">—</span>'}</td>
        <td class="right">${c.quotes ? d.savingOf(c).toFixed(1) + '%' : '<span class="muted">—</span>'}</td>
        <td><div class="rate"><div class="bar big"><i style="width:${d.sums[i].rate}%"></i></div><b>${d.sums[i].rate}%</b></div></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>業務・手順チェック一覧</h2>
      ${todo.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>判定</th><th>案件</th><th>チェック項目</th><th>内容</th><th class="no-print"></th></tr></thead>
        <tbody>${todo.map(({ c, k }) => `<tr><td>${statusChip(k.status)}</td><td>${esc(c.title)}</td><td><b>${esc(k.label)}</b></td><td class="small-text">${esc(k.finding)}</td>
          <td class="right no-print"><button class="btn small ghost" data-a="go" data-v="${k.page}:${c.id}">対象へ</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">注意・確認が必要な業務はありません。</div>'}</div>`;
}

PAGES.report = {
  render: renderReport,
  click(a) {
    if (a === 'print') printDoc();
    else if (a === 'csv') {
      const d = reportData(), cell = v => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [['案件名', 'カテゴリ', '進行状況', '採用予定先', '見積金額', '基準金額', '削減率(%)', '実施率(%)', '注意', '要確認']];
      d.cases.forEach((c, i) => rows.push([c.title, c.info ? c.info.category : '', stageOf(c), c.quotes ? supplier(c.quotes.adopt).name : '',
        c.quotes ? c.quotes.items[c.quotes.adopt].amount : '', c.quotes ? c.quotes.base : '', c.quotes ? d.savingOf(c).toFixed(1) : '', d.sums[i].rate, d.sums[i].warn, d.sums[i].ask]));
      download(`ソーシングレポート_${today()}.csv`, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv');
    }
  },
};

// グラフのツールチップ
document.addEventListener('mousemove', e => {
  const tip = $('#tip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'tip', className: 'tip' }));
  const g = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!g) { tip.style.display = 'none'; return; }
  tip.textContent = g.dataset.tip; tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = e.clientY - 34 + 'px';
});
