
(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const workspace = document.querySelector('.workspace');

  function setSidebarState(side, collapsed){
    workspace.classList.toggle(side === 'left' ? 'left-collapsed' : 'right-collapsed', collapsed);
    const key = side === 'left' ? 'satStudioLeftCollapsed' : 'satStudioRightCollapsed';
    try{localStorage.setItem(key, collapsed ? '1' : '0');}catch(e){}
    updateSidebarButtons();
  }
  function updateSidebarButtons(){
    const left = workspace.classList.contains('left-collapsed');
    const right = workspace.classList.contains('right-collapsed');
    $('#toggleLeftSidebar').innerHTML = `<i class="bi ${left ? 'bi-layout-sidebar' : 'bi-layout-sidebar-inset'}"></i>`;
    $('#toggleLeftSidebar').title = left ? 'Show questions sidebar' : 'Hide questions sidebar';
    $('#toggleRightSidebar').innerHTML = `<i class="bi ${right ? 'bi-layout-sidebar-reverse' : 'bi-layout-sidebar-inset-reverse'}"></i>`;
    $('#toggleRightSidebar').title = right ? 'Show editor sidebar' : 'Hide editor sidebar';
    $('#collapseLeft').innerHTML = `<i class="bi ${left ? 'bi-chevron-right' : 'bi-chevron-left'}"></i>`;
    $('#collapseRight').innerHTML = `<i class="bi ${right ? 'bi-chevron-left' : 'bi-chevron-right'}"></i>`;
  }

  const domains = {
    rw: [
      "Information and Ideas",
      "Craft and Structure",
      "Expression of Ideas",
      "Standard English Conventions"
    ],
    math: [
      "Algebra",
      "Advanced Math",
      "Problem-Solving and Data Analysis",
      "Geometry and Trigonometry"
    ]
  };

  const defaultSource =
`Nellie Bly was an American investigative journalist well-known for an exposé she wrote after spending 10 days undercover in a mental institution. _____ she set a record for traveling around the world in 72 days, a journey based on the work of Jules Verne.

Which choice completes the text with the most logical transition?

A) As a result,
B) Likewise,
C) Thus,
D) Additionally,`;

  let questions = [{
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    number: 4,
    title: "Transition — logical connection",
    type: "mcq",
    section: "rw",
    difficulty: "Medium",
    domain: "Expression of Ideas",
    skill: "Transitions",
    review: false,
    annotationsEnabled: true,
    showChoices: true,
    source: defaultSource,
    answer: "D",
    figure: null,
    annotations: []
  }];

  let activeIndex = 0;
  let currentTool = "pen";
  let drawing = false;
  let startPoint = null;
  let activePath = null;
  let undoStack = [];
  let redoStack = [];

  const source = $("#sourceEditor");
  const rendered = $("#renderedQuestion");
  const figureBox = $("#figureBox");
  const annotationLayer = $("#annotationLayer");
  const svg = $("#annotationSvg");

  function current(){ return questions[activeIndex]; }

  function toast(msg){
    const el = $("#status");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(()=>el.classList.remove("show"), 1700);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  // Markdown + real LaTeX + MathML. MathJax performs the actual rendering.
  function formatText(s){
    const mathml=[];
    let raw=String(s).replace(/<math\b[\s\S]*?<\/math>/gi,m=>{
      const id=`@@MATHML_${mathml.length}@@`; mathml.push(m); return id;
    });
    let x=escapeHtml(raw);
    x=x.replace(/`([^`]+)`/g,"<code>$1</code>");
    x=x.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
    x=x.replace(/\*([^*]+)\*/g,"<em>$1</em>");
    x=x.replace(/\n/g,"<br>");
    mathml.forEach((m,i)=>{x=x.replace(`@@MATHML_${i}@@`,m);});
    return x;
  }

  function typesetMath(root=document){
    if(window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise([root]).catch(()=>{});
    }
  }

  function parseSource(text){
    const lines = text.replace(/\r/g,"").split("\n");
    const choices = [];
    let stem = [];
    let active = null;

    for(const line of lines){
      const m = line.match(/^\s*([A-D])\)\s*(.*)$/i);
      if(m){
        active = {letter:m[1].toUpperCase(), text:m[2]};
        choices.push(active);
      } else if(active){
        if(line.trim()) active.text += "\n" + line.trim();
      } else {
        stem.push(line);
      }
    }
    return {stem:stem.join("\n").trim(), choices};
  }

  function render(){
    const q = current();
    $("#editorTitle").textContent = `Question ${q.number || activeIndex + 1}`;
    $("#paperNumber").textContent = q.number || activeIndex + 1;
    $("#paperTopic").textContent = q.title || q.skill || q.domain || "Untitled question";
    $("#numberInput").value = q.number || activeIndex + 1;
    $("#typeBadge").textContent = q.type === "mcq" ? "MCQ" : "Student Response";
    $("#sectionBadge").textContent = q.section === "rw" ? "Reading & Writing" : "Math";

    $("#reviewCheck").checked = q.review;
    $("#reviewCheck2").checked = q.review;
    $("#annotationSwitch").checked = q.annotationsEnabled;
    $("#choicesSwitch").checked = q.showChoices;

    source.value = q.source;
    $("#titleInput").value = q.title;
    $("#difficultyInput").value = q.difficulty;
    $("#skillInput").value = q.skill;
    $("#answerInput").value = q.answer || "";

    setSegments();
    populateDomains(false);
    $("#domainInput").value = q.domain;

    const parsed = parseSource(q.source);
    let html = `<div class="prompt">${formatText(parsed.stem)}</div>`;

    if(q.type === "mcq" && q.showChoices){
      html += parsed.choices.map(c =>
        `<div class="choice ${q.graded && q.answer===c.letter ? "correct":""} ${q.studentAnswer===c.letter ? "selected-answer":""} ${(q.eliminated||[]).includes(c.letter) ? "eliminated":""} ${q.graded && q.studentAnswer===c.letter && q.answer!==c.letter ? "incorrect-answer":""}" data-letter="${c.letter}">
          <span class="choice-letter">${c.letter}</span>
          <span>${formatText(c.text)}</span>
          <button type="button" class="eliminate-btn ${(q.eliminated||[]).includes(c.letter)?"active":""}" data-eliminate="${c.letter}" title="Eliminate option ${c.letter}" aria-label="Eliminate option ${c.letter}"><i class="fa-solid fa-ban"></i></button>
          ${q.graded && q.answer===c.letter ? '<span class="answer-badge"><i class="fa-solid fa-check"></i> Correct</span>':""}
        </div>`
      ).join("");
    } else if(q.type === "sr"){
      html += `<div class="sr-answer">Student response</div>`;
    }

    rendered.innerHTML = html;
    if(Array.isArray(q.highlights) && q.highlights.length) q.highlights.forEach(h=>applySavedHighlight(rendered,h.text,h.color));
    else if(q.highlightedText) applySavedHighlight(rendered,q.highlightedText,"#ffd400");
    if(Array.isArray(q.underlines)) q.underlines.forEach(text=>applySavedUnderline(rendered,text));
    renderPracticePanel();
    $("#questionNotes").value = q.notes || "";
    typesetMath(rendered);

    if(q.figure){
      figureBox.classList.remove("empty");
      figureBox.innerHTML = `<img src="${q.figure}" alt="Question figure">`;
    } else {
      figureBox.classList.add("empty");
      figureBox.innerHTML = "";
    }

    annotationLayer.classList.toggle("active", q.annotationsEnabled);
    document.body.classList.toggle('annotation-disabled', !q.annotationsEnabled);
    $('#annotationState').textContent = q.annotationsEnabled ? 'ON' : 'OFF';
    $('#annotationToggle').title = q.annotationsEnabled ? 'Disable annotations' : 'Enable annotations';
    $('#annotationToggle').classList.toggle('active', q.annotationsEnabled);
    $('#annotationToggle').innerHTML = `<i class="bi ${q.annotationsEnabled ? 'bi-pencil-square' : 'bi-pencil-square'}"></i>`;
    drawAnnotations();
    updateList();
  }

  function updateList(){
    const list = $("#questionList");
    list.innerHTML = "";
    questions.forEach((q,i)=>{
      const parsed = parseSource(q.source);
      const item = document.createElement("div");
      item.className = "q-item" + (i===activeIndex ? " active":"");
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <span class="q-number">${q.number || i+1}. ${escapeHtml(q.title || "Untitled")}</span>
          <span class="badge badge-soft">${q.type==="mcq"?"MCQ":"SR"}</span>
        </div>
        <div class="q-meta">${q.section==="rw"?"Reading & Writing":"Math"} · ${q.difficulty}</div>
        <small>${escapeHtml(parsed.stem.slice(0,85))}</small>`;
      item.onclick = ()=>{activeIndex=i; render();};
      list.appendChild(item);
    });
    $("#countLabel").textContent = `(${questions.length})`;
  }

  function setSegments(){
    $$("#typeSeg button").forEach(b=>b.classList.toggle("active",b.dataset.type===current().type));
    $$("#sectionSeg button").forEach(b=>b.classList.toggle("active",b.dataset.section===current().section));
  }

  function populateDomains(reset=true){
    const q=current();
    const select=$("#domainInput");
    select.innerHTML = domains[q.section].map(d=>`<option>${escapeHtml(d)}</option>`).join("");
    if(reset) q.domain=domains[q.section][0];
  }

  function mutate(key,value){
    current()[key]=value;
    render();
  }

  function autosave(){
    try{localStorage.setItem("sat-question-maker-v1",JSON.stringify(questions));}catch(e){}
  }

  // ----- Sidebar collapse / expand -----
  $('#toggleLeftSidebar').onclick=()=>setSidebarState('left',!workspace.classList.contains('left-collapsed'));
  $('#toggleRightSidebar').onclick=()=>setSidebarState('right',!workspace.classList.contains('right-collapsed'));
  $('#collapseLeft').onclick=()=>setSidebarState('left',true);
  $('#collapseRight').onclick=()=>setSidebarState('right',true);
  $('#reopenLeft').onclick=()=>setSidebarState('left',false);
  $('#reopenRight').onclick=()=>setSidebarState('right',false);
  try{
    if(localStorage.getItem('satStudioLeftCollapsed')==='1') workspace.classList.add('left-collapsed');
    if(localStorage.getItem('satStudioRightCollapsed')==='1') workspace.classList.add('right-collapsed');
  }catch(e){}
  updateSidebarButtons();

  // ----- Question controls -----
  $("#renderBtn").onclick=()=>{ current().source=source.value; autosave(); render(); toast("Question rendered"); };
  source.addEventListener("input",()=>{ current().source=source.value; autosave(); });
  $("#numberInput").addEventListener("input",e=>{
    const n=Math.max(1,parseInt(e.target.value||"1",10));
    current().number=n; autosave();
    $("#paperNumber").textContent=n;
    $("#editorTitle").textContent=`Question ${n}`;
    updateList();
  });
  $("#titleInput").addEventListener("input",e=>{
    current().title=e.target.value; autosave();
    $("#paperTopic").textContent=current().title || current().skill || current().domain || "Untitled question";
    updateList();
  });
  $("#difficultyInput").onchange=e=>{current().difficulty=e.target.value;autosave();updateList();};
  $("#domainInput").onchange=e=>{current().domain=e.target.value;autosave();};
  $("#skillInput").oninput=e=>{current().skill=e.target.value;autosave();updateList();};
  $("#answerInput").onchange=e=>{current().answer=e.target.value;autosave();render();};

  $("#reviewCheck").onchange=e=>{current().review=e.target.checked;autosave();$("#reviewCheck2").checked=e.target.checked;};
  $("#reviewCheck2").onchange=e=>{current().review=e.target.checked;autosave();$("#reviewCheck").checked=e.target.checked;};

  $("#annotationSwitch").onchange=e=>{current().annotationsEnabled=e.target.checked;autosave();render();toast(e.target.checked?'Annotations enabled':'Annotations disabled');};
  $("#choicesSwitch").onchange=e=>{current().showChoices=e.target.checked;render();};

  $$("#typeSeg button").forEach(b=>b.onclick=()=>{
    current().type=b.dataset.type;
    if(current().type==="sr") current().answer="";
    render();
  });

  $$("#sectionSeg button").forEach(b=>b.onclick=()=>{
    current().section=b.dataset.section;
    populateDomains(true);
    render();
  });

  $("#addQuestion").onclick=()=>{
    questions.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      number: questions.length + 1,
      title:"Untitled question", type:"mcq", section:"rw", difficulty:"Medium",
      domain:domains.rw[0], skill:"", review:false, annotationsEnabled:true,
      showChoices:true,
      source:"Write your question here.\n\nA) First choice\nB) Second choice\nC) Third choice\nD) Fourth choice",
      answer:"", figure:null, annotations:[]
    });
    activeIndex=questions.length-1;
    render();
    toast("New question added");
  };

  $("#duplicateBtn").onclick=()=>{
    const copy=JSON.parse(JSON.stringify(current()));
    copy.id=crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    copy.title=(copy.title||"Untitled")+" — copy";
    questions.splice(activeIndex+1,0,copy);
    activeIndex++;
    render(); toast("Question duplicated");
  };

  $("#newBtn").onclick=()=>{
    if(confirm("Start a new question set?")){
      questions=[]; $("#addQuestion").click();
    }
  };

  // ----- CRUD: create / read / update / delete -----
  function deleteCurrentQuestion(){
    if(questions.length===1){
      if(!confirm("Delete the only question and create a blank question?")) return;
      questions[0]={...questions[0],number:1,title:"Untitled question",source:"Write your question here.",answer:"",figure:null,annotations:[]};
      activeIndex=0; render(); toast("Question reset"); return;
    }
    if(!confirm(`Delete question ${current().number || activeIndex+1}?`)) return;
    questions.splice(activeIndex,1);
    activeIndex=Math.min(activeIndex,questions.length-1);
    autosave(); render(); toast("Question deleted");
  }
  function setReadOnly(on){
    document.body.classList.toggle("read-only",on);
    const ids=["sourceEditor","numberInput","titleInput","difficultyInput","domainInput","skillInput","answerInput","reviewCheck2","annotationSwitch","choicesSwitch"];
    ids.forEach(id=>{const el=$("#"+id);if(el)el.disabled=on;});
    $("#typeSeg").querySelectorAll("button").forEach(b=>b.disabled=on);
    $("#sectionSeg").querySelectorAll("button").forEach(b=>b.disabled=on);
    toast(on?"Read-only preview enabled":"Editing enabled");
  }
  $("#deleteBtn").onclick=deleteCurrentQuestion;
  $("#readBtn").onclick=()=>setReadOnly(!document.body.classList.contains("read-only"));
  $("#crudCreate").onclick=()=>$("#addQuestion").click();
  $("#crudRead").onclick=()=>setReadOnly(true);
  $("#crudUpdate").onclick=()=>{current().source=source.value;autosave();render();toast("Question updated");};
  $("#crudDelete").onclick=deleteCurrentQuestion;

  // ----- Figure upload/drop -----
  $("#uploadFigure").onclick=()=>$("#figureInput").click();
  $("#dropzone").addEventListener("dragover",e=>{e.preventDefault();$("#dropzone").style.borderColor="#111";});
  $("#dropzone").addEventListener("dragleave",()=>$("#dropzone").style.borderColor="");
  $("#dropzone").addEventListener("drop",e=>{
    e.preventDefault();$("#dropzone").style.borderColor="";
    const f=e.dataTransfer.files[0]; if(f) readFigure(f);
  });
  $("#figureInput").onchange=e=>{const f=e.target.files[0];if(f)readFigure(f);};
  function readFigure(file){
    if(!file.type.startsWith("image/")) return toast("Please choose an image");
    const reader=new FileReader();
    reader.onload=()=>{current().figure=reader.result;autosave();render();toast("Figure added");};
    reader.readAsDataURL(file);
  }
  $("#removeFigure").onclick=()=>{current().figure=null;autosave();render();toast("Figure removed");};
  $("#drawFigure").onclick=()=>{
    $("#whiteboardWrap").classList.add("show");
    toast("Draw in Web Whiteboard, export an image there, then use Add figure to attach it here");
  };

  // ----- Annotation engine: SVG overlay, touch/stylus friendly -----
  function pointFromEvent(e){
    const r=svg.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top};
  }
  function svgEl(name,attrs={}){
    const el=document.createElementNS("http://www.w3.org/2000/svg",name);
    Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));
    return el;
  }
  function pushUndo(){
    undoStack.push(JSON.stringify(current().annotations||[]));
    redoStack=[];
    if(undoStack.length>30)undoStack.shift();
  }
  function saveAnn(){
    current().annotations=[...svg.children].map(el=>el.outerHTML); autosave();
  }
  function restoreFromHtml(arr){
    svg.innerHTML="";
    (arr||[]).forEach(s=>svg.insertAdjacentHTML("beforeend",s));
  }
  function drawAnnotations(){
    restoreFromHtml(current().annotations||[]);
  }

  $$(".tool-btn[data-tool]").forEach(btn=>{
    btn.onclick=()=>{
      $$(".tool-btn[data-tool]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      currentTool=btn.dataset.tool;
      annotationLayer.classList.toggle("active",current().annotationsEnabled);
      annotationLayer.style.cursor = currentTool === "select" ? "default" : "crosshair";
    };
  });

  annotationLayer.addEventListener("pointerdown",e=>{
    if(!current().annotationsEnabled || currentTool==="select")return;
    e.preventDefault();
    annotationLayer.setPointerCapture(e.pointerId);
    drawing=true;
    startPoint=pointFromEvent(e);
    pushUndo();

    const color=$("#inkColor").value;
    const width=+$("#inkSize").value;

    if(currentTool==="pen" || currentTool==="highlighter"){
      activePath=svgEl("path",{
        d:`M ${startPoint.x} ${startPoint.y}`,
        fill:"none",stroke:color,"stroke-width":currentTool==="highlighter"?width*4:width,
        "stroke-linecap":"round","stroke-linejoin":"round",
        opacity:currentTool==="highlighter"?.28:1
      });
      svg.appendChild(activePath);
    } else if(currentTool==="line" || currentTool==="arrow"){
      activePath=svgEl("line",{x1:startPoint.x,y1:startPoint.y,x2:startPoint.x,y2:startPoint.y,
        stroke:color,"stroke-width":width,"stroke-linecap":"round"});
      if(currentTool==="arrow")activePath.setAttribute("marker-end","url(#arrowhead)");
      ensureDefs();
      svg.appendChild(activePath);
    } else if(currentTool==="rect"){
      activePath=svgEl("rect",{x:startPoint.x,y:startPoint.y,width:0,height:0,
        fill:"none",stroke:color,"stroke-width":width,rx:2});
      svg.appendChild(activePath);
    } else if(currentTool==="ellipse"){
      activePath=svgEl("ellipse",{cx:startPoint.x,cy:startPoint.y,rx:0,ry:0,
        fill:"none",stroke:color,"stroke-width":width});
      svg.appendChild(activePath);
    } else if(currentTool==="text"){
      const t=prompt("Annotation text:");
      if(t){
        const textEl=svgEl("text",{x:startPoint.x,y:startPoint.y,fill:color,
          "font-size":"18","font-family":"DM Sans, sans-serif","font-weight":"600"});
        textEl.textContent=t; svg.appendChild(textEl); saveAnn();
      }
      drawing=false;
    }
  });

  annotationLayer.addEventListener("pointermove",e=>{
    if(!drawing)return;
    const p=pointFromEvent(e);
    if(currentTool==="pen" || currentTool==="highlighter"){
      activePath.setAttribute("d",activePath.getAttribute("d")+` L ${p.x} ${p.y}`);
    } else if(currentTool==="line" || currentTool==="arrow"){
      activePath.setAttribute("x2",p.x);activePath.setAttribute("y2",p.y);
    } else if(currentTool==="rect"){
      activePath.setAttribute("x",Math.min(startPoint.x,p.x));
      activePath.setAttribute("y",Math.min(startPoint.y,p.y));
      activePath.setAttribute("width",Math.abs(p.x-startPoint.x));
      activePath.setAttribute("height",Math.abs(p.y-startPoint.y));
    } else if(currentTool==="ellipse"){
      activePath.setAttribute("cx",(startPoint.x+p.x)/2);
      activePath.setAttribute("cy",(startPoint.y+p.y)/2);
      activePath.setAttribute("rx",Math.abs(p.x-startPoint.x)/2);
      activePath.setAttribute("ry",Math.abs(p.y-startPoint.y)/2);
    }
  });
  annotationLayer.addEventListener("pointerup",()=>{
    if(!drawing)return;
    drawing=false;saveAnn();activePath=null;
  });
  annotationLayer.addEventListener("pointercancel",()=>{
    drawing=false;activePath=null;
  });

  function ensureDefs(){
    if(svg.querySelector("#arrowhead"))return;
    const defs=svgEl("defs");
    const marker=svgEl("marker",{id:"arrowhead",markerWidth:"8",markerHeight:"8",refX:"7",refY:"3.5",orient:"auto"});
    marker.appendChild(svgEl("path",{d:"M0,0 L0,7 L8,3.5 z",fill:$("#inkColor").value}));
    defs.appendChild(marker);svg.appendChild(defs);
  }

  $("#undoAnn").onclick=()=>{
    const before=undoStack.pop();
    if(before!==undefined){
      redoStack.push(JSON.stringify(current().annotations||[]));
      current().annotations=JSON.parse(before);drawAnnotations();
    }
  };
  $("#redoAnn").onclick=()=>{
    const next=redoStack.pop();
    if(next!==undefined){
      undoStack.push(JSON.stringify(current().annotations||[]));
      current().annotations=JSON.parse(next);drawAnnotations();
    }
  };
  $("#eraseAnn").onclick=()=>{
    pushUndo();svg.innerHTML="";saveAnn();toast("Annotations cleared");
  };
  $("#clearAnnotationsBtn").onclick=()=>$("#eraseAnn").click();

  $("#annotationToggle").onclick=()=>{
    current().annotationsEnabled=!current().annotationsEnabled;
    autosave();
    render();
    toast(current().annotationsEnabled ? 'Annotations enabled' : 'Annotations disabled');
  };

  // ----- Geometry Constructor -----
  const geoSvg = $("#geometrySvg");
  const geoModal = $("#geometryModal");
  let geoTool="select", geoObjects=[], geoHistory=[], geoRedo=[], geoPending=[], geoSelected=null, geoGridOn=true;
  const GEO_W=1000,GEO_H=620;

  function geoSave(){
    geoHistory.push(JSON.stringify(geoObjects));
    if(geoHistory.length>40)geoHistory.shift();
    geoRedo=[];
  }
  function geoPoint(e){
    const r=geoSvg.getBoundingClientRect();
    let x=(e.clientX-r.left)/r.width*GEO_W, y=(e.clientY-r.top)/r.height*GEO_H;
    if($("#geoSnap").checked){ const g=20; x=Math.round(x/g)*g; y=Math.round(y/g)*g; }
    return {x,y};
  }
  function geoDist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
  function geoEl(tag,attrs={}){const e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
  function geoBase(){
    geoSvg.innerHTML="";
    if(geoGridOn){
      const g=geoEl("g",{class:"geo-grid-layer"});
      for(let x=0;x<=GEO_W;x+=20)g.appendChild(geoEl("line",{x1:x,y1:0,x2:x,y2:GEO_H,class:"geo-grid"}));
      for(let y=0;y<=GEO_H;y+=20)g.appendChild(geoEl("line",{x1:0,y1:y,x2:GEO_W,y2:y,class:"geo-grid"}));
      g.appendChild(geoEl("line",{x1:0,y1:GEO_H/2,x2:GEO_W,y2:GEO_H/2,class:"geo-axis"}));
      g.appendChild(geoEl("line",{x1:GEO_W/2,y1:0,x2:GEO_W/2,y2:GEO_H,class:"geo-axis"}));
      geoSvg.appendChild(g);
    }
    geoObjects.forEach((o,i)=>geoRenderObject(o,i));
  }
  function geoRenderObject(o,i){
    const g=geoEl("g",{class:"geo-object-group","data-index":i});
    const cls=o.selected?"geo-object geo-selected":"geo-object";
    if(o.type==="point"){
      g.appendChild(geoEl("circle",{cx:o.p.x,cy:o.p.y,r:6,class:"geo-point"}));
      if(o.label)g.appendChild(geoEl("text",{x:o.p.x+9,y:o.p.y-9,class:"geo-label"}));
    } else if(o.type==="segment"){
      g.appendChild(geoEl("line",{x1:o.a.x,y1:o.a.y,x2:o.b.x,y2:o.b.y,class:cls}));
    } else if(["line","ray","perpendicular","parallel"].includes(o.type)){
      const p=o.a,d=o.d,L=1500;
      let t1=-L,t2=L;
      if(o.type==="ray")t1=0;
      g.appendChild(geoEl("line",{x1:p.x+d.x*t1,y1:p.y+d.y*t1,x2:p.x+d.x*t2,y2:p.y+d.y*t2,class:cls}));
    } else if(o.type==="circle"){
      g.appendChild(geoEl("circle",{cx:o.c.x,cy:o.c.y,r:o.r,class:cls}));
      g.appendChild(geoEl("circle",{cx:o.c.x,cy:o.c.y,r:5,class:"geo-point"}));
      if(o.label)g.appendChild(geoEl("text",{x:o.c.x+9,y:o.c.y-9,class:"geo-label"}));
    } else if(o.type==="rect"){
      g.appendChild(geoEl("rect",{x:o.x,y:o.y,width:o.w,height:o.h,class:cls}));
    } else if(o.type==="polygon"){
      g.appendChild(geoEl("polygon",{points:o.points.map(p=>`${p.x},${p.y}`).join(" "),class:cls}));
    } else if(o.type==="angle"){
      g.appendChild(geoEl("line",{x1:o.v.x,y1:o.v.y,x2:o.a.x,y2:o.a.y,class:cls}));
      g.appendChild(geoEl("line",{x1:o.v.x,y1:o.v.y,x2:o.b.x,y2:o.b.y,class:cls}));
      const r=35, a1=Math.atan2(o.a.y-o.v.y,o.a.x-o.v.x), a2=Math.atan2(o.b.y-o.v.y,o.b.x-o.v.x);
      const p1={x:o.v.x+r*Math.cos(a1),y:o.v.y+r*Math.sin(a1)},p2={x:o.v.x+r*Math.cos(a2),y:o.v.y+r*Math.sin(a2)};
      const delta=((a2-a1+Math.PI*3)%(Math.PI*2))-Math.PI, large=Math.abs(delta)>Math.PI?1:0, sweep=delta>0?1:0;
      g.appendChild(geoEl("path",{d:`M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} ${sweep} ${p2.x} ${p2.y}`,class:cls}));
    } else if(o.type==="label"){
      g.appendChild(geoEl("text",{x:o.p.x,y:o.p.y,class:"geo-label"}));
    }
    const txt=g.querySelector("text"); if(txt&&o.label)txt.textContent=o.label; if(txt&&o.type==="label")txt.textContent=o.text;
    g.addEventListener("pointerdown",ev=>{if(geoTool!=="select")return;ev.stopPropagation();geoSelected=i;geoObjects.forEach(x=>x.selected=false);o.selected=true;geoBase();});
    geoSvg.appendChild(g);
  }
  function geoOpen(){geoModal.classList.add("show");geoModal.setAttribute("aria-hidden","false");geoBase();}
  function geoClose(){geoModal.classList.remove("show");geoModal.setAttribute("aria-hidden","true");}
  function geoToolSet(t){geoTool=t;geoPending=[];$("#geoStatus").textContent={
    select:"Select an object.",point:"Click to place a point.",segment:"Click two points for a segment.",line:"Click two points for an infinite line.",ray:"Click two points for a ray.",circle:"Click the CENTER first, then a point on the circumference.",rect:"Click two opposite corners.",polygon:"Click vertices; double-click the last vertex to close.",angle:"Click point A, then VERTEX, then point B.",perpendicular:"Click the point, then two points defining the base line.",parallel:"Click the point, then two points defining the reference line.",label:"Click a point and enter its label."}[t]||"";}
  $$("[data-geo]").forEach(b=>b.onclick=()=>{$$("[data-geo]").forEach(x=>x.classList.remove("active"));b.classList.add("active");geoToolSet(b.dataset.geo);});
  $("#geometryBtn").onclick=geoOpen; $("#openGeometry").onclick=geoOpen; $("#closeGeometry").onclick=geoClose;
  $("#geoGrid").onclick=()=>{geoGridOn=!geoGridOn;geoBase();};
  $("#clearGeometry").onclick=()=>{geoSave();geoObjects=[];geoSelected=null;geoPending=[];geoBase();};
  $("#geoDelete").onclick=()=>{if(geoSelected!=null){geoSave();geoObjects.splice(geoSelected,1);geoSelected=null;geoBase();}};
  $("#geoUndo").onclick=()=>{if(!geoHistory.length)return;geoRedo.push(JSON.stringify(geoObjects));geoObjects=JSON.parse(geoHistory.pop());geoBase();};
  $("#geoRedo").onclick=()=>{if(!geoRedo.length)return;geoHistory.push(JSON.stringify(geoObjects));geoObjects=JSON.parse(geoRedo.pop());geoBase();};

  function normalizedLine(a,b){const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy)||1;return {x:dx/L,y:dy/L};}
  geoSvg.addEventListener("pointermove",e=>{const p=geoPoint(e);$("#geoCoords").textContent=`${Math.round(p.x)}, ${Math.round(p.y)}`;});
  geoSvg.addEventListener("dblclick",e=>{
    if(geoTool!=="polygon"||geoPending.length<3)return;
    e.preventDefault();geoSave();geoObjects.push({type:"polygon",points:[...geoPending]});geoPending=[];geoBase();
  });
  geoSvg.addEventListener("pointerdown",e=>{
    if(geoTool==="select")return;
    const p=geoPoint(e);geoPending.push(p);
    if(geoTool==="point"){
      geoSave();geoObjects.push({type:"point",p});geoPending=[];geoBase();
    } else if(geoTool==="circle"&&geoPending.length===2){
      geoSave();geoObjects.push({type:"circle",c:geoPending[0],r:geoDist(geoPending[0],geoPending[1]),label:""});geoPending=[];geoBase();
    } else if((geoTool==="segment"||geoTool==="line"||geoTool==="ray")&&geoPending.length===2){
      geoSave();const [a,b]=geoPending,d=normalizedLine(a,b);geoObjects.push(geoTool==="segment"?{type:"segment",a,b}:{type:geoTool,a,d});geoPending=[];geoBase();
    } else if(geoTool==="rect"&&geoPending.length===2){
      const [a,b]=geoPending;geoSave();geoObjects.push({type:"rect",x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)});geoPending=[];geoBase();
    } else if(geoTool==="angle"&&geoPending.length===3){geoSave();geoObjects.push({type:"angle",a:geoPending[0],v:geoPending[1],b:geoPending[2]});geoPending=[];geoBase();
    } else if((geoTool==="perpendicular"||geoTool==="parallel")&&geoPending.length===3){
      const [p0,a,b]=geoPending,base=normalizedLine(a,b),d=geoTool==="parallel"?base:{x:-base.y,y:base.x};
      geoSave();geoObjects.push({type:geoTool,a:p0,d});geoPending=[];geoBase();
    } else if(geoTool==="label"){
      const text=prompt("Label:");if(text){geoSave();geoObjects.push({type:"label",p,text});}geoPending=[];geoBase();
    }
  });
  $("#useGeometryFigure").onclick=()=>{
    const clone=geoSvg.cloneNode(true);clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width",GEO_W);clone.setAttribute("height",GEO_H);
    const svgText=new XMLSerializer().serializeToString(clone);
    const data="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgText);
    current().figure=data;autosave();render();geoClose();toast("Geometry figure added to question");
  };

  // ----- Web Whiteboard (external hosted app) -----
  const whiteboardUrl = "https://webwhiteboard.com/";
  $("#whiteboardBtn").onclick=()=>{
    $("#whiteboardWrap").classList.toggle("show");
    if($("#whiteboardWrap").classList.contains("show")) toast("Web Whiteboard opened");
  };
  $("#closeWhiteboard").onclick=()=>$("#whiteboardWrap").classList.remove("show");
  $("#whiteboardPopout").onclick=()=>window.open(whiteboardUrl,"_blank","noopener,noreferrer");

  // ----- Persistence / export -----
  $("#saveBtn").onclick=()=>{
    localStorage.setItem("sat-question-maker-v1",JSON.stringify(questions));
    toast("Question set saved locally");
  };
  $("#importBtn").onclick=()=>$("#importFile").click();
  $("#importJson").onclick=()=>$("#importFile").click();
  $("#importFile").onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        if(!Array.isArray(data))throw new Error();
        questions=data;activeIndex=0;render();toast("Question set imported");
      }catch{toast("Invalid JSON file");}
    };
    reader.readAsText(f);
  };
  $("#exportJson").onclick=()=>{
    const blob=new Blob([JSON.stringify(questions,null,2)],{type:"application/json"});
    downloadBlob(blob,"sat-question-set.json");
  };
  function downloadBlob(blob,name){
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // ----- Professional PDF export -----
  const pdfModalEl = document.getElementById("pdfExportModal");
  const pdfModal = window.bootstrap ? new bootstrap.Modal(pdfModalEl) : null;

  function renderPdfSelection(){
    const list = $("#pdfQuestionList");
    const selected = getSelectedPdfIndexes();
    list.innerHTML = "";
    questions.forEach((q,i)=>{
      const checked = selected.has(i);
      const wrapper = document.createElement("label");
      wrapper.className = "pdf-question-option" + (checked ? " selected" : "");
      wrapper.innerHTML = `
        <input class="form-check-input pdf-q-check" type="checkbox" value="${i}" ${checked ? "checked" : ""}>
        <span class="pdf-question-info">
          <span class="pdf-question-title">${escapeHtml(q.number || i+1)}. ${escapeHtml(q.title || q.skill || q.domain || "Untitled question")}</span>
          <span class="pdf-question-meta">${q.section==="rw"?"Reading & Writing":"Math"} · ${q.type==="mcq"?"MCQ":"Student Response"} · ${escapeHtml(q.difficulty || "Medium")}</span>
        </span>`;
      const checkbox = wrapper.querySelector(".pdf-q-check");
      checkbox.addEventListener("change",()=>{
        wrapper.classList.toggle("selected",checkbox.checked);
        syncPdfSelectionCount();
      });
      list.appendChild(wrapper);
    });
    syncPdfSelectionCount();
  }

  function getSelectedPdfIndexes(){
    const boxes = $$(".pdf-q-check");
    if(!boxes.length) return new Set(questions.map((_,i)=>i));
    return new Set(boxes.filter(b=>b.checked).map(b=>Number(b.value)));
  }

  function syncPdfSelectionCount(){
    const count = $$(".pdf-q-check").filter(b=>b.checked).length;
    $("#pdfSelectionCount").textContent = `${count} selected`;
    $("#pdfSelectAll").checked = count === questions.length && questions.length > 0;
    $("#pdfSelectAll").indeterminate = count > 0 && count < questions.length;
    $("#confirmPdfExport").disabled = count === 0;
  }

  $("#pdfSelectAll").onchange = e=>{
    $$(".pdf-q-check").forEach(box=>{
      box.checked=e.target.checked;
      box.closest(".pdf-question-option").classList.toggle("selected",box.checked);
    });
    syncPdfSelectionCount();
  };

  $("#exportPdfBtn").onclick=()=>{
    renderPdfSelection();
    if(pdfModal) pdfModal.show();
    else $("#pdfExportModal").style.display="block";
  };

  $("#confirmPdfExport").onclick=()=>{
    const indexes=[...getSelectedPdfIndexes()].sort((a,b)=>a-b);
    if(!indexes.length) return toast("Select at least one question");
    if(pdfModal) pdfModal.hide();
    exportQuestionsToPdf(indexes);
  };

  function exportQuestionsToPdf(indexes){
    let printRoot=document.getElementById("printRoot");
    if(printRoot) printRoot.remove();
    const dateText = new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"});
    printRoot=document.createElement("div");
    printRoot.id="printRoot";
    printRoot.className="pdf-export-paper";
    printRoot.style.cssText="position:fixed;inset:0;background:#fff;z-index:99999;display:none;padding:42px 50px;overflow:auto";

    const header=`<div class="pdf-header">
      <div><div class="pdf-brand">SAT Question Studio</div><div class="pdf-brand-sub">Practice Question Set</div></div>
      <div class="pdf-header-meta">${indexes.length} question${indexes.length===1?"":"s"}<br>${dateText}</div>
    </div>`;
    printRoot.insertAdjacentHTML("beforeend",header);

    indexes.forEach((idx,pos)=>{
      const q=questions[idx];
      const parsed=parseSource(q.source);
      const choices=q.type==="mcq" && q.showChoices
        ? parsed.choices.map(c=>`<div class="pdf-choice"><span class="pdf-choice-letter">${c.letter}</span><span>${formatText(c.text)}</span></div>`).join("")
        : q.type==="sr" ? `<div class="pdf-sr-answer">Student response</div>` : "";
      const fig=q.figure?`<div class="pdf-figure"><img src="${q.figure}" alt="Question figure"></div>`:"";
      const tags=`<div class="pdf-q-tags">
        <span class="pdf-tag">${q.section==="rw"?"Reading & Writing":"Math"}</span>
        <span class="pdf-tag">${q.type==="mcq"?"MCQ":"Student Response"}</span>
        <span class="pdf-tag">${escapeHtml(q.difficulty||"Medium")}</span>
      </div>`;
      const review=q.review?`<span class="pdf-review">Mark for Review</span>`:"";
      const skill=q.skill||q.domain||"";
      const title=q.title||skill||"Untitled question";
      const footer=`<div class="pdf-footer"><span>${escapeHtml(q.domain||"")}${skill&&q.domain?" · ":""}${escapeHtml(skill&&skill!==q.domain?skill:"")}</span><span>${pos+1} / ${indexes.length}</span></div>`;
      printRoot.insertAdjacentHTML("beforeend",`<section class="pdf-question-card ${pos<indexes.length-1?"page-break":""}">
        <div class="pdf-q-top">
          <div class="pdf-q-number">${escapeHtml(q.number||idx+1)}</div>
          <div class="pdf-q-title">${escapeHtml(title)}${review}</div>
          ${tags}
        </div>
        ${fig}
        <div class="pdf-question-content"><div class="prompt">${formatText(parsed.stem)}</div>${choices}</div>
        ${footer}
      </section>`);
    });

    document.body.appendChild(printRoot);
    typesetMath(printRoot);

    const style=document.createElement("style");
    style.id="printRuntimeStyle";
    style.textContent=`
      @page { size: Letter; margin: 0.65in; }
      @media print {
        html,body { background:#fff!important; }
        body>*:not(#printRoot){display:none!important}
        #printRoot{display:block!important;position:static!important;padding:0!important;overflow:visible!important}
        .pdf-question-card.page-break{break-after:page!important;page-break-after:always!important}
        .pdf-question-card{break-inside:avoid!important;page-break-inside:avoid!important}
      }
    `;
    document.head.appendChild(style);
    printRoot.style.display="block";

    // Give MathJax time to finish before the browser print dialog captures the document.
    const printNow=()=>{
      window.print();
      setTimeout(()=>{printRoot.remove();style.remove();},1200);
    };
    if(window.MathJax?.typesetPromise) window.MathJax.typesetPromise([printRoot]).then(printNow).catch(printNow);
    else setTimeout(printNow,250);
  };

  function bindDynamicAfterPrintRestore(){
    // Restored DOM is recreated from the original HTML string; references remain valid
    // for static controls through event delegation where possible.
  }


  // ----- Practice mode, grading, option elimination, notes and movable Desmos -----
  let practiceMode = false;
  function renderPracticePanel(){
    const q=current();
    const controls=$("#practiceControls");
    if(!controls) return;
    if(q.type==="mcq"){
      const parsed=parseSource(q.source);
      controls.innerHTML=(parsed.choices||[]).map(c=>
        `<button type="button" class="practice-choice ${q.studentAnswer===c.letter?"selected":""} ${(q.eliminated||[]).includes(c.letter)?"eliminated":""}" data-practice-choice="${c.letter}">${c.letter}</button>`
      ).join("") + `<button type="button" class="btn btn-sm btn-dark ms-auto" id="submitPractice"><i class="fa-solid fa-check"></i> Submit answer</button>`;
    } else {
      controls.innerHTML=`<input id="studentResponse" class="form-control" style="max-width:320px" placeholder="Type your answer" value="${escapeHtml(q.studentAnswer||"")}"><button type="button" class="btn btn-sm btn-dark" id="submitPractice"><i class="fa-solid fa-check"></i> Submit answer</button>`;
    }
    const result=$("#gradeResult");
    result.hidden=!q.graded;
    result.className="grade-result "+(q.isCorrect?"correct":"incorrect");
    if(q.graded) result.innerHTML=q.isCorrect
      ? '<i class="fa-solid fa-circle-check me-1"></i><strong>Correct!</strong> Your answer is correct.'
      : `<i class="fa-solid fa-circle-xmark me-1"></i><strong>Not quite.</strong> Correct answer: <strong>${escapeHtml(q.answer||"Not set")}</strong>`;
    $("#practicePanel").classList.toggle("practice-mode-active",practiceMode);
  }
  function normalizeAnswer(value){return String(value??"").trim().toLowerCase().replace(/\s+/g,"").replace(/,/g,".");}
  function submitPractice(){
    const q=current();
    if(q.type==="sr"){
      const field=$("#studentResponse");
      q.studentAnswer=field?field.value.trim():"";
    }
    if(!q.studentAnswer){toast("Choose or enter an answer first");return;}
    if(!String(q.answer||"").trim()){toast("Set the correct answer in the Editor panel first");return;}
    q.graded=true;
    q.isCorrect=normalizeAnswer(q.studentAnswer)===normalizeAnswer(q.answer);
    autosave();render();toast(q.isCorrect?"Correct answer!":"Answer submitted");
  }
  rendered.addEventListener("click",e=>{
    const eliminate=e.target.closest("[data-eliminate]");
    if(eliminate){
      e.preventDefault();e.stopPropagation();
      const letter=eliminate.dataset.eliminate;
      current().eliminated=current().eliminated||[];
      const arr=current().eliminated;
      current().eliminated=arr.includes(letter)?arr.filter(x=>x!==letter):[...arr,letter];
      autosave();render();return;
    }
    const choice=e.target.closest(".choice");
    if(choice){
      current().studentAnswer=choice.dataset.letter;
      current().graded=false;autosave();render();
    }
  });
  $("#practiceControls").addEventListener("click",e=>{
    const choice=e.target.closest("[data-practice-choice]");
    if(choice){current().studentAnswer=choice.dataset.practiceChoice;current().graded=false;autosave();renderPracticePanel();return;}
    if(e.target.closest("#submitPractice"))submitPractice();
  });
  $("#practiceControls").addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="studentResponse")submitPractice();});
  $("#questionNotes").addEventListener("input",e=>{current().notes=e.target.value;autosave();});
  $("#practiceModeBtn").onclick=()=>{
    practiceMode=!practiceMode;
    $("#practiceModeBtn").classList.toggle("btn-dark",practiceMode);
    $("#practiceModeBtn").classList.toggle("btn-outline-dark",!practiceMode);
    $("#practiceModeBtn").innerHTML=`<i class="fa-solid fa-graduation-cap"></i> ${practiceMode?"Practice mode: ON":"Practice mode"}`;
    $("#inspector")?.classList.toggle("practice-mode",practiceMode);
    toast(practiceMode?"Practice mode enabled":"Practice mode disabled");
  };
  // iPad-inspired status strip: live local clock and date.
  function updateDeviceClock(){
    const now=new Date();
    const clockEl=$("#statusClock"), dateEl=$("#statusDate");
    if(clockEl) clockEl.textContent=now.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
    if(dateEl) dateEl.textContent=now.toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"});
  }
  updateDeviceClock();
  setInterval(updateDeviceClock, 15000);

  // Toggle the app toolbar independently from the persistent device-style status bar.
  const topbarToggleBtn=$("#topbarToggleBtn");
  topbarToggleBtn?.addEventListener("click",()=>{
    const hidden=document.body.classList.toggle("topbar-hidden");
    topbarToggleBtn.setAttribute("aria-pressed",String(hidden));
    topbarToggleBtn.setAttribute("title",hidden?"Show top toolbar":"Hide top toolbar");
    topbarToggleBtn.setAttribute("aria-label",hidden?"Show top toolbar":"Hide top toolbar");
    topbarToggleBtn.innerHTML=`<i class="bi ${hidden?"bi-chevron-bar-down":"bi-chevron-bar-up"}"></i><span>${hidden?"Show toolbar":"Toolbar"}</span>`;
    toast(hidden?"Top toolbar hidden":"Top toolbar shown");
  });

  // Recording mode blocks clipboard shortcuts and context-menu copy/paste in this page.
  // It cannot police the separate-origin Desmos iframe; browser security intentionally prevents that.
  let recordingMode=false;
  const recordingBtn=$("#recordingModeBtn");
  recordingBtn?.addEventListener("click",()=>{
    recordingMode=!recordingMode;
    document.body.classList.toggle("recording-mode",recordingMode);
    recordingBtn.setAttribute("aria-pressed",String(recordingMode));
    recordingBtn.innerHTML=`<i class="bi ${recordingMode?"bi-record-circle-fill":"bi-record-circle"}"></i><span>${recordingMode?"Recording ON":"Recording mode"}</span>`;
    toast(recordingMode?"Recording mode on. Desmos clipboard actions cannot be blocked from this page.":"Recording mode off");
  });
  document.addEventListener("keydown",e=>{
    if(!recordingMode)return;
    const key=e.key.toLowerCase();
    const clipboardShortcut=(e.ctrlKey||e.metaKey)&&["c","v","x"].includes(key);
    if(clipboardShortcut && !e.target.closest("#desmosFrame")){
      e.preventDefault();e.stopPropagation();toast("Clipboard shortcuts are disabled in this workspace during recording");
    }
  },true);
  document.addEventListener("copy",e=>{if(recordingMode){e.preventDefault();toast("Copy is disabled in this workspace during recording");}},true);
  document.addEventListener("cut",e=>{if(recordingMode){e.preventDefault();toast("Cut is disabled in this workspace during recording");}},true);
  document.addEventListener("paste",e=>{if(recordingMode && !["INPUT","TEXTAREA"].includes(e.target.tagName)){e.preventDefault();toast("Paste is disabled in this workspace during recording");}},true);
  document.addEventListener("contextmenu",e=>{if(recordingMode && !e.target.closest("#desmosModal")){e.preventDefault();}},true);

  const desmosUrls={graphing:"https://www.desmos.com/testing/collegeboard/graphing?lang=en",scientific:"https://www.desmos.com/testing/collegeboard/scientific?lang=en"};
  let desmosMode="graphing";
  function setDesmosMode(mode){
    desmosMode=mode;$("#desmosFrame").src=desmosUrls[mode];
    $("#desmosFrame").title=`Desmos College Board ${mode} calculator`;
    $("#desmosGraphingTab").className=mode==="graphing"?"btn btn-dark":"btn btn-outline-secondary";
    $("#desmosScientificTab").className=mode==="scientific"?"btn btn-dark":"btn btn-outline-secondary";
  }
  $("#desmosBtn").onclick=()=>{$("#desmosModal").classList.add("show");$("#desmosModal").setAttribute("aria-hidden","false");};
  $("#closeDesmos").onclick=()=>{$("#desmosModal").classList.remove("show");$("#desmosModal").setAttribute("aria-hidden","true");};
  $("#desmosModal").addEventListener("click",e=>{if(e.target.id==="desmosModal")$("#closeDesmos").click();});
  $("#desmosGraphingTab").onclick=()=>setDesmosMode("graphing");
  $("#desmosScientificTab").onclick=()=>setDesmosMode("scientific");
  $("#desmosPopout").onclick=()=>window.open(desmosUrls[desmosMode],"_blank","noopener,noreferrer");
  // Drag the calculator window by its header; resize is also available from the lower-right corner.
  (function makeDesmosMovable(){
    const win=$(".desmos-window"), head=$(".desmos-header");let drag=null;
    head.addEventListener("pointerdown",e=>{
      if(e.target.closest("button"))return;
      const r=win.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove",e=>{
      if(!drag)return;
      const maxX=window.innerWidth-win.offsetWidth,maxY=window.innerHeight-win.offsetHeight;
      win.style.left=Math.max(0,Math.min(maxX,e.clientX-drag.x))+"px";
      win.style.top=Math.max(0,Math.min(maxY,e.clientY-drag.y))+"px";
    });
    head.addEventListener("pointerup",()=>drag=null);
    head.addEventListener("pointercancel",()=>drag=null);
  })();
  // Persistent multi-color text highlighting inspired by digital-test annotation tools.
  let activeHighlightColor="#ffd400";
  $$("[data-highlight-color]").forEach(btn=>btn.addEventListener("click",()=>{
    activeHighlightColor=btn.dataset.highlightColor;
    $$("[data-highlight-color]").forEach(b=>b.classList.toggle("active",b===btn));
  }));
  function applySavedHighlight(root,text,color="#ffd400"){
    if(!text)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      const index=node.nodeValue.indexOf(text);
      if(index<0)continue;
      const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+text.length);
      const mark=document.createElement("mark");mark.className="question-highlight";mark.style.setProperty("--highlight-color",color);
      try{range.surroundContents(mark);}catch{}
      break;
    }
  }
  function highlightSelectedText(){
    const selection=window.getSelection();
    if(!selection || selection.isCollapsed || !$("#questionBody").contains(selection.anchorNode)){
      toast("Select text in the question first");return;
    }
    const selectedText=selection.toString().trim();
    if(!selectedText){toast("Select some text first");return;}
    try{
      const range=selection.getRangeAt(0);
      const mark=document.createElement("mark");mark.className="question-highlight";mark.style.setProperty("--highlight-color",activeHighlightColor);
      range.surroundContents(mark);selection.removeAllRanges();
      const q=current();q.highlights=Array.isArray(q.highlights)?q.highlights:[];
      q.highlights.push({text:selectedText,color:activeHighlightColor});
      q.highlightedText=selectedText;autosave();toast("Text highlighted");
    }catch{toast("For best results, select text within one paragraph");}
  }
  $("#highlightSelectionBtn").onclick=highlightSelectedText;

  // Underlines are applied with DOM ranges (execCommand is unreliable on non-editable content).
  function applySavedUnderline(root,text){
    if(!text || !root) return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      const index=node.nodeValue.indexOf(text);
      if(index<0) continue;
      const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+text.length);
      const span=document.createElement("span");span.className="question-underline";
      try{span.appendChild(range.extractContents());range.insertNode(span);}catch{}
      break;
    }
  }
  function underlineSavedRange(range){
    const selectedText=range.toString().trim();
    if(!selectedText) return false;
    const span=document.createElement("span");span.className="question-underline";
    span.style.textDecoration="underline";span.style.textDecorationThickness="1.5px";span.style.textUnderlineOffset="2px";
    try{span.appendChild(range.extractContents());range.insertNode(span);return true;}catch{return false;}
  }

  // Context menu appears when text in the rendered question is selected.
  const selectionPopover=$("#selectionAnnotationPopover");
  let savedQuestionRange=null;
  function hideSelectionPopover(){selectionPopover.hidden=true;}
  function showSelectionPopover(){
    const sel=window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount || !$("#renderedQuestion").contains(sel.anchorNode) || !$("#renderedQuestion").contains(sel.focusNode)){hideSelectionPopover();return;}
    const text=sel.toString().trim();if(!text){hideSelectionPopover();return;}
    savedQuestionRange=sel.getRangeAt(0).cloneRange();
    const rect=savedQuestionRange.getBoundingClientRect();
    selectionPopover.hidden=false;
    const width=selectionPopover.offsetWidth,height=selectionPopover.offsetHeight;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+(rect.width-width)/2));
    let top=rect.top-height-10;if(top<8)top=Math.min(window.innerHeight-height-8,rect.bottom+10);
    selectionPopover.style.left=left+"px";selectionPopover.style.top=Math.max(8,top)+"px";
  }
  document.addEventListener("mouseup",()=>setTimeout(showSelectionPopover,0));
  document.addEventListener("keyup",e=>{if(["Shift","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))showSelectionPopover();});
  window.addEventListener("resize",hideSelectionPopover);
  window.addEventListener("scroll",hideSelectionPopover,true);
  selectionPopover.addEventListener("mousedown",e=>e.preventDefault()); // keep browser text selection alive while clicking menu
  function restoreQuestionSelection(){
    if(!savedQuestionRange)return false;
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(savedQuestionRange);return true;
  }
  $("#selectionUnderlineBtn").addEventListener("click",()=>{
    if(!restoreQuestionSelection())return;
    const range=savedQuestionRange.cloneRange();
    const selectedText=range.toString().trim();
    if(!selectedText || !$("#renderedQuestion").contains(range.commonAncestorContainer)){
      toast("Select text inside the question first");hideSelectionPopover();return;
    }
    if(underlineSavedRange(range)){
      const q=current();q.underlines=Array.isArray(q.underlines)?q.underlines:[];
      q.underlines.push(selectedText);autosave();toast("Underline applied");
    }else toast("Could not underline this selection. Try selecting text within one paragraph.");
    hideSelectionPopover();window.getSelection().removeAllRanges();savedQuestionRange=null;
  });
  $$('[data-selection-color]').forEach(btn=>btn.addEventListener("click",()=>{
    if(!restoreQuestionSelection())return;activeHighlightColor=btn.dataset.selectionColor;
    $$('[data-highlight-color]').forEach(b=>b.classList.toggle('active',b.dataset.highlightColor===activeHighlightColor));
    highlightSelectedText();hideSelectionPopover();savedQuestionRange=null;
  }));
  document.addEventListener("mousedown",e=>{if(!selectionPopover.contains(e.target) && !$("#renderedQuestion").contains(e.target))hideSelectionPopover();});

  $("#clearHighlightsBtn").onclick=()=>{
    const q=current();q.highlights=[];q.highlightedText="";q.highlighted=false;autosave();render();toast("Highlights cleared for this question");
  };
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="h" && $("#questionBody").contains(document.getSelection()?.anchorNode)){
      e.preventDefault();highlightSelectedText();
    }
  });
  // Make grading affordance available after each render and persist added fields.
  const originalRenderForEnhancements=render;
  render=function(){originalRenderForEnhancements();renderPracticePanel();};
  $("#answerInput").addEventListener("input",e=>{
    current().answer=e.target.value.trim();
    current().graded=false;
    autosave();
  });

  // initial load from localStorage if available
  try{
    const saved=localStorage.getItem("sat-question-maker-v1");
    if(saved){
      const parsed=JSON.parse(saved);
      if(Array.isArray(parsed)&&parsed.length){
        questions=parsed.map((q,i)=>({...q,number:q.number||i+1,title:q.title||q.skill||"Untitled question",annotations:q.annotations||[],notes:q.notes||"",eliminated:q.eliminated||[],studentAnswer:q.studentAnswer||"",graded:!!q.graded}));
      }
    }
  }catch{}

  render();
})();
