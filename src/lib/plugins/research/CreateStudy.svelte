<script lang="ts">
  import Modal from '#lib/ui/Modal.svelte';
  import type { ResearchPlanning } from '#lib/contracts/research.js';
  import { researchRequest } from './client';
  let {open,onclose,oncreated}:{open:boolean;onclose:()=>void;oncreated:(study:ResearchPlanning)=>Promise<void>}=$props();
  let busy=$state(false),failure=$state(''),topic=$state(''),background=$state('');
  async function submit(event:SubmitEvent){event.preventDefault();busy=true;failure='';try{const study=await researchRequest<ResearchPlanning>('/api/research',{topic,background});await oncreated(study);onclose();}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{busy=false;}}
</script>
<Modal {open} onOpenChange={next=>{if(!next&&!busy)onclose();}} title="新建研究" closeButton="none" placement="bottom">
  <form class="space-y-5" onsubmit={submit}>
    <fieldset disabled={busy} class="space-y-5">
      <div class="fieldset"><label class="fieldset-legend" for="topic">想了解什么？</label><textarea id="topic" class="textarea min-h-28 w-full text-base" bind:value={topic} maxlength="2000" required></textarea></div>
      <div class="fieldset"><label class="fieldset-legend" for="background">补充背景（选填）</label><textarea id="background" class="textarea min-h-28 w-full" bind:value={background} maxlength="12000" placeholder="与这个问题有关的情况、已有材料或想法，都可以写在这里。"></textarea></div>
    </fieldset>
    {#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}
    <div class="modal-action"><button type="button" class="btn btn-ghost" disabled={busy} onclick={onclose}>取消</button><button class="btn btn-primary" type="submit" disabled={busy}>{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}准备方案</button></div>
  </form>
</Modal>
