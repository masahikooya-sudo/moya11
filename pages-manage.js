// 管理: プロセスチェック（FR-037〜042）、法令チェック（FR-043）、契約チェック（FR-044〜047）
'use strict';

// ---------- プロセスチェック ----------
// AIの指摘文（FR-041）: 判定と理由をまとめて示す
function aiFinding(k) {
  if (k.status === '完了') return '問題は見つかりませんでした。';
  if (k.status === '未実施') return k.finding || 'まだ実施されていません。';
  return k.finding;
}

function renderProcess() {
  if (!state.cases.length) return emptyState('プロセスチェック', '案件がありません。', `<div class="actions center">${sampleButton}</div>`);
  const rows = state.cases.map(c => ({ c, s: checkSummary(c) }));
  const sum = key => rows.reduce((a, r) => a + r.s[key], 0);
  const sel = rows.find(r => r.c.id === ui.caseId) || rows[0];
  return `<div class="page-head"><div><h1>プロセスチェック</h1><p class="muted">案件ごとに調達手続きの実施状況を点検し、AIが不足や注意点を理由付きで示します。</p></div></div>
  <div class="kpi-row">
    <div class="card kpi"><span>対象案件</span><b>${rows.length}件</b><small>チェック項目 計${sum('done') + sum('warn') + sum('ask') + sum('todo')}件</small></div>
    <div class="card kpi tone-ng"><span>！ 注意</span><b>${sum('warn')}件</b><small>対応が必要</small></div>
    <div class="card kpi tone-na"><span>？ 要確認</span><b>${sum('ask')}件</b><small>内容の確認が必要</small></div>
    <div class="card kpi tone-ok"><span>✓ 完了</span><b>${sum('done')}件</b><small>未実施 ${sum('todo')}件</small></div>
  </div>
  <div class="card">
    <h2>案件のチェック状況</h2>
    <div class="table-wrap"><table class="table rows-click"><thead><tr><th>案件</th><th>進行状況</th><th style="width:22%">実施率</th><th>注意</th><th>要確認</th><th>未実施</th></tr></thead>
      <tbody>${rows.map(({ c, s }) => `<tr class="${c === sel.c ? 'sel' : ''}">
        <td><button class="link" data-a="pick" data-v="${c.id}">${esc(c.title)}</button></td>
        <td><span class="chip">${esc(stageOf(c))}</span></td>
        <td><div class="rate"><div class="bar big"><i style="width:${s.rate}%"></i></div><b>${s.rate}%</b></div></td>
        <td>${s.warn ? `<span class="st ng">！ ${s.warn}</span>` : '<span class="muted">0</span>'}</td>
        <td>${s.ask ? `<span class="st na">？ ${s.ask}</span>` : '<span class="muted">0</span>'}</td>
        <td>${s.todo || '<span class="muted">0</span>'}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>判定結果：${esc(sel.c.title)}</h2>
      <div class="rate wide"><span class="muted small-text">実施率</span><div class="bar big"><i style="width:${sel.s.rate}%"></i></div><b>${sel.s.rate}%</b></div></div>
    <div class="table-wrap"><table class="table checks-table"><thead><tr><th>チェック対象</th><th>判定</th><th>問題箇所</th><th><span class="ai">✦ AI</span>指摘・根拠</th><th>必要なアクション</th><th></th></tr></thead>
      <tbody>${sel.s.list.map(k => `<tr class="${k.status === '注意' ? 'flag-ng' : k.status === '要確認' ? 'flag' : ''}">
        <td><b>${esc(k.label)}</b></td><td>${statusChip(k.status)}</td>
        <td>${k.status === '完了' ? '<span class="muted">—</span>' : esc(k.where)}</td>
        <td class="small-text">${esc(aiFinding(k))}</td>
        <td class="small-text">${k.status === '完了' ? '<span class="muted">—</span>' : esc(k.action)}</td>
        <td class="right">${k.status === '完了' ? '' : `<button class="btn small ghost" data-a="go" data-v="${k.page}:${sel.c.id}">対象へ</button>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small-text">判定基準（相見積3社以上など）は仮置きです。社内規程にあわせて調整が必要です。</p>
  </div>`;
}
PAGES.process = { render: renderProcess, click(a, v) { if (a === 'pick') { ui.caseId = v; render(); } } };

// ---------- 法令チェック ----------
// 案件の内容から、確認が必要そうな項目にAIが注意を付ける
function legalHints(c) {
  const hints = {};
  const q = c.quotes && c.quotes.items[c.quotes.adopt];
  if (q && q.pay.includes('翌々月')) hints.pay = `採用予定先の支払条件が「${q.pay}」で、60日を超える可能性があります。`;
  if (c.quotes && supplier(c.quotes.adopt).deals <= 2) hints.antisocial = '取引実績が少ない取引先です。確認日が古くないか見直してください。';
  if (/個人情報|社員|利用者|名簿/.test(c.requestText)) hints.privacy = '依頼内容に人に関する情報の取扱いが含まれる可能性があります。';
  return hints;
}

function renderLegal() {
  const { cases, c } = pickCase(() => true);
  if (!c) return emptyState('法令チェック', '案件がありません。', `<div class="actions center">${sampleButton}</div>`);
  c.legal = c.legal || {}; c.legalNote = c.legalNote || {};
  const hints = legalHints(c), val = id => c.legal[id] || '未確認';
  const cls = { 未確認: 'off', 問題なし: 'ok', 要対応: 'ng', 対象外: 'off' };
  const count = s => LEGAL_ITEMS.filter(i => val(i.id) === s).length;
  return `<div class="page-head"><div><h1>法令チェック</h1><p class="muted">発注前に確認する法令関連の項目を、案件ごとに点検します。</p></div>${caseSelect(cases, c)}</div>
  <div class="notice">デモ動画ではメニュー名のみ確認できたため、対象法令と判定基準は未定です（未確認事項 Q-06）。ここでは担当者が記録する点検リストとして用意しています。項目は例示であり、法的な判断を示すものではありません。</div>
  <div class="card">
    <div class="card-head"><h2>確認項目</h2><div class="chips"><span class="st ok">問題なし ${count('問題なし')}</span><span class="st ng">要対応 ${count('要対応')}</span><span class="st off">未確認 ${count('未確認')}</span></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>項目</th><th style="width:130px">確認結果</th><th style="width:32%">備考</th></tr></thead>
      <tbody>${LEGAL_ITEMS.map(i => `<tr class="${val(i.id) === '要対応' ? 'flag-ng' : ''}">
        <td><b>${esc(i.label)}</b><div class="muted small-text">${esc(i.note)}</div>
          ${hints[i.id] ? `<div class="hint"><span class="ai">✦ AI</span>${esc(hints[i.id])}</div>` : ''}</td>
        <td><select data-c="legal:${i.id}" class="sel-${cls[val(i.id)]}" aria-label="${esc(i.label)}の確認結果">${LEGAL_STATUS.map(s => `<option${val(i.id) === s ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input data-f="${i.id}" value="${esc(c.legalNote[i.id] || '')}" placeholder="確認日・根拠など" aria-label="${esc(i.label)}の備考"></td></tr>`).join('')}</tbody></table></div>
  </div>`;
}
PAGES.legal = {
  render: renderLegal,
  input(f, val) { const { c } = pickCase(() => true); c.legalNote[f] = val; touch(c); },
  change(k, val) { const { c } = pickCase(() => true); c.legal[k.split(':')[1]] = val; touch(c); render(); },
};

// ---------- 契約チェック ----------
// 当社（甲＝発注者）の立場で確認するルール。type: clause=該当条項を指摘 / missing=条項の欠落を指摘
const CONTRACT_RULES = [
  { level: '高', title: '損害賠償額に上限が設定されている', type: 'clause', test: t => /賠償/.test(t) && /上限|限度|を超えない/.test(t),
    reason: '取引先の賠償額が制限されており、重大な事故が起きた場合に損害を回収できない恐れがあります。',
    suggest: '上限額を引き上げるか、故意・重過失および情報漏えいによる損害は上限の対象外とする。' },
  { level: '高', title: '承諾なしで再委託ができる', type: 'clause', test: t => /再委託/.test(t) && !/承諾|同意/.test(t),
    reason: '当社が把握していない第三者に業務や情報が渡る可能性があります。',
    suggest: '再委託は当社の事前の書面による承諾を条件とし、再委託先にも同等の義務を負わせる。' },
  { level: '高', title: '支払期日が長い', type: 'clause', test: t => /支払/.test(t) && (/翌々月/.test(t) || [...t.matchAll(/(\d+)日以内/g)].some(m => +m[1] > 60)),
    reason: '支払までの期間が60日を超える可能性があり、取引の内容によっては法令上の問題となります。',
    suggest: '受領日から60日以内に支払う定めに改める。' },
  { level: '中', title: '契約不適合責任の期間が短い', type: 'clause', test: t => /契約不適合|瑕疵/.test(t) && /(\d+)\s*(日|か月|ヶ月|カ月)以内/.test(t) && !/(6|12)\s*(か月|ヶ月|カ月)|1年/.test(t),
    reason: '不具合が後から見つかった場合に、無償での修補を求められない恐れがあります。',
    suggest: '期間を検収後6か月〜1年に延ばす。' },
  { level: '中', title: '自動更新の定めがある', type: 'clause', test: t => /自動的に.*更新|同一条件で.*更新/.test(t),
    reason: '解約の申し出を忘れると、契約が意図せず更新されます。',
    suggest: '更新拒絶の通知期限を管理台帳に登録する。更新時に条件を見直せる定めを加える。' },
  { level: '中', title: '取引先がいつでも解除できる', type: 'clause', test: t => /乙は.*いつでも.*解除/.test(t),
    reason: '業務の途中で一方的に解除されると、代替先の確保が間に合わない恐れがあります。',
    suggest: '解除には一定の予告期間（例：3か月前）を設け、引継ぎへの協力義務を定める。' },
  { level: '中', title: '反社会的勢力の排除条項がない', type: 'missing', test: t => !/反社会的勢力|暴力団/.test(t),
    reason: '相手方が反社会的勢力と判明した場合に、直ちに解除できる根拠がありません。', suggest: '当社ひな形の反社会的勢力排除条項を追加する。' },
  { level: '中', title: '成果物の権利帰属の定めがない', type: 'missing', test: t => /成果物/.test(t) && !/知的財産|著作権|権利.*帰属/.test(t),
    reason: '成果物を当社が自由に利用・改変できるかが不明確です。', suggest: '成果物の著作権等が当社に帰属する（または利用許諾を受ける）旨を定める。' },
  { level: '低', title: '個人情報の取扱い条項がない', type: 'missing', test: t => !/個人情報/.test(t),
    reason: '個人データを預ける場合、委託先の安全管理措置を契約で定める必要があります。', suggest: '個人情報を取り扱う業務であれば、取扱い条項を追加する。' },
  { level: '低', title: '合意管轄の定めがない', type: 'missing', test: t => !/管轄|裁判所/.test(t),
    reason: '紛争時にどの裁判所で争うかが決まっていません。', suggest: '当社の本店所在地を管轄する裁判所を合意管轄とする。' },
];

function splitClauses(text) {
  const parts = text.split(/\n(?=第[0-9０-９一二三四五六七八九十百]+条)/);
  return parts.map((p, i) => {
    const m = p.match(/^(第[0-9０-９一二三四五六七八九十百]+条)[ 　]*(（[^）]*）)?/);
    return { head: m ? m[0].trim() : (i === 0 ? '前文' : ''), body: p.trim() };
  }).filter(x => x.body);
}

function checkContract(text) {
  const clauses = splitClauses(text), findings = [];
  for (const rule of CONTRACT_RULES) {
    if (rule.type === 'missing') { if (rule.test(text)) findings.push({ ...rule, clause: -1 }); }
    else clauses.forEach((cl, n) => { if (rule.test(cl.body)) findings.push({ ...rule, clause: n }); });
  }
  const order = { 高: 0, 中: 1, 低: 2 };
  return { clauses, findings: findings.sort((a, b) => order[a.level] - order[b.level]) };
}

function renderContract() {
  const k = ui.contract, res = k.findings;
  const lv = { 高: 'ng', 中: 'na', 低: 'off' };
  const head = `<div class="page-head"><div><h1>契約チェック</h1><p class="muted">契約書の条文を読み込み、発注者（甲）の立場でリスクと確認ポイントを抽出します。</p></div></div>`;
  if (!res) return head + `<div class="card">
    <h2>契約書の内容</h2>
    <label class="block">契約書の本文を貼り付けてください<textarea id="contractText" class="doc" data-f="text" rows="18" placeholder="第1条（目的）…">${esc(k.text)}</textarea></label>
    <div class="actions"><button class="btn ghost" data-a="sample">サンプル契約書を入れる</button><span class="spacer"></span>
      <button class="btn primary" data-a="check">✦ AIでチェックする</button></div>
  </div>`;
  const count = l => res.findings.filter(f => f.level === l).length;
  return head + `<div class="kpi-row">
      <div class="card kpi"><span>条項数</span><b>${res.clauses.length}</b><small>指摘 計${res.findings.length}件</small></div>
      <div class="card kpi tone-ng"><span>！ リスク高</span><b>${count('高')}件</b><small>修正を推奨</small></div>
      <div class="card kpi tone-na"><span>？ リスク中</span><b>${count('中')}件</b><small>内容の確認が必要</small></div>
      <div class="card kpi"><span>− リスク低</span><b>${count('低')}件</b><small>必要に応じて対応</small></div>
    </div>
    <div class="split even">
      <div class="card">
        <div class="card-head"><h2>契約条文</h2><button class="btn small ghost" data-a="back">✎ 本文を修正</button></div>
        <div class="clauses">${res.clauses.map((cl, n) => {
          const fs = res.findings.filter(f => f.clause === n), top = fs[0];
          return `<div class="clause ${top ? 'hit-' + lv[top.level] : ''}" id="clause-${n}">
            ${fs.map(f => `<span class="st ${lv[f.level]}">${f.level}　${esc(f.title)}</span>`).join(' ')}
            <p>${esc(cl.body)}</p></div>`;
        }).join('')}</div>
      </div>
      <div class="card">
        <h2><span class="ai">✦ AI</span> レビュー結果</h2>
        ${res.findings.length ? res.findings.map(f => `<div class="finding lv-${lv[f.level]}">
          <div class="finding-head"><span class="st ${lv[f.level]}">リスク${f.level}</span><b>${esc(f.title)}</b></div>
          <div class="small-text muted">${f.clause < 0 ? '該当条項なし（条項の欠落）' : `対象：${esc(res.clauses[f.clause].head)}`}</div>
          <p><span class="tag">理由</span>${esc(f.reason)}</p>
          <p><span class="tag">改善提案</span>${esc(f.suggest)}</p>
          ${f.clause < 0 ? '' : `<button class="btn small ghost" data-a="jump" data-v="${f.clause}">条文を表示</button>`}
        </div>`).join('') : '<div class="empty">指摘事項は見つかりませんでした。</div>'}
        <p class="muted small-text">指摘はキーワードによる簡易判定です。最終的な判断は法務担当者が行ってください。</p>
        <div class="actions"><span class="spacer"></span><button class="btn ghost" data-a="export">レビュー結果を出力</button></div>
      </div>
    </div>`;
}
PAGES.contract = {
  render: renderContract,
  click(a, v) {
    const k = ui.contract;
    if (a === 'sample') { k.text = SAMPLE_CONTRACT; render(); }
    else if (a === 'back') { k.findings = null; render(); }
    else if (a === 'check') {
      if (!k.text.trim()) { toast('契約書の本文を入力してください'); return; }
      runBusy('契約書をチェックしています', ['条文を分割', 'リスクのある条項を抽出', '改善提案を作成'], () => { k.findings = checkContract(k.text); render(); });
    }
    else if (a === 'jump') {
      const el = $('#clause-' + v);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500);
    }
    else if (a === 'export') {
      const r = k.findings;
      download('契約チェック結果.txt', `契約チェック結果（${today()}）\n\n` + r.findings.map((f, i) =>
        `${i + 1}. [リスク${f.level}] ${f.title}\n   対象：${f.clause < 0 ? '該当条項なし' : r.clauses[f.clause].head}\n   理由：${f.reason}\n   改善提案：${f.suggest}`).join('\n\n') + '\n');
    }
  },
  input(f, val) { ui.contract.text = val; },
};
