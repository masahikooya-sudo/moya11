// 比較表（FR-020〜028）と 決裁（FR-029〜036）
'use strict';

const RESP = ['充足', '不充足', '要確認'];
const respChip = s => `<span class="st ${{ 充足: 'ok', 不充足: 'ng', 要確認: 'na' }[s]}">${{ 充足: '○', 不充足: '×', 要確認: '？' }[s]} ${s}</span>`;

// ---------- 比較表 ----------
function workTabs(active, c) {
  const tab = (id, label) => `<button class="tab${active === id ? ' on' : ''}" data-a="tab" data-v="${id}">${label}</button>`;
  return `<div class="tabs" role="tablist">${tab('compare', '見積比較')}${tab('eval', '企業評価')}
    <button class="tab${active === 'ringi' ? ' on' : ''}" data-a="go" data-v="ringi:${c.id}">稟議・決裁</button></div>`;
}

// AIコメント（FR-025）: 各行の差分・注意点を文章にする
function compareComments(c) {
  const ids = Object.keys(c.quotes.items), it = c.quotes.items, name = id => supplier(id).name;
  const byAmount = [...ids].sort((a, b) => it[a].amount - it[b].amount);
  const low = byAmount[0], high = byAmount[byAmount.length - 1];
  const out = {};
  out.amount = ids.length > 1
    ? `最安は${name(low)}（基準比 ${pct((it[low].amount - c.quotes.base) / c.quotes.base * 100)}）。最高値の${name(high)}との差は${yen(it[high].amount - it[low].amount)}です。`
    : `見積が1社のみのため、価格の比較ができません。`;
  const left = daysLeft(c), late = ids.filter(id => left !== null && it[id].lead > left);
  out.lead = left === null ? '希望納期が未設定のため、納期の適否は判定していません。'
    : late.length ? `希望納期まで残り${left}日。${late.map(name).join('、')}は間に合わない可能性があります。` : `希望納期まで残り${left}日。全社とも間に合う見込みです。`;
  out.support = new Set(ids.map(id => it[id].support)).size > 1 ? 'サポート時間に差があります。夜間・休日の対応が必要かを利用部門に確認してください。' : '全社同条件です。';
  out.warranty = new Set(ids.map(id => it[id].warranty)).size > 1 ? '保証期間に差があります。延長保証の費用を含めた総額で比較してください。' : '全社同条件です。';
  const longPay = ids.filter(id => it[id].pay.includes('翌々月'));
  out.pay = longPay.length ? `${longPay.map(name).join('、')}は支払まで60日を超える可能性があります。法令チェックで確認してください。` : '支払条件に大きな差はありません。';
  out.rows = c.matrix.map((r, n) => {
    const ng = ids.filter(id => it[id].resp[n] === '不充足'), ask = ids.filter(id => it[id].resp[n] === '要確認');
    if (ng.length) return `${ng.map(name).join('、')}が未対応。${r.level === '必須' ? '必須要件のため、採用する場合は代替策の確認が必要です。' : '希望要件のため、価格との兼ね合いで判断してください。'}`;
    if (ask.length) return `${ask.map(name).join('、')}の回答が不明確です。追加確認を推奨します。`;
    return '全社充足。';
  });
  return out;
}

function renderCompare() {
  const { cases, c } = pickCase(x => x.selected.length > 0);
  if (!c) return emptyState('比較表生成', '見積を依頼する企業を選択した案件がありません。RFP作成で候補企業を選択してください。',
    `<div class="actions center"><button class="btn primary" data-a="go" data-v="rfp">RFP作成へ</button>${sampleButton}</div>`);
  const head = `<div class="page-head"><div><h1>比較表</h1><p class="muted">複数社の見積と条件を横並びで比較し、AIが違いと注意点を補足します。</p></div>${caseSelect(cases, c)}</div>`;
  if (!c.quotes) return head + `<div class="card placeholder"><h2>見積がまだ取り込まれていません</h2>
    <p class="muted">依頼先 ${c.selected.length}社（${c.selected.map(id => esc(supplier(id).name)).join('、')}）の見積を取り込み、比較表を作成します。<br>このプロトタイプでは見積回答をダミーで生成します。</p>
    <button class="btn primary" data-a="gen">✦ 見積を取り込んで比較表を生成</button></div>`;

  const q = c.quotes, ids = Object.keys(q.items), adopt = q.adopt, aq = q.items[adopt];
  const saving = q.base - aq.amount, rec = recommend(c);
  const tiles = `<div class="kpi-row">
    <div class="card kpi"><span>基準金額</span>${ui.edit ? `<input type="number" step="10000" data-f="base" value="${q.base}" aria-label="基準金額">` : `<b>${yen(q.base)}</b>`}<small>予算・過去実績をもとに設定</small></div>
    <div class="card kpi"><span>見積金額（採用予定）</span><b>${yen(aq.amount)}</b><small>${esc(supplier(adopt).name)}</small></div>
    <div class="card kpi"><span>削減見込額</span><b class="${saving < 0 ? 'neg' : ''}">${yen(saving)}</b><small>基準金額 − 見積金額</small></div>
    <div class="card kpi"><span>削減率</span><b class="${saving < 0 ? 'neg' : ''}">${(saving / q.base * 100).toFixed(1)}%</b><small>${saving < 0 ? '基準金額を超過' : '基準金額比'}</small></div>
  </div>`;
  if (ui.tab === 'eval') return head + workTabs('eval', c) + tiles + renderEval(c, ids);

  const cm = compareComments(c), left = daysLeft(c);
  const cell = (id, key, view) => ui.edit
    ? `<td><input ${key === 'amount' || key === 'lead' ? 'type="number"' : ''} data-f="q:${id}:${key}" value="${esc(q.items[id][key])}" aria-label="${esc(supplier(id).name)}"></td>`
    : `<td>${view(q.items[id])}</td>`;
  const row = (label, key, view, comment) => `<tr><th scope="row">${label}</th>${ids.map(id => cell(id, key, view)).join('')}<td class="ai-note">${esc(comment)}</td></tr>`;
  const min = Math.min(...ids.map(id => q.items[id].amount));
  const reqRows = c.matrix.map((r, n) => `<tr class="${ids.some(id => q.items[id].resp[n] !== '充足') ? 'flag' : ''}">
    <th scope="row">${esc(r.req)} <span class="chip ${r.level === '必須' ? 'must' : ''}">${r.level}</span><div class="muted small-text">${esc(r.cond)}</div></th>
    ${ids.map(id => `<td>${ui.edit
      ? `<select data-f="r:${id}:${n}" aria-label="${esc(supplier(id).name)}">${RESP.map(s => `<option${q.items[id].resp[n] === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`
      : respChip(q.items[id].resp[n])}</td>`).join('')}
    <td class="ai-note">${esc(cm.rows[n])}</td></tr>`).join('');

  // AI要約と未充足リスク（FR-026）
  const risks = [];
  for (const id of ids) {
    const st = quoteStats(c, id), nm = supplier(id).name;
    if (st.mustNg) risks.push(`<li class="risk">${esc(nm)}：必須要件の未充足が${st.mustNg}件</li>`);
    if (st.ask) risks.push(`<li>${esc(nm)}：回答が不明確な要件が${st.ask}件（追加確認が必要）</li>`);
    if (q.items[id].amount > q.base) risks.push(`<li class="risk">${esc(nm)}：見積金額が基準金額を${yen(q.items[id].amount - q.base)}超過</li>`);
  }
  const rs = quoteStats(c, rec);
  const summary = `<div class="card ai-panel">
    <h2><span class="ai">✦ AI</span> 比較の要約</h2>
    <p>推奨は <b>${esc(supplier(rec).name)}</b> です。見積金額は${yen(q.items[rec].amount)}（基準比 ${pct((q.items[rec].amount - q.base) / q.base * 100)}）、必須要件の未充足は${rs.mustNg}件です。${rec !== adopt ? `<br>現在の採用予定は ${esc(supplier(adopt).name)} になっています。` : ''}</p>
    ${risks.length ? `<div class="label">注意点</div><ul>${risks.join('')}</ul>` : '<p class="muted">未充足・要確認の項目はありません。</p>'}
  </div>`;

  return head + workTabs('compare', c) + tiles + summary + `<div class="card">
    <div class="card-head"><h2>見積比較表</h2><div class="chips">
      <span class="st ok">○ 充足</span><span class="st ng">× 不充足</span><span class="st na">？ 要確認</span></div></div>
    <div class="table-wrap"><table class="table cmp">
      <thead><tr><th>項目</th>${ids.map(id => `<th class="${id === adopt ? 'adopt' : ''}">${esc(supplier(id).name)}${id === rec ? ' <span class="chip ok">AI推奨</span>' : ''}
        <label class="radio"><input type="radio" name="adopt" data-c="adopt" value="${id}" ${id === adopt ? 'checked' : ''}> 採用予定</label></th>`).join('')}<th><span class="ai">✦ AI</span>コメント</th></tr></thead>
      <tbody>
        ${row('見積金額', 'amount', x => `<b>${yen(x.amount)}</b>${x.amount === min && ids.length > 1 ? ' <span class="chip ok">最安</span>' : ''}<div class="small-text ${x.amount > q.base ? 'neg' : 'muted'}">基準比 ${pct((x.amount - q.base) / q.base * 100)}</div>`, cm.amount)}
        ${row('納期', 'lead', x => `${x.lead}日 ${left === null ? '' : x.lead <= left ? respChip('充足') : respChip('不充足')}`, cm.lead)}
        ${row('サポート対応時間', 'support', x => esc(x.support), cm.support)}
        ${row('保証', 'warranty', x => esc(x.warranty), cm.warranty)}
        ${row('支払条件', 'pay', x => esc(x.pay), cm.pay)}
        <tr class="section"><td colspan="${ids.length + 2}">要件への回答</td></tr>
        ${reqRows}
      </tbody></table></div>
    <div class="actions">
      <button class="btn ghost" data-a="edit">${ui.edit ? '✓ 編集を終了' : '✎ 比較表を編集'}</button>
      <button class="btn ghost" data-a="regen">↻ 再生成</button>
      <span class="spacer"></span>
      <button class="btn primary" data-a="go" data-v="ringi:${c.id}">稟議・決裁へ進む</button>
    </div>
  </div>`;
}

function renderEval(c, ids) {
  return `<div class="card"><h2>企業評価</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>取引先</th><th>AIスコア</th><th>条件適合率</th><th>リードタイム</th><th>取引実績</th><th>社内評価</th><th>評価理由</th></tr></thead>
    <tbody>${ids.map(id => {
      const s = supplier(id), x = c.candidates.find(k => k.id === id) || { score: '—', fit: 0, reasons: [], risks: [] };
      return `<tr><td><b>${esc(s.name)}</b><div class="muted small-text">${esc(s.note)}</div></td><td><b>${x.score}</b></td>
        <td>${x.fit}%<div class="bar"><i style="width:${x.fit}%"></i></div></td><td>${s.lead}日</td><td>${s.deals}件</td><td>${s.rating.toFixed(1)}</td>
        <td class="small-text">${x.reasons.map(esc).join('<br>')}${x.risks.map(r => `<div class="neg">注意：${esc(r)}</div>`).join('')}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}

PAGES.compare = {
  render: renderCompare,
  click(a, v) {
    const { c } = pickCase(x => x.selected.length > 0);
    if (a === 'tab') { ui.tab = v; ui.edit = false; render(); }
    else if (a === 'edit') { ui.edit = !ui.edit; render(); }
    else if (a === 'gen' || a === 'regen') {
      if (a === 'regen' && !confirm('比較表を作り直します。編集した内容は失われます。よろしいですか？')) return;
      runBusy('比較表を生成しています', ['見積回答を取り込み', '金額・条件を横並びに整理', 'AIが差分と注意点を分析'], () => {
        const base = c.quotes && c.quotes.base; c.quotes = base ? { base } : null;
        genQuotes(c); ui.edit = false; touch(c); render();
      });
    }
  },
  input(f, val) {
    const { c } = pickCase(x => x.selected.length > 0), [kind, id, key] = f.split(':');
    if (f === 'base') c.quotes.base = Math.max(1, +val || 0);
    else if (kind === 'q') c.quotes.items[id][key] = key === 'amount' || key === 'lead' ? +val || 0 : val;
    else if (kind === 'r') c.quotes.items[id].resp[+key] = val;
    touch(c);
  },
  change(k, val) {
    const { c } = pickCase(x => x.selected.length > 0);
    if (k === 'adopt') { c.quotes.adopt = val; touch(c); render(); }
  },
};

// ---------- 決裁（稟議） ----------
function routeFor(amount) { return APPROVAL_ROUTES.find(r => amount < r.max).label; }

function stakeState(s) { return s.status === '未回答' ? '未回答' : s.status === '条件付き' ? '条件付き' : s.status === '不可' ? '不可' : '回答済'; }

function buildStakeSummary(c) {
  const r = c.ringi, by = st => r.stake.filter(s => s.status === st);
  const lines = [`関係者${r.stake.length}名のうち、承諾${by('承諾').length}名、条件付き${by('条件付き').length}名、不可${by('不可').length}名、未回答${by('未回答').length}名。`];
  by('条件付き').forEach(s => lines.push(`・${s.name}の条件：${s.comment || '（内容未記入）'}`));
  by('不可').forEach(s => lines.push(`・${s.name}は不可：${s.comment || '（理由未記入）'}`));
  if (by('未回答').length) lines.push(`・未回答：${by('未回答').map(s => s.name).join('、')}。決裁前に回答を得ること。`);
  if (!by('不可').length && !by('未回答').length) lines.push(by('条件付き').length ? '条件を契約・発注内容に反映することを前提に、決裁へ進めます。' : '全関係者が承諾済みのため、決裁へ進めます。');
  return lines.join('\n');
}

// 価格比較・評価結果から稟議書を作る（FR-030）
function buildRingi(c) {
  const r = c.ringi, q = c.quotes, ids = Object.keys(q.items), sid = q.adopt, s = supplier(sid), aq = q.items[sid], st = quoteStats(c, sid);
  const cand = c.candidates.find(x => x.id === sid);
  const saving = q.base - aq.amount;
  const autoReason = [
    `${ids.length}社の見積を比較した結果、${s.name}を採用したい。`,
    `見積金額は${yen(aq.amount)}で、基準金額${yen(q.base)}に対し${saving >= 0 ? `${yen(saving)}（${(saving / q.base * 100).toFixed(1)}%）の削減` : `${yen(-saving)}の超過`}となる。`,
    cand ? `AI評価スコアは${cand.score}、条件適合率は${cand.fit}%。` : '',
    st.mustNg ? `必須要件に未充足が${st.mustNg}件あるため、代替策を確認する。` : '必須要件はすべて充足している。',
  ].filter(Boolean).join('\n  ');
  const table = ids.map(id => {
    const x = q.items[id], t = quoteStats(c, id);
    return `  ${id === sid ? '◎' : '　'} ${supplier(id).name}　${yen(x.amount)}　納期${x.lead}日　未充足${t.ng}件／要確認${t.ask}件`;
  }).join('\n');
  const cautions = c.matrix.map((m, n) => aq.resp[n] !== '充足' ? `  ・[${m.level}] ${m.req}：${aq.resp[n]}` : null).filter(Boolean);
  return `稟議書

起案日　：${today()}
件名　　：${r.subject}
起案部門：${r.dept || '—'}
起案者　：${r.author || '—'}
決裁区分：${r.route || routeFor(aq.amount)}

1. 決裁を求める事項
  ${s.name} への発注（${c.info.item || c.title}${c.info.quantity ? ' ' + c.info.quantity : ''}）
  発注金額：${yen(aq.amount)}（税別）
  納期　　：${aq.lead}日${c.info.deadline ? `（希望納期 ${c.info.deadline}）` : ''}
  支払条件：${aq.pay}

2. 目的・背景
  ${c.info.purpose || '—'}

3. 選定理由
  ${(r.reason || autoReason).replace(/\n/g, '\n  ')}

4. 見積比較（◎＝採用予定）
  基準金額：${yen(q.base)}
${table}

5. 留意事項
${cautions.length ? cautions.join('\n') : '  特になし'}

6. 社内調整の結果
${(r.summary || buildStakeSummary(c)).split('\n').map(l => '  ' + l).join('\n')}

7. 添付資料
  ${Object.keys(r.attach).filter(k => r.attach[k]).join('、') || 'なし'}
`;
}

function renderRingi() {
  const { cases, c } = pickCase(x => x.quotes);
  if (!c) return emptyState('稟議作成支援', '比較表を作成した案件がありません。先に比較表を作成してください。',
    `<div class="actions center"><button class="btn primary" data-a="go" data-v="compare">比較表へ</button>${sampleButton}</div>`);
  const r = ensureRingi(c), q = c.quotes, ids = Object.keys(q.items), aq = q.items[q.adopt];
  const inp = (key, label, ph = '') => `<label>${label}<input data-f="${key}" value="${esc(r[key])}" placeholder="${esc(ph)}"></label>`;
  const count = st => r.stake.filter(s => stakeState(s) === st).length;
  const stCls = { 未回答: 'off', 回答済: 'ok', 条件付き: 'na', 不可: 'ng' };
  return `<div class="page-head"><div><h1>稟議作成支援</h1><p class="muted">比較・評価の結果を使って稟議書を作成します。承認の実行（ワークフロー）は対象外で、書類の作成までを支援します。</p></div>${caseSelect(cases, c)}</div>
  ${workTabs('ringi', c)}
  <div class="split wide-left">
    <div>
      <div class="card">
        <h2>稟議情報</h2>
        ${inp('subject', '件名')}
        <div class="grid2">${inp('dept', '起案部門')}${inp('author', '起案者')}
          <label>採用先<select data-c="adopt">${ids.map(id => `<option value="${id}"${id === q.adopt ? ' selected' : ''}>${esc(supplier(id).name)}（${yen(q.items[id].amount)}）</option>`).join('')}</select></label>
          <label>決裁区分<select data-c="route"><option value="">金額から自動判定（${routeFor(aq.amount)}）</option>${APPROVAL_ROUTES.map(x => `<option${r.route === x.label ? ' selected' : ''}>${x.label}</option>`).join('')}</select></label>
        </div>
        <label>選定理由（空欄の場合はAIが比較結果から作成）<textarea data-f="reason" rows="3" placeholder="例：価格・納期・保守条件のいずれも最良のため">${esc(r.reason)}</textarea></label>
        <div class="label-like">添付資料</div>
        <div class="checks">${Object.keys(r.attach).map(k => `<label class="check"><input type="checkbox" data-c="attach:${k}" ${r.attach[k] ? 'checked' : ''}>${k}</label>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>社内調整</h2><div class="chips">
          <span class="st ok">回答済 ${count('回答済')}</span><span class="st na">条件付き ${count('条件付き')}</span><span class="st ng">不可 ${count('不可')}</span><span class="st off">未回答 ${count('未回答')}</span></div></div>
        <div class="table-wrap"><table class="table stake"><thead><tr><th>関係者</th><th>受入可否</th><th>コメント</th><th>状態</th></tr></thead>
          <tbody>${r.stake.map((s, n) => `<tr><td><b>${esc(s.name)}</b></td>
            <td><select data-c="stake:${n}" aria-label="${esc(s.name)}の受入可否">${STAKE_STATUS.map(x => `<option${s.status === x ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
            <td><input data-f="stakec:${n}" value="${esc(s.comment)}" placeholder="条件・理由など" aria-label="${esc(s.name)}のコメント"></td>
            <td><span class="st ${stCls[stakeState(s)]}">${stakeState(s)}</span></td></tr>`).join('')}</tbody></table></div>
        ${r.summary ? `<div class="summary"><div class="label"><span class="ai">✦ AI</span> 取りまとめ</div><p>${esc(r.summary).replace(/\n/g, '<br>')}</p></div>` : ''}
        <div class="actions"><button class="btn ghost" data-a="sum">✦ 意見を取りまとめる</button><span class="spacer"></span>
          <button class="btn primary" data-a="doc">✦ 稟議書を作成</button></div>
      </div>
    </div>
    <div class="card sticky">
      <div class="card-head"><h2>稟議書プレビュー</h2>${r.doc ? '<span class="chip ok">作成済</span>' : '<span class="chip warn">未作成</span>'}</div>
      ${r.doc ? `<textarea class="doc" data-f="doc" rows="30" spellcheck="false" aria-label="稟議書">${esc(r.doc)}</textarea>
        <div class="actions"><button class="btn ghost" data-a="doc">↻ 再作成</button><span class="spacer"></span>
          <button class="btn ghost" data-a="print">印刷 / PDF</button><button class="btn primary" data-a="save">ファイル出力</button></div>`
      : `<div class="empty">左の内容を確認し、「稟議書を作成」を押すと、ここにプレビューが表示されます。</div>`}
    </div>
  </div>`;
}

PAGES.ringi = {
  render: renderRingi,
  click(a) {
    const { c } = pickCase(x => x.quotes), r = c.ringi;
    if (a === 'sum') { r.summary = buildStakeSummary(c); touch(c); render(); }
    else if (a === 'doc') {
      if (r.doc && !confirm('稟議書を作り直します。プレビューで編集した内容は失われます。よろしいですか？')) return;
      runBusy('稟議書を作成しています', ['比較表・評価結果を集約', '社内調整の結果を反映', '稟議書を作成'], () => { r.doc = buildRingi(c); touch(c); render(); });
    }
    else if (a === 'save') download(`稟議書_${r.subject}.txt`, r.doc);
    else if (a === 'print') printDoc(r.doc);
  },
  input(f, val) {
    const { c } = pickCase(x => x.quotes), r = c.ringi;
    if (f.startsWith('stakec:')) r.stake[+f.split(':')[1]].comment = val; else r[f] = val;
    touch(c);
  },
  change(k, val, t) {
    const { c } = pickCase(x => x.quotes), r = c.ringi, [kind, arg] = k.split(':');
    if (k === 'adopt') c.quotes.adopt = val;
    else if (k === 'route') r.route = val;
    else if (kind === 'attach') r.attach[arg] = t.checked;
    else if (kind === 'stake') { r.stake[+arg].status = val; r.summary = ''; }
    touch(c); render();
  },
};
