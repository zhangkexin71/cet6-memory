/* 六级真题记忆台 v2 - Supabase 云端账号版 */
const BYID = Object.fromEntries(DATA.map(x => [x.id, x]));
const LEGACY_KEY = 'cet6_memory_lab_v1';
const LOCAL_PREFIX = 'cet6_memory_lab_v2:';
const DEFAULT_STATE = () => ({
  learned: {},
  today: { date: localDateKey(), events: [] },
  settings: { dailyN: 30, scope: 'all' },
  session: null,
  favorites: {},
  meta: { updatedAt: 0, version: 2 }
});

let supa = null;
let authUser = null;
let S = DEFAULT_STATE();
let filter = 'all';
let cloudTimer = null;
let cloudBusy = false;
let loadingState = false;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function cloneDefault() { return DEFAULT_STATE(); }
function normalizeState(raw) {
  const base = cloneDefault();
  if (!raw || typeof raw !== 'object') return base;
  const out = {
    learned: raw.learned && typeof raw.learned === 'object' ? raw.learned : {},
    today: raw.today && typeof raw.today === 'object' ? raw.today : base.today,
    settings: { ...base.settings, ...(raw.settings || {}) },
    session: raw.session || null,
    favorites: raw.favorites && typeof raw.favorites === 'object' ? raw.favorites : {},
    meta: { ...base.meta, ...(raw.meta || {}) }
  };
  if (out.today.date !== localDateKey()) out.today = { date: localDateKey(), events: [] };
  if (out.session?.current) out.session.shownAt = Date.now();
  return out;
}
function configReady() {
  const c = window.CET6_CLOUD_CONFIG || {};
  return c.supabaseUrl && c.supabaseAnonKey && !c.supabaseUrl.includes('YOUR_') && !c.supabaseAnonKey.includes('YOUR_');
}
function localKey() { return authUser ? LOCAL_PREFIX + authUser.id : LOCAL_PREFIX + 'guest'; }
function readLocalForUser() {
  try { return normalizeState(JSON.parse(localStorage.getItem(localKey()) || 'null')); }
  catch { return cloneDefault(); }
}
function readLegacy() {
  try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); }
  catch { return null; }
}
function writeLocal() {
  if (!authUser) return;
  localStorage.setItem(localKey(), JSON.stringify(S));
}
function setSyncStatus(mode, text) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncText');
  const account = document.getElementById('accountStatus');
  if (dot) dot.className = `syncDot ${mode || ''}`;
  if (label) label.textContent = text || '';
  if (account) account.textContent = text || '';
}
function save() {
  if (loadingState || !authUser) return;
  S.meta = S.meta || {};
  S.meta.updatedAt = Date.now();
  S.meta.version = 2;
  writeLocal();
  setSyncStatus('busy', '正在保存…');
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => syncToCloud(false), 450);
}
async function syncToCloud(force = false) {
  if (!authUser || !supa || cloudBusy) return;
  clearTimeout(cloudTimer);
  cloudBusy = true;
  setSyncStatus('busy', '正在同步…');
  try {
    const { error } = await supa.from('user_state').upsert({ user_id: authUser.id, payload: S }, { onConflict: 'user_id' });
    if (error) throw error;
    writeLocal();
    setSyncStatus('ok', '已保存云端');
  } catch (err) {
    console.error(err);
    setSyncStatus('err', '云端同步失败 · 本机已缓存');
    if (force) alert('云端同步失败：' + (err.message || err));
  } finally {
    cloudBusy = false;
  }
}
async function loadStateAfterLogin() {
  loadingState = true;
  setSyncStatus('busy', '正在读取云端…');
  try {
    const local = readLocalForUser();
    const { data, error } = await supa.from('user_state').select('payload,updated_at').eq('user_id', authUser.id).maybeSingle();
    if (error) throw error;
    const cloud = data?.payload ? normalizeState(data.payload) : null;
    const legacy = localStorage.getItem(LEGACY_KEY + ':migrated') ? null : readLegacy();

    if (!cloud) {
      const candidate = hasMeaningfulState(local) ? local : (legacy ? normalizeState(legacy) : cloneDefault());
      S = candidate;
      S.meta.updatedAt = Math.max(S.meta.updatedAt || 0, Date.now());
      writeLocal();
      const { error: upErr } = await supa.from('user_state').upsert({ user_id: authUser.id, payload: S }, { onConflict: 'user_id' });
      if (upErr) throw upErr;
      if (legacy) localStorage.setItem(LEGACY_KEY + ':migrated', String(Date.now()));
      setSyncStatus('ok', legacy ? '已迁移旧版记录并保存' : '已创建云端记录');
    } else {
      const localT = Number(local?.meta?.updatedAt || 0);
      const cloudT = Number(cloud?.meta?.updatedAt || 0);
      if (hasMeaningfulState(local) && localT > cloudT + 3000) {
        S = local;
        const { error: upErr } = await supa.from('user_state').upsert({ user_id: authUser.id, payload: S }, { onConflict: 'user_id' });
        if (upErr) throw upErr;
        setSyncStatus('ok', '已把本机较新的进度同步到云端');
      } else {
        S = cloud;
        writeLocal();
        setSyncStatus('ok', '已从云端恢复进度');
      }
    }
  } catch (err) {
    console.error(err);
    S = readLocalForUser();
    setSyncStatus('err', '云端读取失败 · 使用本机缓存');
  } finally {
    loadingState = false;
  }
}
function hasMeaningfulState(x) {
  return !!(x && (Object.keys(x.learned || {}).length || Object.keys(x.favorites || {}).length || x.session || (x.today?.events || []).length));
}

function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function speak(t){speechSynthesis.cancel();let u=new SpeechSynthesisUtterance(t.replace(/…/g,' '));u.lang='en-US';speechSynthesis.speak(u)}
function extraHTML(e){
 let h='';
 if(e.etymology) h+=`<div class="section"><h3>词源 · 为什么是这个意思</h3><p style="white-space:pre-line">${esc(e.etymology)}</p></div>`;
 else if(e.kind==='core_vocab') h+=`<div class="section"><h3>词源</h3><p class="note">此词的词源解析尚未逐词核验。当前版本不做机械拆分，避免把“看起来像前缀”的字母误当成真实词根。</p></div>`;

 if(e.phrase_hint){
   if(e.kind==='core_vocab'){
     const collocations=String(e.phrase_hint).split(/[；;]/).map(x=>x.trim()).filter(Boolean);
     h+=`<div class="section"><h3>常用搭配</h3><p>${collocations.map(esc).join(' · ')}</p></div>`;
   } else {
     h+=`<div class="section"><h3>词组方向感提示</h3><p>${esc(e.phrase_hint)}</p><p class="note">这是帮助理解词组结构的语义提示，不等于完整历史词源。</p></div>`;
   }
 }

 if(e.similar?.length) h+=`<div class="section"><h3>形近词候选</h3><p>${e.similar.map(x=>`<a href="#" onclick="openDetail('${x.id}');return false">${esc(x.term)}</a>`).join(' · ')}</p></div>`;
 if(e.groups?.length) e.groups.forEach(i=>{let g=GROUPS[i]; if(g) h+=`<div class="section"><h3>${g.type}辨析 · ${esc(g.title)}</h3><p>${esc(g.note)}</p></div>`});
 return h;
}

// 搜索负责“找到词”，翻页负责“沿着词库往前/往后看”。不要用搜索结果作为翻页队列。
let visibleWords = DATA.slice();
let matchedWords = DATA.slice();
let activeId = DATA[0]?.id || null;
let detailOrigin = 'search';
const categories = [['all','全部'],['core_vocab','核心词汇'],['core_phrase','核心词组'],['extended_phrase','拓展词组'],['star','★ 收藏']];

function setView(name) {
 document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===name));
 document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.v===name));
 if(name==='groups') renderGroups();
}
// 翻页范围只取决于当前分类，不被搜索关键词缩成一条。
function browseItems(){
 if(filter==='all')return DATA;
 if(filter==='star')return DATA.filter(e=>!!S.favorites[e.id]);
 return DATA.filter(e=>e.kind===filter);
}
function searchItems(){
 const q=(document.getElementById('q')?.value||'').trim().toLowerCase();
 return browseItems().filter(e=>!q||e.term.toLowerCase().includes(q)||e.meaning.toLowerCase().includes(q));
}
function changeFilter(k){filter=k;renderFilters();runSearch()}
function renderFilters(){document.getElementById('filters').innerHTML=categories.map(([k,n])=>`<button type="button" class="chip ${k===filter?'active':''}" onclick="changeFilter('${k}')">${n}</button>`).join('')}
function runSearch(){
 matchedWords=searchItems();
 const box=document.getElementById('results');
 const entry=matchedWords[0];
 const begin=entry?`<button type="button" class="btn browse-start" onclick="openDetail('${entry.id}','search')">${document.getElementById('q').value.trim()?'查看第一个匹配词':'从第一词开始连续浏览'} <span aria-hidden="true">→</span></button>`:'';
 const list=matchedWords.length?matchedWords.slice(0,180).map(e=>`<button type="button" class="result" onclick="openDetail('${e.id}','search')"><b>${esc(e.term)}</b><span class="resultmeaning">${esc(e.meaning)}</span><small>${esc(e.source)} · #${e.n}${S.favorites[e.id]?' · ★':''}</small></button>`).join(''):'<div class="empty">没有找到符合条件的词条</div>';
 box.innerHTML=begin+list;
 document.getElementById('resultCount').textContent=`搜索结果 ${matchedWords.length} 条 · 点开任意词即可用左右箭头连续翻阅${matchedWords.length>180?' · 下方只展示前 180 条':''}`;
}
// 点击搜索或按回车，直接打开最匹配的词，不必多点一次搜索结果。
function searchAndOpen(){
 runSearch();
 if(matchedWords.length)openDetail(matchedWords[0].id,'search');
}
function detailButtons(i, mode='top'){
 const len=visibleWords.length;
 return `<nav class="navwords navwords--${mode}" aria-label="上一词和下一词"><button type="button" class="btn arrow" onclick="goWord(-1)" ${len<2?'disabled':''} aria-label="上一词">← 上一词</button><span class="position" aria-live="polite">${i+1} / ${len}</span><button type="button" class="btn arrow" onclick="goWord(1)" ${len<2?'disabled':''} aria-label="下一词">下一词 →</button></nav>`;
}
function openDetail(id, origin){
 const e=BYID[id];if(!e)return;
 if(origin)detailOrigin=origin;
 // 分类内连续翻词；如果分类里只剩这一个词，就退回全词库，确保仍有前后词。
 const pool=detailOrigin==='groups'?DATA:browseItems();
 visibleWords=(pool.length>1&&pool.some(x=>x.id===id))?pool:DATA;
 activeId=id;
 const i=visibleWords.findIndex(x=>x.id===id);
 document.getElementById('detailMount').innerHTML=`<div class="detailtop"><button class="btn back" onclick="setView('${detailOrigin}')">← 返回${detailOrigin==='groups'?'辨析':'查词'}</button><span class="muted">${esc(e.source)} · #${e.n}</span></div><p class="browse-hint">左右箭头沿词库顺序翻词；翻到末尾会接回开头。</p>${detailButtons(i,'top')}<article class="card detail"><div class="source">PDF 第${e.page}页</div><div class="heading"><h2 class="word">${esc(e.term)}</h2><button class="speaker" id="speakerBtn" aria-label="朗读单词">🔊</button></div><div class="meaning">${esc(e.meaning)||'（原词表没有解析到释义）'}</div>${extraHTML(e)}<div class="section"><button class="btn" onclick="toggleStar('${e.id}')">${S.favorites[e.id]?'★ 已收藏 · 点击取消':'☆ 收藏这个词'}</button></div></article>${detailButtons(i,'floating')}`;
 document.getElementById('speakerBtn').onclick=()=>speak(e.term);
 setView('detail');window.scrollTo(0,0);
}
function goWord(delta){
 const len=visibleWords.length;
 if(len<2)return;
 const i=visibleWords.findIndex(e=>e.id===activeId);
 if(i<0)return;
 // 循环翻阅，首页上一词、末页下一词都可用。
 const next=visibleWords[(i+delta+len)%len];
 if(next)openDetail(next.id);
}
function toggleStar(id){ S.favorites[id]=!S.favorites[id];save();runSearch();openDetail(id); }
function renderGroups(){
 document.getElementById('groupsMount').innerHTML=GROUPS.map(g=>`<article class="card group"><h3>${esc(g.type)} · ${esc(g.title)}</h3><div class="words">${g.members.map(termLink).join(' / ')}</div><p>${esc(g.note)}</p></article>`).join('');
}
function termLink(w){const e=DATA.find(x=>x.term.toLowerCase()===String(w).toLowerCase());return e?`<a href="#" onclick="visibleWords=DATA.slice();openDetail('${e.id}','groups');return false">${esc(w)}</a>`:esc(w)}
function mountApp(){
 document.getElementById('accountEmail').textContent=authUser?.email||'';
 renderFilters();runSearch();setView('search');
}
async function signIn() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  setAuthMsg('');
  if (!email || !password) return setAuthMsg('请输入邮箱和密码。');
  document.getElementById('signInBtn').disabled = true;
  try {
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (e) { setAuthMsg(e.message || String(e)); }
  finally { document.getElementById('signInBtn').disabled = false; }
}
async function signUp() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  setAuthMsg('');
  if (!email || password.length < 6) return setAuthMsg('请输入有效邮箱，密码至少 6 位。');
  document.getElementById('signUpBtn').disabled = true;
  try {
    const { data, error } = await supa.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) setAuthMsg('注册成功。请先去邮箱完成验证，再回来登录。', false);
  } catch (e) { setAuthMsg(e.message || String(e)); }
  finally { document.getElementById('signUpBtn').disabled = false; }
}
function setAuthMsg(msg, bad = true) { const el=document.getElementById('authMsg'); el.textContent=msg; el.style.color=bad?'var(--bad)':'var(--accent)'; }
async function signOut() {
  await syncToCloud(false);
  await supa.auth.signOut();
}
async function handleUser(user) {
  authUser = user || null;
  if (!authUser) {
    document.getElementById('appRoot').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
    return;
  }
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  await loadStateAfterLogin();
  mountApp();
}


async function init(){
 const signInBtn=document.getElementById('signInBtn'), signUpBtn=document.getElementById('signUpBtn');
 signInBtn.onclick=signIn;signUpBtn.onclick=signUp;
 document.getElementById('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')signIn()});
 document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setView(b.dataset.v));
 document.getElementById('q').addEventListener('input',runSearch);
 document.getElementById('searchBtn').onclick=searchAndOpen;
 document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')searchAndOpen()});
 document.getElementById('syncNowBtn').onclick=()=>syncToCloud(true);
 document.getElementById('signOutBtn').onclick=signOut;
 document.addEventListener('keydown',e=>{if(document.getElementById('detail').classList.contains('active')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){if(e.key==='ArrowLeft')goWord(-1);if(e.key==='ArrowRight')goWord(1)}});
 if(!configReady()||!window.supabase?.createClient){
  document.getElementById('setupScreen').classList.remove('hidden');return;
 }
 supa=window.supabase.createClient(window.CET6_CLOUD_CONFIG.supabaseUrl,window.CET6_CLOUD_CONFIG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 document.getElementById('setupScreen').classList.add('hidden');
 const {data:{session}}=await supa.auth.getSession();await handleUser(session?.user||null);
 supa.auth.onAuthStateChange((event,session2)=>{setTimeout(()=>{if(event==='SIGNED_OUT'){authUser=null;S=cloneDefault();handleUser(null);return}if((event==='SIGNED_IN'||event==='USER_UPDATED')&&session2?.user&&session2.user.id!==authUser?.id)handleUser(session2.user)},0)});
 window.addEventListener('online',()=>syncToCloud(false));window.addEventListener('beforeunload',writeLocal);
}
init();
