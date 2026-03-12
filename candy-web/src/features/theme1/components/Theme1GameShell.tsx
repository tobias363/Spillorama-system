import { useEffect } from "react";
import { useTheme1Store } from "@/features/theme1/hooks/useTheme1Store";
import { Theme1ConnectionPanel } from "@/features/theme1/components/Theme1ConnectionPanel";
import { Theme1HudRack } from "@/features/theme1/components/Theme1HudRack";
import { Theme1TopperStrip } from "@/features/theme1/components/Theme1TopperStrip";
import { Theme1BoardGrid } from "@/features/theme1/components/Theme1BoardGrid";
import { Theme1BallRail } from "@/features/theme1/components/Theme1BallRail";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";

export function Theme1GameShell() {
  const snapshot = useTheme1Store((state) => state.snapshot);
  const session = useTheme1Store((state) => state.session);
  const connect = useTheme1Store((state) => state.connect);

  useEffect(() => {
    if (session.roomCode) {
      void connect();
    }
  }, []);

  return (
    <main
      className="theme1-app"
      style={{ backgroundImage: `linear-gradient(180deg, rgba(255, 245, 251, 0.02), rgba(255, 245, 251, 0.12)), url(${theme1Assets.backgroundUrl})` }}
    >
      <div className="theme1-app__backdrop" />

      <section className="theme1-app__header">
        <div>
          <p className="theme1-app__eyebrow">Candy Web Rebuild</p>
          <h1>Theme1 runtime rebuilt for web-first delivery</h1>
          <p className="theme1-app__lede">
            Ren startflate for ny klient. Denne appen skal overta UI/state/rendering gradvis, uten Unity-monolitten.
          </p>
        </div>

        <div className="theme1-app__status">
          <div>
            <span>Source</span>
            <strong>candy-web/</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>{snapshot.meta.backendUrl}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{snapshot.meta.connectionLabel}</strong>
          </div>
          <div>
            <span>Room</span>
            <strong>{snapshot.meta.roomCode || "Ingen room valgt"}</strong>
          </div>
        </div>
      </section>

      <Theme1ConnectionPanel />
      <Theme1TopperStrip toppers={snapshot.toppers} />
      <Theme1HudRack hud={snapshot.hud} />
      <Theme1BoardGrid boards={snapshot.boards} />
      <Theme1BallRail balls={snapshot.recentBalls} />
    </main>
  );
}
