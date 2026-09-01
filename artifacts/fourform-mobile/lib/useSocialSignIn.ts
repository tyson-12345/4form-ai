/**
 * What to do with a completed provider credential.
 *
 * Shared by the sign-in and sign-up screens because the answer does not depend
 * on which one you tapped from — "Continue with Apple" means the same thing on
 * both, and the server decides whether it is a sign-in, a signup, or a link.
 * Duplicating this per screen would let the two drift into disagreeing about
 * what an outcome means, which the user would experience as the button behaving
 * differently depending on where they pressed it.
 */

import { useCallback } from "react";
import { useRouter } from "expo-router";

import { oauth } from "./api";
import { useAuth } from "./authContext";
import { stashOAuth } from "./oauthHandoff";
import type { SocialCredential } from "./socialAuth";
import * as haptics from "./haptics";

export function useSocialSignIn(): (credential: SocialCredential) => Promise<void> {
  const router = useRouter();
  const { adoptSession } = useAuth();

  return useCallback(
    async (credential: SocialCredential) => {
      const outcome = await oauth.start(credential);

      if (outcome.kind === "signed-in") {
        await adoptSession(outcome.result);
        haptics.success();
        router.replace("/");
        return;
      }

      if (outcome.kind === "needs-registration") {
        stashOAuth({
          kind: "registration",
          token: outcome.registration,
          email: outcome.email,
          suggestedName: outcome.suggestedName,
        });
        router.push("/auth/complete-signup");
        return;
      }

      stashOAuth({
        kind: "link",
        token: outcome.challenge,
        email: outcome.email,
        message: outcome.message,
      });
      router.push("/auth/link-account");
    },
    [adoptSession, router],
  );
}
