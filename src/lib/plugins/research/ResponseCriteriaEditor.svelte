<script lang="ts">
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import type {ResearchPlan} from '#lib/contracts/research.js';
  let {plan,disabled=false}:{plan:ResearchPlan;disabled?:boolean}=$props();
</script>
<Disclosure triggerClass="text-base-content/60 text-sm py-2">
  {#snippet trigger(open)}<span>续答期限与资料完整度</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
  <div class="mt-3 space-y-4">
    {#if plan.progressPolicy}
      <label class="fieldset"><span class="fieldset-legend">最近一次作答后可续答多少小时</span><input class="input w-full" type="number" min="0.01" step="any" bind:value={plan.progressPolicy.returnWindowHours} {disabled} required/></label>
      <label class="fieldset"><span class="fieldset-legend">期限依据</span><textarea class="textarea w-full" bind:value={plan.progressPolicy.rationale} maxlength="500" {disabled} required></textarea></label>
      <button class="btn btn-ghost btn-sm" type="button" {disabled} onclick={()=>delete plan.progressPolicy}>使用收集截止时间</button>
    {:else}<p class="text-base-content/60 text-xs">当前可续答至研究停止收集。需要提前收口时，可让助手结合研究安排提出期限。</p>{/if}
    {#if plan.responseCriteria}
      <label class="fieldset"><span class="fieldset-legend">资料分类依据</span><textarea class="textarea w-full" bind:value={plan.responseCriteria.rationale} maxlength="500" {disabled} required></textarea></label>
      {#each [{name:'完整资料',rule:plan.responseCriteria.complete},{name:'部分资料',rule:plan.responseCriteria.partial}] as entry (entry.name)}
        {#if entry.rule}<div class="space-y-2 border-t border-base-300 pt-3"><p class="text-sm font-medium">{entry.name}</p><label class="fieldset"><span class="fieldset-legend">适用题的最低实答比例（0–1）</span><input class="input w-full" type="number" min="0" max="1" step="any" bind:value={entry.rule.minimumAnsweredFraction} {disabled} required/></label><p class="text-base-content/60 text-xs">需回答的关键题</p>{#each plan.questions as q (q.id)}<label class="flex items-start gap-2 text-xs"><input class="checkbox checkbox-xs" type="checkbox" checked={entry.rule.essentialQuestionIds.includes(q.id)} {disabled} onchange={e=>{const rule=entry.rule!;rule.essentialQuestionIds=e.currentTarget.checked?[...rule.essentialQuestionIds,q.id]:rule.essentialQuestionIds.filter(id=>id!==q.id);}}/>{q.prompt}</label>{/each}</div>{/if}
      {/each}
      <button class="btn btn-ghost btn-sm" type="button" {disabled} onclick={()=>delete plan.responseCriteria}>仅报告覆盖情况</button>
    {:else}<p class="text-base-content/60 text-xs">当前保留逐题回答与覆盖比例，分析时结合研究用途判断。</p>{/if}
  </div>
</Disclosure>
