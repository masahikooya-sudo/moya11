// コミュニケーション: チャット（FR-048〜051）／検索: ナレッジ（FR-052〜058）
'use strict';

// ---------- チャット ----------
const CHAT_KEY = 'pd-ai-sourcing-chats-v1';
let chats = {};
try { chats = JSON.parse(localStorage.getItem(CHAT_KEY)) || {}; } catch (e) { chats = {}; }
const saveChats = () => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chats)); } catch (e) { /* 保存できなくても継続 */ } };
const nowText = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// スレッド一覧: 社外＝案件×依頼先、社内＝案件ごと
function chatThreads(tab) {
  const list = [];
  for (const c of state.cases) {
    if (tab === 'in') list.push({ id: c.id + ':in', c, who: '社内関係者', sub: STAKEHOLDERS.join('・') });
    else for (const sid of c.selected) list.push({ id: c.id + ':' + sid, c, who: supplier(sid).name, sub: '営業担当', sid });
  }
  return list;
}
// 初めて開くスレッドには、案件の状況に応じた最初のやり取りを入れておく
function threadMessages(t) {
  if (chats[t.id]) return chats[t.id];
  const me = t.c.owner || '調達担当', at = `${t.c.updated} 10:00`, at2 = `${t.c.updated} 11:30`, m = [];
  if (t.sid) {
    if (t.c.rfp) {
      m.push({ me: true, name: me, text: `お世話になっております。「${t.c.title.replace('【サンプル】', '')}」の見積依頼書をお送りします。ご確認をお願いいたします。`, at });
      m.push({ me: false, name: t.who, text: '見積依頼書を受領しました。回答期限までにお見積りを提出いたします。', at: at2 });
    }
    if (t.c.quotes) m.push({ me: false, name: t.who, text: `お見積りを提出しました。金額は${yen(t.c.quotes.items[t.sid] ? t.c.quotes.items[t.sid].amount : 0)}（税別）です。ご不明点があればお知らせください。`, at: `${t.c.updated} 15:20` });
  } else if (t.c.info) {
    m.push({ me: true, name: me, text: `「${t.c.title.replace('【サンプル】', '')}」の調達を進めています。要件に過不足があればこのスレッドでお知らせください。`, at });
    if (t.c.ringi) t.c.ringi.stake.filter(s => s.comment).forEach((s, i) => m.push({ me: false, name: s.name, text: s.comment, at: `${t.c.updated} ${13 + i}:10` }));
  }
  return (chats[t.id] = m);
}

function renderChat() {
  if (!state.cases.length) return emptyState('チャット', '案件がありません。', `<div class="actions center">${sampleButton}</div>`);
  const threads = chatThreads(ui.chatTab), t = threads.find(x => x.id === ui.thread) || threads[0];
  const tab = (id, label) => `<button class="tab${ui.chatTab === id ? ' on' : ''}" data-a="ctab" data-v="${id}">${label}</button>`;
  const list = threads.map(x => {
    const ms = threadMessages(x), last = ms[ms.length - 1];
    return `<button class="thread${x === t ? ' on' : ''}" data-a="thread" data-v="${x.id}">
      <b>${esc(x.who)}</b><span class="thread-case">${esc(x.c.title)}</span>
      <span class="thread-last">${last ? esc(last.text) : 'メッセージはまだありません'}</span></button>`;
  }).join('');
  let pane = `<div class="empty">${ui.chatTab === 'ext' ? '見積依頼先を選択した案件がありません。' : 'スレッドがありません。'}</div>`;
  if (t) {
    const ms = threadMessages(t);
    pane = `<div class="chat-head">
        <div><b>${esc(t.who)}</b> <span class="muted small-text">${esc(t.sub)}</span><div class="small-text">案件：<button class="link" data-a="go" data-v="rfp:${t.c.id}">${esc(t.c.title)}</button></div></div>
        <div class="chat-meta"><span class="chip">担当 ${esc(t.c.owner || '未設定')}</span><span class="chip ok">${esc(stageOf(t.c))}</span></div>
      </div>
      <div class="msgs" id="msgs">${ms.length ? ms.map(m => `<div class="msg ${m.me ? 'me' : ''}">
        <div class="msg-meta">${esc(m.name)}・${esc(m.at)}</div><div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`).join('')
        : '<div class="empty">メッセージはまだありません。</div>'}</div>
      <div class="composer"><textarea id="chatInput" rows="2" placeholder="メッセージを入力（Ctrl+Enter で送信）" aria-label="メッセージ"></textarea>
        <button class="btn primary" data-a="send">送信</button></div>`;
  }
  setTimeout(() => { const el = $('#msgs'); if (el) el.scrollTop = el.scrollHeight; });
  return `<div class="page-head"><div><h1>チャット</h1><p class="muted">案件に紐づけて、サプライヤや社内関係者とやり取りします。相手からの返信はダミーの自動応答です。</p></div></div>
    <div class="tabs">${tab('ext', '社外サプライヤ')}${tab('in', '社内')}</div>
    <div class="chat card"><div class="threads">${list || '<div class="empty">スレッドなし</div>'}</div><div class="chat-pane">${pane}</div></div>`;
}

function sendChat() {
  const input = $('#chatInput'), text = input.value.trim();
  if (!text) return;
  const threads = chatThreads(ui.chatTab), t = threads.find(x => x.id === ui.thread) || threads[0];
  threadMessages(t).push({ me: true, name: t.c.owner || '調達担当', text, at: nowText() });
  saveChats(); render(); $('#chatInput').focus();
  setTimeout(() => {
    const name = t.sid ? t.who : STAKEHOLDERS[Math.floor(hash(text) * STAKEHOLDERS.length)];
    chats[t.id].push({ me: false, name, text: t.sid ? '承知いたしました。確認のうえ、改めてご連絡いたします。（自動応答）' : '確認しました。部内で検討して回答します。（自動応答）', at: nowText() });
    saveChats();
    if (state.page === 'chat') { const draft = $('#chatInput') ? $('#chatInput').value : ''; render(); if ($('#chatInput')) $('#chatInput').value = draft; }
  }, 1200);
}
PAGES.chat = {
  render: renderChat,
  click(a, v) {
    if (a === 'ctab') { ui.chatTab = v; ui.thread = null; render(); }
    else if (a === 'thread') { ui.thread = v; render(); }
    else if (a === 'send') sendChat();
  },
};
document.addEventListener('keydown', e => {
  if (e.target.id === 'chatInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); }
  if (e.target.id === 'searchInput' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); PAGES[state.page].click('search'); }
});

// ---------- 検索 ----------
// 質問文を2文字ずつに区切り、タイトル・タグ・本文との一致で点数を付ける簡易検索
function searchKnowledge(query, sources) {
  const q = toHalf(query).toLowerCase().replace(/[\s、。？?！!「」]/g, '');
  const grams = new Set();
  for (let i = 0; i < q.length - 1; i++) { const g = q.slice(i, i + 2); if (!/^[ぁ-ん]+$/.test(g)) grams.add(g); }
  return KNOWLEDGE.filter(k => sources.includes(k.src)).map(k => {
    const title = k.title.toLowerCase(), body = k.body.toLowerCase();
    let score = 0;
    for (const tag of k.tags) if (q.includes(tag.toLowerCase())) score += 6;
    for (const g of grams) { if (title.includes(g)) score += 2; if (body.includes(g)) score += 1; }
    return { k, score };
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score);
}

function renderSearch() {
  const def = SEARCH_PAGES[state.page], s = ui.search[state.page] || (ui.search[state.page] = { q: '', done: '' });
  const off = ui.srcOff[state.page] || (ui.srcOff[state.page] = Object.keys(SOURCES).filter(k => !def.src.includes(k)));
  const sources = Object.keys(SOURCES).filter(k => !off.includes(k));
  const card = k => `<div class="kcard"><div class="kcard-head"><span class="src src-${k.src}">${SOURCES[k.src]}</span><b>${esc(k.title)}</b></div>
    <p>${esc(k.body)}</p><div class="chips">${k.tags.slice(0, 4).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>`;
  let body;
  if (!s.done) {
    const recs = KNOWLEDGE.filter(k => sources.includes(k.src)).slice(0, 6);
    body = `<div class="card"><h2>おすすめの参照先</h2>${recs.length ? `<div class="kcards">${recs.map(card).join('')}</div>` : '<div class="empty">検索対象が選択されていません。</div>'}</div>`;
  } else {
    const hits = searchKnowledge(s.done, sources), top = hits.slice(0, 3);
    body = hits.length ? `<div class="card ai-panel">
        <h2><span class="ai">✦ AI</span> 「${esc(s.done)}」の要点</h2>
        <div class="split even"><div><div class="label">要点</div><ul>${top.map(x => `<li>${esc(x.k.body)}</li>`).join('')}</ul></div>
          <div><div class="label">業務上のチェックポイント</div><ul class="checklist">${[...new Set(top.flatMap(x => x.k.points))].slice(0, 5).map(p => `<li>${esc(p)}</li>`).join('')}</ul></div></div>
        <p class="muted small-text">参照元：${top.map(x => `${SOURCES[x.k.src]}「${esc(x.k.title)}」`).join('、')}</p>
      </div>
      <div class="card"><h2>関連情報（${hits.length}件）</h2><div class="kcards">${hits.map(x => card(x.k)).join('')}</div></div>`
    : `<div class="card"><div class="empty">「${esc(s.done)}」に該当する情報は見つかりませんでした。検索対象を増やすか、別の言葉でお試しください。</div></div>`;
  }
  return `<div class="page-head"><div><h1>${def.title}</h1><p class="muted">${def.lead}</p></div></div>
    <div class="card">
      <div class="searchbar"><input id="searchInput" data-f="q" value="${esc(s.q)}" placeholder="質問を文章で入力してください" aria-label="検索する質問">
        <button class="btn primary" data-a="search">✦ 検索</button>${s.done ? '<button class="btn ghost" data-a="clear">クリア</button>' : ''}</div>
      <div class="filters"><span class="muted small-text">検索対象</span>${Object.keys(SOURCES).map(k => `<label class="check"><input type="checkbox" data-c="src:${k}" ${off.includes(k) ? '' : 'checked'}>${SOURCES[k]}</label>`).join('')}</div>
      <div class="filters"><span class="muted small-text">質問の例</span>${def.examples.map(x => `<button class="chip-btn" data-a="example" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    </div>${body}`;
}
const searchPage = {
  render: renderSearch,
  click(a, v) {
    const s = ui.search[state.page];
    if (a === 'example') { s.q = v; a = 'search'; }
    if (a === 'clear') { s.q = s.done = ''; render(); }
    else if (a === 'search') {
      if (!s.q.trim()) { toast('質問を入力してください'); return; }
      runBusy('情報を検索しています', ['質問の意図を解析', 'ノウハウ・過去案件を検索', 'AIが要点を整理'], () => { s.done = s.q.trim(); render(); });
    }
  },
  input(f, val) { ui.search[state.page].q = val; },
  change(k, val, t) {
    const key = k.split(':')[1], off = ui.srcOff[state.page];
    if (t.checked) off.splice(off.indexOf(key), 1); else off.push(key);
    render();
  },
};
PAGES.knowledge = PAGES.past = PAGES.trend = searchPage;
