import { FormEvent, useState } from "react";
import { useApp } from "../store";

export function TeamLogin() {
  const teamAuthed = useApp((s) => s.teamAuthed);
  const teamName = useApp((s) => s.teamName);
  const login = useApp((s) => s.teamLogin);
  const logout = useApp((s) => s.teamLogout);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goMap = () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password, name);
      setPassword("");
      goMap();
    } catch {
      setError("Parolă greșită sau serverul nu e disponibil.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="team-login">
      <div className="team-login-card">
        {teamAuthed ? (
          <>
            <h1>Echipă</h1>
            <p className="sub">Ești conectat ca {teamName}.</p>
            <div className="actions">
              <button type="button" className="btn primary" onClick={goMap}>
                Mergi la hartă
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await logout();
                }}
              >
                Ieși
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Acces echipă</h1>
            <p className="sub">Editarea hărții e doar pentru echipă. Vizitatorii nu văd acest ecran.</p>
            <form className="team-login-form" onSubmit={(e) => void onSubmit(e)}>
              <label className="field">
                Nume (îl văd colegii la lock)
                <input
                  type="text"
                  name="name"
                  autoComplete="nickname"
                  maxLength={24}
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  required
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
                {busy ? "Se verifică…" : "Intră"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
