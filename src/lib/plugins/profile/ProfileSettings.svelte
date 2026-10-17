<script lang="ts">
  import { getProfile } from "#lib/plugins/profile/context.js";
  import ProfileForm from "#lib/plugins/profile/ProfileForm.svelte";
  const profile = getProfile();
</script>

<ProfileForm
  profile={profile.profile}
  onSaved={(state) => profile.apply(state)}
/>
