# Candy Web Live Test Notes

Dette dokumentet dekker live-runtime-laget i `codex/candy-web-live-runtime`.

## Eierskap

Denne branchen eier kun:

- `candy-web/src/features/theme1/hooks/useTheme1Store.ts`
- `candy-web/src/domain/realtime/client.ts`
- `candy-web/src/features/theme1/components/Theme1ConnectionPanel.tsx`
- `candy-web/src/features/theme1/components/Theme1GameShell.tsx`
- dette dokumentet

Domain/config-filer holdes utenfor denne branchen.

## Runtime-adferd som er lagt inn

- klienten prover `room:resume` forst hvis `playerId` finnes lokalt
- hvis `room:resume` ikke lykkes, fallbacker klienten til `room:state`
- `room:update` oppdaterer UI direkte
- hvis en pre-round `room:update` mangler lokale tickets, beholdes forrige view og klienten prover en eksplisitt resync
- disconnect og connect-error vises eksplisitt i UI
- session fortsetter a bli lagret i localStorage

## Manuell sjekkliste

1. Start webklienten og koble til med `roomCode`.
2. Verifiser at forste sync fungerer uten mock.
3. Verifiser at lagret `playerId` gir `room:resume`-path ved reload.
4. Verifiser fallback til `room:state` hvis `playerId` er tom eller ugyldig.
5. Verifiser at `room:update` endrer UI mens socketen er tilkoblet.
6. Verifiser at `Koble fra` setter tydelig disconnected-state.
7. Verifiser reconnect via `Koble til`.
8. Verifiser at pre-round oppdateringer uten lokale tickets ikke nuller ut sist kjente kortview.

## Kjent begrensning

- Full parity for topper-priser og pattern-config avhenger av domain/config-arbeidet i `codex/candy-web-domain-config`.
