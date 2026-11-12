// RFP作成以外の画面で共通に使う処理
'use strict';

const ui = { caseId: null, tab: 'compare', edit: false, thread: null, chatTab: 'ext', search: {}, srcOff: {}, contract: { text: '', findings: null } };

const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const pct = n => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const supplier = id => SUPPLIERS.find(s => s.id === id);
// 文字列から 0〜1 の決まった値を作る（ダミー値を毎回同じにするため）
function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; // 似た文字列でも値が散らばるように混ぜる
  return (h >>> 0) / 4294967296;
}
function parseBudget(text) {
  const m = toHalf(text || '').match(/([\d,.]+)\s*(億|万|千)?円/);
  if (!m) return 0;
  return parseFloat(m[1].replace(/,/g, '')) * ({ 億: 1e8, 万: 1e4, 千: 1e3 }[m[2]] || 1);
}
const daysLeft = c => c.info && c.info.deadline ? Math.ceil((new Date(c.info.deadline) - new Date()) / 86400000) : null;

// 画面で扱う案件を選ぶ
function pickCase(filter) {
  const cases = state.cases.filter(filter);
  return { cases, c: cases.find(x => x.id === ui.caseId) || cases[0] || null };
}
function caseSelect(cases, c) {
  return `<label class="inline">案件<select data-c="case">${cases.map(x => `<option value="${x.id}"${x === c ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>`;
}
function go(page, caseId) {
  state.page = page; state.caseId = null;
  if (caseId) { ui.caseId = caseId; if (page === 'rfp') state.caseId = caseId; }
  render();
}
function emptyState(title, text, btn) {
  return `<div class="card placeholder"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>${btn || ''}</div>`;
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
// 文書だけを印刷する（text 省略時は画面全体）
function printDoc(text) {
  if (text === undefined) { window.print(); return; }
  $('#printDoc').textContent = text;
  document.body.classList.add('printing-doc');
  window.print();
  document.body.classList.remove('printing-doc');
}

// 案件の進行状況（チャット・レポートで表示）
function stageOf(c) {
  if (c.ringi && c.ringi.doc) return '稟議作成済';
  if (c.ringi) return '決裁準備中';
  if (c.quotes) return '見積比較中';
  if (c.rfp) return 'RFP作成済';
  return STEPS[c.step];
}

// ---------- 見積（ダミー生成）と比較 ----------
function genQuotes(c) {
  const base = (c.quotes && c.quotes.base) || parseBudget(c.info.budget) || 10000000;
  const items = {};
  for (const sid of c.selected) {
    const s = supplier(sid), cand = c.candidates.find(x => x.id === sid) || { checks: [] };
    items[sid] = {
      amount: Math.round(base * (0.82 + hash(c.id + sid) * 0.22) / 1000) * 1000,
      lead: s.lead + Math.round(hash(sid + 'lead') * 4),
      support: s.caps.includes('support24') ? '24時間365日' : s.caps.includes('helpdesk') ? '平日9〜18時' : '平日10〜17時（メールのみ）',
      warranty: s.caps.includes('warranty3') ? '3年' : '1年',
      pay: ['月末締め翌月末払い', '月末締め翌々月末払い', '納品後30日以内'][Math.floor(hash(sid + 'pay') * 3)],
      resp: c.matrix.map((r, n) => {
        const k = cand.checks[n] || 'na', h = hash(c.id + sid + n);
        return k === 'ok' ? '充足' : k === 'ng' ? (h < 0.6 ? '不充足' : '要確認') : (h < 0.7 ? '充足' : '要確認');
      }),
    };
  }
  c.quotes = { base, items, adopt: null };
  c.quotes.adopt = recommend(c);
}

// 必須要件の未充足が少なく、金額と要件充足のバランスが良い取引先を推奨とする
function quoteStats(c, sid) {
  const q = c.quotes.items[sid];
  const must = c.matrix.map((r, n) => r.level === '必須' ? q.resp[n] : null);
  return { q, mustNg: must.filter(x => x === '不充足').length, mustAsk: must.filter(x => x === '要確認').length,
    ng: q.resp.filter(x => x === '不充足').length, ask: q.resp.filter(x => x === '要確認').length };
}
function recommend(c) {
  return Object.keys(c.quotes.items).sort((a, b) => {
    const A = quoteStats(c, a), B = quoteStats(c, b);
    // 金額（基準比）に、未充足1件につき3ポイント・要確認1件につき1ポイントを上乗せして比べる
    const cost = (S) => S.q.amount / c.quotes.base * 100 + S.ng * 3 + S.ask;
    return A.mustNg - B.mustNg || cost(A) - cost(B);
  })[0];
}

// ---------- プロセスチェック（管理・レポートで共用） ----------
function ensureRingi(c) {
  if (c.ringi) return c.ringi;
  c.ringi = {
    subject: `${c.title.replace('【サンプル】', '')}の件`, dept: c.dept || '', author: c.owner || '', reason: '', route: '',
    attach: { 見積書: true, 比較表: true, RFP: true, 契約書案: false },
    stake: STAKEHOLDERS.map(name => ({ name, status: '未回答', comment: '' })), summary: '', doc: '',
  };
  return c.ringi;
}

function processChecks(c) {
  const out = [];
  const add = (label, status, where, finding, action, page) => out.push({ label, status, where, finding, action, page });
  add('依頼情報の整理', c.info ? '完了' : '未実施', '依頼内容', c.info ? '' : '依頼内容がまだ整理されていません。', '依頼内容を入力し、AIで整理する', 'rfp');
  if (!c.matrix.length) add('要件マトリクスの確定', '未実施', '要件マトリクス', '要件マトリクスが未作成です。', '要件マトリクスを作成して確定する', 'rfp');
  else add('要件マトリクスの確定', c.matrixFixed ? '完了' : '要確認', '要件マトリクス', c.matrixFixed ? '' : '要件が未確定のままです。確定前の要件で見積を依頼すると、比較条件がそろいません。', '内容を確認して確定する', 'rfp');
  const n = c.selected.length;
  add('相見積（3社以上）', n >= 3 ? '完了' : n > 0 ? '注意' : '未実施', '候補選定',
    n >= 3 ? '' : n > 0 ? `見積依頼先が${n}社です。価格の妥当性を示す根拠が弱くなります。` : '見積依頼先が選択されていません。', n > 0 ? '依頼先を追加するか、3社未満とする理由を稟議に記載する' : '候補企業を選択する', 'rfp');
  add('RFPの作成', c.rfp ? '完了' : '未実施', 'RFP', c.rfp ? '' : 'RFPが未作成です。', 'RFPを作成する', 'rfp');
  add('見積の回収・比較', c.quotes ? '完了' : '未実施', '比較表', c.quotes ? '' : '比較表が未作成です。', '見積を取り込み、比較表を作成する', 'compare');
  if (c.quotes) {
    const sid = c.quotes.adopt, st = quoteStats(c, sid), name = supplier(sid).name;
    add('必須要件の充足', st.mustNg ? '注意' : st.mustAsk ? '要確認' : '完了', `比較表／${name}`,
      st.mustNg ? `採用予定の${name}に、必須要件の未充足が${st.mustNg}件あります。` : st.mustAsk ? `採用予定の${name}に、回答が不明確な必須要件が${st.mustAsk}件あります。` : '',
      st.mustNg ? '代替策を確認するか、採用予定先を見直す' : '取引先に追加確認する', 'compare');
    const over = st.q.amount - c.quotes.base;
    add('基準金額との比較', over > 0 ? '注意' : '完了', `比較表／${name}`, over > 0 ? `採用予定額が基準金額を${yen(over)}上回っています。` : '', '価格交渉を行うか、超過理由を稟議に記載する', 'compare');
  }
  if (c.ringi) {
    const no = c.ringi.stake.filter(s => s.status === '不可').length, wait = c.ringi.stake.filter(s => s.status === '未回答').length;
    add('社内調整', no ? '注意' : wait ? '要確認' : '完了', '稟議／社内調整',
      no ? `関係者${no}名が「不可」と回答しています。` : wait ? `関係者${wait}名が未回答です。` : '', no ? '条件を再調整する' : '未回答の関係者に回答を依頼する', 'ringi');
    add('稟議書の作成', c.ringi.doc ? '完了' : '未実施', '稟議', c.ringi.doc ? '' : '稟議書が未作成です。', '稟議書を作成する', 'ringi');
  } else if (c.quotes) {
    add('社内調整', '未実施', '稟議／社内調整', '関係者への確認が始まっていません。', '関係者の意見を入力する', 'ringi');
  }
  if (c.quotes) {
    const vals = LEGAL_ITEMS.map(i => (c.legal || {})[i.id] || '未確認');
    const todo = vals.filter(v => v === '要対応').length, un = vals.filter(v => v === '未確認').length;
    add('法令チェック', todo ? '注意' : un === vals.length ? '未実施' : un ? '要確認' : '完了', '法令チェック',
      todo ? `「要対応」の項目が${todo}件あります。` : un ? `未確認の項目が${un}件あります。` : '', '法令チェックの各項目を確認する', 'legal');
  }
  return out;
}
function checkSummary(c) {
  const list = processChecks(c), count = s => list.filter(x => x.status === s).length;
  return { list, done: count('完了'), warn: count('注意'), ask: count('要確認'), todo: count('未実施'), rate: Math.round(count('完了') / list.length * 100) };
}
const statusChip = s => `<span class="st ${{ 完了: 'ok', 注意: 'ng', 要確認: 'na', 未実施: 'off' }[s]}">${{ 完了: '✓', 注意: '！', 要確認: '？', 未実施: '−' }[s]} ${s}</span>`;

// ---------- サンプル案件 ----------
function makeSampleCase(def, n) {
  const c = { id: 'c' + (Date.now() + n), title: def.title, category: def.category, dept: def.dept, owner: def.owner, requestText: def.text,
    info: null, matrix: [], matrixFixed: false, candidates: [], selected: [], rfp: '', step: 0, maxStep: 0, done: false, updated: today() };
  c.info = structureRequest(c);
  c.matrix = buildMatrix(c); c.step = c.maxStep = 2;
  if (def.stage === 'matrix') return c;
  c.matrixFixed = true;
  c.candidates = evaluateSuppliers(c);
  c.selected = c.candidates.slice(0, def.pick).map(x => x.id);
  c.rfp = buildRfp(c); c.step = c.maxStep = 4; c.done = true;
  genQuotes(c);
  if (def.stage === 'ringi') {
    const r = ensureRingi(c);
    r.stake[0] = { name: '利用部門', status: '承諾', comment: '仕様・納期とも問題ありません。' };
    r.stake[1] = { name: '経理部', status: '条件付き', comment: '支払条件は月末締め翌月末払いとしてください。' };
    r.stake[2] = { name: '法務部', status: '承諾', comment: '契約書は当社ひな形を使用してください。' };
  }
  return c;
}
function seedSamples(force) {
  let first = false;
  try { first = localStorage.getItem(STORE_KEY) === null; } catch (e) { first = !state.cases.length; }
  if (!first && !force) return;
  state.cases.push(...SAMPLE_CASES.map(makeSampleCase));
  saveCases();
}
const sampleButton = '<button class="btn ghost" data-a="seed">サンプル案件を作成</button>';

// ---------- イベント（各画面の click / input / change に振り分ける） ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]');
  if (!t || state.busy) return;
  const a = t.dataset.a, v = t.dataset.v;
  if (a === 'go') { const [page, id] = v.split(':'); go(page, id); }
  else if (a === 'seed') { seedSamples(true); render(); toast('サンプル案件を作成しました'); }
  else if (PAGES[state.page] && PAGES[state.page].click) PAGES[state.page].click(a, v, t);
});
document.addEventListener('input', e => {
  const f = e.target.dataset.f, P = PAGES[state.page];
  if (f && P && P.input) P.input(f, e.target.value, e.target);
});
document.addEventListener('change', e => {
  const k = e.target.dataset.c, P = PAGES[state.page];
  if (!k) return;
  if (k === 'case') { ui.caseId = e.target.value; ui.edit = false; ui.thread = null; render(); }
  else if (P && P.change) P.change(k, e.target.value, e.target);
});
