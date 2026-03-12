import type { Theme1HudState } from "@/domain/theme1/renderModel";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";

interface Theme1HudRackProps {
  hud: Theme1HudState;
}

function ValuePanel({
  label,
  shellUrl,
  value,
}: {
  label: string;
  shellUrl: string;
  value: string;
}) {
  return (
    <article className="hud-card hud-card--value">
      <div className="hud-card__copy">
        <span>{label}</span>
      </div>
      <div className="hud-card__shell hud-card__shell--small">
        <img src={shellUrl} alt="" />
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export function Theme1HudRack({ hud }: Theme1HudRackProps) {
  return (
    <section className="hud-rack">
      <ValuePanel label="Saldo" shellUrl={theme1Assets.saldoPanelUrl} value={hud.saldo} />
      <ValuePanel label="Gevinst" shellUrl={theme1Assets.gevinstPanelUrl} value={hud.gevinst} />

      <article className="hud-card hud-card--countdown">
        <div className="hud-card__copy">
          <span>Neste trekning</span>
          <small>{hud.roomPlayers}</small>
        </div>
        <div className="hud-card__shell hud-card__shell--wide">
          <img src={theme1Assets.nextDrawBannerUrl} alt="" />
          <div className="hud-card__countdown">
            <span>Ny trekning</span>
            <small>starter om</small>
            <strong>{hud.nesteTrekkOm}</strong>
          </div>
        </div>
      </article>

      <article className="hud-card hud-card--stake">
        <div className="hud-card__copy">
          <span>Innsats</span>
          <small>Klar for web-klient</small>
        </div>
        <div className="hud-card__shell hud-card__shell--stake">
          <img src={theme1Assets.stakePanelUrl} alt="" />
          <span className="hud-card__stake-label">Innsats</span>
          <strong className="hud-card__stake-value">{hud.innsats}</strong>
        </div>
      </article>

      <article className="hud-button">
        <img src={theme1Assets.shuffleButtonUrl} alt="" />
        <span>Shuffle</span>
      </article>

      <article className="hud-button hud-button--primary">
        <img src={theme1Assets.placeBetButtonUrl} alt="" />
        <span>Plasser innsats</span>
      </article>
    </section>
  );
}
