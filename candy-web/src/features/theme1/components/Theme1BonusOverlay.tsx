import type { Theme1BonusState } from "@/domain/theme1/renderModel";
import { createPortal } from "react-dom";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";

interface Theme1BonusOverlayProps {
  bonus: Theme1BonusState;
  onSelectSlot: (slotId: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export function Theme1BonusOverlay({
  bonus,
  onSelectSlot,
  onReset,
  onClose,
}: Theme1BonusOverlayProps) {
  void onReset;

  if (bonus.status === "idle") {
    return null;
  }

  const resultSymbolId = bonus.result.matchedSymbolId;
  const showLossPopup = bonus.status === "resolved" && !bonus.result.isWin;
  const showWinPopup =
    bonus.status === "resolved" &&
    bonus.result.isWin &&
    resultSymbolId !== null &&
    resultSymbolId !== "asset-4";
  const popupSymbolId = showWinPopup ? resultSymbolId : null;
  const popupAmountImageUrl =
    popupSymbolId !== null ? theme1Assets.bonusResultAmountUrls[popupSymbolId] : null;
  const popupTripletImageUrl =
    popupSymbolId !== null ? theme1Assets.bonusResultTripletUrls[popupSymbolId] : null;
  const resultModal =
    showWinPopup && popupAmountImageUrl && popupTripletImageUrl ? (
      <div
        className="bonus-overlay__result-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Bonusgevinst"
      >
        <div className="bonus-overlay__result-modal-scrim" onClick={onClose} aria-hidden="true" />
        <div className="bonus-overlay__result-modal-content bonus-overlay__result-modal-content--win">
          <div className="bonus-overlay__result-card bonus-overlay__result-card--win">
            <img
              src={theme1Assets.bonusResultWinCardUrl}
              alt=""
              className="bonus-overlay__result-card-image bonus-overlay__result-card-image--win"
            />
            <img
              src={popupAmountImageUrl}
              alt=""
              className="bonus-overlay__result-amount-image"
            />
            <img
              src={popupTripletImageUrl}
              alt=""
              className="bonus-overlay__result-triplet-image"
            />
          </div>

          <button
            type="button"
            className="bonus-overlay__result-button"
            onClick={onClose}
            aria-label="Tilbake til spillet"
          >
            <img
              src={theme1Assets.bonusResultBackButtonUrl}
              alt=""
              className="bonus-overlay__result-button-image"
            />
          </button>
        </div>
      </div>
    ) : showLossPopup ? (
      <div
        className="bonus-overlay__result-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Ingen gevinst"
      >
        <div className="bonus-overlay__result-modal-scrim" onClick={onClose} aria-hidden="true" />
        <div className="bonus-overlay__result-modal-content bonus-overlay__result-modal-content--loss">
          <div className="bonus-overlay__result-card bonus-overlay__result-card--loss">
            <img
              src={theme1Assets.bonusResultLossCardUrl}
              alt="Beklager, Ingen gevinst denne gangen"
              className="bonus-overlay__result-card-image bonus-overlay__result-card-image--loss"
            />
          </div>

          <button
            type="button"
            className="bonus-overlay__result-button bonus-overlay__result-button--loss"
            onClick={onClose}
            aria-label="Tilbake til spillet"
          >
            <img
              src={theme1Assets.bonusResultBackButtonUrl}
              alt=""
              className="bonus-overlay__result-button-image"
            />
          </button>
        </div>
      </div>
    ) : null;

  return (
    <section className="bonus-overlay" aria-label="Candy bonusspill">
      <div className="bonus-overlay__backdrop" onClick={onClose} aria-hidden="true" />

      <article className="bonus-overlay__panel" aria-live="polite">
        <div className="bonus-overlay__body">
          <div className="bonus-overlay__stage">
            <div className="bonus-overlay__brand" aria-hidden="true">
              <img
                src={theme1Assets.bonusLogoUrl}
                alt=""
                className="bonus-overlay__brand-image"
              />
              <img
                src={theme1Assets.bonusInstructionUrl}
                alt=""
                className="bonus-overlay__instruction-image"
              />
            </div>

            <div className="bonus-overlay__grid" role="list" aria-label="Bonusluker">
              {bonus.slots.map((slot, index) => {
                const symbol = bonus.payoutTable.find((entry) => entry.symbolId === slot.symbolId);
                const symbolImageUrl =
                  slot.symbolId !== null ? theme1Assets.bonusSymbolUrls[slot.symbolId] : null;
                const isDisabled =
                  slot.selected ||
                  bonus.status !== "open" ||
                  bonus.selectedSlotIds.length >= bonus.pickLimit;

                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={`bonus-overlay__slot${slot.selected ? " bonus-overlay__slot--selected" : ""}${slot.revealed ? " bonus-overlay__slot--revealed" : ""}`.trim()}
                    onClick={() => onSelectSlot(slot.id)}
                    disabled={isDisabled}
                    role="listitem"
                    aria-label={`Luke ${index + 1}${slot.revealed && symbol ? ` viser ${symbol.label}` : ""}`}
                  >
                    <span className="bonus-overlay__slot-card" aria-hidden="true">
                      <span className="bonus-overlay__slot-card-inner">
                        <span className="bonus-overlay__slot-card-face bonus-overlay__slot-card-face--front">
                          <img
                            src={theme1Assets.bonusCardFrontUrl}
                            alt=""
                            className="bonus-overlay__slot-frame"
                          />
                          <span className="bonus-overlay__slot-index">Luke {index + 1}</span>
                        </span>

                        <span className="bonus-overlay__slot-card-face bonus-overlay__slot-card-face--back">
                          <img
                            src={theme1Assets.bonusCardBackUrl}
                            alt=""
                            className="bonus-overlay__slot-frame"
                          />
                          {slot.revealed && symbol && symbolImageUrl ? (
                            <img
                              src={symbolImageUrl}
                              alt=""
                              className="bonus-overlay__slot-symbol-image"
                            />
                          ) : null}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="bonus-overlay__payouts" aria-label="Premieoversikt">
            <img
              src={theme1Assets.bonusPayoutPanelUrl}
              alt="Premieoversikt for bonusspill"
              className="bonus-overlay__payout-image"
            />
            <img
              src={theme1Assets.bonusPayoutFooterUrl}
              alt=""
              className="bonus-overlay__payout-footer-image"
            />
          </aside>
        </div>
      </article>

      {resultModal
        ? typeof document === "undefined"
          ? resultModal
          : createPortal(resultModal, document.body)
        : null}
    </section>
  );
}
