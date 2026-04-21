# Elvis-bilder (Spill 1)

Dette katalog inneholder bildene som vises på Elvis-bonger (Elvis 1–5) i Spill 1
(norsk databingo). Hver fil tilsvarer én av de 5 Elvis-variantene.

## Filer

| Fil         | Variant  | Premie       |
| ----------- | -------- | ------------ |
| `elvis1.svg` | Elvis 1 | 500 kr       |
| `elvis2.svg` | Elvis 2 | 1000 kr      |
| `elvis3.svg` | Elvis 3 | 1500 kr      |
| `elvis4.svg` | Elvis 4 | 2000 kr      |
| `elvis5.svg` | Elvis 5 | 2500 kr      |

## Status

Filene er **placeholder-bilder** (distinkte fargegradianter + stor tekst). De er
ment som kort-liv-stand-in til Tobias leverer offisielle Elvis-assets.

## Slik bytter du til offisielle bilder

**Enklest (samme filnavn og -endelse):** Bare overskriv `elvis1.svg`–`elvis5.svg`
med de nye filene. Ingen kode-endring nødvendig.

**Hvis de nye assetene er PNG:** Legg PNG-ene inn med filnavnene `elvis1.png`
osv., og endre `EXTENSION` i [`ElvisAssetPaths.ts`](../../games/game1/colors/ElvisAssetPaths.ts)
fra `"svg"` til `"png"`. Filnavnene og koden er sentralisert der slik at ett
sted må oppdateres.

## Dimensjoner

Placeholder-bildene er 240×320 SVG (samme aspect-ratio som anbefalt for PNG).
BingoTicketHtml skalerer dem ved bruk av `background-size: contain`, så eksakte
pikselmål på nye assets er ikke kritisk — men 240×320 gir best visuell
konsistens med kort-oppsettet.
