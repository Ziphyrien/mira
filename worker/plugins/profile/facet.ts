import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { ProfileInput } from "../../../src/lib/contracts";
import { ProfileData, ProfilePersistence, SpeechSettings } from "./api";
import { ProfileStore } from "./store";
export function profileFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.profile",
    ...defineFacet(
      (api) => {
        api.serve(ProfilePersistence, (_input, _principal, self) => {
          const profile = self.resource("profile", {
            version: 1,
            open: () => new ProfileStore(scope.storage.sql),
          });
          return { store: self.expose(profile) };
        });
        api.serve(ProfileData, (_input, _principal, self) => {
          const profile = self.get(ProfilePersistence, {});
          return {
            get: () => profile.store!.get(),
            set: (input) => profile.store!.set(ProfileInput.parse(input)),
          };
        });
        api.serve(SpeechSettings, (_input, _principal, self) => {
          const profile = self.get(ProfilePersistence, {});
          return {
            get: () => profile.store!.speech(),
            set: (input) => profile.store!.setSpeech(input),
          };
        });
      },
      { uses: [ProfilePersistence] },
    ),
  };
}
