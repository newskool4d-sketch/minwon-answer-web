// Explicit fictional fixture only. Never pass user complaint text to this script.
import { generate, getProviderStatuses } from '../server/providers.mjs';
import { readdir, stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
if(!process.argv.includes('--live-fictional')){console.error('실제 구독 호출 검증: node scripts/smoke-claude.mjs --live-fictional');process.exit(2);}
const marker='MINWON_MVP_FICTIONAL_SMOKE_20261019';
const roots=[join(homedir(),'.claude','projects'),join(homedir(),'.claude','debug')];
const startedAt=Date.now();
async function changedFiles(root){let entries;try{entries=await readdir(root,{withFileTypes:true});}catch{return [];}const out=[];for(const entry of entries){const file=join(root,entry.name);if(entry.isDirectory())out.push(...await changedFiles(file));else if(entry.isFile()&&/\.(jsonl|json|txt|log)$/.test(file)){const meta=await stat(file);if(meta.mtimeMs>=startedAt-1000&&meta.size<10_000_000)out.push(file);}}return out;}
try{
 const statuses=await getProviderStatuses();const status=statuses.find(x=>x.id==='claude');
 if(status?.status!=='connected')throw new Error(status?.message||'Claude is not connected.');
 const result=await generate('claude',{stage:'draft',model:'default',input:{classification:'fictional',title:marker,fieldLabel:'시설·안전·체험교육',type:'일반민원',body:'전적으로 가상 사례입니다. 체험교육 신청 처리 여부와 누락된 안내의 조치를 묻습니다.',facts:'가상 신청은 정상 접수되어 참가 확정되었습니다. 안내 누락을 확인했습니다.',actions:'참가 확정 사실을 다시 안내하고 발송 확인 절차를 보완합니다.',department:'가상 운영팀',questionList:['신청 처리 결과는 무엇인가요?','안내 누락에 어떤 조치를 하나요?'],deadline:'2026-10-26',verifiedEvidence:[]}}, {signal:AbortSignal.timeout(180000)});
 const files=(await Promise.all(roots.map(changedFiles))).flat();let persisted=0;for(const file of files){if((await readFile(file,'utf8')).includes(marker))persisted++;}
 process.stdout.write(JSON.stringify({provider:'claude',realCall:true,fixture:'fictional-only',answerCharacters:result.answer.length,questions:result.questions.length,unresolved:result.unresolved.length,elapsedMs:Date.now()-startedAt,changedSessionOrDebugFilesChecked:files.length,promptMarkerPersistedFiles:persisted,localPersistenceCheck:persisted===0?'PASS':'FAIL'})+'\n');
 if(persisted)process.exitCode=1;
}catch(error){process.stderr.write(JSON.stringify({provider:'claude',realCallSucceeded:false,code:error.code||'SMOKE_FAILED',message:error.code?error.message:'실제 생성 검증에 실패했습니다. 원문과 인증정보는 출력하지 않습니다.',elapsedMs:Date.now()-startedAt})+'\n');process.exitCode=1;}
