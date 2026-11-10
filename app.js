// P&D AI Sourcing プロトタイプ（対象: FR-001〜FR-019）
// AI処理はルールベースの擬似実装。データはブラウザの localStorage に保存する。
'use strict';

const STORE_KEY = 'pd-ai-sourcing-cases-v1';
const STEPS = ['依頼内容の入力', '依頼情報の整理', '要件マトリクス', '候補選定', 'RFP生成'];

const state = { page: 'rfp', caseId: null, cases: loadCases(), busy: null };

function loadCases() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
}
function saveCases() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.cases)); } catch (e) { /* 保存できなくても動作は継続 */ }
}
const currentCase = () => state.cases.find(c => c.id === state.caseId) || null;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const today = () => new Date().toISOString().slice(0, 10);
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}
function findMenuItem(id) {
  for (const g of MENU) for (const s of g.sections) for (const it of s.items) if (it.id === id) return { g, s, it };
  return null;
}

// ---------- 擬似AI: 依頼文の構造化（FR-006, FR-007） ----------
function toHalf(s) { return s.replace(/[０-９，]/g, ch => ch === '，' ? ',' : String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); }

function guessCategory(text) {
  let best = null, bestHits = 0;
  for (const [name, def] of Object.entries(CATEGORIES)) {
    const hits = def.words.filter(w => text.toLowerCase().includes(w.toLowerCase())).length;
    if (hits > bestHits) { best = name; bestHits = hits; }
  }
  return best;
}

function parseDeadline(text) {
  const now = new Date();
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const nextYear = (m, d) => { // 年の指定がなければ、今日以降で最も近い日付とみなす
    let y = now.getFullYear();
    if (new Date(y, m - 1, d) < now) y += 1;
    return y;
  };
  let m;
  if ((m = text.match(/(\d{4})[\/年\-](\d{1,2})[\/月\-](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = text.match(/(\d{1,2})月(\d{1,2})日/))) return iso(nextYear(+m[1], +m[2]), +m[1], +m[2]);
  if ((m = text.match(/(\d{1,2})月末/))) {
    const y = nextYear(+m[1], 28);
    return iso(y, +m[1], new Date(y, +m[1], 0).getDate());
  }
  if ((m = text.match(/(\d{1,2})月(上旬|中旬|下旬)/))) {
    const d = { 上旬: 10, 中旬: 20, 下旬: 28 }[m[2]];
    return iso(nextYear(+m[1], d), +m[1], d);
  }
  if ((m = text.match(/(\d+)\s*(週間|ヶ月|か月|カ月|ヵ月|日)以内/))) {
    const days = +m[1] * (m[2] === '週間' ? 7 : m[2] === '日' ? 1 : 30);
    const d = new Date(now.getTime() + days * 86400000);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return '';
}

function structureRequest(c) {
  const text = toHalf(c.requestText || '');
  const sentences = text.split(/[。\n]/).map(s => s.trim()).filter(Boolean);
  const pick = re => (text.match(re) || [])[0] || '';
  const category = c.category || guessCategory(text) || 'IT機器';
  const def = CATEGORIES[category];
  const itemWord = def.words.find(w => text.toLowerCase().includes(w.toLowerCase()));
  const itemPhrase = itemWord ? (text.match(new RegExp(`[ァ-ヶーA-Za-z0-9・]*${itemWord}[ァ-ヶーA-Za-z0-9・]*`, 'i')) || [itemWord])[0] : '';
  const specs = sentences.filter(s => /以上|以下|相当|GB|TB|インチ|サイズ|仕様|スペック/.test(s) && !/予算|納品|納期/.test(s));
  const purpose = sentences.find(s => /ため|向け|目的|に伴|したい|更新|入れ替え|新設/.test(s)) || sentences[0] || '';
  const places = [...new Set(text.match(/[一-龥ァ-ヶA-Za-z]{1,6}(?:本社|支社|支店|工場|営業所|事業所|センター|オフィス)|本社/g) || [])];
  return {
    category,
    item: itemPhrase || c.title || '',
    purpose,
    quantity: pick(/\d[\d,]*\s*(?:台|個|本|名|式|ライセンス|セット|部|枚|脚|ユーザー|ID|件|箱)/),
    spec: specs.join('\n'),
    deadline: parseDeadline(text),
    budget: pick(/\d[\d,.]*\s*(?:億|万|千)?円(?:以内|以下|程度)?/),
    place: places.join('、'),
    other: sentences.filter(s => /してほしい|してもらいたい|希望|必須|こと$/.test(s) && !specs.includes(s) && s !== purpose).join('\n'),
  };
}

function buildMatrix(c) {
  const rows = CATEGORIES[c.info.category].matrix.map(r => ({ cat: r[0], req: r[1], cond: r[2], level: r[3] }));
  if (c.info.spec) rows[0].cond = c.info.spec.replace(/\n/g, ' / ');
  if (c.info.deadline) rows.push({ cat: '納入', req: '納期', cond: `${c.info.deadline} までに納品すること`, level: '必須' });
  // 予算は社内情報のため、取引先に渡る要件マトリクス・RFPには載せない
  // 依頼文に出てくる対応力キーワードが初期値に無ければ、行として追加する
  const all = `${c.requestText}\n${c.info.other}`;
  for (const cap of CAPS) {
    const word = cap.words.find(w => all.includes(w));
    if (word && !rows.some(r => capsOfRow(r).includes(cap.id))) {
      rows.push({ cat: 'その他', req: cap.label, cond: `${word}に対応すること`, level: '希望' });
    }
  }
  return rows;
}

// ---------- 擬似AI: 候補探索と評価（FR-011〜016） ----------
function capsOfRow(row) {
  const text = `${row.req} ${row.cond}`;
  return CAPS.filter(cap => cap.words.some(w => text.includes(w))).map(cap => cap.id);
}

function evaluateSuppliers(c) {
  const rows = c.matrix.map(r => ({ ...r, caps: capsOfRow(r) }));
  const daysLeft = c.info.deadline ? Math.ceil((new Date(c.info.deadline) - new Date()) / 86400000) : null;
  const results = [];
  for (const s of SUPPLIERS) {
    const primary = s.cats.includes(c.info.category);
    if (!primary && !s.sub.includes(c.info.category)) continue;
    let total = 0, got = 0;
    const checks = rows.map(r => {
      if (r.req === '納期' && daysLeft !== null) {
        const ok = s.lead <= daysLeft;
        total += 2; if (ok) got += 2;
        return ok ? 'ok' : 'ng';
      }
      if (!r.caps.length) return 'na'; // マスタで照合できない要件は「要確認」
      const w = r.level === '必須' ? 2 : 1;
      const ok = r.caps.some(id => s.caps.includes(id));
      total += w; if (ok) got += w;
      return ok ? 'ok' : 'ng';
    });
    const fit = total ? got / total : 0.5;
    const leadScore = daysLeft === null ? 0.7 : s.lead <= daysLeft ? 1 : Math.max(0, 1 - (s.lead - daysLeft) / 30);
    const score = Math.round((fit * 50 + (s.rating / 5) * 20 + leadScore * 12 + Math.min(s.deals, 10) / 10 * 10 + (primary ? 8 : 2)));
    const okRows = rows.filter((r, i) => checks[i] === 'ok');
    const ngMust = rows.filter((r, i) => checks[i] === 'ng' && r.level === '必須');
    const reasons = [];
    if (okRows.length) reasons.push(`「${okRows.slice(0, 3).map(r => r.req).join('」「')}」など${okRows.length}件の要件に適合`);
    reasons.push(s.deals >= 5 ? `過去${s.deals}件の取引実績があり、社内評価は${s.rating.toFixed(1)}` : `取引実績は${s.deals}件と少なく、社内評価は${s.rating.toFixed(1)}`);
    if (daysLeft !== null) reasons.push(s.lead <= daysLeft ? `標準リードタイム${s.lead}日で希望納期に間に合う見込み` : `標準リードタイム${s.lead}日では希望納期（残り${daysLeft}日）に間に合わない可能性`);
    if (!primary) reasons.push('当カテゴリは主力領域ではない');
    results.push({
      id: s.id, score: Math.min(score, 99), fit: Math.round(fit * 100), checks,
      reasons, risks: ngMust.map(r => `必須要件「${r.req}」に未対応`),
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

// ---------- RFP生成（FR-019） ----------
function buildRfp(c) {
  const i = c.info;
  const sel = c.selected.map(id => SUPPLIERS.find(s => s.id === id).name);
  const reqLines = c.matrix.map((r, n) => `  ${n + 1}. [${r.level}] ${r.cat}／${r.req}：${r.cond}`).join('\n');
  const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  return `見積依頼書（RFP）

発行日：${today()}
案件名：${c.title}
依頼先：${sel.join('、')}　御中

1. 依頼の趣旨
  ${i.purpose || '下記の調達について、お見積りをお願いいたします。'}

2. 調達概要
  カテゴリ：${i.category}
  品目　　：${i.item || '—'}
  数量　　：${i.quantity || '—'}
  納入場所：${i.place || '—'}
  希望納期：${i.deadline || '—'}

3. 仕様
${(i.spec || '別途協議').split('\n').map(l => '  ' + l).join('\n')}

4. 要件一覧（各項目について対応可否をご回答ください）
${reqLines}

5. その他の要望
${(i.other || '特になし').split('\n').map(l => '  ' + l).join('\n')}

6. ご提出いただきたい内容
  ・見積書（単価、数量、合計、諸費用の内訳）
  ・納期および納入スケジュール
  ・「4. 要件一覧」各項目への対応可否と補足
  ・保守・サポート条件

7. 回答期限
  ${due}

8. 留意事項
  ・本依頼は発注を確約するものではありません。
  ・本依頼書の内容は第三者へ開示しないでください。
`;
}

// ---------- 描画 ----------
function renderSidebar() {
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="brand-mark">P&amp;D</span><span>AI Sourcing</span></div>
    <nav>${MENU.map(g => `
      <div class="nav-group">
        <div class="nav-group-title">${g.group}</div>
        ${g.sections.map(s => `
          ${s.label ? `<div class="nav-section">${esc(s.label)}</div>` : ''}
          ${s.items.map(it => `<button class="nav-item${it.id === state.page ? ' active' : ''}${s.label ? ' sub' : ''}" data-nav="${it.id}">
            <span>${esc(it.label)}</span>${it.ready ? '' : '<span class="soon">準備中</span>'}</button>`).join('')}
        `).join('')}
      </div>`).join('')}
    </nav>`;
}

function render() {
  renderSidebar();
  const found = findMenuItem(state.page);
  const c = currentCase();
  $('#crumb').innerHTML = [found.g.group, found.s.label, found.it.label, c && state.page === 'rfp' ? c.title : null]
    .filter(Boolean).map(esc).join(' <span class="sep">›</span> ');
  const view = $('#view');
  if (state.page !== 'rfp') view.innerHTML = renderPlaceholder(found);
  else if (!c) view.innerHTML = renderCaseList();
  else view.innerHTML = renderWizard(c);
  view.scrollTop = 0;
}

function renderPlaceholder({ g, it }) {
  return `<div class="placeholder card">
    <div class="ph-tag">${g.group}</div>
    <h1>${esc(it.label)}</h1>
    <p>この機能は今回のプロトタイプの対象外です（機能要件一覧 ${esc(it.frs)}）。</p>
    <p class="muted">今回は大分類「共通」「見積依頼」（FR-001〜FR-019）を実装しています。</p>
    <button class="btn primary" data-nav="rfp">RFP作成へ移動</button>
  </div>`;
}

function renderCaseList() {
  const rows = state.cases.map(c => `
    <tr>
      <td><button class="link" data-open="${c.id}">${esc(c.title)}</button></td>
      <td>${esc(c.info ? c.info.category : (c.category || '未設定'))}</td>
      <td><span class="chip ${c.done ? 'ok' : ''}">${c.done ? 'RFP作成済' : `${c.step + 1}. ${STEPS[c.step]}`}</span></td>
      <td>${esc(c.updated)}</td>
      <td class="right"><button class="btn small ghost" data-delete="${c.id}" aria-label="${esc(c.title)}を削除">削除</button></td>
    </tr>`).join('');
  return `
    <div class="page-head">
      <div><h1>RFP作成</h1><p class="muted">調達したい内容を文章で入力すると、AIが要件を整理し、取引先候補の選定からRFPの作成までを支援します。</p></div>
      <button class="btn primary" data-new>＋ 新規見積依頼</button>
    </div>
    <div class="card">
      <h2>見積依頼案件</h2>
      ${state.cases.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>案件名</th><th>カテゴリ</th><th>状況</th><th>更新日</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : `<div class="empty">まだ案件がありません。「新規見積依頼」から作成してください。</div>`}
    </div>`;
}

function renderWizard(c) {
  const stepper = STEPS.map((s, i) => `
    <li class="${i === c.step ? 'current' : i < c.step ? 'done' : ''}">
      <button ${i <= c.maxStep ? `data-step="${i}"` : 'disabled'}><span class="num">${i < c.step ? '✓' : i + 1}</span><span>${s}</span></button>
    </li>`).join('');
  const body = [stepInput, stepInfo, stepMatrix, stepCandidates, stepRfp][c.step](c);
  return `<ol class="stepper">${stepper}</ol>${state.busy ? renderBusy() : body}`;
}

function renderBusy() {
  return `<div class="card busy"><div class="spinner"></div><div><strong>${esc(state.busy.title)}</strong>
    <ul>${state.busy.lines.map((l, i) => `<li class="${i < state.busy.at ? 'done' : i === state.busy.at ? 'now' : ''}">${esc(l)}</li>`).join('')}</ul></div></div>`;
}

// Step 1: FR-005, FR-006
function stepInput(c) {
  return `<div class="card">
    <h2>新規見積依頼</h2>
    <div class="grid2">
      <label>案件名<span class="req">必須</span><input id="f-title" value="${esc(c.title)}" placeholder="例：新入社員向けノートPC調達"></label>
      <label>対象カテゴリ<select id="f-category">
        <option value="">AIに判定させる</option>
        ${Object.keys(CATEGORIES).map(k => `<option${c.category === k ? ' selected' : ''}>${k}</option>`).join('')}
      </select></label>
      <label>依頼部門<input id="f-dept" value="${esc(c.dept)}" placeholder="例：情報システム部"></label>
      <label>担当者<input id="f-owner" value="${esc(c.owner)}" placeholder="例：調達 太郎"></label>
    </div>
    <label class="block">依頼内容（調達の目的・要件を自由に記入）<span class="req">必須</span>
      <textarea id="f-text" rows="7" placeholder="何を、いくつ、いつまでに、どこへ、どんな条件で調達したいかを文章で入力してください。">${esc(c.requestText)}</textarea>
    </label>
    <div class="actions">
      <button class="btn ghost" data-sample>サンプル文を入れる</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-back-list>一覧へ戻る</button>
      <button class="btn primary" data-act="structure">✦ AIで整理する</button>
    </div>
  </div>`;
}

// Step 2: FR-007, FR-008
function stepInfo(c) {
  const i = c.info;
  const field = (key, label, multi) => `<label>${label}${multi
    ? `<textarea data-info="${key}" rows="3">${esc(i[key])}</textarea>`
    : `<input data-info="${key}" value="${esc(i[key])}">`}</label>`;
  return `<div class="split">
    <div class="card">
      <h2>入力した依頼内容</h2>
      <p class="quote">${esc(c.requestText)}</p>
      <button class="btn small ghost" data-step="0">依頼内容を修正する</button>
    </div>
    <div class="card">
      <h2><span class="ai">✦ AI</span> 整理した依頼情報</h2>
      <p class="muted">内容を確認し、必要に応じて修正してください。空欄は依頼文から読み取れなかった項目です。</p>
      <div class="grid2">
        <label>カテゴリ<select data-info="category">${Object.keys(CATEGORIES).map(k => `<option${i.category === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        ${field('item', '品目')}
        ${field('quantity', '数量')}
        <label>希望納期<input type="date" data-info="deadline" value="${esc(i.deadline)}"></label>
        ${field('budget', '予算（社内用・RFPには記載しません）')}
        ${field('place', '納入場所')}
      </div>
      ${field('purpose', '目的', true)}
      ${field('spec', '仕様', true)}
      ${field('other', 'その他の要望', true)}
      <div class="actions"><span class="spacer"></span>
        <button class="btn primary" data-act="matrix">✦ 要件マトリクスを作成</button></div>
    </div>
  </div>`;
}

// Step 3: FR-009, FR-010
function stepMatrix(c) {
  const cats = [...new Set(c.matrix.map(r => r.cat))];
  const must = c.matrix.filter(r => r.level === '必須').length;
  return `<div class="card">
    <div class="card-head">
      <h2><span class="ai">✦ AI</span> 要件マトリクス</h2>
      <div class="chips"><span class="chip">全${c.matrix.length}件</span><span class="chip must">必須 ${must}</span><span class="chip">希望 ${c.matrix.length - must}</span>
        ${c.matrixFixed ? '<span class="chip ok">確定済</span>' : '<span class="chip warn">未確定</span>'}</div>
    </div>
    <p class="muted">要件をカテゴリ別・条件別に整理しました。行の追加・修正・削除ができます。確定すると候補探索に進みます。</p>
    <div class="table-wrap"><table class="table matrix">
      <thead><tr><th style="width:13%">カテゴリ</th><th style="width:17%">要件</th><th>条件</th><th style="width:96px">区分</th><th style="width:60px"></th></tr></thead>
      <tbody>${c.matrix.map((r, n) => `<tr>
        <td><input data-m="${n}:cat" value="${esc(r.cat)}" list="catlist" aria-label="カテゴリ"></td>
        <td><input data-m="${n}:req" value="${esc(r.req)}" aria-label="要件"></td>
        <td><input data-m="${n}:cond" value="${esc(r.cond)}" aria-label="条件"></td>
        <td><select data-m="${n}:level" class="${r.level === '必須' ? 'must' : ''}" aria-label="区分"><option${r.level === '必須' ? ' selected' : ''}>必須</option><option${r.level === '希望' ? ' selected' : ''}>希望</option></select></td>
        <td class="right"><button class="btn small ghost" data-mdel="${n}" aria-label="行を削除">✕</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <datalist id="catlist">${cats.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <div class="actions">
      <button class="btn ghost" data-madd>＋ 行を追加</button>
      <button class="btn ghost" data-act="rematrix">↻ 再生成</button>
      <span class="spacer"></span>
      <button class="btn primary" data-act="search">要件を確定して候補を探索</button>
    </div>
  </div>`;
}

// Step 4: FR-011〜018
function stepCandidates(c) {
  if (!c.candidates.length) {
    return `<div class="card"><h2>取引先候補</h2><div class="empty">カテゴリ「${esc(c.info.category)}」に該当する取引先がマスタに見つかりませんでした。</div></div>`;
  }
  const sup = id => SUPPLIERS.find(s => s.id === id);
  const top = c.candidates[0];
  const avgFit = Math.round(c.candidates.reduce((a, x) => a + x.fit, 0) / c.candidates.length);
  const minLead = Math.min(...c.candidates.map(x => sup(x.id).lead));
  const cards = c.candidates.map((x, n) => {
    const s = sup(x.id), on = c.selected.includes(x.id);
    const tone = x.score >= 80 ? 'hi' : x.score >= 65 ? 'mid' : 'lo';
    return `<div class="cand ${on ? 'on' : ''}">
      <div class="cand-head">
        <div class="score ${tone}" title="AI評価スコア"><b>${x.score}</b><span>スコア</span></div>
        <div class="cand-title"><h3>${esc(s.name)}${n === 0 ? '<span class="chip ok">AI推奨</span>' : ''}</h3><p class="muted">${esc(s.note)}</p></div>
        <label class="pick"><input type="checkbox" data-pick="${x.id}" ${on ? 'checked' : ''}> 見積を依頼</label>
      </div>
      <div class="kpis">
        <div><span>条件適合率</span><b>${x.fit}%</b><div class="bar"><i style="width:${x.fit}%"></i></div></div>
        <div><span>リードタイム</span><b>${s.lead}日</b></div>
        <div><span>取引実績</span><b>${s.deals}件</b></div>
        <div><span>社内評価</span><b>${s.rating.toFixed(1)}</b></div>
        <div><span>対応エリア</span><b>${esc(s.area)}</b></div>
      </div>
      <div class="reasons"><div class="label"><span class="ai">✦ AI</span> 推奨根拠</div>
        <ul>${x.reasons.map(r => `<li>${esc(r)}</li>`).join('')}${x.risks.map(r => `<li class="risk">注意：${esc(r)}</li>`).join('')}</ul></div>
    </div>`;
  }).join('');
  const mark = { ok: '<span class="st ok">○ 充足</span>', ng: '<span class="st ng">× 未対応</span>', na: '<span class="st na">— 要確認</span>' };
  const shown = c.selected.length ? c.candidates.filter(x => c.selected.includes(x.id)) : c.candidates;
  return `
    <div class="kpi-row">
      <div class="card kpi"><span>候補企業</span><b>${c.candidates.length}社</b><small>P&amp;D保有データと照合</small></div>
      <div class="card kpi"><span>最高スコア</span><b>${top.score}</b><small>${esc(sup(top.id).name)}</small></div>
      <div class="card kpi"><span>平均 条件適合率</span><b>${avgFit}%</b><small>要件マトリクスに対して</small></div>
      <div class="card kpi"><span>最短リードタイム</span><b>${minLead}日</b><small>${c.info.deadline ? `希望納期 ${esc(c.info.deadline)}` : '希望納期 未設定'}</small></div>
    </div>
    <div class="card">
      <div class="card-head"><h2><span class="ai">✦ AI</span> 取引先候補の評価</h2><button class="btn small ghost" data-act="search">↻ 再探索</button></div>
      <p class="muted">スコア＝条件適合率（50）＋社内評価（20）＋納期適合（12）＋取引実績（10）＋カテゴリ適合（8）。見積を依頼する企業を選択してください。</p>
      <div class="cands">${cards}</div>
    </div>
    <div class="card">
      <h2>条件・評価情報の確認${c.selected.length ? '（選択中の企業）' : '（全候補）'}</h2>
      <div class="table-wrap"><table class="table compare">
        <thead><tr><th>要件</th><th>区分</th>${shown.map(x => `<th>${esc(sup(x.id).name)}</th>`).join('')}</tr></thead>
        <tbody>${c.matrix.map((r, n) => `<tr><td><b>${esc(r.req)}</b><div class="muted small-text">${esc(r.cond)}</div></td>
          <td><span class="chip ${r.level === '必須' ? 'must' : ''}">${r.level}</span></td>
          ${shown.map(x => `<td>${mark[x.checks[n]] || mark.na}</td>`).join('')}</tr>`).join('')}
          <tr class="total"><td colspan="2">AI評価スコア</td>${shown.map(x => `<td><b>${x.score}</b></td>`).join('')}</tr>
        </tbody></table></div>
      <p class="muted small-text">「要確認」は取引先マスタでは判定できない要件です。見積回答で確認してください。</p>
      <div class="actions"><span class="chip">${c.selected.length}社を選択中</span><span class="spacer"></span>
        <button class="btn primary" data-act="rfp" ${c.selected.length ? '' : 'disabled'}>選択した企業でRFPを作成</button></div>
    </div>`;
}

// Step 5: FR-019
function stepRfp(c) {
  return `<div class="card">
    <div class="card-head"><h2><span class="ai">✦ AI</span> 見積依頼書（RFP）</h2>
      <div class="chips">${c.selected.map(id => `<span class="chip">${esc(SUPPLIERS.find(s => s.id === id).name)}</span>`).join('')}</div></div>
    <p class="muted">生成結果は編集できます。内容の確定・送付は担当者が確認のうえ行ってください。</p>
    <textarea id="f-rfp" class="doc" rows="26" spellcheck="false">${esc(c.rfp)}</textarea>
    <div class="actions">
      <button class="btn ghost" data-act="rerfp">↻ 再生成</button>
      <span class="spacer"></span>
      <button class="btn ghost" data-copy>コピー</button>
      <button class="btn ghost" data-download>テキストで保存</button>
      <button class="btn primary" data-finish>完了して一覧へ</button>
    </div>
  </div>`;
}

// ---------- 操作 ----------
function touch(c) { c.updated = today(); saveCases(); }

function goStep(c, n) { c.step = n; c.maxStep = Math.max(c.maxStep, n); touch(c); render(); }

// 擬似的なAI処理中表示を出してから次の処理を行う
function runBusy(title, lines, done) {
  state.busy = { title, lines, at: 0 };
  render();
  const tick = () => {
    state.busy.at += 1;
    if (state.busy.at >= lines.length) { state.busy = null; done(); return; }
    render(); setTimeout(tick, 450);
  };
  setTimeout(tick, 450);
}

function readInputForm(c) {
  c.title = $('#f-title').value.trim();
  c.category = $('#f-category').value;
  c.dept = $('#f-dept').value.trim();
  c.owner = $('#f-owner').value.trim();
  c.requestText = $('#f-text').value.trim();
}

const actions = {
  structure(c) {
    readInputForm(c);
    if (!c.title || !c.requestText) { toast('案件名と依頼内容を入力してください'); saveCases(); return; }
    runBusy('AIが依頼内容を整理しています', ['依頼文を解析', '品目・数量・納期・予算を抽出', '依頼情報を構造化'], () => {
      c.info = structureRequest(c);
      c.matrix = []; c.matrixFixed = false; c.candidates = []; c.selected = []; c.rfp = ''; c.done = false;
      c.maxStep = 1; goStep(c, 1);
    });
  },
  matrix(c) {
    if (c.matrix.length) { goStep(c, 2); return; }
    actions.rematrix(c);
  },
  rematrix(c) {
    runBusy('AIが要件マトリクスを作成しています', ['カテゴリ別の標準要件を参照', '依頼情報を条件に反映', '必須／希望を区分'], () => {
      c.matrix = buildMatrix(c); c.matrixFixed = false; goStep(c, 2);
    });
  },
  search(c) {
    c.matrix = c.matrix.filter(r => r.req.trim() || r.cond.trim());
    if (!c.matrix.length) { toast('要件を1件以上入力してください'); render(); return; }
    c.matrixFixed = true;
    runBusy('取引先候補を探索しています', ['確定した調達条件を読み込み', 'P&D保有の取引先データと照合', 'AIが条件適合度を評価', '推奨根拠を作成'], () => {
      c.candidates = evaluateSuppliers(c);
      c.selected = c.selected.filter(id => c.candidates.some(x => x.id === id));
      goStep(c, 3);
    });
  },
  rfp(c) {
    if (c.rfp && !confirm('作成済みのRFPを、現在の内容で作り直しますか？\n（キャンセルすると作成済みのRFPを開きます）')) { goStep(c, 4); return; }
    actions.rerfp(c);
  },
  rerfp(c) {
    runBusy('RFPを生成しています', ['調達条件・要件情報を集約', '見積依頼文書を作成'], () => { c.rfp = buildRfp(c); goStep(c, 4); });
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-nav]');
  if (!t || state.busy) return;
  const d = t.dataset, c = currentCase();
  if (t.id === 'menuBtn') { document.body.classList.toggle('nav-open'); return; }
  if (d.nav) { state.page = d.nav; state.caseId = null; document.body.classList.remove('nav-open'); render(); }
  else if ('new' in d) {
    const nc = { id: 'c' + Date.now(), title: '', category: '', dept: '', owner: '', requestText: '', info: null, matrix: [], matrixFixed: false,
      candidates: [], selected: [], rfp: '', step: 0, maxStep: 0, done: false, updated: today() };
    state.cases.unshift(nc); state.caseId = nc.id; saveCases(); render();
  }
  else if (d.open) { state.caseId = d.open; render(); }
  else if (d.delete) {
    const target = state.cases.find(x => x.id === d.delete);
    if (confirm(`案件「${target.title || '（無題）'}」を削除しますか？`)) { state.cases = state.cases.filter(x => x !== target); saveCases(); render(); }
  }
  else if (!c) return;
  else if ('backList' in d) { readInputForm(c); if (!c.title && !c.requestText) state.cases = state.cases.filter(x => x !== c); saveCases(); state.caseId = null; render(); }
  else if ('sample' in d) { if (!$('#f-title').value) $('#f-title').value = '新入社員向けノートPC調達'; $('#f-text').value = SAMPLE_REQUEST; }
  else if (d.step !== undefined) { if (c.step === 0) readInputForm(c); goStep(c, +d.step); }
  else if (d.act) actions[d.act](c);
  else if ('madd' in d) { c.matrix.push({ cat: 'その他', req: '', cond: '', level: '希望' }); c.matrixFixed = false; touch(c); render(); }
  else if (d.mdel !== undefined) { c.matrix.splice(+d.mdel, 1); c.matrixFixed = false; touch(c); render(); }
  else if ('copy' in d) {
    const text = $('#f-rfp').value;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('コピーしました'), () => { $('#f-rfp').select(); toast('選択しました。Ctrl+C でコピーしてください'); });
  }
  else if ('download' in d) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$('#f-rfp').value], { type: 'text/plain;charset=utf-8' }));
    a.download = `RFP_${c.title || '見積依頼'}.txt`; a.click(); URL.revokeObjectURL(a.href);
  }
  else if ('finish' in d) { c.done = true; touch(c); state.caseId = null; render(); toast('RFPを保存しました'); }
});

// 入力内容は画面を作り直さずに保存する
document.addEventListener('input', e => {
  const c = currentCase(), d = e.target.dataset;
  if (!c) return;
  if (d.info) { c.info[d.info] = e.target.value; touch(c); }
  else if (d.m) {
    const [n, key] = d.m.split(':');
    c.matrix[+n][key] = e.target.value; c.matrixFixed = false; touch(c);
    if (key === 'level') e.target.classList.toggle('must', e.target.value === '必須');
  }
  else if (e.target.id === 'f-rfp') { c.rfp = e.target.value; touch(c); }
});

document.addEventListener('change', e => {
  const c = currentCase(), d = e.target.dataset;
  if (!c) return;
  if (d.pick) {
    c.selected = e.target.checked ? [...c.selected, d.pick] : c.selected.filter(id => id !== d.pick);
    touch(c); render();
  } else if (d.info === 'category') {
    // カテゴリを変えたら、要件マトリクス以降は作り直す
    c.matrix = []; c.candidates = []; c.selected = []; c.maxStep = 1; touch(c); render();
  }
});

render();
