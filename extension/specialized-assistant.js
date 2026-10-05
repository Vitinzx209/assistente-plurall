(() => {
  if (window.top !== window) return;
  if (document.getElementById("specialized-local-assistant")) return;

  const state = { busy: false, fingerprint: "", auto: false, timer: 0, materialContext: "", materialReady: false, dragging: false, dragX: 0, dragY: 0 };
  const host = document.createElement("div");
  host.id = "specialized-local-assistant";
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}.panel{width:min(390px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 32px));overflow:auto;padding:16px;border:1px solid #7f1d1d;border-radius:16px;background:#090909;color:#f5f5f5;box-shadow:0 18px 50px #000b;font:14px/1.45 system-ui,sans-serif}.head{display:flex;justify-content:space-between;align-items:center;gap:12px}h2{margin:0;color:#f87171;font-size:16px}.badge{font-size:11px;color:#fecaca;border:1px solid #991b1b;border-radius:999px;padding:3px 8px}.status{margin:12px 0;padding:10px 12px;border-radius:10px;background:#1c1010;color:#fecaca}.status.error{background:#3b0b0b;color:#fecaca}.status.ok{background:#241010;color:#fca5a5}button{width:100%;border:0;border-radius:10px;padding:10px 12px;cursor:pointer;font:inherit;font-weight:700}button.primary{color:#fff;background:linear-gradient(135deg,#dc2626,#991b1b)}button.secondary{margin-top:10px;color:#fecaca;background:#2a1010;border:1px solid #991b1b}button:disabled{opacity:.5;cursor:not-allowed}.auto{display:flex;gap:8px;align-items:center;margin-top:11px;color:#fca5a5}.auto input{accent-color:#dc2626}.result{display:none;margin-top:14px;padding-top:14px;border-top:1px solid #7f1d1d}.result.show{display:block}.answer{display:flex;align-items:baseline;gap:10px}.letter{font-size:34px;font-weight:900;color:#ef4444}.confidence{color:#fca5a5;font-size:12px}.explanation{white-space:pre-wrap}.warning{color:#fcd34d}.privacy{color:#a3a3a3;font-size:11px}
    </style>
    <section class="panel" aria-label="Assistente de estudo Specialized">
      <div class="head"><h2 id="drag">Assistente de estudo</h2><span class="badge">Specialized • Ollama</span></div>
      <div id="status" class="status">Procurando uma questão objetiva…</div>
      <button id="analyze" class="primary">Analisar questão</button><button id="material" class="secondary">Estudar vídeo/material</button>
      <label class="auto"><input id="auto" type="checkbox"> Analisar automaticamente ao trocar de questão</label>
      <div id="result" class="result"><div class="answer"><span id="letter" class="letter">—</span><span id="confidence" class="confidence"></span></div><p id="explanation" class="explanation"></p><ul id="warnings"></ul></div>
      <p class="privacy">Lê o conteúdo da aula e processa localmente. A resposta não é enviada nem marcada automaticamente.</p>
    </section>`;
  const ui = Object.fromEntries(["status","analyze","material","auto","result","letter","confidence","explanation","warnings","drag"].map(id => [id, shadow.getElementById(id)]));
  ui.analyze.addEventListener("click", () => analyze(false));
  ui.auto.addEventListener("change", () => { state.auto = ui.auto.checked; if (state.auto) schedule(300); });
  ui.material.addEventListener("click", () => analyzeMaterial());
  ui.drag.style.cursor="move";
  ui.drag.addEventListener("pointerdown", e => { state.dragging=true; const r=host.getBoundingClientRect(); state.dragX=e.clientX-r.left; state.dragY=e.clientY-r.top; ui.drag.setPointerCapture?.(e.pointerId); });
  ui.drag.addEventListener("pointermove", e => { if(!state.dragging) return; host.style.left=`${Math.max(8,e.clientX-state.dragX)}px`; host.style.top=`${Math.max(8,e.clientY-state.dragY)}px`; host.style.right="auto"; host.style.bottom="auto"; });
  ui.drag.addEventListener("pointerup", () => { state.dragging=false; });
  const observer = new MutationObserver(() => schedule(700));
  observer.observe(document.documentElement, { childList:true, subtree:true });
  schedule(500);

  function visible(el) { if (!el || !el.getClientRects().length) return false; const s=getComputedStyle(el); return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)>.05; }
  function text(el) { return String(el?.innerText || el?.textContent || "").replace(/\s+/g," ").trim(); }
  function extract() {
    const root = [...document.querySelectorAll("main, article, [role=main], section, form")].find(visible) || document.body;
    const controls = [...root.querySelectorAll("input[type=radio], [role=radio], button")].filter(visible);
    const options = controls.map((el,i) => ({ index:i, label:String.fromCharCode(65+i), text:text(el.closest("label") || el) })).filter(x => x.text && x.text.length > 1 && !/^(next|previous|submit|continue|avançar|voltar|enviar|continuar)$/i.test(x.text));
    const lines = text(root).split(/\n+/).map(x=>x.trim()).filter(Boolean);
    const question = lines.filter(x=>!options.some(o=>x===o.text)).join("\n").slice(0,60000);
    if (options.length < 2 || !question) return null;
    const fingerprint = hash(question+options.map(o=>o.text).join("\n"));
    return { question, options:options.slice(0,12), fingerprint };
  }
  function schedule(delay) { clearTimeout(state.timer); state.timer=setTimeout(()=>{ const q=extract(); ui.analyze.disabled=state.busy||!q; if(q&&!state.busy&&state.auto&&q.fingerprint!==state.fingerprint) analyze(true); else if(q&&!state.busy&&!state.fingerprint&&!state.materialReady) status("Questão encontrada. Pronta para analisar."); },delay); }
  async function analyzeMaterial() {
    const parts = [...document.querySelectorAll("track, [class*=caption i], [class*=transcript i], [class*=subtitle i], main, article")].filter(visible);
    let material = parts.map(text).filter(x=>x.length>20).join("\n").slice(0,60000);
    const video = [...document.querySelectorAll("video")].find(visible);
    if (video) { try { status("Transcrevendo o áudio localmente…"); const blob=await fetch(video.currentSrc||video.src,{credentials:"include"}).then(r=>r.blob()); const reader=new FileReader(); const encoded=await new Promise((res,rej)=>{reader.onload=()=>res(String(reader.result).split(",")[1]||"");reader.onerror=rej;reader.readAsDataURL(blob);}); const tr=await fetch("http://127.0.0.1:8765/transcribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({video_base64:encoded})}).then(r=>r.json()); if(tr.ok&&tr.text) material=(material?material+"\n":"")+tr.text; } catch(e) { console.warn("Transcrição local indisponível",e); } }
    const imageData = await sampleVideoFrames();
    if (!material && !imageData.length) { status("Não encontrei texto nem quadros acessíveis neste vídeo.",true); return; }
    ui.material.disabled=true; state.materialReady=true; status("Estudando o material localmente…");
    try { const response=await send({type:"analyze-material",payload:{material}}); if(!response?.ok) throw Error(response?.error||"Não foi possível estudar o material."); const r=response.result||{}; ui.letter.textContent="Vídeo"; ui.confidence.textContent="Resumo preparado"; ui.explanation.textContent=[r.summary,...(r.key_points||[]).map((x,i)=>`${i+1}. ${x}`)].filter(Boolean).join("\n\n"); ui.warnings.replaceChildren(...(r.warnings||[]).map(w=>{const li=document.createElement("li");li.className="warning";li.textContent=w;return li;})); ui.result.classList.add("show"); status("Material estudado. Use o resumo para responder ao quiz.",false,"ok"); } catch(e){ status(e?.message||"Falha ao estudar o material.",true); } finally { ui.material.disabled=false; }
  }
  async function analyze(fromAuto) {
    if(state.busy) return; const q=extract(); if(!q){status("Não encontrei duas ou mais alternativas visíveis.",true);return;} state.busy=true; ui.analyze.disabled=true; status(fromAuto?"Nova questão encontrada. Analisando localmente…":"Analisando localmente…");
    try { const response=await send({type:"solve-question",payload:{question:q.question,options:q.options,image_descriptions:[],image_count:0,image_data:[]}}); if(!response?.ok) throw Error(response?.error||"Não foi possível analisar a questão."); state.fingerprint=q.fingerprint; const r=response.result||{}; ui.letter.textContent=r.option_label||String.fromCharCode(65+Number(r.option_index||0)); ui.confidence.textContent=`${Math.round(Math.max(0,Math.min(1,Number(r.confidence)||0))*100)}% de confiança`; ui.explanation.textContent=r.explanation||"Sem explicação disponível."; ui.warnings.replaceChildren(...(Array.isArray(r.warnings)?r.warnings.map(w=>{const li=document.createElement("li");li.className="warning";li.textContent=w;return li;}):[])); ui.result.classList.add("show"); status("Análise concluída. Confira a explicação e responda manualmente.",false,"ok"); } catch(e){status(e?.message||"Falha na análise.",true);} finally {state.busy=false; ui.analyze.disabled=!extract();}
  }
  function send(message){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error("A análise local demorou mais de 50 segundos.")),50000);chrome.runtime.sendMessage(message,r=>{clearTimeout(t);if(chrome.runtime.lastError)reject(Error(chrome.runtime.lastError.message));else resolve(r);});});}
  function status(message,error=false,tone=""){ui.status.textContent=message;ui.status.className=`status ${error?"error":tone}`;}
  function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
})();
