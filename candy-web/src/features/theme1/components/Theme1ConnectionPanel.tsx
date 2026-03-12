import type { ChangeEvent } from "react";
import { useTheme1Store } from "@/features/theme1/hooks/useTheme1Store";

export function Theme1ConnectionPanel() {
  const mode = useTheme1Store((state) => state.mode);
  const session = useTheme1Store((state) => state.session);
  const connection = useTheme1Store((state) => state.connection);
  const setSessionField = useTheme1Store((state) => state.setSessionField);
  const connect = useTheme1Store((state) => state.connect);
  const disconnect = useTheme1Store((state) => state.disconnect);
  const useMockMode = useTheme1Store((state) => state.useMockMode);
  const refresh = useTheme1Store((state) => state.refresh);

  function updateField(key: keyof typeof session) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setSessionField(key, event.target.value);
    };
  }

  return (
    <section className="connection-panel">
      <div className="connection-panel__head">
        <div>
          <p className="connection-panel__eyebrow">Realtime bridge</p>
          <h2>Backend session</h2>
        </div>
        <span className={`connection-panel__badge connection-panel__badge--${connection.phase}`}>
          {connection.label}
        </span>
      </div>

      <div className="connection-panel__grid">
        <label>
          <span>Backend URL</span>
          <input value={session.baseUrl} onChange={updateField("baseUrl")} placeholder="http://127.0.0.1:4000" />
        </label>

        <label>
          <span>Room code</span>
          <input value={session.roomCode} onChange={updateField("roomCode")} placeholder="ABCD12" />
        </label>

        <label>
          <span>Player ID</span>
          <input value={session.playerId} onChange={updateField("playerId")} placeholder="player-123" />
        </label>

        <label>
          <span>Access token</span>
          <input value={session.accessToken} onChange={updateField("accessToken")} placeholder="valgfri portal-token" />
        </label>
      </div>

      <div className="connection-panel__actions">
        <button type="button" onClick={() => void connect()}>
          Koble til
        </button>
        <button type="button" onClick={() => void refresh()} disabled={mode !== "live"}>
          Oppdater state
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={connection.phase !== "connected" && connection.phase !== "connecting"}
        >
          Koble fra
        </button>
        <button type="button" onClick={useMockMode}>
          Bruk mock
        </button>
      </div>

      <p className="connection-panel__message">
        {connection.message ||
          "Skriv inn romkode og eventuelt playerId. Hvis playerId finnes lokalt prover klienten room:resume forst, ellers room:state."}
      </p>
    </section>
  );
}
