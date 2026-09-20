'use client';

import Link from 'next/link';
import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Code2, FileCode2, Files, FolderOpen, GitBranch, GitFork, KeyRound, Layers3, LoaderCircle, Pause, Play, RotateCcw, Sparkles, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { demoAnalysis, demoFiles } from '../lib/demo';
import { detectProvider, MAX_FILE_BYTES, MAX_FILES, type Analysis, type Provider, type SourceFile } from '../lib/types';

async function api<T = Analysis & { models: {id:string;name:string}[]; content: string; error?: string; files: SourceFile[]; repo: {owner:string;name:string;ref:string} }>(endpoint: string, data: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal });
  if (signal?.aborted) throw new DOMException('Aborted','AbortError');
  const result = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function Syntax({ text }: { text: string }) {
  return <>{text.split(/(\/\/.*$|"[^"\n]*"|'[^'\n]*'|\b(?:export|function|const|return|type|number|import|from|if|else|async|await|class|def|let|for|in|new|true|false|null)\b|\b\d+(?:\.\d+)?\b)/g).map((token, i) => <span key={i} className={token.startsWith('//') ? 'token-comment' : /^["']/.test(token) ? 'token-string' : /^\d/.test(token) ? 'token-number' : /^(export|function|const|return|type|number|import|from|if|else|async|await|class|def|let|for|in|new|true|false|null)$/.test(token) ? 'token-keyword' : ''}>{token}</span>)}</>;
}

export default function Home() {
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState<Provider | ''>('');
  const [models, setModels] = useState<{id:string;name:string}[]>([]);
  const [model, setModel] = useState('');
  const [connected, setConnected] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [repo, setRepo] = useState<{owner:string;name:string;ref:string} | null>(null);
  const [files, setFiles] = useState<SourceFile[]>(demoFiles);
  const [selected, setSelected] = useState<string | null>('example.ts');
  const [analysis, setAnalysis] = useState<Analysis | null>(demoAnalysis);
  const [overview, setOverview] = useState<Analysis | null>(null);
  const [question, setQuestion] = useState('');
  const [demo, setDemo] = useState(true);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [guide, setGuide] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const activeCodeRef = useRef<HTMLDivElement>(null);
  const activeTextRef = useRef<HTMLButtonElement>(null);
  const file = files.find(f => f.path === selected);
  const step = analysis?.steps[active];

  useEffect(() => { if (guide) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [guide]);
  useEffect(() => {
    activeCodeRef.current?.scrollIntoView({block:'center',behavior:'smooth'});
    activeTextRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }, [active, selected, analysis]);
  useEffect(() => {
    if (!playing || !step) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => { if (active < (analysis?.steps.length || 0) - 1) setActive(a => a + 1); else setPlaying(false); };
    if (voice && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(step.explanation);
      utterance.rate = speed;
      utterance.onend = next;
      utterance.onerror = () => setPlaying(false);
      window.speechSynthesis.speak(utterance);
    } else timer = setTimeout(next, Math.max(4000, step.explanation.split(/\s+/).length / 3 * 1000) / speed);
    return () => { if (timer) clearTimeout(timer); window.speechSynthesis?.cancel(); };
  }, [playing, active, voice, speed, step, analysis]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name:'select_walkthrough_block',title:'Select walkthrough block',
        description:'Select an existing explanation block and highlight its source. This does not call a provider or send data.',
        inputSchema:{type:'object',properties:{index:{type:'integer',minimum:1}},required:['index'],additionalProperties:false},
        annotations:{readOnlyHint:false,untrustedContentHint:true},
        execute(input:unknown){
          const index=(input as {index?:unknown})?.index;
          if(typeof index!=='number'||!Number.isInteger(index)||index<1||index>(analysis?.steps.length||0))throw new Error('Invalid walkthrough block.');
          flushSync(()=>{setActive(index-1);setPlaying(false);});
          return {index,title:analysis!.steps[index-1].title};
        },
      },{signal:lifecycle.signal})).catch(()=>{});
    } catch { /* WebMCP is optional. */ }
    return ()=>lifecycle.abort();
  },[analysis]);

  function credentialsChanged(value: string, nextProvider?: Provider | '') {
    requestRef.current?.abort(); setBusy(''); setKey(value);
    setProvider(nextProvider ?? detectProvider(value.trim()));
    setConnected(false); setModels([]); setModel(''); setError('');
  }
  async function perform(label: string, work: (signal: AbortSignal) => Promise<void>) {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setBusy(label); setError(''); setPlaying(false);
    try { await work(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { if (requestRef.current === controller) setBusy(''); }
  }
  function showAnalysis(result: Analysis) { setAnalysis(result); setActive(0); setPlaying(false); }
  async function connect() {
    if (!key.trim() || !provider) { setError('Enter an API key and select its provider.'); return; }
    await perform('Connecting', async signal => {
      const result = await api('models', {key:key.trim(),provider}, signal);
      setModels(result.models); setModel(result.models[0]?.id || ''); setConnected(true);
    });
  }
  async function runAnalysis(target: SourceFile | null = file || null, currentFiles = files, currentRepo = repo, currentQuestion = question) {
    if (!connected || !model) { setError('Connect an API key and select a model.'); return; }
    await perform(target ? 'Analyzing file' : 'Mapping files', async signal => {
      let content = target?.content;
      if (target && content === undefined && currentRepo) {
        const result = await api('repository', {action:'file',repo:currentRepo,path:target.path,sha:target.sha}, signal);
        content = result.content;
        setFiles(previous => previous.map(f => f.path === target.path ? {...f,content} : f));
      }
      if (target) {
        const result = await api('analyze', {key:key.trim(),provider,model,question:currentQuestion,mode:'file',file:{path:target.path,content},paths:currentFiles.map(f=>f.path)}, signal);
        setSelected(target.path); showAnalysis(result);
      } else {
        // Every path receives an overview entry, in bounded batches.
        const steps: Analysis['steps'] = []; let summary = '';
        for (let i=0;i<currentFiles.length;i+=40) {
          setBusy(`Mapping files · ${Math.min(i+40,currentFiles.length)}/${currentFiles.length}`);
          const result = await api('analyze', {key:key.trim(),provider,model,question:currentQuestion,mode:'repository',files:currentFiles.slice(i,i+40).map(f=>({path:f.path})),paths:currentFiles.map(f=>f.path)}, signal);
          steps.push(...result.steps); if (!summary) summary=result.summary;
        }
        const result={summary,steps}; setOverview(result); setSelected(null); showAnalysis(result);
      }
    });
  }
  async function loadRepository() {
    if (!repoUrl.trim()) { setError('Enter a GitHub repository URL.'); return; }
    let imported: {files:SourceFile[];repo:{owner:string;name:string;ref:string}} | undefined;
    await perform('Loading repository', async signal => {
      imported = await api('repository', {action:'tree',url:repoUrl.trim()}, signal);
      if (!imported) return;
      setRepo(imported.repo); setFiles(imported.files); setSelected(null); setDemo(false); setOverview(null); showAnalysis({summary:'',steps:[]});
    });
    if (imported && connected) await runAnalysis(null, imported.files, imported.repo);
  }
  async function loadFiles(list: FileList | null) {
    if (!list?.length) return;
    await perform('Reading files', async signal => {
      if (Array.from(list).reduce((sum,f)=>sum+f.size,0)>12_000_000) throw new Error('Choose files totaling no more than 12 MB.');
      if (list.length > MAX_FILES) throw new Error(`Choose at most ${MAX_FILES} files.`);
      const imported: SourceFile[]=[];
      for (const f of Array.from(list)) {
        if (f.size > MAX_FILE_BYTES) throw new Error(`${f.name} exceeds the 120 KB file limit.`);
        const bytes = await f.arrayBuffer();
        if (signal.aborted) throw new DOMException('Aborted','AbortError');
        let content: string;
        try { content = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new Error(`${f.name} is not UTF-8 text.`); }
        if (content.includes('\0')) throw new Error(`${f.name} is a binary file. Choose text or source files.`);
        imported.push({path:f.webkitRelativePath || f.name,content});
      }
      if (new Set(imported.map(f=>f.path)).size!==imported.length) throw new Error('Files must have unique paths. Use the folder picker for duplicate names.');
      setFiles(imported); setRepo(null); setDemo(false); setOverview(null); setSelected(imported.length===1?imported[0].path:null); setAnalysis(null); setActive(0);
    });
    if (uploadRef.current) uploadRef.current.value='';
    if (folderRef.current) folderRef.current.value='';
  }
  async function selectFile(target: SourceFile) {
    if (busy) return;
    setSelected(target.path); setAnalysis(null); setActive(0); setPlaying(false);
    if (demo) {showAnalysis(demoAnalysis);return;}
    if (connected) await runAnalysis(target);
    else if (target.content === undefined && repo) await perform('Loading file', async signal => {
      const result=await api('repository',{action:'file',repo,path:target.path,sha:target.sha},signal);
      setFiles(previous=>previous.map(f=>f.path===target.path?{...f,content:result.content}:f));
    });
  }
  function move(index: number) { setActive(index); setPlaying(false); }

  return <main className="app-shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Codebreakdown home"><span className="brand-icon"><Code2 size={23}/></span><span>code<span className="brand-light">breakdown</span><span className="brand-dot">.</span></span></Link>
      <div className="top-actions"><span className="workspace-label">WORKSPACE / 01</span><button className="quiet guide-button" onClick={()=>setGuide(true)}><BookOpen size={16}/>Guide</button></div>
    </header>
    <section className="connection-bar" aria-label="Model connection">
      <label className="key-field"><span>API key</span><div className="input-icon"><KeyRound size={15}/><input aria-label="API key" type="password" value={key} onChange={e=>credentialsChanged(e.target.value)} autoComplete="off" spellCheck={false}/></div></label>
      <label><span>Provider</span><select aria-label="Provider" value={provider} onChange={e=>credentialsChanged(key,e.target.value as Provider)}><option value="">Select provider</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option></select></label>
      <button className={`connect-button ${connected?'connected':''}`} onClick={connect} disabled={!!busy}>{connected?<Check size={15}/>:<ArrowRight size={15}/>} {connected?'Connected':'Connect'}</button>
      <div className="connection-divider"/>
      <label className="model-field"><span>Model</span><select aria-label="Model" value={model} disabled={!models.length || !!busy} onChange={e=>setModel(e.target.value)}><option value="">Select model</option>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <span className="session-status"><i className={connected?'online':''}/>{connected?'Connected':'Not connected'}</span>
    </section>
    <section className="source-bar" aria-label="Code input">
      <label className="repo-field"><span>GitHub repository</span><div className="input-icon"><GitFork size={17}/><input aria-label="GitHub repository" value={repoUrl} onChange={e=>setRepoUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!busy)void loadRepository();}} placeholder="github.com / owner / repository"/><button aria-label="Load repository" onClick={loadRepository} disabled={!!busy}><ArrowRight size={18}/></button></div></label>
      <div className="source-or">/</div>
      <button className="outline source-button" disabled={!!busy} onClick={()=>uploadRef.current?.click()}><Upload size={16}/>Upload files</button>
      <button className="icon-button outline source-button" title="Browse folder" aria-label="Browse folder" disabled={!!busy} onClick={()=>folderRef.current?.click()}><FolderOpen size={18}/></button>
      <input hidden ref={uploadRef} type="file" multiple onChange={e=>void loadFiles(e.target.files)}/>
      <input hidden ref={folderRef} type="file" multiple {...{webkitdirectory:''}} onChange={e=>void loadFiles(e.target.files)}/>
    </section>
    {error && <div className="error-banner" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    <section className="workspace">
      <aside className="file-panel">
        <div className="panel-heading"><span><Files size={15}/>Explorer</span><span className="count">{files.length}</span></div>
        <div className="file-tree">
          <button className={`overview-row ${selected===null?'chosen':''}`} disabled={!!busy} onClick={()=>{setSelected(null);showAnalysis(overview||{summary:'',steps:[]});}}><Layers3 size={16}/>Overview</button>
          <div className="tree-root"><GitBranch size={14}/><span>{repo?.name || (demo?'Example':'Local files')}</span>{demo&&<span className="demo-tag">DEMO</span>}</div>
          {files.map(f=><button key={f.path} title={f.path} disabled={!!busy} className={`file-row ${selected===f.path?'chosen':''} ${selected===null&&step?.path===f.path?'mapped':''}`} onClick={()=>void selectFile(f)}><FileCode2 size={15}/><span>{f.path}</span>{selected===f.path&&<i/>}</button>)}
        </div>
        <div className="sidebar-footer"><span className="tiny-square"/> {repo?'GitHub':demo?'Example workspace':'Local workspace'}</div>
      </aside>
      <section className="code-panel">
        <div className="panel-heading"><span><FileCode2 size={15}/>{selected || 'Repository overview'}</span><span className="code-meta">{selected?`${file?.content?.split('\n').length || 0} lines`:`${files.length} files`}</span></div>
        <div className="code-scroll">
          {selected ? <div className="code-lines">{(file?.content || '').split('\n').map((line,index)=>{
            const highlighted=step && index+1>=step.startLine&&index+1<=step.endLine;
            return <div key={index} ref={index+1===step?.startLine?activeCodeRef:undefined} className={`code-line ${highlighted?'highlighted':''} ${index+1===step?.startLine?'block-start':''} ${index+1===step?.endLine?'block-end':''}`}><span className="line-number">{index+1}</span><code><Syntax text={line}/>{line?'':' '}</code></div>;
          })}</div> : <div className="overview-grid">{files.map(f=>{
            const explanation=analysis?.steps.find(s=>s.path===f.path);
            return <button key={f.path} className={`file-card ${step?.path===f.path?'active':''}`} disabled={!!busy} onClick={()=>void selectFile(f)}><FileCode2 size={22}/><strong>{f.path}</strong>{explanation&&<p>{explanation.explanation}</p>}<ArrowRight size={16}/></button>;
          })}</div>}
        </div>
        <div className="code-footer"><span>{selected?.split('.').pop()?.toUpperCase() || 'FILE MAP'}</span><span>{step&&selected?`Ln ${step.startLine}–${step.endLine}`:'—'}<span className="footer-dot">·</span>UTF-8</span></div>
      </section>
      <section className="explanation-panel">
        <div className="panel-heading"><span><Sparkles size={15}/>Walkthrough</span><span className="count">{analysis?.steps.length||0} blocks</span></div>
        <div className="narration-scroll">
          {analysis?.summary&&<div className="walkthrough-intro"><span className="eyebrow">{question&&!demo?'FOCUSED ANSWER':'THE BIG PICTURE'}</span><p>{analysis.summary}</p></div>}
          {analysis?.steps.map((s,index)=><button ref={index===active?activeTextRef:undefined} key={`${s.path||s.startLine}-${index}`} className={`narration-card ${index===active?'active':''}`} onClick={()=>move(index)} aria-current={index===active?'step':undefined}><span className="step-heading"><span className="step-number">{String(index+1).padStart(2,'0')}</span><span className="step-location">{selected?`LINES ${s.startLine}–${s.endLine}`:s.path}</span>{index===active&&<span className="active-dot"/>}</span><h2>{s.title}</h2><p>{s.explanation}</p></button>)}
          {!analysis?.steps.length&&!busy&&<div className="empty-state"><Sparkles size={28}/><span>Ready to analyze</span></div>}
          {!!busy&&<output className="busy-state"><LoaderCircle className="spin" size={20}/>{busy}</output>}
        </div>
        <div className="playback">
          <div className="progress-track"><div style={{width:`${analysis?.steps.length?((active+1)/analysis.steps.length)*100:0}%`}}/></div>
          <div className="playback-controls"><button className="icon-button" aria-label="Restart walkthrough" disabled={!analysis?.steps.length} onClick={()=>move(0)}><RotateCcw size={15}/></button><button className="icon-button" aria-label="Previous block" disabled={!active} onClick={()=>move(active-1)}><ChevronLeft size={20}/></button><button className="play-button" aria-label={playing?'Pause walkthrough':'Play walkthrough'} disabled={!analysis?.steps.length||!!busy} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}</button><button className="icon-button" aria-label="Next block" disabled={!analysis?.steps.length||active===analysis.steps.length-1} onClick={()=>move(active+1)}><ChevronRight size={20}/></button><span className="step-counter">{analysis?.steps.length?active+1:0}<span> / {analysis?.steps.length||0}</span></span><select className="speed" aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select><button className={`icon-button voice ${voice?'enabled':''}`} aria-label={voice?'Mute narration':'Enable spoken narration'} aria-pressed={voice} onClick={()=>setVoice(!voice)}>{voice?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div>
        </div>
      </section>
    </section>
    <footer className="question-bar"><div className="question-label"><Sparkles size={17}/><label htmlFor="question">Question <span>optional</span></label></div><textarea id="question" value={question} onChange={e=>setQuestion(e.target.value)} rows={1} aria-label="Question (optional)"/><button className="analyze-button" disabled={!!busy} onClick={()=>{if(connected&&model){setDemo(false);void runAnalysis();}else setError('Connect an API key and select a model.');}}>{busy?<LoaderCircle size={17} className="spin"/>:<Sparkles size={17}/>}Analyze<ArrowRight size={17}/></button>{!!busy&&<button className="quiet" onClick={()=>{requestRef.current?.abort();setBusy('');}}>Cancel</button>}</footer>
    <dialog ref={dialogRef} onCancel={()=>setGuide(false)} className="guide-dialog"><div className="guide-header"><span><BookOpen size={20}/>Guide</span><button className="icon-button" aria-label="Close guide" onClick={()=>setGuide(false)}><X size={20}/></button></div><div className="guide-content"><h2>Read code. See the connections.</h2><p>Codebreakdown turns source code into a guided, block-by-block explanation. The initial example is a prerecorded demo; your files are analyzed with your chosen model.</p><h3>1. Connect a model</h3><p>Enter an OpenAI, Anthropic, or Google Gemini API key. Recognizable prefixes select the provider; choose it manually for ambiguous keys. Connect loads the provider’s live model list. Select a model before analyzing.</p><h3>2. Choose your code</h3><p>Import a public GitHub repository, upload text files, or browse a local folder. A repository opens with an overview of every file’s likely role, inferred from its path. Select a file to read its actual code and generate a walkthrough. Uploads are read locally; press Analyze to send the selected file or generate a file overview.</p><h3>3. Follow the walkthrough</h3><p>Leave Question empty for a complete file explanation. Enter a question to focus on specific behavior. Select an explanation block to highlight its source lines. Play moves through the blocks; enable the speaker for browser narration. Change playback speed or move forward and back at any time.</p><h3>Data & limits</h3><p>Keys and code are kept in page memory, never local storage or an app database. Your key passes through this app’s server to the selected provider. Analysis sends selected code, file paths, and your question to that provider and may incur charges. Provider retention policies apply. Refreshing clears your session. Browser speech may use your operating system’s speech service.</p><p>Public repositories only, default branch, up to 1,500 files. File overviews use names, not contents, and can be wrong. Text files are limited to 120 KB; full-file analysis is divided into bounded sections when necessary. Binary files are not analyzed. AI explanations are not proof of correctness.</p><h3>Sandbox test runs</h3><p>A future Test run can generate tests, execute them in an isolated environment, and connect observed results to source lines. This version does not execute uploaded code. See the README for the proposed sandbox design and limits.</p></div></dialog>
  </main>;
}
