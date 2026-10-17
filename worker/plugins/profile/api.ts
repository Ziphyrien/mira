import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { Profile, SpeechPreferences } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
export { profileNote, profileDescription } from "./prompt";

export interface ProfilePersistencePort {
  get(): Profile | null;
  set(profile: Profile): void;
  speech(): SpeechPreferences | null;
  setSpeech(input: unknown): SpeechPreferences;
}
export const ProfilePersistence = local("mira.profile.persistence", {
  version: 1,
  input: Type.Object({}),
  members: { store: opaque<ProfilePersistencePort>("mira.profile-writer@1") },
});
export const ProfileData = local("mira.profile.data", {
  version: 1,
  input: Type.Object({}),
  members: {
    get: method(Type.Null(), localValue<Profile | null>("mira.profile@1")),
    set: method(Type.Unknown(), Type.Void()),
  },
});
export const SpeechSettings = local("mira.speech.settings", {
  version: 1,
  input: Type.Object({}),
  members: {
    get: method(Type.Null(), localValue<SpeechPreferences | null>("mira.speech-preferences@1")),
    set: method(Type.Unknown(), localValue<SpeechPreferences>("mira.speech-preferences@1")),
  },
});
