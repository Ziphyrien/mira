<script lang="ts">
  import { untrack } from 'svelte';
  import {persistResearchDraft} from './draft.svelte';
  import { Tabs, Checkbox } from 'bits-ui';
  import Modal from '#lib/ui/Modal.svelte';
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import ResponseCriteriaEditor from './ResponseCriteriaEditor.svelte';
  import PlanDetails from './PlanDetails.svelte';
  import Dropdown from '#lib/ui/Dropdown.svelte';
  import type { ResearchPlan, ResearchQuestion } from '#lib/contracts/research.js';
  let { initial, questionId, readonly = false, onsave, onclose, draftScope, draftVersion }: { draftScope:string;draftVersion:string; initial: ResearchPlan; questionId?: string; readonly?: boolean; onsave: (plan: ResearchPlan) => Promise<void>; onclose: () => void } = $props();
  let plan = $state(untrack(() => structuredClone(initial)));
  const draft=persistResearchDraft({scope:untrack(()=>draftScope),name:'plan',context:untrack(()=>draftVersion+JSON.stringify(initial)),initial:untrack(()=>structuredClone(initial)),read:()=>plan,restore:value=>{if(!readonly)plan=value;},enabled:()=>!readonly});
  const question = $derived(plan.questions.find(q => q.id === questionId));
  const preceding = $derived.by(()=>{if(!question)return [];return plan.followupPolicy.coreOrder==='adaptive'?plan.questions.filter(q=>q.id!==question.id):plan.questions.slice(0,plan.questions.indexOf(question));});
  type Condition = ResearchQuestion['applicability']['all'][number];
  function conditionOperators(rule:Condition) {
    const source=preceding.find(q=>q.id===rule.questionId);
    const ops: {id:Condition['operator'];label:string}[]=[{id:'answered',label:'有实质回答'}];
    if(source?.responsePolicy.options.length) ops.push({id:'nonresponse',label:'选择非回答选项'});
    if(source?.kind==='multiple') ops.push({id:'includes',label:'包含选项'});
    else {ops.push({id:'eq',label:'等于'},{id:'neq',label:'不等于'});if(source&&['rating','slider','number'].includes(source.kind)) ops.push({id:'gt',label:'大于'},{id:'gte',label:'大于或等于'},{id:'lt',label:'小于'},{id:'lte',label:'小于或等于'});}
    return ops;
  }
  function setOperator(rule:Condition,operator:Condition['operator']) {
    rule.operator=operator;
    const source=preceding.find(q=>q.id===rule.questionId)!;
    if(operator==='answered') rule.value=null;
    else if(operator==='nonresponse') rule.value=source.responsePolicy.options[0]?.id??'';
    else if(['number','rating','slider'].includes(source.kind)) rule.value=source.min;
    else rule.value=source.options[0]?.id??'';
  }
  let editing=$state(untrack(()=>!questionId&&!readonly));
  let busy = $state(false);
  let failure = $state('');
  async function save(event: SubmitEvent) { event.preventDefault(); busy = true; failure = ''; try { await onsave($state.snapshot(plan)); await draft.clear(); onclose(); } catch (e) { failure = e instanceof Error ? e.message : '请重试。'; } finally { busy = false; } }
</script>

<Modal open={true} onOpenChange={open => { if (!open && !busy) onclose(); }} title={question ? '题目详情' : '研究方案'} closeButton="icon" class="max-w-xl" placement="bottom">
  {#if !readonly&&draft.restored}<p class="mb-4 flex items-center justify-between text-xs text-base-content/55">已恢复本地草稿<button type="button" class="btn btn-ghost btn-xs" disabled={busy} onclick={draft.discard}>放弃草稿</button></p>{/if}
  {#if readonly || (question && !editing)}
    <PlanDetails {plan} {question} />
    {#if !readonly}<div class="modal-action"><button type="button" class="btn btn-primary btn-sm" onclick={()=>editing=true}><span class="icon-[lucide--pencil] size-4" aria-hidden="true"></span>编辑题目</button></div>{/if}
  {:else}
  <form class="space-y-5" onsubmit={save}>
    <fieldset disabled={readonly || busy} class="space-y-4">
      {#if question}
        <section class="space-y-4">
        <div class="fieldset"><label class="fieldset-legend" for="question-prompt">题目</label><textarea id="question-prompt" class="textarea min-h-24 w-full" bind:value={question.prompt} maxlength="500" required></textarea></div>
        {#if question.temporal}<div class="rounded-box border border-base-300 p-3 text-sm"><p class="font-medium">回答参考期</p><p class="text-base-content/70 mt-2">{question.temporal.description}</p>{#if question.temporal.from}<p class="text-base-content/60 text-xs">{question.temporal.from} — {question.temporal.until}</p>{/if}</div>{/if}
        <div class="fieldset"><label class="fieldset-legend" for="question-help">说明</label><input id="question-help" class="input w-full" bind:value={question.help} maxlength="400" /></div>
        {#if question.options.length}<div class="space-y-3">{#each question.options as option, i (option.id)}<div class="flex items-center gap-3"><label for={'option-' + option.id} class="text-base-content/50 w-6 text-sm">{i + 1}</label><input id={'option-' + option.id} class="input w-full" bind:value={option.label} maxlength="120" required /></div>{/each}</div>{/if}
        {#if ['rating', 'slider', 'number'].includes(question.kind)}
          <div class="grid grid-cols-2 gap-4">
            <div class="fieldset"><label class="fieldset-legend" for="q-min">下界</label><input id="q-min" class="input w-full" type="number" step="any" bind:value={question.min} required /></div>
            <div class="fieldset"><label class="fieldset-legend" for="q-max">上界</label><input id="q-max" class="input w-full" type="number" step="any" bind:value={question.max} required /></div>
            <div class="fieldset"><label class="fieldset-legend" for="q-low">下界含义</label><input id="q-low" class="input w-full" bind:value={question.lowLabel} maxlength="80" /></div>
            <div class="fieldset"><label class="fieldset-legend" for="q-high">上界含义</label><input id="q-high" class="input w-full" bind:value={question.highLabel} maxlength="80" /></div>
            <div class="fieldset"><label class="fieldset-legend" for="q-step">步长</label><input id="q-step" class="input w-full" type="number" step="any" min="0.001" bind:value={question.step} required /></div>
          </div>
        {/if}
        </section>
        <div class="divide-y divide-base-300 border-y border-base-300">
        <Disclosure triggerClass="py-4 font-medium text-sm">{#snippet trigger(open)}<span>作答安排</span><span class={["icon-[lucide--chevron-down] ml-auto size-4",open&&"rotate-180"]}></span>{/snippet}<div class="space-y-6 pb-5">
        <section class="space-y-3">
          <h3 class="font-medium">跳过本题</h3>
          
          <label class="fieldset"><span class="fieldset-legend">测量与缺失处理依据</span><textarea class="textarea w-full" bind:value={question.responsePolicy.rationale} maxlength="500" required></textarea></label>
          {#each question.responsePolicy.options as option (option.id)}
            <div class="space-y-2 border-t border-base-300 pt-3">
              <label class="fieldset"><span class="fieldset-legend">参与者看到的选项</span><input class="input w-full" bind:value={option.label} maxlength="120" required /></label>
              <Dropdown label="记录含义" value={option.kind} options={[{id:'declined',label:'不愿回答'},{id:'unknown',label:'不知道／记不清'},{id:'not_applicable',label:'参与者选择不适用'},{id:'unspecified',label:'未收集原因'}]} onChange={v=>option.kind=v} disabled={readonly||busy} />
              <Dropdown label="选择后" value={option.next} options={[{id:'continue',label:'继续适用题目'},{id:'finish',label:'结束访谈'}]} onChange={v=>option.next=v} disabled={readonly||busy} />
              <button type="button" class="btn btn-ghost btn-sm" onclick={()=>question.responsePolicy.options=question.responsePolicy.options.filter(o=>o.id!==option.id)}>移除此选项</button>
            </div>
          {/each}
          <button type="button" class="btn btn-outline btn-sm" onclick={()=>question.responsePolicy.options.push({id:'nr_'+crypto.randomUUID().replaceAll('-',''),label:'不愿回答',kind:'declined',next:'continue'})}>添加非回答选项</button>
        </section>
        <section class="space-y-3">
          <h3 class="font-medium">适用条件</h3>
          <p class="text-base-content/60 text-xs">全部条件满足时呈现本题；无条件时适用于所有参与者。前置资料缺失会单独记录。</p>
          <label class="fieldset"><span class="fieldset-legend">适用范围依据</span><textarea class="textarea w-full" bind:value={question.applicability.rationale} maxlength="500" required></textarea></label>
          {#each question.applicability.all as rule (rule)}
            {@const source=preceding.find(q=>q.id===rule.questionId)}
            <div class="space-y-2 border-t border-base-300 pt-3">
              <Dropdown label="前置题目" value={rule.questionId} options={preceding.map(q=>({id:q.id,label:q.prompt}))} onChange={v=>{rule.questionId=v;setOperator(rule,'answered');}} disabled={readonly||busy} />
              <Dropdown label="条件" value={rule.operator} options={conditionOperators(rule)} onChange={v=>setOperator(rule,v)} disabled={readonly||busy} />
              {#if rule.operator!=='answered' && source}
                {#if rule.operator==='nonresponse'}
                  <Dropdown label="非回答选项" value={String(rule.value??'')} options={source.responsePolicy.options} onChange={v=>rule.value=v} disabled={readonly||busy} />
                {:else if source.options.length}
                  <Dropdown label="回答选项" value={String(rule.value??'')} options={source.options} onChange={v=>rule.value=v} disabled={readonly||busy} />
                {:else if ['number','rating','slider'].includes(source.kind)}
                  <label class="fieldset"><span class="fieldset-legend">比较数值</span><input class="input w-full" type="number" step="any" value={rule.value} onchange={e=>rule.value=Number(e.currentTarget.value)} required /></label>
                {:else}
                  <label class="fieldset"><span class="fieldset-legend">比较文字</span><input class="input w-full" bind:value={rule.value} required /></label>
                {/if}
              {/if}
              <button type="button" class="btn btn-ghost btn-sm" onclick={()=>question.applicability.all=question.applicability.all.filter(r=>r!==rule)}>移除此条件</button>
            </div>
          {/each}
          {#if preceding.length}<button type="button" class="btn btn-outline btn-sm" onclick={()=>question.applicability.all.push({questionId:preceding[0].id,operator:'answered',value:null})}>添加前置条件</button>{/if}
        </section>
        </div></Disclosure>
        <Disclosure triggerClass="py-4 font-medium text-sm">{#snippet trigger(open)}<span>收集用途</span><span class={["icon-[lucide--chevron-down] ml-auto size-4",open&&"rotate-180"]}></span>{/snippet}<div class="space-y-4 pb-5">
        <Dropdown label="关联维度" value={question.constructId} options={[{id:'',label:'单独分析'},...plan.constructs.map(c=>({id:c.id,label:c.name}))]} disabled={readonly||busy} onChange={v=>{question.constructId=v;if(!v)question.reverse=false;}} />
        <div class="fieldset"><label class="fieldset-legend" for="question-purpose">收集用途</label><textarea id="question-purpose" class="textarea w-full" bind:value={question.purpose} maxlength="500"></textarea></div>
        {#if ['rating','slider','number'].includes(question.kind)}
          <label class="flex items-center gap-3 text-sm"><Checkbox.Root class="checkbox checkbox-sm" bind:checked={question.reverse} disabled={readonly || busy} aria-label="反向计分" />反向计分</label>
        {/if}
        </div></Disclosure>
        </div>
      {:else}
        <Tabs.Root value="topic">
          <Tabs.List class="tabs tabs-border mb-4" aria-label="方案编辑"><Tabs.Trigger class="tab data-[state=active]:tab-active" value="topic">课题</Tabs.Trigger><Tabs.Trigger class="tab data-[state=active]:tab-active" value="method">方法</Tabs.Trigger><Tabs.Trigger class="tab data-[state=active]:tab-active" value="constructs">维度</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="topic" class="space-y-4">
            <div class="fieldset"><label class="fieldset-legend" for="plan-title">参与者看到的标题</label><input id="plan-title" class="input w-full" bind:value={plan.title} maxlength="100" required /></div>
            {#each ([['question', '研究问题'], ['topicReview', '课题调整'], ['welcome', '参与者开场'], ['closing', '参与者收尾']] as const) as [key, label] (key)}<div class="fieldset"><label class="fieldset-legend" for={'plan-' + key}>{label}</label><textarea id={'plan-' + key} class="textarea w-full" bind:value={plan[key]} maxlength="500" required></textarea></div>{/each}
          </Tabs.Content>
          <Tabs.Content value="method" class="space-y-4">
            <ResponseCriteriaEditor {plan} disabled={readonly||busy} />
            <label class="flex items-center gap-3"><Checkbox.Root class="checkbox checkbox-sm" bind:checked={plan.followupPolicy.enabled} />核心题后允许补充追问</label>
            <Dropdown label="追问时机" value={plan.followupPolicy.placement} options={[{id:"after_core",label:"预定题目之后"},{id:"interleaved",label:"可结合回答穿插追问"}]} onChange={v=>plan.followupPolicy.placement=v} disabled={readonly||busy||!plan.followupPolicy.enabled} />
            <Dropdown label="预定题目的顺序" value={plan.followupPolicy.coreOrder} options={[{id:"fixed",label:"按方案顺序"},{id:"adaptive",label:"结合回答选择下一道适用题"}]} onChange={v=>plan.followupPolicy.coreOrder=v} disabled={readonly||busy} />
            <div class="fieldset"><label class="fieldset-legend" for="followup-rationale">追问安排依据</label><textarea id="followup-rationale" class="textarea w-full" bind:value={plan.followupPolicy.rationale} maxlength="500" required></textarea></div>
            <div class="fieldset"><label class="fieldset-legend" for="estimated-minutes">预计时长 / 分钟</label><input id="estimated-minutes" class="input w-full" type="number" min="0.1" step="any" bind:value={plan.estimatedMinutes} /><p class="fieldset-label">供参与者安排时间，可根据预试调整</p></div>
            {#each ([['design', '研究设计'], ['unitOfAnalysis', '分析单位'], ['estimand', '估计目标'], ['sampleSizeRationale', '样本量依据'], ['biasControls', '偏差处理'], ['validationPlan', '测量验证']] as const) as [key, label] (key)}<div class="fieldset"><label class="fieldset-legend" for={'method-' + key}>{label}</label><textarea id={'method-' + key} class="textarea w-full" bind:value={plan.methodology[key]} maxlength="500" required></textarea></div>{/each}
            {#each ([['population', '对象范围评估（研究者查看）'], ['sampling', '抽样'], ['recruitment', '招募'], ['pilot', '预试']] as const) as [key, label] (key)}<div class="fieldset"><label class="fieldset-legend" for={'plan-' + key}>{label}</label><textarea id={'plan-' + key} class="textarea w-full" bind:value={plan[key]} maxlength="500" required></textarea></div>{/each}
          </Tabs.Content>
          <Tabs.Content value="constructs" class="divide-base-300 divide-y">
            {#each plan.constructs as c (c.id)}
              <div class="space-y-4 py-4"><div class="fieldset"><label class="fieldset-legend" for={'name-' + c.id}>名称</label><input id={'name-' + c.id} class="input w-full" bind:value={c.name} maxlength="80" required /></div><div class="fieldset"><label class="fieldset-legend" for={'definition-' + c.id}>定义</label><textarea id={'definition-' + c.id} class="textarea w-full" bind:value={c.definition} maxlength="500" required></textarea></div><Dropdown label="汇总方式" value={c.scoring} options={[{ id: 'items_only', label: '逐题描述' }, { id: 'exploratory_mean', label: '探索性均值' }]} onChange={v => c.scoring = v} disabled={readonly || busy} />
                <div class="fieldset"><label class="fieldset-legend" for={'evidence-' + c.id}>依据</label><textarea id={'evidence-' + c.id} class="textarea w-full" bind:value={c.evidence} maxlength="500" required></textarea></div><div class="fieldset"><label class="fieldset-legend" for={'interpretation-' + c.id}>解释</label><textarea id={'interpretation-' + c.id} class="textarea w-full" bind:value={c.interpretation} maxlength="500" required></textarea></div>
              </div>
            {/each}
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </fieldset>
    {#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}
    <div class="modal-action"><button type="button" class="btn btn-ghost" disabled={busy} onclick={onclose}>关闭</button>{#if !readonly}<button type="submit" class="btn btn-primary" disabled={busy}>{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}保存</button>{/if}</div>
  </form>
  {/if}
</Modal>
