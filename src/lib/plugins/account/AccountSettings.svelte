<script lang="ts">
  import { getAccount } from "#lib/plugins/account/context.js";
  import AccountForm from "#lib/plugins/account/AccountForm.svelte";
  const account = getAccount();
</script>

<AccountForm
  onReset={() => account.reset(null)}
  flushDraft={() => account.flushDraft(null)}
  clearDraft={() => account.clearDraft(null)}
/>
