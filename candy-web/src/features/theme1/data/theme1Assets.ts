import type { Theme1BonusSymbolId } from "@/domain/theme1/renderModel";
import backgroundUrl from "../../../assets/theme1/backgrounds/candy-background.png";
import bonusBackgroundUrl from "../../../assets/theme1/backgrounds/bonus-background.png";
import bonusSymbolAsset4Url from "../../../assets/theme1/bonus/asset-4.png";
import bonusResultLossCardUrl from "../../../assets/theme1/bonus/asset-15.png";
import bonusResultWinCardUrl from "../../../assets/theme1/bonus/asset-14.png";
import bonusResultBackButtonUrl from "../../../assets/theme1/bonus/asset-20.png";
import bonusCardBackUrl from "../../../assets/theme1/bonus/bakside.png";
import bonusCardFrontUrl from "../../../assets/theme1/bonus/kort2.png";
import bonusSymbolAsset19Url from "../../../assets/theme1/bonus/asset-19.png";
import bonusSymbolGoldenDropUrl from "../../../assets/theme1/bonus/asset-6.png";
import bonusSymbolPinkDropUrl from "../../../assets/theme1/bonus/asset-7.png";
import bonusSymbolAsset8Url from "../../../assets/theme1/bonus/asset-8.png";
import bonusSymbolGoldenCandyUrl from "../../../assets/theme1/bonus/asset-9.png";
import bonusSymbolSilverCandyUrl from "../../../assets/theme1/bonus/asset-10.png";
import bonusResultTripletAsset22Url from "../../../assets/theme1/bonus/asset-22.png";
import bonusResultTripletAsset23Url from "../../../assets/theme1/bonus/asset-23.png";
import bonusResultTripletAsset24Url from "../../../assets/theme1/bonus/asset-24.png";
import bonusResultTripletAsset25Url from "../../../assets/theme1/bonus/asset-25.png";
import bonusResultTripletAsset26Url from "../../../assets/theme1/bonus/asset-26.png";
import bonusPayoutPanelUrl from "../../../assets/theme1/bonus/asset-16.png";
import bonusPayoutFooterUrl from "../../../assets/theme1/bonus/asset-27.png";
import bonusResultAmountAsset28Url from "../../../assets/theme1/bonus/asset-28.png";
import bonusResultAmountAsset29Url from "../../../assets/theme1/bonus/asset-29.png";
import bonusResultAmountAsset30Url from "../../../assets/theme1/bonus/asset-30.png";
import bonusResultAmountAsset31Url from "../../../assets/theme1/bonus/asset-31.png";
import bonusResultAmountAsset32Url from "../../../assets/theme1/bonus/asset-32.png";
import bonusResultAmountAsset33Url from "../../../assets/theme1/bonus/asset-33.png";
import bonusResultTripletAsset34Url from "../../../assets/theme1/bonus/asset-34.png";
import bonusLogoUrl from "../../../assets/theme1/bonus/asset-18.png";
import bonusInstructionUrl from "../../../assets/theme1/bonus/asset-21.png";
import bongShellUrl from "../../../assets/theme1/boards/Theme1BongShellRaster.png";
import oneToGoGlowUrl from "../../../assets/theme1/boards/Theme1OneToGoGlowRaster.png";
import saldoPanelUrl from "../../../assets/theme1/controls/Theme1SaldoPanelBase.png";
import gevinstPanelUrl from "../../../assets/theme1/controls/Theme1GevinstPanelBase.png";
import nextDrawBannerUrl from "../../../assets/theme1/controls/Theme1NextDrawBannerBase.png";
import stakePanelUrl from "../../../assets/theme1/controls/Theme1StakePanelBase.png";
import placeBetButtonUrl from "../../../assets/theme1/controls/Theme1PlaceBetButtonShell.png";
import shuffleButtonUrl from "../../../assets/theme1/controls/Theme1ShuffleButton.png";
import patternOverlaySpriteMarkup from "../../../assets/theme1/overlays/theme1-pattern-overlays.svg?raw";
import candyManiaLogoUrl from "../../../../bilder/300ppi/17.png";
import ballMachineUrl from "../../../assets/theme1/stage/Theme1BallMachine.png";

type Theme1NonJackpotBonusSymbolId = Exclude<Theme1BonusSymbolId, "asset-4">;

export const theme1Assets = {
  backgroundUrl,
  bonusBackgroundUrl,
  bonusCardBackUrl,
  bonusCardFrontUrl,
  bonusResultWinCardUrl,
  bonusResultLossCardUrl,
  bonusResultBackButtonUrl,
  bonusLogoUrl,
  bonusInstructionUrl,
  bonusPayoutPanelUrl,
  bonusPayoutFooterUrl,
  bonusSymbolUrls: {
    "asset-19": bonusSymbolAsset19Url,
    "asset-8": bonusSymbolAsset8Url,
    "asset-7": bonusSymbolPinkDropUrl,
    "asset-6": bonusSymbolGoldenDropUrl,
    "asset-10": bonusSymbolSilverCandyUrl,
    "asset-9": bonusSymbolGoldenCandyUrl,
    "asset-4": bonusSymbolAsset4Url,
  } satisfies Record<Theme1BonusSymbolId, string>,
  bonusResultAmountUrls: {
    "asset-19": bonusResultAmountAsset33Url,
    "asset-8": bonusResultAmountAsset32Url,
    "asset-7": bonusResultAmountAsset28Url,
    "asset-6": bonusResultAmountAsset31Url,
    "asset-10": bonusResultAmountAsset30Url,
    "asset-9": bonusResultAmountAsset29Url,
  } satisfies Record<Theme1NonJackpotBonusSymbolId, string>,
  bonusResultTripletUrls: {
    "asset-19": bonusResultTripletAsset34Url,
    "asset-8": bonusResultTripletAsset22Url,
    "asset-7": bonusResultTripletAsset23Url,
    "asset-6": bonusResultTripletAsset26Url,
    "asset-10": bonusResultTripletAsset25Url,
    "asset-9": bonusResultTripletAsset24Url,
  } satisfies Record<Theme1NonJackpotBonusSymbolId, string>,
  bongShellUrl,
  oneToGoGlowUrl,
  saldoPanelUrl,
  gevinstPanelUrl,
  nextDrawBannerUrl,
  stakePanelUrl,
  placeBetButtonUrl,
  shuffleButtonUrl,
  patternOverlaySpriteMarkup,
  candyManiaLogoUrl,
  ballMachineUrl,
};
