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
function show(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.getElementById(v)?.classList.add('active');
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.v===v));
  if(v==='todayView') renderStats();
  if(v==='groupsView') renderGroups();
}

function eligible(){let scope=document.getElementById('scope').value||S.settings.scope;return DATA.filter(e=>scope==='all'||e.kind===scope)}
function startNewSession(force=false){
 S.settings.dailyN=Math.max(5,Math.min(100,+document.getElementById('dailyN').value||30));
 S.settings.scope=document.getElementById('scope').value;
 let pool=eligible();
 let weak=pool.filter(e=>{let x=S.learned[e.id];return x&&(x.wrong||0)+(x.unknown||0)+(x.fuzzy||0)>0}).sort((a,b)=>weakScore(b)-weakScore(a));
 let unseen=pool.filter(e=>!S.learned[e.id]);
 let picked=[...weak.slice(0,Math.min(8,S.settings.dailyN)),...unseen].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,S.settings.dailyN);
 if(!picked.length) picked=pool.slice(0,S.settings.dailyN);
 S.session={base:picked.map(x=>x.id),queue:picked.map(x=>x.id),done:{},attempts:{},started:Date.now(),current:null,revealed:false,pre:null,shownAt:0};
 save();renderLearn();show('learn');
}
function weakScore(e){let x=S.learned[e.id]||{};return (x.wrong||0)*3+(x.unknown||0)*3+(x.fuzzy||0)}
function ensureSession(){if(!S.session||(!S.session.queue?.length && Object.keys(S.session.done||{}).length===0)) startNewSession()}
function current(){
  ensureSession();
  if(!S.session.current){S.session.current=S.session.queue.shift()||null;S.session.revealed=false;S.session.pre=null;S.session.shownAt=Date.now();save()}
  return S.session.current?BYID[S.session.current]:null
}
function renderLearn(){
 let e=current(); let mount=document.getElementById('learnMount');
 if(!e){mount.innerHTML='<div class="card empty"><h2>本轮完成</h2><p>本轮记录已经自动保存。去“今日”查看记忆报告，或开始下一轮。</p><button class="btn primary" onclick="startNewSession(true)">再来一轮</button></div>';updateProg();return}
 let ans=S.session.revealed;
 mount.innerHTML=`<div class="card learn-card"><div class="source">${esc(e.source)} · #${e.n} · PDF 第${e.page}页</div><div><span class="word">${esc(e.term)}</span> <button class="speaker" onclick="speak('${esc(e.term).replace(/'/g,"\\'")}')">🔊</button></div><div class="timer" id="timer">回忆中…</div>
 <div class="answer ${ans?'show':''}" id="answer"><div class="meaning">${esc(e.meaning)||'（原词表此处未解析到释义）'}</div>${extraHTML(e)}</div>
 ${ans?`<div class="rate-actions"><button class="btn good" onclick="rate('mastered')">背会了</button><button class="btn fuzzy" onclick="rate('fuzzy')">模糊</button><button class="btn wrong" onclick="rate('wrong')">记错了</button><button class="btn unknown" onclick="rate('unknown')">不会</button></div>`:`<div class="recall-actions"><button class="btn primary" onclick="reveal('remembered')">我想起来了 · 核对</button><button class="btn" onclick="reveal('unknown')">没想起来 · 看答案</button></div>`}</div>`;
 updateProg();
 if(!ans){let t=setInterval(()=>{let el=document.getElementById('timer');if(!el||S.session.revealed){clearInterval(t);return}let sec=Math.floor((Date.now()-S.session.shownAt)/1000);el.textContent=sec<8?`已回忆 ${sec}s`:`已回忆 ${sec}s · 时间较久，可考虑标“模糊”`;},1000)}
}
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
function reveal(pre){S.session.pre=pre;S.session.revealed=true;save();renderLearn()}
function rate(r){
 let e=BYID[S.session.current], sec=Math.round((Date.now()-S.session.shownAt)/1000), id=e.id;
 let a=S.session.attempts[id]||(S.session.attempts[id]={mastered:0,fuzzy:0,wrong:0,unknown:0});a[r]++;
 let L=S.learned[id]||(S.learned[id]={mastered:0,fuzzy:0,wrong:0,unknown:0,total:0});L[r]++;L.total++;L.last=Date.now();
 S.today.events.push({id,r,pre:S.session.pre,sec,t:Date.now()});
 let hadWeak=(a.fuzzy+a.wrong+a.unknown)>0; let masteredNeeded=hadWeak?2:1;
 if(r==='mastered' && a.mastered>=masteredNeeded){S.session.done[id]=true}
 else {let gap=r==='unknown'?1:r==='wrong'?2:r==='fuzzy'?4:7; let pos=Math.min(gap,S.session.queue.length);S.session.queue.splice(pos,0,id)}
 S.session.current=null;S.session.revealed=false;S.session.pre=null;save();renderLearn();
}
function updateProg(){if(!S.session)return;let done=Object.keys(S.session.done||{}).length,total=S.session.base?.length||0;document.getElementById('sessionCount').textContent=`${done}/${total}`;document.getElementById('progressBar').style.width=(total?done/total*100:0)+'%';document.getElementById('queueCount').textContent=`队列 ${S.session.queue?.length||0}`}

const fdefs=[['all','全部'],['core_vocab','核心词汇'],['core_phrase','核心词组'],['extended_phrase','拓展词组'],['weak','薄弱词'],['star','重点词']];
function setFilter(k,el){filter=k;document.querySelectorAll('#filters .chip').forEach(x=>x.classList.remove('active'));el.classList.add('active');runSearch()}
function runSearch(){let q=document.getElementById('q').value.trim().toLowerCase();let arr=DATA.filter(e=>{if(filter==='weak'){let l=S.learned[e.id]||{};if(!(l.wrong||l.unknown||l.fuzzy))return false}else if(filter==='star'){if(!S.favorites[e.id])return false}else if(filter!=='all'&&e.kind!==filter)return false;if(!q)return true;return e.term.toLowerCase().includes(q)||e.meaning.toLowerCase().includes(q)}).slice(0,120);document.getElementById('results').innerHTML=arr.length?arr.map(e=>`<div class="result" onclick="openDetail('${e.id}')"><b>${esc(e.term)}</b><div class="m">${esc(e.meaning)}</div><div class="meta">${esc(e.source)} · #${e.n}${S.favorites[e.id]?' · ★重点':''}</div></div>`).join(''):'<div class="empty">没有找到匹配词条</div>'}
function openDetail(id){let e=BYID[id],l=S.learned[id]||{};document.getElementById('detailMount').innerHTML=`<button class="btn back" onclick="show('search')">← 返回查词</button><div class="card detail"><div class="source">${esc(e.source)} · #${e.n} · PDF 第${e.page}页</div><div><span class="word">${esc(e.term)}</span> <button class="speaker" onclick="speak('${esc(e.term).replace(/'/g,"\\'")}')">🔊</button></div><div class="meaning">${esc(e.meaning)}</div>${extraHTML(e)}<div class="section"><h3>你的记忆记录</h3><p>背会 ${l.mastered||0} 次 · 模糊 ${l.fuzzy||0} 次 · 记错 ${l.wrong||0} 次 · 不会 ${l.unknown||0} 次</p></div><div class="section"><button class="btn" onclick="toggleStar('${id}')">${S.favorites[id]?'取消重点':'★ 标为重点'}</button></div></div>`;show('detail')}
function toggleStar(id){S.favorites[id]=!S.favorites[id];save();openDetail(id)}

function renderStats(){let ev=S.today.events||[], by={};ev.forEach(x=>{let z=by[x.id]||(by[x.id]={mastered:0,fuzzy:0,wrong:0,unknown:0,secs:[],last:null});z[x.r]++;z.secs.push(x.sec);z.last=x.r});let ids=Object.keys(by);let c={mastered:0,fuzzy:0,wrong:0,unknown:0};ev.forEach(x=>c[x.r]++);let firstFast=ids.filter(id=>{let e=ev.find(x=>x.id===id);return e&&e.r==='mastered'&&e.sec<=8}).length;let rows=ids.sort((a,b)=>(by[b].wrong+by[b].unknown)*3+by[b].fuzzy-(by[a].wrong+by[a].unknown)*3-by[a].fuzzy).map(id=>{let z=by[id],e=BYID[id];return `<div class="row" onclick="openDetail('${id}')"><b>${esc(e.term)}</b><span class="tag ${z.wrong?'bad':z.fuzzy?'fuzzy':''}">${z.last==='mastered'?'最终会了':z.last==='fuzzy'?'最终模糊':z.last==='wrong'?'最终记错':'最终不会'}</span><span>错 ${z.wrong+z.unknown} 次</span><span>模糊 ${z.fuzzy} 次</span></div>`}).join('');document.getElementById('statsMount').innerHTML=`<div class="stats-grid"><div class="card stat"><strong>${ids.length}</strong><span>今日接触词条</span></div><div class="card stat"><strong>${firstFast}</strong><span>首次 ≤8秒且答对</span></div><div class="card stat"><strong>${c.wrong}</strong><span>记错次数</span></div><div class="card stat"><strong>${c.unknown}</strong><span>不会次数</span></div></div><div class="card table"><div class="row head"><span>词条</span><span>最终状态</span><span>记错/不会</span><span>模糊</span></div>${rows||'<div class="empty">今天还没有学习记录</div>'}</div>`}
function resetToday(){if(confirm('确定清空今天的学习记录吗？')){S.today={date:localDateKey(),events:[]};save();renderStats()}}
function renderGroups(){let auto=GROUPS.map((g,i)=>`<div class="card group"><h3>${g.type}</h3><div class="words">${g.members.map(w=>termLink(w)).join(' / ')}</div><p>${esc(g.note)}</p></div>`).join('');document.getElementById('groupsMount').innerHTML=auto+`<div class="card group"><h3>说明</h3><p class="note">“辨析”页先放入已核验的近义/易混组。每个单词详情页还会自动给出拼写形近词候选；后续可以继续把整套词表按近义、形近、同词根系统化扩充。</p></div>`}
function termLink(w){let e=DATA.find(x=>x.term.toLowerCase()===w);return e?`<a href="#" onclick="openDetail('${e.id}');return false">${esc(w)}</a>`:esc(w)}

function mountApp() {
  document.getElementById('today').textContent = localDateKey();
  document.getElementById('dailyN').value = S.settings.dailyN || 30;
  document.getElementById('scope').value = S.settings.scope || 'all';
  document.getElementById('accountEmail').textContent = authUser?.email || authUser?.id || '';
  document.getElementById('filters').innerHTML=fdefs.map(([k,n])=>`<button class="chip ${k==='all'?'active':''}" onclick="setFilter('${k}',this)">${n}</button>`).join('');
  runSearch(); renderGroups(); ensureSession(); renderLearn();
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

async function init() {
  if (!configReady()) {
    document.getElementById('setupScreen').classList.remove('hidden');
    return;
  }
  if (!window.supabase?.createClient) {
    document.getElementById('setupScreen').classList.remove('hidden');
    document.getElementById('setupScreen').querySelector('p').textContent='Supabase 脚本加载失败，请检查网络后刷新。';
    return;
  }
  supa = window.supabase.createClient(window.CET6_CLOUD_CONFIG.supabaseUrl, window.CET6_CLOUD_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  document.getElementById('setupScreen').classList.add('hidden');
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>show(b.dataset.v));
  document.getElementById('searchBtn').onclick=runSearch;
  document.getElementById('q').addEventListener('input',runSearch);
  document.getElementById('newSessionBtn').onclick=()=>startNewSession(true);
  document.getElementById('resetTodayBtn').onclick=resetToday;
  document.getElementById('syncNowBtn').onclick=()=>syncToCloud(true);
  document.getElementById('signOutBtn').onclick=signOut;
  document.getElementById('signInBtn').onclick=signIn;
  document.getElementById('signUpBtn').onclick=signUp;
  document.getElementById('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')signIn()});

  const { data: { session } } = await supa.auth.getSession();
  await handleUser(session?.user || null);
  supa.auth.onAuthStateChange((event, session2) => {
    setTimeout(() => {
      if (event === 'SIGNED_OUT') { authUser=null; S=cloneDefault(); handleUser(null); return; }
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session2?.user && session2.user.id !== authUser?.id) handleUser(session2.user);
    }, 0);
  });
  window.addEventListener('online',()=>syncToCloud(false));
  window.addEventListener('beforeunload',()=>{ writeLocal(); });
}

init();
