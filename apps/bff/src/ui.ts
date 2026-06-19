/** The Sprint Demo workspace page (PRD §10): input + left trace, center report, right sources/cost. */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Apolla AI Studio — Research</title>
<style>
  :root { --bd:#e5e7eb; --mut:#6b7280; --bg:#f9fafb; --ac:#2563eb; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; color:#111; }
  header { padding:.8rem 1rem; border-bottom:1px solid var(--bd); display:flex; gap:.6rem; align-items:center; }
  header b { font-size:1rem; } header .mode { font-size:.72rem; color:var(--mut); border:1px solid var(--bd); border-radius:999px; padding:.1rem .5rem; }
  .bar { display:flex; gap:.5rem; padding:.8rem 1rem; border-bottom:1px solid var(--bd); }
  .bar input { flex:1; padding:.55rem .7rem; border:1px solid var(--bd); border-radius:8px; font:inherit; }
  .bar button, .exp button { padding:.55rem .9rem; border:1px solid var(--ac); background:var(--ac); color:#fff; border-radius:8px; cursor:pointer; font:inherit; }
  .bar button:disabled { opacity:.5; cursor:default; }
  .grid { display:grid; grid-template-columns:230px 1fr 280px; gap:0; height:calc(100vh - 118px); }
  .col { overflow:auto; padding:1rem; } .col + .col { border-left:1px solid var(--bd); }
  h3 { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--mut); margin:.2rem 0 .6rem; }
  .step { font-size:.85rem; padding:.35rem .5rem; border-radius:6px; margin-bottom:.25rem; background:var(--bg); }
  .step.run { border-left:3px solid var(--ac); } .step.done { color:var(--mut); }
  #report { white-space:pre-wrap; } #report h2 { font-size:1.05rem; }
  .src { font-size:.82rem; margin-bottom:.6rem; } .src a { color:var(--ac); word-break:break-all; }
  .sid { font-family:ui-monospace,monospace; font-size:.72rem; color:var(--mut); }
  .cost { font-size:1.4rem; font-weight:600; } .exp { display:flex; gap:.4rem; margin-top:.5rem; }
  .exp button { background:#fff; color:var(--ac); } .muted { color:var(--mut); font-size:.82rem; }
</style>
</head>
<body>
<header><b>Apolla AI Studio</b><span class="mode" id="mode">…</span><span class="muted">research → cited report</span></header>
<div class="bar">
  <input id="q" placeholder="Ask a research question, e.g. “State of the EV market in 2026”" />
  <button id="go">Research</button>
</div>
<div class="grid">
  <div class="col">
    <h3>Task trace</h3><div id="trace"></div>
    <h3 style="margin-top:1rem">Plan</h3><div id="plan" class="muted">—</div>
  </div>
  <div class="col"><h3>Report</h3><div id="report" class="muted">Enter a question to begin.</div></div>
  <div class="col">
    <h3>Sources</h3><div id="sources" class="muted">—</div>
    <h3 style="margin-top:1rem">Cost</h3><div class="cost" id="cost">$0.0000</div>
    <div class="exp" id="exp" style="display:none">
      <button data-fmt="md">Export .md</button><button data-fmt="html">Export .html</button>
    </div>
  </div>
</div>
<script>
const $ = (id) => document.getElementById(id);
fetch('/api/health').then(r=>r.json()).then(h=>{ $('mode').textContent = h.mode === 'real' ? 'live models' : 'demo mode'; });
let taskId = null;

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
  $('report').textContent=''; $('report').className=''; $('sources').textContent='—';
  $('cost').textContent='$0.0000'; $('exp').style.display='none';
  const res = await fetch('/api/tasks', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ question:q }) });
  taskId = (await res.json()).taskId;
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
document.querySelectorAll('#exp button').forEach(b => b.onclick = () => { if(taskId) window.location='/api/tasks/'+taskId+'/export?fmt='+b.dataset.fmt; });
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body>
</html>`;
