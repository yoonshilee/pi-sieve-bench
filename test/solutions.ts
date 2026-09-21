import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowId } from "../src/fixtures.ts";
export const solutions: Record<WorkflowId, Record<string, string>> = {
    payments: {
        "src/payments.ts": `export async function pay(store,gateway,request){
  const {key,customerId,amountCents}=request;
  if(typeof key!=="string"||!key.trim()||typeof customerId!=="string"||!customerId.trim()||!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error("INVALID_REQUEST");
  store.pending??=new Map();
  const entry=store.pending.get(key)??store.payments.get(key);
  if(entry){if(entry.customerId!==customerId||entry.amountCents!==amountCents)throw new Error("KEY_CONFLICT");return entry.promise??entry;}
  const reservation={customerId,amountCents};
  const promise=Promise.resolve().then(()=>gateway.charge(customerId,amountCents)).then(charge=>{store.payments.set(key,charge);return charge;}).finally(()=>store.pending.delete(key));
  reservation.promise=promise;store.pending.set(key,reservation);return promise;
}
export async function handleWebhook(store,event){
  if(!event||typeof event.id!=="string"||!event.id.trim()||typeof event.chargeId!=="string"||!event.chargeId.trim()||event.type!=="payment.succeeded")throw new Error("INVALID_EVENT");
  if(store.events.has(event.id))return {accepted:false};store.events.add(event.id);
  if(!store.receipts.some(x=>x.chargeId===event.chargeId))store.receipts.push(event);
  return {accepted:true};
}
`,
    },
    "tenant-api": {
        "src/api.ts": `function tenant(value){if(typeof value!=="string"||!value.trim())throw new Error("INVALID_TENANT");}
function project(row){return {id:row.id,name:row.name};}
function select(rows,id){tenant(id);return rows.filter(x=>x.tenantId===id).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
export function listItems(rows,{tenantId,limit=20,cursor}={}){
  const all=select(rows,tenantId);if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("INVALID_LIMIT");
  let after="";if(cursor!==undefined&&cursor!==null){try{const value=JSON.parse(Buffer.from(cursor,"base64url").toString());if(value.tenantId!==tenantId||typeof value.after!=="string")throw new Error();after=value.after;}catch{throw new Error("INVALID_CURSOR");}}
  const remaining=all.filter(x=>x.id>after),items=remaining.slice(0,limit).map(project);
  return {items,nextCursor:remaining.length>limit?Buffer.from(JSON.stringify({tenantId,after:items.at(-1).id})).toString("base64url"):null};
}
export function getItem(rows,tenantId,id){tenant(tenantId);const row=rows.find(x=>x.id===id&&x.tenantId===tenantId);return row?project(row):null;}
export function legacyList(rows,tenantId){return select(rows,tenantId).map(project);}
`,
    },
    reconciliation: {
        "src/csv.ts": `export function parseCsv(text){
  text=text.replace(/^\\uFEFF/,"");const records=[];let record=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
    else if(c==='"')quoted=true;else if(c===','){record.push(field);field="";}else if(c==='\\n'||c==='\\r'){if(c==='\\r'&&text[i+1]==='\\n')i++;record.push(field);if(record.some(x=>x!==""))records.push(record);record=[];field="";}else field+=c;}
  if(quoted)throw new Error("INVALID_CSV");if(field||record.length){record.push(field);records.push(record);}
  const keys=records.shift()??[];return records.map(values=>{if(values.length!==keys.length)throw new Error("INVALID_CSV");return Object.fromEntries(keys.map((key,i)=>[key,values[i]]));});
}
`,
        "src/importer.ts": `import {parseCsv} from './csv.ts';
export function createLedger(){return new Map();}
export function importCsv(ledger,text){
  const rows=parseCsv(text),stats={inserted:0,duplicate:0,rejected:0};
  for(const row of rows){
    const match=/^(-?)(\\d+)(?:\\.(\\d{1,2}))?$/.exec(row.amount);const date=new Date(row.timestamp);
    if(!row.id?.trim()||row.currency!=="USD"||!match||!/(?:Z|[+-]\\d{2}:\\d{2})$/.test(row.timestamp)||!Number.isFinite(date.getTime())){stats.rejected++;continue;}
    const value=(BigInt(match[2])*100n+BigInt((match[3]??"").padEnd(2,"0")))*(match[1]? -1n:1n);const amountCents=Number(value);
    if(!Number.isSafeInteger(amountCents)){stats.rejected++;continue;}
    const item={id:row.id,day:date.toISOString().slice(0,10),amountCents,currency:"USD",note:row.note};const previous=ledger.get(row.id);
    if(previous){if(previous.day===item.day&&previous.amountCents===item.amountCents&&previous.currency===item.currency)stats.duplicate++;else stats.rejected++;}
    else{ledger.set(row.id,item);stats.inserted++;}
  }return stats;
}
`,
        "src/report.ts": `export function reconcile(ledger){const days={};let totalCents=0;for(const item of [...ledger.values()].sort((a,b)=>a.day.localeCompare(b.day))){totalCents+=item.amountCents;days[item.day]=(days[item.day]??0)+item.amountCents;}return {totalCents,days,count:ledger.size};}\n`,
        "reconciliation.json": JSON.stringify({ totalCents: 1000, days: { "2026-01-02": 1000 }, count: 2 }),
    },
    incident: {
        "src/retry.ts": `export function retryDecision({attempt,status,maxAttempts=4,retryAfter,nowMs=0}){
  if(attempt>=maxAttempts||![0,408,429,500,502,503,504].includes(status))return {retry:false,delayMs:0};
  let delay=Math.min(8000,250*2**(attempt-1));if([429,503].includes(status)&&retryAfter!==undefined){const numeric=Number(retryAfter);let requested=Number.isFinite(numeric)&&numeric>=0?numeric*1000:Date.parse(retryAfter)-nowMs;if(Number.isFinite(requested)&&requested>=0)delay=Math.min(8000,Math.max(delay,requested));}
  return {retry:true,delayMs:delay};
}
`,
        "src/worker.ts": `import {retryDecision} from './retry.ts';
export async function deliver(send,payload,{maxAttempts=4,sleep=async()=>{},now=()=>0}={}){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw new Error("INVALID_BUDGET");
  for(let attempt=1;attempt<=maxAttempts;attempt++){let result;try{result=await send(payload);}catch{result={status:0};}const decision=retryDecision({attempt,status:result.status,maxAttempts,retryAfter:result.retryAfter,nowMs:now()});
    if(!decision.retry)return {ok:result.status>=200&&result.status<300,attempts:attempt,status:result.status};await sleep(decision.delayMs);}
}
`,
        "src/dispatcher.ts": `import {deliver} from './worker.ts';
export function createDispatcher(){return {deliveries:new Map()};}
export async function dispatch(state,send,{key,payload},options={}){
  if(typeof key!=="string"||!key.trim())throw new Error("INVALID_KEY");const identity=JSON.stringify(payload),existing=state.deliveries.get(key);
  if(existing){if(existing.identity!==identity)throw new Error("KEY_CONFLICT");return existing.promise;}
  const promise=Promise.resolve().then(()=>deliver(send,payload,options)).then(result=>{if(!result.ok)state.deliveries.delete(key);return result;},error=>{state.deliveries.delete(key);throw error;});state.deliveries.set(key,{identity,promise});return promise;
}
`,
        "incident-report.json": JSON.stringify({ rootCause: "retry-storm", evidenceIds: ["q-101", "q-102"], mitigations: ["Bound retries"], remainingRisks: ["No production validation"] }),
    },
};
export async function installSolution(root: string, id: WorkflowId): Promise<void> {
    const files = { ...solutions[id], "verification.json": JSON.stringify({ completed: true, checks: ["Local regressions"] }), "test/regression.test.ts": "import {test} from 'node:test'; test('fixture reference check',()=>{});\n" };
    for (const [file, body] of Object.entries(files)) {
        await mkdir(join(root, file, ".."), { recursive: true });
        await writeFile(join(root, file), body);
    }
}
