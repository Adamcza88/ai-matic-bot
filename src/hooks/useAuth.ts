import { useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { allowlistedEmails, supabase } from "../lib/supabaseClient";

type AuthStatus = "checking" | "signed_out" | "ready" | "blocked";

type AuthState = {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  error?: string;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    status: "checking",
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const allowedListLoaded = useMemo(
    () => allowlistedEmails.length > 0,
    []
  );

  const evaluateSession = (session: Session | null) => {
    if (!session) {
      setState({ session: null, user: null, status: "signed_out" });
      return;
    }

    const email = session.user.email?.toLowerCase();
    if (
      !email ||
      !allowedListLoaded ||
      !allowlistedEmails.includes(email)
    ) {
      supabase.auth.signOut();
      setState({
        session: null,
        user: null,
        status: "blocked",
        error:
          allowedListLoaded && email
            ? "This app is not yet publicly released for your account."
            : "No allowlisted emails configured. Set VITE_ALLOWED_EMAILS.",
      });
      return;
    }

    setState({ session, user: session.user, status: "ready" });
  };

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          setState({
            session: null,
            user: null,
            status: "signed_out",
            error: error.message,
          });
          return;
        }
        evaluateSession(data.session);
      })
      .catch((err) => {
        setState({
          session: null,
          user: null,
          status: "signed_out",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      evaluateSession(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setIsAuthenticating(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setState((prev) => ({
        ...prev,
        error: error.message,
      }));
    }
    setIsAuthenticating(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({ session: null, user: null, status: "signed_out" });
  };

  return {
    ...state,
    signInWithGoogle,
    signOut,
    isAuthenticating,
  };
}
