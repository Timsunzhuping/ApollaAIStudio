/** Sprint Demo workspace page: login → project → research → cited report → export. */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Apolla AI Studio</title>
<style>
  :root { --bd:#e5e7eb; --mut:#6b7280; --bg:#f9fafb; --ac:#2563eb; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; color:#111; }
  header { padding:.7rem 1rem; border-bottom:1px solid var(--bd); display:flex; gap:.6rem; align-items:center; }
  header b { font-size:1rem; } header .mode { font-size:.7rem; color:var(--mut); border:1px solid var(--bd); border-radius:999px; padding:.1rem .5rem; }
  header .spacer { flex:1; } header .who { font-size:.8rem; color:var(--mut); }
  .bar { display:flex; gap:.5rem; padding:.7rem 1rem; border-bottom:1px solid var(--bd); align-items:center; }
  .bar input, .bar select { padding:.5rem .6rem; border:1px solid var(--bd); border-radius:8px; font:inherit; }
  .bar input#q { flex:1; }
  button { padding:.5rem .85rem; border:1px solid var(--ac); background:var(--ac); color:#fff; border-radius:8px; cursor:pointer; font:inherit; }
  button.ghost { background:#fff; color:var(--ac); } button:disabled { opacity:.5; cursor:default; }
  .grid { display:grid; grid-template-columns:230px 1fr 280px; height:calc(100vh - 116px); }
  .col { overflow:auto; padding:1rem; } .col + .col { border-left:1px solid var(--bd); }
  h3 { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--mut); margin:.2rem 0 .6rem; }
  .step { font-size:.85rem; padding:.35rem .5rem; border-radius:6px; margin-bottom:.25rem; background:var(--bg); }
  .step.run { border-left:3px solid var(--ac); } .step.done { color:var(--mut); }
  #report { white-space:pre-wrap; } .src { font-size:.82rem; margin-bottom:.6rem; } .src a { color:var(--ac); word-break:break-all; }
  .sid { font-family:ui-monospace,monospace; font-size:.72rem; color:var(--mut); }
  .cost { font-size:1.4rem; font-weight:600; } .exp { display:flex; gap:.4rem; margin-top:.5rem; }
  .muted { color:var(--mut); font-size:.82rem; }
  #login { max-width:22rem; margin:5rem auto; text-align:center; display:none; }
  #login input { width:100%; padding:.6rem; border:1px solid var(--bd); border-radius:8px; margin:.6rem 0; font:inherit; }
  #app { display:none; }
</style>
</head>
<body>
<header>
  <b>Apolla AI Studio</b><span class="mode" id="mode">…</span>
  <span class="spacer"></span>
  <span class="who" id="who"></span>
  <button class="ghost" id="logout" style="display:none">Sign out</button>
</header>

<div id="login">
  <h2>Sign in</h2>
  <p class="muted">Enter any email — Sprint 02 uses email-identity auth.</p>
  <input id="email" type="email" placeholder="you@example.com" />
  <button id="loginBtn" style="width:100%">Continue</button>
</div>

<div id="app">
  <div class="bar">
    <select id="project"><option value="">No project</option></select>
    <button class="ghost" id="newProject">+ Project</button>
    <select id="skill" title="Rerun a saved skill"><option value="">No skill</option></select>
    <button class="ghost" id="prefs" title="Writing preferences">⚙</button>
    <input id="q" placeholder="Ask a research question, e.g. “State of the EV market in 2026”" />
    <button id="go">Research</button>
  </div>
  <div class="grid">
    <div class="col"><h3>Task trace</h3><div id="trace"></div><h3 style="margin-top:1rem">Plan</h3><div id="plan" class="muted">—</div></div>
    <div class="col"><h3>Report</h3><div id="report" class="muted">Enter a question to begin.</div></div>
    <div class="col">
      <h3>Sources</h3><div id="sources" class="muted">—</div>
      <h3 style="margin-top:1rem">Cost</h3><div class="cost" id="cost">$0.0000</div>
      <div class="exp" id="exp" style="display:none"><button class="ghost" data-fmt="md">Export .md</button><button class="ghost" data-fmt="html">Export .html</button><button class="ghost" id="saveSkill">★ Save as skill</button><button class="ghost" id="genImage">🖼 Cover</button><button class="ghost" id="genVideo">🎬 Video</button></div>
      <div id="media" style="margin-top:.6rem"></div>
    </div>
  </div>
  <div class="bar" style="border-top:1px solid var(--bd)">
    <button class="ghost" id="addConnector">+ MCP connector</button>
    <span id="connList" class="muted">no connectors</span>
    <input id="agentGoal" placeholder="Agent goal, e.g. “save a note about EVs”" />
    <button id="runAgent">Run agent</button>
  </div>
  <div class="col" style="border:0">
    <h3>Agent trace</h3><div id="agentTrace" class="muted">—</div>
    <div id="agentConfirm" style="margin-top:.4rem"></div>
    <h3 style="margin-top:1rem">Audit</h3><div id="agentAudit" class="muted">—</div>
  </div>
  <div class="bar" style="border-top:1px solid var(--bd)">
    <button class="ghost" id="addSchedule">+ Daily schedule</button>
    <button class="ghost" id="refreshInbox">↻ Inbox</button>
    <span id="notifBadge" class="muted">🔔 0</span>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
    <div class="col"><h3>Schedules</h3><div id="schedules" class="muted">—</div></div>
    <div class="col"><h3>Job history</h3><div id="jobs" class="muted">—</div></div>
    <div class="col"><h3>Notifications</h3><div id="notifs" class="muted">—</div></div>
  </div>
  <div class="bar" style="border-top:1px solid var(--bd)">
    <b>Cowork</b>
    <select id="pluginSel"></select>
    <button class="ghost" id="installPlugin">Install plugin</button>
    <span id="pluginList" class="muted">no plugins</span>
  </div>
  <div class="bar">
    <input id="coworkGoal" placeholder="Cowork goal, e.g. “Research the EV market across 3 angles and write a brief”" />
    <button id="runCowork">Run Cowork</button>
    <button class="ghost" id="scheduleCowork">+ Daily Cowork</button>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr">
    <div class="col"><h3>Cowork trace (sub-agent fan-out)</h3><div id="coworkTrace" class="muted">—</div></div>
    <div class="col"><h3>Deliverable</h3><div id="coworkOut" class="muted">—</div></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let taskId = null;

async function boot() {
  const h = await fetch('/api/health').then(r=>r.json());
  $('mode').textContent = (h.mode==='real'?'live models':'demo mode') + ' · ' + h.persistence;
  const me = await fetch('/api/auth/me');
  if (me.ok) { const u = await me.json(); showApp(u); } else { $('login').style.display='block'; }
}
function showApp(u) {
  $('login').style.display='none'; $('app').style.display='block';
  $('who').textContent = u.email; $('logout').style.display='inline-block';
  loadProjects(); loadSkills(); loadConnectors(); loadPlugins(); refreshInbox();
}
function btn(label, cls, fn){ const b=document.createElement('button'); b.textContent=label; if(cls)b.className=cls; b.onclick=fn; b.style.marginRight='.3rem'; return b; }
async function refreshInbox(){ loadSchedules(); loadJobs(); loadNotifs(); }
$('refreshInbox').onclick = refreshInbox;
$('addSchedule').onclick = async () => {
  const question = prompt('Daily research question'); if(!question) return;
  const cron = prompt('Cron (UTC), default daily 08:00', '0 8 * * *') || '0 8 * * *';
  await fetch('/api/schedules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:question.slice(0,40),cron,kind:'research',input:{question}})});
  loadSchedules();
};
async function loadSchedules(){
  const list = await fetch('/api/schedules').then(r=>r.json());
  const box = $('schedules'); box.innerHTML='';
  if(!list.length){ box.className='muted'; box.textContent='—'; return; } box.className='';
  for(const s of list){ const d=document.createElement('div'); d.className='step';
    d.textContent = (s.enabled?'🟢 ':'⚪️ ')+(s.name||s.cron)+' · '+s.cron+' ';
    d.appendChild(btn('run now','ghost', async()=>{ await fetch('/api/schedules/'+s.id+'/run-now',{method:'POST'}); loadJobs(); }));
    d.appendChild(btn(s.enabled?'pause':'resume','ghost', async()=>{ await fetch('/api/schedules/'+s.id+'/toggle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!s.enabled})}); loadSchedules(); }));
    d.appendChild(btn('✕','ghost', async()=>{ await fetch('/api/schedules/'+s.id,{method:'DELETE'}); loadSchedules(); }));
    box.appendChild(d);
  }
}
async function loadJobs(){
  const list = await fetch('/api/jobs').then(r=>r.json());
  $('jobs').className = list.length?'':'muted';
  $('jobs').innerHTML = list.length ? list.slice(0,20).map(j=>'<div class="step">'+j.kind+' · '+j.status+'</div>').join('') : '—';
}
async function loadNotifs(){
  const list = await fetch('/api/notifications').then(r=>r.json());
  const unread = list.filter(n=>!n.read).length; $('notifBadge').textContent='🔔 '+unread;
  const box=$('notifs'); box.innerHTML=''; if(!list.length){ box.className='muted'; box.textContent='—'; return; } box.className='';
  for(const n of list.slice(0,20)){ const d=document.createElement('div'); d.className='step'+(n.read?' done':'');
    d.textContent=(n.read?'· ':'• ')+n.title+' ';
    if(!n.read) d.appendChild(btn('read','ghost', async()=>{ await fetch('/api/notifications/'+n.id+'/read',{method:'POST'}); loadNotifs(); }));
    box.appendChild(d);
  }
}
// --- Plugins + Cowork (S6) ---
async function loadPlugins(){
  const [official, installed] = await Promise.all([
    fetch('/api/plugins/official').then(r=>r.json()),
    fetch('/api/plugins').then(r=>r.json()),
  ]);
  $('pluginSel').innerHTML = official.map(p=>'<option value="'+p.name+'">'+escapeHtml(p.name)+'</option>').join('');
  const box=$('pluginList'); box.innerHTML='';
  if(!installed.length){ box.className='muted'; box.textContent='no plugins installed'; return; } box.className='';
  for(const p of installed){ const s=document.createElement('span'); s.style.marginRight='.4rem';
    s.textContent='🧩 '+p.name+' ';
    s.appendChild(btn('✕','ghost', async()=>{ await fetch('/api/plugins/'+encodeURIComponent(p.name),{method:'DELETE'}); loadPlugins(); loadSkills(); }));
    box.appendChild(s);
  }
}
$('installPlugin').onclick = async () => {
  const name=$('pluginSel').value; if(!name) return;
  const j = await fetch('/api/plugins/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})}).then(r=>r.json());
  if(j.missingConnectors && j.missingConnectors.length) alert('Installed "'+name+'". Connect required: '+j.missingConnectors.join(', '));
  loadPlugins(); loadSkills();
};
$('runCowork').onclick = async () => {
  const goal=$('coworkGoal').value.trim(); if(!goal) return;
  $('coworkTrace').innerHTML=''; $('coworkTrace').className=''; $('coworkOut').className='muted'; $('coworkOut').textContent='…';
  const r = await fetch('/api/cowork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal})});
  if(!r.ok){ alert('cowork failed: '+(await r.json()).error); return; }
  const {jobId} = await r.json();
  const es = new EventSource('/api/jobs/'+jobId+'/events');
  es.onmessage=(m)=>{ const ev=JSON.parse(m.data); const line=document.createElement('div'); line.className='step';
    if(ev.type==='plan') line.textContent='📋 plan: '+ev.subgoals.length+' sub-agents'+(ev.truncated?(' (capped, dropped '+ev.truncated+')'):'');
    else if(ev.type==='subagent-start') line.textContent='🤖 #'+(ev.index+1)+' '+ev.subgoal;
    else if(ev.type==='subagent-result') line.textContent='✓ #'+(ev.index+1)+' done ('+ev.result.toolCalls+' tool calls)';
    else if(ev.type==='clarify') line.textContent='❓ '+ev.question+(ev.answered?' (answered)':' (no answer — proceeding safely)');
    else if(ev.type==='synthesize'){ $('coworkOut').className=''; $('coworkOut').textContent=ev.text; line.textContent='🧩 synthesized deliverable'; }
    else if(ev.type==='done'){ es.close(); loadJobs(); }
    else if(ev.type==='error'){ line.textContent='error: '+ev.message; es.close(); }
    $('coworkTrace').appendChild(line);
  };
  es.onerror=()=>es.close();
};
$('scheduleCowork').onclick = async () => {
  const goal=$('coworkGoal').value.trim()||prompt('Cowork goal'); if(!goal) return;
  const cron=prompt('Cron (UTC), default daily 08:00','0 8 * * *')||'0 8 * * *';
  await fetch('/api/schedules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Cowork: '+goal.slice(0,30),cron,kind:'cowork',input:{goal}})});
  loadSchedules();
};
let agentId = null;
async function loadConnectors(){
  const l = await fetch('/api/connectors').then(r=>r.json());
  $('connList').textContent = l.length ? l.map(c=>c.name+' ('+c.tools.length+' tools)').join(', ') : 'no connectors';
}
$('addConnector').onclick = async () => {
  await fetch('/api/connectors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'demo',transport:'stub',readOnlyTools:['echo']})});
  loadConnectors();
};
async function loadAudit(){
  if(!agentId) return;
  const a = await fetch('/api/audit?taskId='+agentId).then(r=>r.json());
  $('agentAudit').innerHTML = a.length ? a.map(e=>escapeHtml(e.tool)+': '+e.decision+(e.confirmed!==undefined?'/'+(e.confirmed?'approved':'denied'):'')+' → '+e.status).join('<br>') : 'no actions';
}
$('runAgent').onclick = async () => {
  const goal = $('agentGoal').value.trim(); if(!goal) return;
  $('agentTrace').innerHTML=''; $('agentConfirm').innerHTML=''; $('agentAudit').textContent='—';
  const r = await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal})});
  agentId = (await r.json()).agentId;
  const es = new EventSource('/api/agent/'+agentId+'/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data); const line = document.createElement('div'); line.className='step';
    if(ev.type==='plan') line.textContent='📋 planning…';
    else if(ev.type==='tool-call') line.textContent='🔧 '+ev.tool+' ['+ev.risk+']';
    else if(ev.type==='tool-result') line.textContent='✓ '+ev.tool+': '+(ev.summary||'').slice(0,80);
    else if(ev.type==='denied') line.textContent='⛔ '+ev.tool+' — '+ev.reason;
    else if(ev.type==='delta') line.textContent='💬 '+ev.text;
    else if(ev.type==='confirm'){
      line.textContent='⏸ confirm '+ev.tool+' ['+ev.risk+']?';
      const yes=document.createElement('button'); yes.textContent='Approve';
      yes.onclick=()=>{ fetch('/api/agent/'+agentId+'/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({approved:true})}); $('agentConfirm').innerHTML=''; };
      const no=document.createElement('button'); no.className='ghost'; no.textContent='Deny';
      no.onclick=()=>{ fetch('/api/agent/'+agentId+'/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({approved:false})}); $('agentConfirm').innerHTML=''; };
      $('agentConfirm').innerHTML=''; $('agentConfirm').append(yes,no);
    }
    else if(ev.type==='done'){ es.close(); loadAudit(); }
    else if(ev.type==='error'){ line.textContent='error: '+ev.message; es.close(); }
    $('agentTrace').appendChild(line);
  };
  es.onerror = () => es.close();
};
async function loadSkills() {
  const list = await fetch('/api/skills').then(r=>r.json());
  $('skill').innerHTML = '<option value="">No skill</option>' + list.map(s=>'<option value="'+s.name+'">'+escapeHtml(s.name)+'</option>').join('');
}
$('prefs').onclick = async () => {
  const language = prompt('Preferred language (e.g. English, Chinese)') || '';
  const style = prompt('Preferred style (e.g. concise bullets)') || '';
  await fetch('/api/memory/model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language,style})});
  alert('Preferences saved — future research will reflect them.');
};
$('saveSkill').onclick = async () => {
  if(!taskId) return;
  const r = await fetch('/api/tasks/'+taskId+'/save-as-skill',{method:'POST'});
  if(r.ok){ const s = await r.json(); await loadSkills(); $('skill').value=s.name; alert('Saved skill: '+s.name); }
  else alert('Could not save skill');
};
$('loginBtn').onclick = async () => {
  const email = $('email').value.trim();
  const r = await fetch('/api/auth/login', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email})});
  if (r.ok) showApp(await r.json()); else alert('login failed');
};
$('logout').onclick = async () => { await fetch('/api/auth/logout',{method:'POST'}); location.reload(); };

async function loadProjects() {
  const list = await fetch('/api/projects').then(r=>r.json());
  $('project').innerHTML = '<option value="">No project</option>' + list.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join('');
}
$('newProject').onclick = async () => {
  const name = prompt('Project name'); if(!name) return;
  const description = prompt('Project background (optional)') || '';
  const p = await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,description})}).then(r=>r.json());
  await loadProjects(); $('project').value = p.id;
};

function addStep(state, status){
  let el = document.querySelector('[data-step="'+state+'"]');
  if(!el){ el=document.createElement('div'); el.className='step'; el.dataset.step=state; el.textContent=state; $('trace').appendChild(el); }
  el.className = 'step ' + status;
}
$('go').onclick = run;
$('q').addEventListener('keydown', e => { if(e.key==='Enter') run(); });

async function run(){
  const q = $('q').value.trim(); if(!q) return;
  $('go').disabled = true; $('trace').innerHTML=''; $('plan').textContent='—';
  $('report').textContent=''; $('report').className=''; $('sources').textContent='—'; $('cost').textContent='$0.0000'; $('exp').style.display='none';
  const skillName = $('skill').value;
  const res = skillName
    ? await fetch('/api/skills/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:skillName, question:q})})
    : await fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q, projectId: $('project').value || undefined})});
  const body = await res.json();
  if(!res.ok){ $('go').disabled=false; $('report').textContent = body.error || 'request failed'; return; }
  taskId = body.taskId;
  const es = new EventSource('/api/tasks/'+taskId+'/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if(ev.type==='step-start') addStep(ev.state,'run');
    else if(ev.type==='step-end') addStep(ev.state,'done');
    else if(ev.type==='plan') $('plan').innerHTML = ev.plan.subquestions.map(s=>'• '+escapeHtml(s)).join('<br>') + '<div class="muted" style="margin-top:.4rem">~'+ev.estimate.seconds+'s</div>';
    else if(ev.type==='delta'){ $('report').className=''; $('report').textContent += ev.text; }
    else if(ev.type==='sources') $('sources').innerHTML = ev.sources.map(s=>'<div class="src"><span class="sid">['+s.id+']</span> '+escapeHtml(s.title||'')+'<br><a href="'+s.url+'" target="_blank" rel="noopener">'+escapeHtml(s.url||'')+'</a></div>').join('');
    else if(ev.type==='cost') $('cost').textContent = '$'+ev.totalUsd.toFixed(4);
    else if(ev.type==='done'){ es.close(); $('go').disabled=false; $('exp').style.display='flex'; }
    else if(ev.type==='error'){ es.close(); $('go').disabled=false; $('report').textContent='Error: '+ev.message; }
  };
  es.onerror = () => { es.close(); $('go').disabled=false; };
}
document.querySelectorAll('#exp button[data-fmt]').forEach(b => b.onclick = () => { if(taskId) window.location='/api/tasks/'+taskId+'/export?fmt='+b.dataset.fmt; });
$('genImage').onclick = () => genMedia('image_premium', false);
$('genVideo').onclick = () => genMedia('video_standard', false);
async function genMedia(alias, confirm){
  if(!taskId) return;
  const r = await fetch('/api/tasks/'+taskId+'/media',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({alias, confirm})});
  const b = await r.json();
  if(b.requiresConfirmation){ if(window.confirm('Estimated $'+b.estimateUsd.toFixed(2)+' — generate video?')) return genMedia(alias, true); return; }
  if(!b.mediaId) return;
  const box = document.createElement('div'); box.className='muted'; box.textContent='generating media…'; $('media').appendChild(box);
  const es = new EventSource('/api/media/'+b.mediaId+'/events');
  es.onmessage = (m) => { const ev = JSON.parse(m.data);
    if(ev.type==='asset'){ box.innerHTML = ev.assets.map(a => a.kind==='image'
      ? '<img src="'+a.uri+'" style="max-width:100%;border-radius:8px" />'
      : (a.posterUri?'<img src="'+a.posterUri+'" style="max-width:100%;border-radius:8px" />':'')+'<div><a href="'+a.uri+'">▶ video</a></div>').join(''); }
    else if(ev.type==='blocked'){ box.textContent='Blocked: '+ev.reason; es.close(); }
    else if(ev.type==='done'){ es.close(); }
    else if(ev.type==='error'){ box.textContent='Error: '+ev.message; es.close(); }
  };
  es.onerror = () => es.close();
}
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
boot();
</script>
</body>
</html>`;
