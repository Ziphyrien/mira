<script lang="ts">
 import type {ResearchStudy} from '#lib/contracts/research.js';
 import type {ResearchAnalysis} from '#lib/contracts/research-analysis.js';
 import {researchRequest} from './client';
 import {createQuery,useQueryClient} from '@tanstack/svelte-query';
 import {researchQuery,invalidateResearch} from './queries';
 const queries=useQueryClient();
 let {study}:{study:ResearchStudy}=$props();
 let failure=$state(''),retrying=$state<string|null>(null);
 const query=createQuery(()=>({...researchQuery<ResearchAnalysis[]>('/api/research/'+study.id+'/analyses'),refetchInterval:current=>current.state.data?.some(r=>r.status==='queued'||r.status==='generating')?2500:false}));
 const reports=$derived(query.data??[]),loading=$derived(query.isPending);
 const endpoint=$derived('/api/research/'+study.id+'/analyses');

 async function retry(id?:string){retrying=id??'new';failure='';try{await researchRequest(endpoint,id?{id}:{action:'generate'});await invalidateResearch(queries,study.id);}catch(error){failure=error instanceof Error?error.message:'请重试。';}finally{retrying=null;}}
 function download(report:ResearchAnalysis){if(!report.report)return;const text=[study.plan.title,'收集截至 '+new Date(report.closedAt).toLocaleString(),report.sessions+' 份记录 · '+report.answers+' 条实质回答','',report.report.overview,...report.report.sections.flatMap(s=>['',s.title,s.text]),'','解释范围',...report.report.limitations,'','后续建议',...report.report.nextSteps].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='研究分析-'+report.id+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
</script>
{#if loading}<div class="py-12 text-center" role="status" aria-label="加载分析"><span class="loading loading-spinner loading-sm"></span></div>
{:else if !reports.length}<div class="space-y-3 py-12 text-center"><span class="icon-[lucide--file-text] text-base-content/30 mx-auto block size-9" aria-hidden="true"></span><p class="text-base-content/60 text-sm">{study.status==='closed'?'本轮还没有可用的分析。':'结束收集后，这里会生成本轮数据的分析。'}</p>{#if study.status==='closed'&&study.expiresAt&&Date.now()<study.expiresAt}<button class="btn btn-outline btn-sm" disabled={retrying!==null} onclick={()=>retry()}>生成分析</button>{/if}</div>
{:else}<div class="space-y-8">{#each reports as report (report.id)}<article class="rounded-box border border-base-300 p-5 sm:p-6"><header class="mb-5 flex items-start justify-between gap-3"><div><h2 class="font-medium">截至 {new Date(report.closedAt).toLocaleString()} 的分析</h2><p class="mt-1 text-xs text-base-content/50">{report.sessions} 份记录 · {report.answers} 条实质回答</p></div>{#if report.status==='ready'}<button class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="下载分析文本" onclick={()=>download(report)}><span class="icon-[lucide--download] size-4" aria-hidden="true"></span></button>{/if}</header>
{#if report.status==='queued'||report.status==='generating'}<div role="status" class="flex items-center gap-3 py-6 text-sm text-base-content/60"><span class="loading loading-spinner loading-sm" aria-hidden="true"></span>正在整理本轮分析</div>
{:else if report.status==='failed'}<p role="alert" class="text-sm text-error">{report.error}</p><button class="btn btn-outline btn-sm mt-4" disabled={retrying===report.id} onclick={()=>retry(report.id)}>重试分析</button>
{:else if report.report}<div class="space-y-6 text-sm leading-relaxed"><p class="whitespace-pre-wrap">{report.report.overview}</p>{#each report.report.sections as section,index (index)}<section class="space-y-2"><h3 class="font-medium">{section.title}</h3><p class="whitespace-pre-wrap text-base-content/80">{section.text}</p></section>{/each}{#if report.report.limitations.length}<section><h3 class="mb-2 font-medium">解释范围</h3><ul class="list-disc space-y-2 pl-5 text-base-content/65">{#each report.report.limitations as text,index (index)}<li>{text}</li>{/each}</ul></section>{/if}{#if report.report.nextSteps.length}<section><h3 class="mb-2 font-medium">后续建议</h3><ul class="list-disc space-y-2 pl-5">{#each report.report.nextSteps as text,index (index)}<li>{text}</li>{/each}</ul></section>{/if}<p class="text-xs text-base-content/45">基于该次截止时的数据生成，后续回答不包含在本报告中。用于研究整理，解释与引用请结合原始数据核对。</p></div>{/if}</article>{/each}</div>{/if}
{#if failure||query.error}<p role="alert" class="text-error text-sm">{failure||query.error?.message}</p>{/if}
