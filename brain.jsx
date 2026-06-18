import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "personal_brain_v2";
const DOMAINS = ["Geopolitics","Real Estate","Philosophy","Business","Vedic","Macro","Personal","Research","Other"];
const DOMAIN_COLORS = {
  Geopolitics:"#e85d4a", "Real Estate":"#f4a261", Philosophy:"#a8dadc",
  Business:"#f1c40f", Vedic:"#c77dff", Macro:"#48cae4",
  Personal:"#80ed99", Research:"#ff9f1c", Other:"#adb5bd"
};
const P = {
  bg:"#06060f", surface:"#0d0d1e", surfaceHigh:"#12122a",
  border:"#1a1a35", borderBright:"#2e2e55",
  gold:"#c9a84c", goldDim:"#7a6130", goldGlow:"#c9a84c44",
  text:"#e8e8f0", textDim:"#5a5a7a", textMid:"#9898b8",
  red:"#e85d4a", green:"#80ed99", purple:"#c77dff", blue:"#48cae4"
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const loadBrain = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {thoughts:[],edges:[]}; } catch { return {thoughts:[],edges:[]}; }};
const saveBrain = d => localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const dColor = d => DOMAIN_COLORS[d] || DOMAIN_COLORS["Other"];
const fileToB64 = f => new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });

// ─── API ──────────────────────────────────────────────────────────────────────
async function callAI(apiKey, messages, system) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1000, system, messages })
  });
  if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e?.error?.message||`API ${r.status}`); }
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function processInput(apiKey, inputData, existing) {
  const ctx = existing.slice(-20).map(t=>`[${t.domain}] ${t.summary}`).join("\n");
  const system = `You are the analytical engine of a personal second brain. Return ONLY raw JSON, no markdown fences, no explanation.

EXISTING KNOWLEDGE (last 20):
${ctx||"Empty — first entry."}

Return exactly:
{"summary":"1-2 sentence core insight, sharp","domain":"one of: Geopolitics, Real Estate, Philosophy, Business, Vedic, Macro, Personal, Research, Other","tags":["tag1","tag2","tag3"],"confidence":"hypothesis|belief|conviction","keyInsight":"the single most important idea","connections":["summaries of existing thoughts this genuinely connects to"],"contradiction":"existing belief this contradicts or null","implication":"second-order consequence of this idea","question":"most important unanswered question this raises","fullAnalysis":"3-4 sentence deep analysis preserving full nuance of the original input"}`;
  const content = Array.isArray(inputData) ? inputData : [{type:"text",text:inputData}];
  const raw = await callAI(apiKey, [{role:"user",content}], system);
  try { return JSON.parse(raw.replace(/```json|```/g,"").trim()); }
  catch { return { summary:raw.slice(0,200), domain:"Other", tags:[], confidence:"hypothesis", keyInsight:raw.slice(0,100), connections:[], contradiction:null, implication:"", question:"", fullAnalysis:raw.slice(0,500) }; }
}

async function chatWithBrain(apiKey, msg, thoughts, history) {
  const kb = thoughts.map((t,i)=>`[${i+1}][${t.domain}][${t.confidence}] ${t.summary}\n  Insight: ${t.keyInsight}\n  Implies: ${t.implication}`).join("\n\n");
  const system = `You are the living intelligence of this person's second brain — the accumulated weight of everything they have ever thought, read, and believed.

KNOWLEDGE BASE (${thoughts.length} thoughts):
${kb||"Empty. Ask user to add thoughts first."}

RULES:
- Reference specific thoughts by number [N] when relevant
- Surface contradictions the user hasn't noticed
- Give second-order implications, not just answers
- Be rigorous, not agreeable — push back when warranted
- Speak as "your thinking suggests..." or "across your [N] thoughts..."
- Max 4 dense paragraphs. No fluff.`;
  const msgs = [...history.slice(-6).map(m=>({role:m.role,content:m.content})),{role:"user",content:msg}];
  return callAI(apiKey, msgs, system);
}

// ─── THOUGHT MODAL ────────────────────────────────────────────────────────────
function ThoughtModal({ thought, allThoughts, edges, onClose, onNavigate, onDelete }) {
  const connectedEdges = edges.filter(e => e.source===thought.id||e.target===thought.id);
  const connected = connectedEdges.map(e => {
    const otherId = e.source===thought.id ? e.target : e.source;
    const other = allThoughts.find(t=>t.id===otherId);
    return other ? { thought:other, type:e.type } : null;
  }).filter(Boolean);

  const color = dColor(thought.domain);
  const confColor = thought.confidence==="conviction"?P.gold:thought.confidence==="belief"?P.blue:P.textMid;

  // Close on backdrop click
  const handleBackdrop = e => { if (e.target===e.currentTarget) onClose(); };

  // Keyboard
  useEffect(() => {
    const handler = e => { if (e.key==="Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const S = {
    backdrop: { position:"fixed", inset:0, background:"#000000cc", backdropFilter:"blur(8px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn 0.2s ease" },
    modal: { width:"100%", maxWidth:780, maxHeight:"88vh", background:P.surface, border:`1px solid ${color}44`, borderRadius:16, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:`0 0 60px ${color}22, 0 24px 80px #00000088`, animation:"slideUp 0.25s ease" },
    header: { padding:"20px 24px 16px", borderBottom:`1px solid ${P.border}`, background:P.surfaceHigh, flexShrink:0 },
    body: { flex:1, overflow:"auto", padding:24 },
    footer: { padding:"16px 24px", borderTop:`1px solid ${P.border}`, background:P.surfaceHigh, flexShrink:0, display:"flex", justifyContent:"space-between", alignItems:"center" },
    sectionTitle: { fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:P.textDim, marginBottom:8, marginTop:20, display:"flex", alignItems:"center", gap:6 },
    connCard: { background:"#0a0a1a", border:`1px solid ${P.border}`, borderRadius:8, padding:12, cursor:"pointer", transition:"all 0.18s", marginBottom:8, display:"flex", gap:10, alignItems:"flex-start" },
    tag: col => ({ display:"inline-block", padding:"3px 9px", borderRadius:20, background:col+"22", color:col, fontSize:10, fontWeight:700, letterSpacing:"0.05em", marginRight:5, marginBottom:4, border:`1px solid ${col}33` }),
    pill: (col,bg) => ({ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, background:bg||col+"18", color:col, fontSize:11, fontWeight:600, border:`1px solid ${col}30` }),
    closeBtn: { background:"none", border:`1px solid ${P.border}`, borderRadius:8, color:P.textDim, cursor:"pointer", padding:"6px 12px", fontSize:12, display:"flex", alignItems:"center", gap:5 },
    deleteBtn: { background:P.red+"15", border:`1px solid ${P.red}44`, borderRadius:8, color:P.red, cursor:"pointer", padding:"6px 12px", fontSize:12 },
    blockQuote: { background:"#080812", border:`1px solid ${color}22`, borderLeft:`3px solid ${color}`, borderRadius:"0 8px 8px 0", padding:"14px 16px", fontSize:13, color:P.textMid, lineHeight:1.75, fontFamily:"Georgia,serif", whiteSpace:"pre-wrap", wordBreak:"break-word", margin:"4px 0" },
    insightBlock: col => ({ background:col+"0d", border:`1px solid ${col}22`, borderRadius:10, padding:"12px 14px", marginBottom:10 }),
  };

  return (
    <div style={S.backdrop} onClick={handleBackdrop}>
      <style>{`
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .conn-card:hover { border-color: ${P.borderBright} !important; background: #111128 !important; transform: translateX(2px); }
        .modal-scroll::-webkit-scrollbar { width: 4px; }
        .modal-scroll::-webkit-scrollbar-track { background: transparent; }
        .modal-scroll::-webkit-scrollbar-thumb { background: ${P.border}; border-radius: 2px; }
      `}</style>

      <div style={S.modal}>
        {/* HEADER */}
        <div style={S.header}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <span style={S.tag(color)}>{thought.domain}</span>
              <span style={S.pill(confColor)}>
                {thought.confidence==="conviction"?"⬡":thought.confidence==="belief"?"◈":"◇"} {thought.confidence}
              </span>
              <span style={S.pill(P.textDim,"transparent")}>{new Date(thought.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</span>
              {connected.length > 0 && <span style={S.pill(color,"transparent")}>⟷ {connected.length} connection{connected.length!==1?"s":""}</span>}
            </div>
            <button style={S.closeBtn} onClick={onClose}>✕ Close</button>
          </div>
          <h2 style={{ fontSize:17, fontWeight:700, color:P.text, lineHeight:1.5, margin:0, fontFamily:"Georgia,serif" }}>{thought.summary}</h2>
        </div>

        {/* BODY */}
        <div style={S.body} className="modal-scroll">

          {/* KEY INSIGHT */}
          <div style={S.insightBlock(color)}>
            <div style={{ fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:color, marginBottom:6, fontWeight:700 }}>⬡ Core Insight</div>
            <p style={{ fontSize:14, color:P.text, lineHeight:1.6, margin:0, fontWeight:500 }}>{thought.keyInsight}</p>
          </div>

          {/* FULL ANALYSIS */}
          {thought.fullAnalysis && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Full Analysis</div>
              <div style={S.blockQuote}>{thought.fullAnalysis}</div>
            </>
          )}

          {/* IMPLICATION */}
          {thought.implication && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Second-Order Implication</div>
              <div style={S.insightBlock(P.blue)}>
                <p style={{ fontSize:13, color:P.blue, lineHeight:1.6, margin:0 }}>{thought.implication}</p>
              </div>
            </>
          )}

          {/* OPEN QUESTION */}
          {thought.question && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Open Question</div>
              <div style={S.insightBlock(P.purple)}>
                <p style={{ fontSize:13, color:P.purple, lineHeight:1.6, margin:0, fontStyle:"italic" }}>"{thought.question}"</p>
              </div>
            </>
          )}

          {/* CONTRADICTION */}
          {thought.contradiction && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>⚡ Contradicts</div>
              <div style={S.insightBlock(P.red)}>
                <p style={{ fontSize:13, color:P.red, lineHeight:1.6, margin:0 }}>{thought.contradiction}</p>
              </div>
            </>
          )}

          {/* TAGS */}
          {thought.tags?.length > 0 && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Tags</div>
              <div style={{ marginBottom:4 }}>
                {thought.tags.map(t => <span key={t} style={S.tag(P.textMid)}>{t}</span>)}
              </div>
            </>
          )}

          {/* CONNECTED THOUGHTS */}
          {connected.length > 0 && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Connected Thoughts ({connected.length})</div>
              {connected.map(({thought:ct, type},i) => (
                <div key={i} className="conn-card" style={{...S.connCard, borderColor: type==="contradiction"?P.red+"44":dColor(ct.domain)+"33"}}
                  onClick={() => onNavigate(ct)}>
                  <div style={{ flexShrink:0, marginTop:3 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:dColor(ct.domain), boxShadow:`0 0 6px ${dColor(ct.domain)}` }} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", gap:6, marginBottom:5, flexWrap:"wrap" }}>
                      <span style={S.tag(dColor(ct.domain))}>{ct.domain}</span>
                      <span style={{ fontSize:10, color: type==="contradiction"?P.red:P.gold, fontWeight:600 }}>
                        {type==="contradiction" ? "⚡ contradicts" : "⟷ connects"}
                      </span>
                    </div>
                    <p style={{ fontSize:12, color:P.textMid, margin:0, lineHeight:1.5 }}>{ct.summary}</p>
                    {ct.keyInsight && <p style={{ fontSize:11, color:P.textDim, margin:"4px 0 0", fontStyle:"italic" }}>→ {ct.keyInsight.slice(0,100)}{ct.keyInsight.length>100?"…":""}</p>}
                  </div>
                  <span style={{ color:P.textDim, fontSize:14, flexShrink:0 }}>›</span>
                </div>
              ))}
            </>
          )}

          {/* ORIGINAL SOURCE */}
          {thought.originalContent && (
            <>
              <div style={S.sectionTitle}><span style={{ width:16, height:1, background:P.border, display:"inline-block" }}/>Original Source (Preserved)</div>
              <div style={{ background:"#07070e", border:`1px solid ${P.border}`, borderRadius:10, overflow:"hidden" }}>
                <div style={{ padding:"8px 14px", borderBottom:`1px solid ${P.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:10, color:P.textDim, letterSpacing:"0.08em", textTransform:"uppercase" }}>Raw Input</span>
                  <button onClick={() => navigator.clipboard.writeText(thought.originalContent)}
                    style={{ background:"none", border:"none", color:P.textDim, cursor:"pointer", fontSize:11, padding:"2px 6px" }}>
                    ⧉ Copy
                  </button>
                </div>
                <div style={{ padding:14, maxHeight:200, overflow:"auto" }} className="modal-scroll">
                  <pre style={{ margin:0, fontSize:12, color:P.textMid, lineHeight:1.7, fontFamily:"'JetBrains Mono', 'Courier New', monospace", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                    {thought.originalContent.slice(0,2000)}{thought.originalContent.length>2000?"…\n[truncated for display]":""}
                  </pre>
                </div>
              </div>
            </>
          )}

          <div style={{ height:8 }} />
        </div>

        {/* FOOTER */}
        <div style={S.footer}>
          <button style={S.deleteBtn} onClick={() => { onDelete(thought.id); onClose(); }}>
            ✕ Remove from Brain
          </button>
          <div style={{ display:"flex", gap:8 }}>
            {connected.length > 0 && (
              <span style={{ fontSize:11, color:P.textDim, alignSelf:"center" }}>
                Navigate connections above ↑
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BRAIN GRAPH ──────────────────────────────────────────────────────────────
function BrainGraph({ thoughts, edges, selectedId, onSelectNode }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const container = svgRef.current.parentElement;
    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width",W).attr("height",H);

    if (thoughts.length === 0) {
      const g = svg.append("g");
      g.append("circle").attr("cx",W/2).attr("cy",H/2).attr("r",40).attr("fill","none").attr("stroke",P.border).attr("stroke-width",1);
      g.append("circle").attr("cx",W/2).attr("cy",H/2).attr("r",5).attr("fill",P.gold).attr("opacity",0.4);
      g.append("text").attr("x",W/2).attr("y",H/2+70).attr("text-anchor","middle").attr("fill",P.textDim).attr("font-size",12).attr("font-family","Inter,sans-serif").text("Add your first thought →");
      return;
    }

    const defs = svg.append("defs");

    // Glow filters per domain
    Object.entries(DOMAIN_COLORS).forEach(([name, col]) => {
      const key = name.replace(/\s/g,"");
      const f = defs.append("filter").attr("id",`glow-${key}`).attr("x","-60%").attr("y","-60%").attr("width","220%").attr("height","220%");
      f.append("feGaussianBlur").attr("stdDeviation","4").attr("result","blur");
      const fm = f.append("feMerge");
      fm.append("feMergeNode").attr("in","blur");
      fm.append("feMergeNode").attr("in","SourceGraphic");
    });

    // Selected glow (stronger)
    const sf = defs.append("filter").attr("id","glow-selected").attr("x","-80%").attr("y","-80%").attr("width","260%").attr("height","260%");
    sf.append("feGaussianBlur").attr("stdDeviation","8").attr("result","blur");
    const sfm = sf.append("feMerge");
    sfm.append("feMergeNode").attr("in","blur");
    sfm.append("feMergeNode").attr("in","SourceGraphic");

    // Arrow marker
    defs.append("marker").attr("id","arrow").attr("viewBox","0 -5 10 10").attr("refX",18).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto")
      .append("path").attr("d","M0,-5L10,0L0,5").attr("fill",P.borderBright);

    svg.append("rect").attr("width",W).attr("height",H).attr("fill",P.bg);

    const nodes = thoughts.map(t => ({
      ...t, _r: t.confidence==="conviction"?16:t.confidence==="belief"?11:7,
      _col: dColor(t.domain), _key: (t.domain||"Other").replace(/\s/g,"")
    }));
    const nodeMap = Object.fromEntries(nodes.map(n=>[n.id,n]));
    const links = edges.filter(e=>nodeMap[e.source]&&nodeMap[e.target]).map(e=>({...e}));

    if (simRef.current) simRef.current.stop();
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d=>d.id).distance(d=>d.type==="contradiction"?90:130).strength(0.35))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(W/2,H/2))
      .force("collide", d3.forceCollide().radius(d=>d._r+22));
    simRef.current = sim;

    const root = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.2,4]).on("zoom", e=>root.attr("transform",e.transform)));

    // Link layer
    const linkG = root.append("g");
    const linkSel = linkG.selectAll("line").data(links).enter().append("line")
      .attr("stroke", d=>d.type==="contradiction"?P.red:P.borderBright)
      .attr("stroke-width", d=>d.type==="contradiction"?1.5:1)
      .attr("stroke-dasharray", d=>d.type==="contradiction"?"5 4":"none")
      .attr("opacity", 0.5)
      .attr("marker-end", d=>d.type==="contradiction"?"":"url(#arrow)");

    // Particle layer
    const partG = root.append("g");

    // Node layer
    const nodeG = root.append("g");
    const nodeSel = nodeG.selectAll("g.nd").data(nodes).enter().append("g").attr("class","nd")
      .style("cursor","pointer")
      .on("click", (e,d) => { e.stopPropagation(); onSelectNode(d); })
      .call(d3.drag()
        .on("start",(e,d)=>{ if(!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on("drag",(e,d)=>{ d.fx=e.x; d.fy=e.y; })
        .on("end",(e,d)=>{ if(!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; })
      );

    // Orbit ring
    nodeSel.append("circle")
      .attr("r",d=>d._r+8).attr("fill","none")
      .attr("stroke",d=>d._col).attr("stroke-width",0.5).attr("opacity",0.2);

    // Main circle
    nodeSel.append("circle")
      .attr("r",d=>d._r)
      .attr("fill",d=>d.id===selectedId ? d._col+"55" : d._col+"22")
      .attr("stroke",d=>d._col)
      .attr("stroke-width",d=>d.id===selectedId?2.5:1.5)
      .attr("filter",d=>d.id===selectedId?"url(#glow-selected)":`url(#glow-${d._key})`);

    // Core dot
    nodeSel.append("circle").attr("r",2.5).attr("fill",d=>d._col).attr("opacity",0.9);

    // Hover tooltip text
    nodeSel.append("title").text(d=>d.summary);

    // Label
    nodeSel.append("text")
      .text(d=>{ const s=d.summary||""; return s.length>35?s.slice(0,34)+"…":s; })
      .attr("dy",d=>d._r+13).attr("text-anchor","middle")
      .attr("font-size","9px").attr("font-family","Inter,sans-serif")
      .attr("fill",P.textDim).attr("pointer-events","none");

    // Tick
    sim.on("tick",() => {
      linkSel.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
      nodeSel.attr("transform",d=>`translate(${d.x},${d.y})`);
    });

    // Synaptic particle animation
    const particles = [];
    function frame() {
      if (links.length > 0 && Math.random() < 0.05) {
        const l = links[Math.floor(Math.random()*links.length)];
        particles.push({l, t:0, spd:0.006+Math.random()*0.012, col:l.type==="contradiction"?P.red:P.gold});
      }
      for (let i=particles.length-1;i>=0;i--) {
        particles[i].t += particles[i].spd;
        if (particles[i].t>=1) particles.splice(i,1);
      }
      partG.selectAll("circle.pt").remove();
      particles.forEach(p=>{
        const s=p.l.source, t=p.l.target;
        if (!s.x||!t.x) return;
        const x=s.x+(t.x-s.x)*p.t, y=s.y+(t.y-s.y)*p.t;
        const opacity = p.t < 0.5 ? p.t*2 : (1-p.t)*2;
        partG.append("circle").attr("class","pt").attr("cx",x).attr("cy",y).attr("r",2.5).attr("fill",p.col).attr("opacity",opacity);
      });
      rafRef.current = requestAnimationFrame(frame);
    }
    frame();

    return () => { if(simRef.current) simRef.current.stop(); cancelAnimationFrame(rafRef.current); };
  }, [thoughts, edges, selectedId]);

  return <svg ref={svgRef} style={{width:"100%",height:"100%"}} />;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey] = useState(()=>localStorage.getItem("brain_key")||"");
  const [keySaved, setKeySaved] = useState(()=>!!localStorage.getItem("brain_key"));
  const [brain, setBrain] = useState(loadBrain);
  const [view, setView] = useState("graph");
  const [openThought, setOpenThought] = useState(null); // modal
  const [selectedId, setSelectedId] = useState(null);   // graph highlight
  const [inputText, setInputText] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [procStatus, setProcStatus] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest"); // newest|domain|confidence
  const recRef = useRef(null);
  const fileRef = useRef(null);
  const chatEndRef = useRef(null);
  const activeVoiceTarget = useRef("input"); // "input" | "chat"

  useEffect(()=>{ saveBrain(brain); },[brain]);
  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:"smooth"}); },[chatHistory]);

  // Voice setup
  useEffect(()=>{
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous=false; r.interimResults=false; r.lang="en-IN";
    r.onresult = e => {
      const t = e.results[0][0].transcript;
      if (activeVoiceTarget.current==="chat") setChatInput(p=>p+" "+t);
      else setInputText(p=>p+" "+t);
      setListening(false);
    };
    r.onerror = ()=>setListening(false);
    r.onend = ()=>setListening(false);
    recRef.current = r;
  },[]);

  const startVoice = useCallback((target="input")=>{
    if (!recRef.current){ setError("Voice needs Chrome/Safari."); return; }
    if (listening){ recRef.current.stop(); setListening(false); return; }
    activeVoiceTarget.current = target;
    recRef.current.start(); setListening(true); setError("");
  },[listening]);

  const saveKey = ()=>{ localStorage.setItem("brain_key",apiKey); setKeySaved(true); setError(""); };

  // ── ADD THOUGHT ──
  const addThought = useCallback(async (content) => {
    if (!apiKey){ setError("Add your API key first."); return; }
    setIsProcessing(true); setError("");
    try {
      setProcStatus("Reading input…");
      const p = await processInput(apiKey, content, brain.thoughts);
      setProcStatus("Building connections…");
      const t = {
        id:uid(), timestamp:Date.now(),
        summary:p.summary, domain:p.domain, tags:p.tags||[],
        confidence:p.confidence||"hypothesis", keyInsight:p.keyInsight,
        implication:p.implication, question:p.question,
        contradiction:p.contradiction, fullAnalysis:p.fullAnalysis,
        rawConnections:p.connections||[],
        originalContent: typeof content==="string" ? content : "[multipart: file/image/pdf]"
      };
      const newEdges = [];
      (p.connections||[]).forEach(ct=>{
        const m = brain.thoughts.find(x=>x.summary?.toLowerCase().includes(ct.slice(0,25).toLowerCase())||ct.toLowerCase().includes(x.summary?.slice(0,25).toLowerCase()));
        if (m) newEdges.push({id:uid(),source:m.id,target:t.id,type:"connection"});
      });
      if (p.contradiction) {
        const m = brain.thoughts.find(x=>x.summary?.toLowerCase().includes(p.contradiction.slice(0,25).toLowerCase()));
        if (m) newEdges.push({id:uid(),source:m.id,target:t.id,type:"contradiction"});
      }
      setBrain(prev=>({thoughts:[...prev.thoughts,t],edges:[...prev.edges,...newEdges]}));
      setSelectedId(t.id);
      setOpenThought(t);
      setInputText(""); setInputUrl(""); setView("graph");
    } catch(e){ setError(e.message||"Failed. Check API key."); }
    finally { setIsProcessing(false); setProcStatus(""); }
  },[apiKey, brain.thoughts]);

  const handleTextSubmit = useCallback(()=>{ if(inputText.trim()) addThought(inputText.trim()); },[inputText,addThought]);

  const handleUrlSubmit = useCallback(async()=>{
    if (!inputUrl.trim()) return;
    setIsProcessing(true); setProcStatus("Fetching URL…"); setError("");
    try {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(inputUrl)}`);
      const d = await r.json();
      const text = (d.contents||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,6000);
      await addThought(`SOURCE URL: ${inputUrl}\n\n${text}`);
    } catch { setError("Could not fetch URL. Paste the text instead."); setIsProcessing(false); setProcStatus(""); }
  },[inputUrl,addThought]);

  const handleFile = useCallback(async e=>{
    const f = e.target.files?.[0]; if(!f) return;
    setIsProcessing(true); setProcStatus("Reading file…"); setError("");
    try {
      const b64 = await fileToB64(f);
      if (f.type==="application/pdf") {
        await addThought([{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:`Analyse this PDF: ${f.name}. Extract all key insights, arguments, data, and preserve important details.`}]);
      } else if (f.type.startsWith("image/")) {
        await addThought([{type:"image",source:{type:"base64",media_type:f.type,data:b64}},{type:"text",text:"Analyse everything visible in this image — text, data, charts, concepts. Preserve all details precisely."}]);
      } else {
        const text = await f.text();
        await addThought(`FILE: ${f.name}\n\n${text.slice(0,6000)}`);
      }
    } catch(e){ setError("File error: "+e.message); setIsProcessing(false); setProcStatus(""); }
    e.target.value="";
  },[addThought]);

  const handleChat = useCallback(async()=>{
    if (!chatInput.trim()||!apiKey) return;
    const msg = chatInput.trim(); setChatInput("");
    const nh = [...chatHistory,{role:"user",content:msg}];
    setChatHistory(nh); setChatLoading(true); setError("");
    try {
      const reply = await chatWithBrain(apiKey, msg, brain.thoughts, chatHistory);
      setChatHistory([...nh,{role:"assistant",content:reply}]);
    } catch(e){ setError(e.message); }
    finally { setChatLoading(false); }
  },[chatInput,apiKey,chatHistory,brain.thoughts]);

  const deleteThought = useCallback(id=>{
    setBrain(p=>({thoughts:p.thoughts.filter(t=>t.id!==id),edges:p.edges.filter(e=>e.source!==id&&e.target!==id)}));
    if (selectedId===id) setSelectedId(null);
    if (openThought?.id===id) setOpenThought(null);
  },[selectedId,openThought]);

  // ── FILTERED THOUGHTS ──
  const filtered = brain.thoughts
    .filter(t=>{
      const md = domainFilter==="All"||t.domain===domainFilter;
      const ms = !search||t.summary?.toLowerCase().includes(search.toLowerCase())||t.tags?.some(g=>g.toLowerCase().includes(search.toLowerCase()))||t.keyInsight?.toLowerCase().includes(search.toLowerCase());
      return md&&ms;
    })
    .sort((a,b)=>{
      if (sortBy==="domain") return (a.domain||"").localeCompare(b.domain||"");
      if (sortBy==="confidence") { const o={conviction:0,belief:1,hypothesis:2}; return (o[a.confidence]||2)-(o[b.confidence]||2); }
      return b.timestamp-a.timestamp;
    });

  const confCounts = brain.thoughts.reduce((a,t)=>{ a[t.confidence]=(a[t.confidence]||0)+1; return a; },{});

  // ── STYLES ──
  const S = {
    app:{ width:"100vw",height:"100vh",background:P.bg,color:P.text,fontFamily:"Inter,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden" },
    header:{ height:50,borderBottom:`1px solid ${P.border}`,display:"flex",alignItems:"center",padding:"0 16px",gap:12,flexShrink:0,background:P.surface },
    logo:{ fontSize:14,fontWeight:800,color:P.gold,letterSpacing:"0.06em",fontFamily:"Georgia,serif",whiteSpace:"nowrap" },
    navBtn:active=>({ padding:"5px 13px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,background:active?P.gold+"22":"transparent",color:active?P.gold:P.textDim,transition:"all 0.18s",letterSpacing:"0.03em" }),
    main:{ flex:1,display:"flex",overflow:"hidden" },
    graphArea:{ flex:1,position:"relative",overflow:"hidden" },
    sidebar:{ width:276,borderLeft:`1px solid ${P.border}`,display:"flex",flexDirection:"column",overflow:"hidden",background:P.surface },
    sidePanel:{ flex:1,overflow:"auto",padding:12 },
    sectionLabel:{ fontSize:9,color:P.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6,marginTop:14,display:"block" },
    input:{ width:"100%",background:"#09091a",border:`1px solid ${P.border}`,borderRadius:8,padding:"9px 12px",color:P.text,fontSize:13,outline:"none",resize:"vertical",boxSizing:"border-box",fontFamily:"Inter,sans-serif",transition:"border-color 0.2s" },
    btn:(v="primary")=>({ padding:v==="icon"?"8px 10px":"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:v==="primary"?P.gold:v==="danger"?P.red+"22":"#14142a",color:v==="primary"?"#070710":v==="danger"?P.red:P.textDim,transition:"all 0.18s",display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap" }),
    tCard:sel=>({ background:sel?P.gold+"0e":"#09091a",border:`1px solid ${sel?P.gold+"44":P.border}`,borderRadius:8,padding:"10px 12px",marginBottom:7,cursor:"pointer",transition:"all 0.18s" }),
    tag:col=>({ display:"inline-block",padding:"2px 8px",borderRadius:20,background:col+"22",color:col,fontSize:10,fontWeight:700,marginRight:4,marginBottom:3,border:`1px solid ${col}33` }),
    chatBubble:role=>({ maxWidth:"84%",padding:"10px 14px",borderRadius:role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:role==="user"?P.gold+"1a":"#0f0f22",border:`1px solid ${role==="user"?P.gold+"33":P.border}`,color:P.text,fontSize:13,lineHeight:1.65,alignSelf:role==="user"?"flex-end":"flex-start" }),
    statPill:{ display:"flex",flexDirection:"column",alignItems:"center",padding:"7px 14px",background:"#09091a",borderRadius:8,border:`1px solid ${P.border}` },
    voiceBtn:active=>({ background:active?P.red+"22":"#12122a",border:`1px solid ${active?P.red:P.border}`,borderRadius:8,padding:"9px 11px",cursor:"pointer",fontSize:15,color:active?P.red:P.textDim,transition:"all 0.18s",flexShrink:0 }),
  };

  return (
    <div style={S.app}>
      <style>{`
        *:focus { outline: none; }
        input:focus, textarea:focus { border-color: ${P.gold}66 !important; }
        select { appearance: none; }
        ::-webkit-scrollbar { width:3px; height:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${P.border}; border-radius:2px; }
        .tcard:hover { border-color:${P.borderBright} !important; background:#0f0f20 !important; }
        .navbtn:hover { color:${P.text} !important; }
        .action-btn:hover { opacity:0.85; transform:scale(0.98); }
      `}</style>

      {/* ── HEADER ── */}
      <div style={S.header}>
        <span style={S.logo}>⬡ MIND</span>
        <span style={{ fontSize:10,color:P.textDim,whiteSpace:"nowrap" }}>{brain.thoughts.length} thoughts · {brain.edges.length} links</span>
        <div style={{ display:"flex",gap:3,marginLeft:"auto" }}>
          {[["graph","◉ Map"],["add","＋ Feed"],["chat","◈ Think"],["library","≡ Library"]].map(([v,l])=>(
            <button key={v} className="navbtn" style={S.navBtn(view===v)} onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>
        {!keySaved ? (
          <div style={{ display:"flex",gap:6,marginLeft:8 }}>
            <input type="password" placeholder="Anthropic API key…" value={apiKey} onChange={e=>setApiKey(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveKey()}
              style={{ ...S.input,width:180,padding:"5px 10px",fontSize:11 }} />
            <button style={S.btn()} onClick={saveKey}>Save</button>
          </div>
        ) : (
          <span style={{ fontSize:10,color:P.green,marginLeft:8,whiteSpace:"nowrap" }}>● Live</span>
        )}
      </div>

      {/* ── ERROR BAR ── */}
      {error && (
        <div style={{ background:P.red+"18",borderBottom:`1px solid ${P.red}33`,padding:"7px 16px",fontSize:12,color:P.red,flexShrink:0,display:"flex",gap:8,alignItems:"center" }}>
          <span>⚠</span><span style={{flex:1}}>{error}</span>
          <button onClick={()=>setError("")} style={{ background:"none",border:"none",color:P.red,cursor:"pointer",fontSize:14 }}>✕</button>
        </div>
      )}

      <div style={S.main}>

        {/* ════════ MAP VIEW ════════ */}
        {view==="graph" && (
          <>
            <div style={S.graphArea}>
              <BrainGraph thoughts={filtered} edges={brain.edges} selectedId={selectedId}
                onSelectNode={t=>{ setSelectedId(t.id); setOpenThought(t); }} />

              {/* Overlays */}
              <div style={{ position:"absolute",top:12,left:12,display:"flex",gap:8 }}>
                <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
                  style={{ ...S.input,width:160,padding:"7px 12px",fontSize:11,background:"#0a0a18ee" }} />
                <select value={domainFilter} onChange={e=>setDomainFilter(e.target.value)}
                  style={{ ...S.input,width:118,padding:"7px 10px",fontSize:11,background:"#0a0a18ee" }}>
                  <option value="All">All domains</option>
                  {DOMAINS.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Stats */}
              <div style={{ position:"absolute",bottom:12,left:12,display:"flex",gap:7 }}>
                {Object.entries(confCounts).map(([k,v])=>(
                  <div key={k} style={S.statPill}>
                    <span style={{ fontSize:17,fontWeight:700,color:k==="conviction"?P.gold:k==="belief"?P.blue:P.textMid }}>{v}</span>
                    <span style={{ fontSize:8,color:P.textDim,textTransform:"uppercase",letterSpacing:"0.08em" }}>{k}</span>
                  </div>
                ))}
              </div>

              {/* Hint */}
              {brain.thoughts.length>0&&!selectedId&&(
                <div style={{ position:"absolute",bottom:12,right:12,fontSize:10,color:P.textDim,background:P.surface+"cc",padding:"6px 10px",borderRadius:6,border:`1px solid ${P.border}` }}>
                  Click any node to explore
                </div>
              )}
            </div>

            {/* Right sidebar — selected thought */}
            <div style={S.sidebar}>
              {selectedId && brain.thoughts.find(t=>t.id===selectedId) ? (()=>{
                const t = brain.thoughts.find(x=>x.id===selectedId);
                const col = dColor(t.domain);
                const conns = brain.edges.filter(e=>e.source===t.id||e.target===t.id);
                return (
                  <div style={S.sidePanel}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                      <span style={S.tag(col)}>{t.domain}</span>
                      <button style={{ ...S.btn(),padding:"5px 10px",fontSize:11 }} onClick={()=>setOpenThought(t)}>
                        ⬡ Open Full View
                      </button>
                    </div>
                    <p style={{ fontSize:13,fontWeight:600,lineHeight:1.5,color:P.text,marginBottom:10 }}>{t.summary}</p>
                    <span style={S.sectionLabel}>Insight</span>
                    <p style={{ fontSize:12,color:P.blue,lineHeight:1.5 }}>{t.keyInsight}</p>
                    {t.implication&&<><span style={S.sectionLabel}>Implies</span><p style={{ fontSize:11,color:P.textMid,lineHeight:1.5 }}>{t.implication}</p></>}
                    {t.question&&<><span style={S.sectionLabel}>Open Question</span><p style={{ fontSize:11,color:P.purple,lineHeight:1.5,fontStyle:"italic" }}>"{t.question}"</p></>}
                    <span style={S.sectionLabel}>Connections ({conns.length})</span>
                    {conns.length===0?<p style={{ fontSize:11,color:P.textDim }}>None yet.</p>:
                      conns.map(e=>{
                        const oid=e.source===t.id?e.target:e.source;
                        const ot=brain.thoughts.find(x=>x.id===oid); if(!ot) return null;
                        return (
                          <div key={e.id} style={{ ...S.tCard(false),padding:8,marginBottom:6 }}
                            className="tcard" onClick={()=>{ setSelectedId(ot.id); setOpenThought(ot); }}>
                            <span style={{ fontSize:9,color:e.type==="contradiction"?P.red:P.gold,fontWeight:700 }}>
                              {e.type==="contradiction"?"⚡ contradicts":"⟷ connects"}
                            </span>
                            <p style={{ fontSize:11,color:P.textDim,margin:"3px 0 0",lineHeight:1.4 }}>{ot.summary?.slice(0,70)}…</p>
                          </div>
                        );
                      })
                    }
                    <button style={{ ...S.btn("danger"),marginTop:12,fontSize:11 }} onClick={()=>deleteThought(t.id)}>Remove thought</button>
                  </div>
                );
              })() : (
                <div style={{ ...S.sidePanel,display:"flex",alignItems:"center",justifyContent:"center" }}>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ width:40,height:40,borderRadius:"50%",border:`1px solid ${P.border}`,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center" }}>
                      <div style={{ width:6,height:6,borderRadius:"50%",background:P.gold,opacity:0.5 }} />
                    </div>
                    <p style={{ color:P.textDim,fontSize:11,lineHeight:1.8 }}>Select a node<br/>to inspect</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════ FEED VIEW ════════ */}
        {view==="add" && (
          <div style={{ flex:1,overflow:"auto",display:"flex",justifyContent:"center",padding:"24px 16px" }}>
            <div style={{ width:"100%",maxWidth:580 }}>
              <h2 style={{ fontSize:17,fontWeight:700,color:P.gold,marginBottom:3,fontFamily:"Georgia,serif" }}>Feed Your Brain</h2>
              <p style={{ fontSize:11,color:P.textDim,marginBottom:22 }}>Every input is read, analysed, connected, and stored permanently.</p>

              {isProcessing ? (
                <div style={{ textAlign:"center",padding:"50px 0" }}>
                  <div style={{ fontSize:28,animation:"spin 2s linear infinite",display:"inline-block" }}>⬡</div>
                  <p style={{ color:P.gold,fontSize:13,marginTop:12 }}>{procStatus}</p>
                  <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
                </div>
              ) : (<>
                {/* Voice + Text */}
                <span style={S.sectionLabel}>Thought / Voice</span>
                <div style={{ position:"relative" }}>
                  <textarea value={inputText} onChange={e=>setInputText(e.target.value)} rows={4}
                    placeholder="Speak or type — a theory, belief, observation, half-formed idea…"
                    style={{ ...S.input,paddingRight:46 }}
                    onKeyDown={e=>{ if(e.key==="Enter"&&e.metaKey) handleTextSubmit(); }} />
                  <button onClick={()=>startVoice("input")} style={{ position:"absolute",right:10,top:10,background:listening?"#e85d4a22":"#12122a",border:`1px solid ${listening?P.red:P.border}`,borderRadius:7,padding:"6px 9px",cursor:"pointer",fontSize:13,color:listening?P.red:P.textDim }}>
                    {listening?"⏹":"🎙"}
                  </button>
                </div>
                {listening&&<p style={{ fontSize:10,color:P.red,marginTop:3 }}>● Listening…</p>}
                <button className="action-btn" style={{ ...S.btn(),marginTop:8 }} onClick={handleTextSubmit} disabled={!inputText.trim()}>
                  Process Thought →
                </button>

                {/* URL */}
                <span style={{ ...S.sectionLabel,display:"block" }}>URL / Article / Website</span>
                <div style={{ display:"flex",gap:8 }}>
                  <input value={inputUrl} onChange={e=>setInputUrl(e.target.value)} placeholder="https://…"
                    style={{ ...S.input,flex:1 }} onKeyDown={e=>e.key==="Enter"&&handleUrlSubmit()} />
                  <button className="action-btn" style={S.btn()} onClick={handleUrlSubmit} disabled={!inputUrl.trim()}>Fetch</button>
                </div>

                {/* File drop */}
                <span style={{ ...S.sectionLabel,display:"block" }}>PDF / Image / Text File</span>
                <div onClick={()=>fileRef.current?.click()}
                  onDragOver={e=>e.preventDefault()}
                  onDrop={e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f){const dt=new DataTransfer();dt.items.add(f);fileRef.current.files=dt.files;handleFile({target:{files:dt.files}});} }}
                  style={{ border:`2px dashed ${P.border}`,borderRadius:10,padding:22,textAlign:"center",cursor:"pointer",transition:"border-color 0.2s" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=P.gold+"44"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=P.border}>
                  <p style={{ color:P.textDim,fontSize:12,margin:0 }}>📎 Drop PDF, image, or text file<br/><span style={{ fontSize:10 }}>or click to browse</span></p>
                </div>
                <input ref={fileRef} type="file" accept=".pdf,.txt,.md,image/*" style={{ display:"none" }} onChange={handleFile} />

                <div style={{ height:20 }} />
              </>)}
            </div>
          </div>
        )}

        {/* ════════ CHAT VIEW ════════ */}
        {view==="chat" && (
          <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
            <div style={{ flex:1,overflow:"auto",padding:16,display:"flex",flexDirection:"column",gap:10 }}>
              {chatHistory.length===0&&(
                <div style={{ textAlign:"center",padding:"40px 20px" }}>
                  <p style={{ color:P.gold,fontSize:14,fontFamily:"Georgia,serif",marginBottom:8 }}>Your Brain Awaits</p>
                  <p style={{ color:P.textDim,fontSize:12,lineHeight:1.9 }}>
                    It holds everything you've fed it.<br/>Ask it to think with you.
                  </p>
                  {[
                    "What patterns connect my strongest beliefs?",
                    "Where do my theories contradict each other?",
                    "What is my core thesis on India's future?",
                  ].map(q=>(
                    <div key={q} onClick={()=>setChatInput(q)}
                      style={{ background:P.surfaceHigh,border:`1px solid ${P.border}`,borderRadius:8,padding:"8px 14px",margin:"6px auto",maxWidth:340,cursor:"pointer",fontSize:11,color:P.textMid,transition:"all 0.18s" }}>
                      "{q}"
                    </div>
                  ))}
                  {brain.thoughts.length===0&&<p style={{ color:P.red,fontSize:11,marginTop:16 }}>⚠ No thoughts yet — add some first.</p>}
                </div>
              )}
              {chatHistory.map((m,i)=>(
                <div key={i} style={{ display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                  <div style={S.chatBubble(m.role)}>
                    <pre style={{ margin:0,whiteSpace:"pre-wrap",fontFamily:"Inter,sans-serif",fontSize:13,lineHeight:1.65 }}>{m.content}</pre>
                  </div>
                </div>
              ))}
              {chatLoading&&(
                <div style={{ alignSelf:"flex-start" }}>
                  <div style={S.chatBubble("assistant")}>
                    <span style={{ color:P.textDim,fontSize:12 }}>Thinking across your knowledge…</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ borderTop:`1px solid ${P.border}`,padding:10,display:"flex",gap:8,background:P.surface }}>
              <button onClick={()=>startVoice("chat")} style={S.voiceBtn(listening&&activeVoiceTarget.current==="chat")}>
                {listening&&activeVoiceTarget.current==="chat"?"⏹":"🎙"}
              </button>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleChat();} }}
                placeholder="Ask your brain anything…"
                style={{ ...S.input,flex:1,padding:"10px 14px" }} />
              <button className="action-btn" style={S.btn()} onClick={handleChat} disabled={!chatInput.trim()||chatLoading}>Send</button>
            </div>
          </div>
        )}

        {/* ════════ LIBRARY VIEW ════════ */}
        {view==="library" && (
          <div style={{ flex:1,overflow:"auto",padding:20 }}>
            <div style={{ maxWidth:760,margin:"0 auto" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
                <h2 style={{ fontSize:16,fontWeight:700,color:P.gold,margin:0,fontFamily:"Georgia,serif" }}>Knowledge Library</h2>
                <div style={{ display:"flex",gap:8 }}>
                  <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
                    style={{ ...S.input,width:150,padding:"6px 10px",fontSize:11 }} />
                  <select value={domainFilter} onChange={e=>setDomainFilter(e.target.value)}
                    style={{ ...S.input,width:120,padding:"6px 10px",fontSize:11 }}>
                    <option value="All">All domains</option>
                    {DOMAINS.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                    style={{ ...S.input,width:110,padding:"6px 10px",fontSize:11 }}>
                    <option value="newest">Newest</option>
                    <option value="domain">Domain</option>
                    <option value="confidence">Confidence</option>
                  </select>
                </div>
              </div>

              {/* Domain breakdown */}
              <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:20 }}>
                {Object.entries(brain.thoughts.reduce((a,t)=>{ a[t.domain]=(a[t.domain]||0)+1;return a; },{})).map(([d,n])=>(
                  <div key={d} onClick={()=>setDomainFilter(domainFilter===d?"All":d)}
                    style={{ padding:"5px 12px",borderRadius:20,background:dColor(d)+(domainFilter===d?"33":"18"),border:`1px solid ${dColor(d)}${domainFilter===d?"66":"33"}`,cursor:"pointer",fontSize:11,color:dColor(d),fontWeight:600,transition:"all 0.18s" }}>
                    {d} <span style={{ opacity:0.6 }}>{n}</span>
                  </div>
                ))}
              </div>

              {/* Thought grid */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(330px,1fr))",gap:12 }}>
                {filtered.map(t=>(
                  <div key={t.id} className="tcard" style={{ ...S.tCard(selectedId===t.id),padding:14 }}
                    onClick={()=>{ setSelectedId(t.id); setOpenThought(t); }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                      <span style={S.tag(dColor(t.domain))}>{t.domain}</span>
                      <span style={{ fontSize:9,color:P.textDim }}>{new Date(t.timestamp).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</span>
                    </div>
                    <p style={{ fontSize:12,fontWeight:600,color:P.text,lineHeight:1.5,margin:"0 0 7px" }}>{t.summary}</p>
                    <p style={{ fontSize:11,color:P.textMid,lineHeight:1.4,margin:"0 0 8px" }}>{t.keyInsight?.slice(0,100)}{t.keyInsight?.length>100?"…":""}</p>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div>{(t.tags||[]).slice(0,3).map(g=><span key={g} style={S.tag(P.textDim)}>{g}</span>)}</div>
                      <span style={{ fontSize:10,color:t.confidence==="conviction"?P.gold:t.confidence==="belief"?P.blue:P.textDim,fontWeight:600 }}>
                        {t.confidence}
                      </span>
                    </div>
                    {brain.edges.filter(e=>e.source===t.id||e.target===t.id).length > 0 && (
                      <div style={{ marginTop:6,fontSize:9,color:P.gold }}>
                        ⟷ {brain.edges.filter(e=>e.source===t.id||e.target===t.id).length} connection{brain.edges.filter(e=>e.source===t.id||e.target===t.id).length!==1?"s":""}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {filtered.length===0&&(
                <div style={{ textAlign:"center",padding:50,color:P.textDim,fontSize:12 }}>
                  {brain.thoughts.length===0?"No thoughts yet. Go to Feed →":"No thoughts match this filter."}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ════════ THOUGHT MODAL ════════ */}
      {openThought && (
        <ThoughtModal
          thought={openThought}
          allThoughts={brain.thoughts}
          edges={brain.edges}
          onClose={()=>setOpenThought(null)}
          onNavigate={t=>{ setSelectedId(t.id); setOpenThought(t); }}
          onDelete={deleteThought}
        />
      )}
    </div>
  );
}
