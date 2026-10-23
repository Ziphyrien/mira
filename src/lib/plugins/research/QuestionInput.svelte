<script lang="ts">
  import { untrack } from 'svelte';
  import {legacyAnswer} from './drafts';
  import {persistResearchDraft} from './draft.svelte';
  import { Checkbox, RadioGroup } from 'bits-ui';
  import Modal from '#lib/ui/Modal.svelte';
  import Dropdown from '#lib/ui/Dropdown.svelte';
  import type { InterviewQuestion, AnswerValue } from '#lib/contracts/research.js';
  let { question: q, disabled = false, initial = null, submitLabel = '继续', draftKey, draftScope, draftName, onanswer }: { draftScope?:string;draftName?:string; question: InterviewQuestion; disabled?: boolean; initial?: AnswerValue; submitLabel?: string; draftKey?:string; onanswer: (value: AnswerValue, nonresponse?: string) => void } = $props();
  let text = $state(untrack(()=>typeof initial==='string'?initial:''));
  let selected = $state(untrack(()=>typeof initial==='string'?initial:''));
  let multiple = $state<string[]>(untrack(()=>Array.isArray(initial)?[...initial]:[]));
  let number = $state<number | undefined>(untrack(()=>typeof initial==='number'?initial:undefined));
  let touched = $state(untrack(()=>typeof initial==='number'));
  function draftValue():AnswerValue{if(q.kind==='text')return text;if(q.kind==='multiple')return multiple;if(['single','select'].includes(q.kind))return selected;return number??null;}
  persistResearchDraft<{value:AnswerValue}>({scope:untrack(()=>draftScope??''),name:untrack(()=>draftName??''),context:untrack(()=>JSON.stringify({q,initial})),initial:{value:untrack(draftValue)},enabled:()=>Boolean(draftScope)&&!disabled,read:()=>({value:draftValue()}),legacy:()=>draftKey?legacyAnswer(draftKey):undefined,restore:({value:saved})=>{
    if(q.kind==='text'&&typeof saved==='string')text=saved;
    else if(q.kind==='multiple'&&Array.isArray(saved))multiple=saved.filter(id=>q.options.some(o=>o.id===id));
    else if(['single','select'].includes(q.kind)&&typeof saved==='string'&&q.options.some(o=>o.id===saved))selected=saved;
    else if(typeof saved==='number'&&Number.isFinite(saved)&&saved>=q.min&&saved<=q.max){number=saved;touched=true;}
  }});
  let pendingNonresponse = $state<string | null>(null);
  function chooseNonresponse(id:string) {
    let hasInput=touched;
    if(q.kind==='text') hasInput=text.length>0;
    else if(q.kind==='multiple') hasInput=multiple.length>0;
    else if(['single','select'].includes(q.kind)) hasInput=Boolean(selected);
    if (hasInput) pendingNonresponse=id;
    else onanswer(null,id);
  }
  const values = $derived(q.kind === 'rating' ? Array.from({ length: Math.floor((q.max - q.min) / q.step) + 1 }, (_, i) => q.min + i * q.step) : []);
  const value = $derived.by<AnswerValue>(() => {
    if (q.kind === 'text') return text.trim();
    if (q.kind === 'multiple') return multiple;
    if (['single', 'select'].includes(q.kind)) return selected;
    return number ?? null;
  });
  const valid = $derived.by(() => {
    if (q.kind === 'text') return text.trim().length > 0;
    if (q.kind === 'multiple') return multiple.length > 0;
    if (['single', 'select'].includes(q.kind)) return Boolean(selected);
    return touched && number !== undefined;
  });
</script>

<form onsubmit={event => { event.preventDefault(); if (valid) onanswer(value); }}>
  <fieldset {disabled} class="min-w-0 space-y-6">
    <legend class="mb-4 w-full min-w-0 max-w-full whitespace-normal text-xl leading-relaxed font-medium [overflow-wrap:anywhere] sm:text-2xl">{q.prompt}</legend>
    {#if q.temporal}<p class="text-base-content/60 text-sm">{q.temporal.description}{#if q.referenceAt!==undefined}<span class="mt-1 block text-xs">以 {new Date(q.referenceAt).toLocaleString('zh-CN',{timeZone:q.timeZone})} 时的情况为准。</span>{/if}</p>{/if}
    {#if q.help}<p class="text-base-content/60 text-sm" id="question-help">{q.help}</p>{/if}
    {#if q.kind === 'text'}
      <label class="sr-only" for="answer-text">你的回答</label>
      <textarea id="answer-text" class="textarea min-h-36 w-full text-base" bind:value={text} rows="4" aria-describedby={q.help ? 'question-help' : undefined}></textarea>
    {:else if q.kind === 'single'}
      <RadioGroup.Root bind:value={selected} {disabled} class="grid gap-3" aria-label={q.prompt}>
        {#each q.options as option (option.id)}
          <label class={['flex min-h-12 cursor-pointer items-center gap-3 rounded-box border p-4', selected === option.id ? 'border-primary bg-primary/5' : 'border-base-300']}>
            <RadioGroup.Item class="radio radio-primary radio-sm" value={option.id} aria-label={option.label} />
            <span>{option.label}</span>
          </label>
        {/each}
      </RadioGroup.Root>
    {:else if q.kind === 'multiple'}
      <Checkbox.Group bind:value={multiple} {disabled} class="grid gap-3" aria-label={q.prompt}>
        {#each q.options as option (option.id)}
          <label class={['flex min-h-12 cursor-pointer items-center gap-3 rounded-box border p-4', multiple.includes(option.id) ? 'border-primary bg-primary/5' : 'border-base-300']}>
            <Checkbox.Root class="checkbox checkbox-primary checkbox-sm" value={option.id} aria-label={option.label} />
            <span>{option.label}</span>
          </label>
        {/each}
      </Checkbox.Group>
    {:else if q.kind === 'select'}
      <Dropdown label="请选择" value={selected} options={q.options} onChange={v => selected = v} {disabled} />
    {:else if q.kind === 'rating'}
      <RadioGroup.Root value={number === undefined ? '' : String(number)} onValueChange={v => { number = Number(v); touched = true; }} {disabled} class="flex flex-wrap gap-2" aria-label={q.prompt}>
        {#each values as n (n)}
          <RadioGroup.Item value={String(n)} class={['btn min-h-12 min-w-11 flex-1 px-2 font-normal', number === n ? 'btn-primary' : 'btn-outline border-base-300']} aria-label={String(n)}>{n}</RadioGroup.Item>
        {/each}
      </RadioGroup.Root>
      <div class="text-base-content/60 -mt-3 flex justify-between gap-6 text-xs"><span>{q.lowLabel}</span><span class="text-right">{q.highLabel}</span></div>
    {:else if q.kind === 'slider'}
      <div class="space-y-4 py-2">
        <label for="answer-slider" class="block text-center text-2xl tabular-nums">{touched ? number : '—'}</label>
        <input id="answer-slider" class="range range-primary w-full" type="range" min={q.min} max={q.max} step={q.step} value={number ?? q.min + (q.max - q.min) / 2} oninput={event => { number = Number(event.currentTarget.value); touched = true; }} />
        <div class="text-base-content/60 flex justify-between gap-6 text-xs"><span>{q.min} · {q.lowLabel}</span><span class="text-right">{q.max} · {q.highLabel}</span></div>
      </div>
    {:else}
      <label class="sr-only" for="answer-number">你的回答</label>
      <input id="answer-number" class="input input-lg w-full" type="number" inputmode="decimal" min={q.min} max={q.max} step={q.step} bind:value={number} oninput={() => touched = true} required />
    {/if}
    <div class="flex flex-wrap items-center justify-between gap-4 pt-3">
      <div class="flex flex-wrap gap-2">{#each q.responsePolicy.options as option (option.id)}<button type="button" class="btn btn-ghost text-base-content/60" onclick={() => chooseNonresponse(option.id)} {disabled}>{option.label}</button>{/each}</div>
      <button type="submit" class="btn btn-primary min-w-28" disabled={!valid || disabled}>
        {#if disabled}<span class="loading loading-spinner loading-sm" aria-label="保存中"></span>{:else}{submitLabel}<span class="icon-[lucide--arrow-right] size-4" aria-hidden="true"></span>{/if}
      </button>
    </div>
  </fieldset>
</form>
<Modal open={pendingNonresponse !== null} onOpenChange={open=>{if(!open)pendingNonresponse=null;}} title="放弃本题已填内容？" closeButton="none">
  <p class="text-base-content/70 text-sm">本题将记录为“{q.responsePolicy.options.find(o=>o.id===pendingNonresponse)?.label}”，已填内容不作为本题回答保存。</p>
  {#snippet footer()}<button class="btn btn-ghost" onclick={()=>pendingNonresponse=null}>继续填写</button><button class="btn btn-primary" onclick={()=>{if(pendingNonresponse){onanswer(null,pendingNonresponse);pendingNonresponse=null;}}}>确认</button>{/snippet}
</Modal>
