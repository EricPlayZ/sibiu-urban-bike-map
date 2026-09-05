import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { loginFailureMessage } from "../lib/teamApi";
import { fadeExit, panelSpring } from "../lib/uiMotion";
import { useApp } from "../store";

export function TeamLogin() {
  const open = useApp((s) => s.teamLoginOpen);
  const login = useApp((s) => s.teamLogin);
  const closeTeamLogin = useApp((s) => s.closeTeamLogin);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTeamLogin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeTeamLogin]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password, name);
      setPassword("");
    } catch (err) {
      setError(loginFailureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="team-login"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-login-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={fadeExit()}
        >
          <button type="button" className="team-login-scrim" onClick={closeTeamLogin} aria-label="Închide" />
          <motion.div
            className="team-login-card"
            initial={{ scale: 0.96, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={panelSpring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="team-login-head">
              <h1 id="team-login-title">Acces editare</h1>
              <button type="button" className="icon-x" onClick={closeTeamLogin} aria-label="Închide">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>
        <form className="team-login-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            Nume
                <input
                  type="text"
                  name="name"
                  autoComplete="nickname"
                  maxLength={24}
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                Parolă
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  required
                />
              </label>
              {error ? <p className="team-login-error">{error}</p> : null}
              <button type="submit" className="btn primary wide" disabled={busy}>
                {busy ? "Se verifică…" : "Intră în editare"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
