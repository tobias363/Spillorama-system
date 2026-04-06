import type { Theme1HudState } from "@/domain/theme1/renderModel";

interface Theme1HudRackProps {
  hud: Theme1HudState;
  drawCountLabel: string;
  isBetArmed: boolean;
  stakeBusy: boolean;
  rerollBusy: boolean;
  betBusy: boolean;
  onDecreaseStake: () => void;
  onIncreaseStake: () => void;
  onShuffle: () => void;
  onPlaceBet: () => void;
  onOpenBonusTest: () => void;
}

interface Theme1CountdownPanelProps {
  countdown: string;
}

function splitKrLabel(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)(?:\s*(kr))$/i);
  if (!match) {
    return {
      amount: trimmed,
      suffix: "",
    };
  }

  return {
    amount: match[1].trim(),
    suffix: match[2],
  };
}

function CandyMetricPanel({ title, value }: { title: string; value: string }) {
  const { amount, suffix } = splitKrLabel(value);

  return (
    <article className="css-hud-candy-panel css-hud-candy-panel--metric">
      <div className="css-hud-candy-panel__title">{title}</div>
      <div className="css-hud-candy-panel__body">
        <strong className="css-hud-candy-panel__value">
          <span className="css-hud-candy-panel__value-amount">{amount}</span>
          {suffix ? <span className="css-hud-candy-panel__value-suffix">{suffix}</span> : null}
        </strong>
      </div>
    </article>
  );
}

function ShuffleIcon() {
  return (
    <span className="css-hud-button__icon css-hud-button__icon--shuffle" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <path d="M44.15625,12.00977c-0.59245,-0.02447 -1.15625,0.43887 -1.15625,1.10938v3.88086h-2.82422c-2.346,0 -4.52222,1.16419 -5.82422,3.11719l-4.60156,6.90234l-4.60156,-6.90234c-1.302,-1.952 -3.47822,-3.11719 -5.82422,-3.11719h-7.32422c-1.104,0 -2,0.896 -2,2c0,1.104 0.896,2 2,2h7.32422c1.005,0 1.93909,0.49994 2.49609,1.33594l5.52539,8.28906l-6.02539,9.03906c-0.558,0.836 -1.49109,1.33594 -2.49609,1.33594h-6.82422c-1.104,0 -2,0.896 -2,2c0,1.104 0.896,2 2,2h6.82422c2.346,0 4.52322,-1.16519 5.82422,-3.11719l5.10156,-7.65234l5.10156,7.65234c1.302,1.952 3.47822,3.11719 5.82422,3.11719h2.32422v3.88086c0,0.894 1.00328,1.42111 1.73828,0.91211l8.50195,-5.88281c0.637,-0.44 0.637,-1.38126 0,-1.82227l-8.50195,-5.88086c-0.735,-0.508 -1.73828,0.01811 -1.73828,0.91211v3.88086h-2.32422c-1.005,0 -1.93909,-0.49994 -2.49609,-1.33594l-6.02539,-9.03906l5.52539,-8.28906c0.558,-0.836 1.49109,-1.33594 2.49609,-1.33594h2.82422v3.88086c0,0.894 1.00328,1.42111 1.73828,0.91211l8.50195,-5.88281c0.637,-0.44 0.637,-1.38126 0,-1.82227l-8.50195,-5.88086c-0.18375,-0.127 -0.38455,-0.18911 -0.58203,-0.19726z" />
      </svg>
    </span>
  );
}

export function Theme1CountdownPanel({ countdown }: Theme1CountdownPanelProps) {
  return (
    <article className="css-hud-countdown-panel" aria-label="Ny trekning starter om">
      <div className="css-hud-countdown-panel__body">
        <strong className="css-hud-countdown-panel__label">Ny trekning starter om</strong>
        {countdown ? <div className="css-hud-countdown-panel__timer">{countdown}</div> : null}
        <p className="css-hud-countdown-panel__helper">
          Plasser innsats for å være med i trekningen
        </p>
      </div>
    </article>
  );
}

export function Theme1HudRack({
  hud,
  drawCountLabel,
  isBetArmed,
  stakeBusy,
  rerollBusy,
  betBusy,
  onDecreaseStake,
  onIncreaseStake,
  onShuffle,
  onPlaceBet,
  onOpenBonusTest,
}: Theme1HudRackProps) {
  const stake = splitKrLabel(hud.innsats);

  return (
    <section className="css-hud-stack" aria-label="Bunnkontroller">
      <div className="css-hud-rack">
        <CandyMetricPanel title="Trekk" value={drawCountLabel} />
        <CandyMetricPanel title="Saldo" value={hud.saldo} />
        <CandyMetricPanel title="Gevinst" value={hud.gevinst} />

        <button
          type="button"
          className="css-hud-button css-hud-candy-button css-hud-candy-button--shuffle"
          aria-label="Bytt tall"
          onClick={onShuffle}
          disabled={rerollBusy}
        >
          <span className="css-hud-candy-panel__title css-hud-candy-button__title">Bytt tall</span>
          <span className="css-hud-candy-button__body">
            <ShuffleIcon />
          </span>
        </button>

        <article className="css-hud-stake-panel">
          <div className="css-hud-stake-panel__title">Innsats</div>
          <div className="css-hud-stake-panel__body">
            <button
              type="button"
              className="css-hud-stake-panel__stepper"
              aria-label="Reduser innsats"
              onClick={onDecreaseStake}
              disabled={stakeBusy}
            >
              <span aria-hidden="true">−</span>
            </button>

            <strong className="css-hud-stake-panel__value">
              <span className="css-hud-stake-panel__value-amount">{stake.amount}</span>
              {stake.suffix ? (
                <span className="css-hud-stake-panel__value-suffix">{stake.suffix}</span>
              ) : null}
            </strong>

            <button
              type="button"
              className="css-hud-stake-panel__stepper"
              aria-label="Ok innsats"
              onClick={onIncreaseStake}
              disabled={stakeBusy}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </article>

        <button
          type="button"
          className={`css-hud-button css-hud-button--primary css-hud-candy-button${isBetArmed ? " css-hud-candy-button--armed" : ""}`.trim()}
          onClick={onPlaceBet}
          disabled={betBusy}
          aria-pressed={isBetArmed}
        >
          <span className="css-hud-button__label">
            {isBetArmed ? "Innsats plassert" : "Plasser innsats"}
          </span>
        </button>

        <button
          type="button"
          className="css-hud-button css-hud-candy-button css-hud-candy-button--bonus-test"
          onClick={onOpenBonusTest}
        >
          <span className="css-hud-button__label css-hud-button__label--bonus-test">Tilfeldig bonus</span>
        </button>
      </div>
    </section>
  );
}
