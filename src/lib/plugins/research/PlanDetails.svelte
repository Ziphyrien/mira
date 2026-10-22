<script lang="ts">
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import type {ResearchPlan,ResearchQuestion} from '#lib/contracts/research.js';
  let {plan,question}:{plan:ResearchPlan;question?:ResearchQuestion}=$props();
  const names={text:'文字回答',single:'单选',multiple:'多选',select:'单选',rating:'评分',slider:'滑动评分',number:'数字回答'};
  const construct=$derived(plan.constructs.find(c=>c.id===question?.constructId));
  function conditionText(rule:ResearchQuestion['applicability']['all'][number]){
    const source=plan.questions.find(q=>q.id===rule.questionId);
    const title=source?.prompt??'前置题';
    if(rule.operator==='answered')return title+'：已回答';
    if(rule.operator==='nonresponse')return title+'：选择“'+(source?.responsePolicy.options.find(o=>o.id===rule.value)?.label??'未回答')+'”';
    const operators={eq:'为',neq:'不为',gt:'大于',gte:'至少为',lt:'小于',lte:'不超过',includes:'包含'};
    const value=source?.options.find(o=>o.id===rule.value)?.label??String(rule.value);
    return title+'：'+operators[rule.operator]+' '+value;
  }
</script>

<div class="space-y-6 text-sm leading-relaxed">
  {#if question}
    <section class="space-y-4">
      <p class="text-base-content/50 text-xs">第 {plan.questions.findIndex(q=>q.id===question.id)+1} 题 / {plan.questions.length} · {names[question.kind]}</p>
      <h2 class="pr-2 text-lg font-medium leading-relaxed break-words">{question.prompt}</h2>
      {#if question.help}<p class="text-base-content/65 whitespace-pre-wrap">{question.help}</p>{/if}
      {#if question.temporal}<p class="text-base-content/65">{question.temporal.description}</p>{/if}
      {#if question.options.length}
        <ol class="divide-base-300 divide-y rounded-box border border-base-300 px-4">{#each question.options as option,index (option.id)}<li class="flex gap-3 py-3"><span class="text-base-content/40 tabular-nums">{index+1}.</span><span>{option.label}</span></li>{/each}</ol>
      {:else if ['rating','slider','number'].includes(question.kind)}
        <div class="rounded-box border border-base-300 px-4 py-3"><div class="flex justify-between gap-6"><span>{question.min}{#if question.lowLabel}<span class="text-base-content/60 ml-2">{question.lowLabel}</span>{/if}</span><span>{#if question.highLabel}<span class="text-base-content/60 mr-2">{question.highLabel}</span>{/if}{question.max}</span></div><p class="text-base-content/45 mt-2 text-xs">间隔 {question.step}</p></div>
      {/if}
    </section>
    <div class="divide-base-300 divide-y border-y border-base-300">
      <Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>作答安排</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
        <div class="space-y-4 pb-5">
          {#if question.responsePolicy.options.length}<div class="flex flex-wrap gap-2">{#each question.responsePolicy.options as option (option.id)}<span class="rounded-full border border-base-300 px-3 py-1 text-xs">{option.label}{#if option.next==='finish'} · 结束本次作答{/if}</span>{/each}</div>{/if}
          <p>{question.responsePolicy.rationale}</p>
          {#if question.applicability.all.length}<div><p class="mb-2 font-medium">满足以下条件时出现</p><ul class="space-y-2 text-base-content/70">{#each question.applicability.all as rule,index (index)}<li>{conditionText(rule)}</li>{/each}</ul></div>{/if}
          <p class="text-base-content/65">{question.applicability.rationale}</p>
        </div>
      </Disclosure>
      <Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>收集用途</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
        <div class="space-y-3 pb-5"><p>{question.purpose}</p>{#if construct}<p class="text-base-content/65">{construct.name} · {construct.scoring==='items_only'?'逐题描述':'探索性汇总'}</p>{/if}{#if question.reverse}<p class="text-base-content/65">本题反向计分。</p>{/if}</div>
      </Disclosure>
    </div>
  {:else}
    <section class="space-y-3"><h2 class="text-lg font-medium">{plan.title}</h2><p>{plan.question}</p><p class="text-base-content/65">{plan.topicReview}</p></section>
    <div class="divide-base-300 divide-y border-y border-base-300">
      {#each [{title:'参与者说明',items:[['开场',plan.welcome],['结束',plan.closing]]},{title:'研究方法',items:[['设计',plan.methodology.design],['分析单位',plan.methodology.unitOfAnalysis],['估计目标',plan.methodology.estimand],['对象',plan.population],['抽样',plan.sampling],['招募',plan.recruitment],['样本量依据',plan.methodology.sampleSizeRationale],['偏差处理',plan.methodology.biasControls],['测量验证',plan.methodology.validationPlan],['预试',plan.pilot]]},{title:'题序与追问',items:[['题序',plan.followupPolicy.coreOrder==='fixed'?'按方案顺序':'结合回答选择下一道适用题'],['补充追问',plan.followupPolicy.enabled?'允许补充追问':'沿预定题目作答'],['安排依据',plan.followupPolicy.rationale]]}] as section (section.title)}
        <Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>{section.title}</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}<dl class="space-y-4 pb-5">{#each section.items as [label,value] (label)}<div><dt class="text-base-content/50 mb-1 text-xs">{label}</dt><dd class="whitespace-pre-wrap">{value}</dd></div>{/each}</dl></Disclosure>
      {/each}
      <Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>续答与资料完整度</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
        <div class="space-y-4 pb-5">
          {#if plan.progressPolicy}<p>续答期限：最近一次作答后 {plan.progressPolicy.returnWindowHours} 小时</p><p class="text-base-content/65">{plan.progressPolicy.rationale}</p>{:else}<p>续答至本研究停止收集。</p>{/if}
          {#if plan.responseCriteria}<p>{plan.responseCriteria.rationale}</p>{#each [{label:'完整资料',rule:plan.responseCriteria.complete},{label:'部分资料',rule:plan.responseCriteria.partial}] as entry (entry.label)}{#if entry.rule}<div><p>{entry.label}：适用题至少回答 {Math.round(entry.rule.minimumAnsweredFraction*100)}%</p>{#if entry.rule.essentialQuestionIds.length}<ul class="mt-2 space-y-1 text-base-content/65">{#each entry.rule.essentialQuestionIds as id (id)}<li>{plan.questions.find(q=>q.id===id)?.prompt}</li>{/each}</ul>{/if}</div>{/if}{/each}{:else}<p>按逐题回答和覆盖比例描述资料。</p>{/if}
        </div>
      </Disclosure>
      {#each plan.constructs as construct (construct.id)}<Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>{construct.name}</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}<div class="space-y-3 pb-5"><p>{construct.definition}</p><p class="text-base-content/65">{construct.evidence}</p><p>{construct.interpretation}</p></div></Disclosure>{/each}
      <Disclosure triggerClass="py-4 font-medium">{#snippet trigger(open)}<span>解释范围</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}<ul class="space-y-3 pb-5">{#each plan.limitations as limitation (limitation)}<li>{limitation}</li>{/each}</ul></Disclosure>
    </div>
  {/if}
</div>
