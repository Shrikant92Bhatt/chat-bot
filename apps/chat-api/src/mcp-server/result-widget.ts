/**
 * Optional Apps SDK UI for the remote MCP tools (plan §9): one generic,
 * self-contained widget that renders a tool's structuredContent (the same
 * ConnectorResultCardData the NexusAI UI renders) as a list or table with
 * source links. Tools work without it - it only improves the ChatGPT view.
 *
 * Builds DOM with textContent only (no innerHTML) because the data is
 * provider content, and only renders http(s) links.
 */

export const WIDGET_URI = 'ui://widget/nexus-result.html';
/** OpenAI Apps SDK widget mime type. */
export const WIDGET_MIME_TYPE = 'text/html+skybridge';

export const WIDGET_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--fg:#0f172a;--muted:#64748b;--border:#e2e8f0;--bg:#fff;--accent:#0891b2}
@media (prefers-color-scheme:dark){:root{--fg:#e2e8f0;--muted:#94a3b8;--border:#1e293b;--bg:#0b1120;--accent:#22d3ee}}
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg)}
.wrap{padding:12px 14px}h1{font-size:15px;margin:0 0 4px}.sum{color:var(--muted);margin:0 0 10px}
ul{list-style:none;margin:0;padding:0}li{border-top:1px solid var(--border);padding:8px 0}
.row{display:flex;gap:8px;align-items:baseline;justify-content:space-between}.badge{font-size:11px;border:1px solid var(--border);border-radius:999px;padding:1px 8px;color:var(--muted);white-space:nowrap}
.sub,.meta{color:var(--muted);font-size:12px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--border);padding:4px 6px;text-align:left}
.err{color:#dc2626}.src{margin-top:10px;font-size:12px;color:var(--muted)}
</style></head>
<body><div class="wrap" id="root"><p class="sum">Loading…</p></div>
<script>
(function(){
  function el(tag, text, cls){var n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;}
  function safeUrl(u){try{var x=new URL(u);return (x.protocol==='https:'||x.protocol==='http:')?x.href:null;}catch(e){return null;}}
  function link(text,url){var u=safeUrl(url);if(!u)return el('span',text);var a=el('a',text);a.href=u;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function render(data){
    var root=document.getElementById('root');root.textContent='';
    if(!data){root.appendChild(el('p','No data.','sum'));return;}
    var d=data.display||{};
    root.appendChild(el('h1',d.title||data.toolName||'Result'));
    if(data.error){root.appendChild(el('p',data.error.message,'err'));return;}
    if(d.summary)root.appendChild(el('p',d.summary,'sum'));
    var items=d.items||[];
    if(items.length){var ul=el('ul');items.forEach(function(it){var li=el('li');var row=el('div',null,'row');row.appendChild(link(it.title,it.url));if(it.badge)row.appendChild(el('span',it.badge,'badge'));li.appendChild(row);if(it.subtitle)li.appendChild(el('div',it.subtitle,'sub'));(it.meta||[]).forEach(function(m){li.appendChild(el('div',m.label+': '+m.value,'meta'));});ul.appendChild(li);});root.appendChild(ul);}
    if(d.table&&d.table.columns){var t=el('table');var tr=el('tr');d.table.columns.forEach(function(c){tr.appendChild(el('th',c));});t.appendChild(tr);(d.table.rows||[]).forEach(function(r){var row=el('tr');r.forEach(function(c){row.appendChild(el('td',c==null?'':c));});t.appendChild(row);});root.appendChild(t);}
    if(!items.length&&!(d.table&&d.table.rows&&d.table.rows.length))root.appendChild(el('p',d.emptyMessage||'Nothing found.','sum'));
    if(data.truncated)root.appendChild(el('p','Some results were omitted to keep this short.','sum'));
    if(data.sources&&data.sources.length){var s=el('div',null,'src');s.appendChild(el('span','Sources: '));data.sources.slice(0,5).forEach(function(src,i){if(i)s.appendChild(el('span',' · '));s.appendChild(link(src.title,src.url));});root.appendChild(s);}
  }
  function current(){return window.openai&&window.openai.toolOutput;}
  render(current());
  window.addEventListener('openai:set_globals',function(){render(current());});
})();
</script></body></html>`;
