import { AppError,body,failure,json,string } from '../../../lib/server';
import { repositoryTree,repositoryFile,validateRepo } from '../../../lib/repository';
export async function POST(request:Request){
  try{const data=await body(request);
    if(data.action==='tree')return json(await repositoryTree(string(data.url,'repository URL',2000),request.signal));
    if(data.action==='file')return json(await repositoryFile(validateRepo(data.repo),string(data.path,'file path',1000),string(data.sha,'file reference',40),request.signal));
    throw new AppError('Invalid repository action.');
  }catch(error){return failure(error);}
}
