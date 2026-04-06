import { useEffect, useState, type ChangeEvent } from "react";
import {
  isLocalTheme1RuntimeHost,
  useTheme1Store,
} from "@/features/theme1/hooks/useTheme1Store";

const LOCAL_BACKEND_URL = "http://127.0.0.1:4000";

function resolveAccessTokenSourceLabel(source: string) {
  switch (source) {
    case "url":
      return "URL";
    case "storage":
      return "lagret session";
    case "launch-token":
      return "launch-resolve";
    case "portal-storage":
      return "portal-innlogging";
    case "manual":
      return "manuelt felt";
    default:
      return "mangler";
  }
}

function maskAccessToken(accessToken: string) {
  const trimmed = accessToken.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function Theme1ConnectionPanel() {
  const mode = useTheme1Store((state) => state.mode);
  const session = useTheme1Store((state) => state.session);
  const accessTokenSource = useTheme1Store((state) => state.accessTokenSource);
  const connection = useTheme1Store((state) => state.connection);
  const setSessionField = useTheme1Store((state) => state.setSessionField);
  const connect = useTheme1Store((state) => state.connect);
  const disconnect = useTheme1Store((state) => state.disconnect);
  const useMockMode = useTheme1Store((state) => state.useMockMode);
  const refresh = useTheme1Store((state) => state.refresh);
  const triggerMockDraw = useTheme1Store((state) => state.triggerMockDraw);
  const startLocalLiveSession = useTheme1Store((state) => state.startLocalLiveSession);
  const [expanded, setExpanded] = useState(false);
  const isLocalRuntimeHost =
    typeof window !== "undefined" && isLocalTheme1RuntimeHost(window.location.hostname);
  const hasAccessToken = session.accessToken.trim().length > 0;
  const isLocalDemoMode = mode === "mock";
  const tokenSourceLabel = resolveAccessTokenSourceLabel(accessTokenSource);
  const maskedAccessToken = hasAccessToken ? maskAccessToken(session.accessToken) : "";
  const tokenPillLabel = isLocalRuntimeHost
    ? hasAccessToken
      ? `Token lastet fra ${tokenSourceLabel}`
      : isLocalDemoMode
        ? "Lokal demo aktiv · token ikke nodvendig"
        : "Access token mangler"
    : hasAccessToken
      ? "Portal-innlogging aktiv"
      : "Logg inn i portalen for å åpne Candy";
  const tokenHintText = isLocalRuntimeHost
    ? hasAccessToken
      ? `Klienten bruker token fra ${tokenSourceLabel}. Hvis du åpnet siden med accessToken i URL-en er det nå lagret lokalt også.`
      : isLocalDemoMode
        ? "Du er i lokal demo/mock-modus. Access token trengs ikke for `Test lokal trekning`."
        : "Denne backend-en krever accessToken i socket-payload. Lim inn token, eller åpne spillet med accessToken i URL-en."
    : "Når du er logget inn i portalen på samme host, bruker Candy den sessionen automatisk. Du trenger ikke lime inn token manuelt.";

  useEffect(() => {
    if (connection.phase === "error" || connection.phase === "disconnected") {
      setExpanded(true);
    }
  }, [connection.phase]);

  useEffect(() => {
    if (!session.roomCode) {
      return;
    }

    if (mode === "mock" || session.accessToken || connection.phase === "connected") {
      setExpanded(false);
    }
  }, [connection.phase, mode, session.accessToken, session.roomCode]);

  function updateField(key: keyof typeof session) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setSessionField(key, event.target.value);
    };
  }

  function useLocalBackendPreset() {
    setSessionField("baseUrl", LOCAL_BACKEND_URL);
    setSessionField("playerId", "");
  }

  return (
    <section
      className={`connection-panel${expanded ? "" : " connection-panel--collapsed"}`.trim()}
    >
      <div className="connection-panel__head">
        <div>
          <p className="connection-panel__eyebrow">Realtime bridge</p>
          <h2>Backend session</h2>
        </div>
        <div className="connection-panel__head-actions">
          <span className={`connection-panel__badge connection-panel__badge--${connection.phase}`}>
            {connection.label}
          </span>
          <button
            className="connection-panel__toggle"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Skjul" : "Vis"}
          </button>
        </div>
      </div>

      <p className="connection-panel__summary">
        {mode === "live"
          ? `${session.roomCode || "Ingen room"}${session.playerId ? ` • ${session.playerId}` : ""}${session.baseUrl ? ` • ${session.baseUrl}` : ""}`
          : `${session.roomCode || "Ingen room"}${session.playerId ? ` • ${session.playerId}` : ""}${session.baseUrl ? ` • ${session.baseUrl}` : ""}`}
      </p>

      <div className="connection-panel__session-meta" aria-live="polite">
        <span
          className={`connection-panel__token-pill${hasAccessToken || isLocalDemoMode ? " connection-panel__token-pill--ready" : ""}`.trim()}
        >
          {tokenPillLabel}
        </span>
        {hasAccessToken && isLocalRuntimeHost ? (
          <span className="connection-panel__token-preview">{maskedAccessToken}</span>
        ) : null}
      </div>

      {expanded ? (
        <>
          <div className="connection-panel__grid">
            <label>
              <span>Backend URL</span>
              <input
                value={session.baseUrl}
                onChange={updateField("baseUrl")}
                placeholder="http://127.0.0.1:4000"
              />
            </label>

            <label>
              <span>Room code</span>
              <input value={session.roomCode} onChange={updateField("roomCode")} placeholder="ABCD12" />
            </label>

            <label>
              <span>Player ID</span>
              <input
                value={session.playerId}
                onChange={updateField("playerId")}
                placeholder="player-123"
              />
            </label>

            {isLocalRuntimeHost ? (
              <label>
                <span>Access token</span>
                <input
                  type="password"
                  value={session.accessToken}
                  onChange={updateField("accessToken")}
                  placeholder="påkrevd socket-token"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            ) : null}
          </div>

          <div className="connection-panel__actions">
            <button type="button" onClick={() => void connect()}>
              Koble til
            </button>
            {isLocalRuntimeHost ? (
              <button type="button" onClick={useLocalBackendPreset}>
                Bruk lokal backend
              </button>
            ) : null}
            {isLocalRuntimeHost ? (
              <button type="button" onClick={() => void startLocalLiveSession()}>
                Start lokal live
              </button>
            ) : null}
            {isLocalRuntimeHost ? (
              <button type="button" onClick={triggerMockDraw}>
                Test lokal trekning
              </button>
            ) : null}
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
            {isLocalRuntimeHost ? (
              <button type="button" onClick={useMockMode}>
                Bruk mock
              </button>
            ) : null}
          </div>

          <p className="connection-panel__message">
            {connection.message ||
              "Skriv inn romkode og eventuelt playerId. Hvis playerId finnes lokalt prover klienten room:resume forst, ellers room:state."}
          </p>
          <p className="connection-panel__message connection-panel__message--hint">
            {tokenHintText}
            {isLocalRuntimeHost
              ? " Bruk `Bruk lokal backend` for å tvinge `127.0.0.1:4000` og tømme gammel playerId."
              : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
