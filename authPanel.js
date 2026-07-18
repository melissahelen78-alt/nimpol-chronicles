/**
 * Sign-in overlay + session persistence for NimpolXP.
 * Supabase stores the session in localStorage automatically;
 * users stay signed in across reloads until sign-out or cache clear.
 */

export async function getInitialSession(client) {
  const {
    data: { session },
    error
  } = await client.auth.getSession();

  if (error) throw error;
  return session;
}

export function createAuthController(client, { onSignedIn, onSignedOut } = {}) {
  const overlay = document.getElementById("authOverlay");
  const form = document.getElementById("authForm");
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const errorEl = document.getElementById("authError");
  const submitBtn = document.getElementById("authSubmitBtn");
  const statusEl = document.getElementById("authStatus");
  const statusText = document.getElementById("authStatusText");
  const signOutBtn = document.getElementById("authSignOutBtn");

  let signedIn = false;

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function setSubmitting(isSubmitting) {
    if (submitBtn) {
      submitBtn.disabled = isSubmitting;
      submitBtn.textContent = isSubmitting ? "Signing in…" : "Sign In";
    }
    if (emailInput) emailInput.disabled = isSubmitting;
    if (passwordInput) passwordInput.disabled = isSubmitting;
  }

  function showSignInPanel() {
    signedIn = false;
    overlay?.classList.add("open");
    overlay?.setAttribute("aria-hidden", "false");
    statusEl?.setAttribute("hidden", "");
    showError("");
    setSubmitting(false);
  }

  function showSignedInUI(session) {
    signedIn = true;
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
    showError("");

    if (statusEl && statusText) {
      const label = session?.user?.email || "Adventurer";
      statusText.textContent = `Cloud synced · ${label}`;
      statusEl.removeAttribute("hidden");
    }
  }

  async function handleSignedIn(session) {
    showSignedInUI(session);
    if (typeof onSignedIn === "function") {
      await onSignedIn(session);
    }
  }

  async function handleSignedOut() {
    showSignInPanel();
    if (typeof onSignedOut === "function") {
      await onSignedOut();
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    setSubmitting(true);

    const email = emailInput?.value.trim() ?? "";
    const password = passwordInput?.value ?? "";

    if (!email || !password) {
      showError("Enter your email and password.");
      setSubmitting(false);
      return;
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      showError(error.message);
      setSubmitting(false);
      return;
    }

    if (data.session) {
      await handleSignedIn(data.session);
    }

    setSubmitting(false);
  });

  signOutBtn?.addEventListener("click", async () => {
    signOutBtn.disabled = true;
    await client.auth.signOut();
    signOutBtn.disabled = false;
  });

  const { data: listener } = client.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session && !signedIn) {
      await handleSignedIn(session);
    } else if (event === "SIGNED_OUT") {
      await handleSignedOut();
    } else if (event === "TOKEN_REFRESHED" && session && signedIn) {
      showSignedInUI(session);
    }
  });

  async function bootstrap() {
    const session = await getInitialSession(client);

    if (session) {
      if (!signedIn) {
        await handleSignedIn(session);
      }
    } else {
      showSignInPanel();
    }
  }

  return {
    bootstrap,
    destroy: () => listener.subscription.unsubscribe()
  };
}
