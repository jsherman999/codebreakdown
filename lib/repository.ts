import { AppError, upstream, readJson } from './server';
import { MAX_FILE_BYTES, MAX_FILES } from './types';
export function parseRepoUrl(value:string){
  let url:URL;try{url=new URL(value.startsWith('https://')?value:`https://${value}`);}catch{throw new AppError('Enter a valid GitHub repository URL.');}
  const parts=url.pathname.replace(/\/$/,'').split('/').filter(Boolean);
  if(url.hostname!=='github.com'||url.port||url.username||url.password||parts.length!==2||parts.some(p=>!/^[-\w.]+$/.test(p))){throw new AppError('Use a repository URL: https://github.com/owner/repository.');}
  return {owner:parts[0],name:parts[1].replace(/\.git$/,'')};
}
export function validateRepo(value:unknown){
  const r=value as {owner:string;name:string;ref:string};
  if(!r||![r.owner,r.name].every(s=>typeof s==='string'&&/^[-\w.]+$/.test(s))||typeof r.ref!=='string'||!/^[a-f0-9]{40}$/.test(r.ref))throw new AppError('Invalid repository reference.');return r;
}
const ghHeaders={'Accept':'application/vnd.github+json','User-Agent':'Codebreakdown','X-GitHub-Api-Version':'2022-11-28'};
export async function repositoryTree(url:string,signal?:AbortSignal){
  const repo=parseRepoUrl(url);const base=`https://api.github.com/repos/${repo.owner}/${repo.name}`;
  const response=await upstream(base,{headers:ghHeaders},signal);const metadata=await readJson<{default_branch:string;private:boolean}>(response);
  if(metadata.private)throw new AppError('Only public repositories are supported.');
  const treeResponse=await upstream(`${base}/git/trees/${encodeURIComponent(metadata.default_branch)}?recursive=1`,{headers:ghHeaders},signal);
  const tree=await readJson<{sha:string;truncated:boolean;tree:{type:string;path:string;sha:string;size?:number}[]}>(treeResponse,8_000_000);
  if(tree.truncated)throw new AppError('GitHub truncated this repository tree. Upload a smaller folder instead.',413);
  const files=tree.tree.filter(f=>f.type==='blob').map(({path,sha,size})=>({path,sha,size}));
  if(!files.length)throw new AppError('This repository has no files.');
  if(files.length>MAX_FILES)throw new AppError(`This repository exceeds ${MAX_FILES} files. Upload a smaller folder instead.`,413);
  return {repo:{...repo,ref:tree.sha},files};
}
export async function repositoryFile(repo:ReturnType<typeof validateRepo>,path:string,sha:string,signal?:AbortSignal){
  if(!/^[a-f0-9]{40}$/.test(sha))throw new AppError('Invalid file reference.');
  if(path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.')||path.length>1000)throw new AppError('Invalid file path.');
  // Blob SHA pins content to the imported tree even if the default branch changes.
  const response=await upstream(`https://api.github.com/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`,{headers:ghHeaders},signal);
  const data=await readJson<{size:number;encoding:string;content:string}>(response,200_000);
  if(data.size>MAX_FILE_BYTES)throw new AppError('This file exceeds the 120 KB analysis limit.',413);
  if(data.encoding!=='base64')throw new AppError('Unsupported GitHub file encoding.');
  const binary=atob(data.content.replace(/\s/g,''));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length>MAX_FILE_BYTES||bytes.includes(0))throw new AppError('Choose a text source file up to 120 KB.');
  let content:string;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AppError('This file is not UTF-8 text.');}
  return {content};
}
