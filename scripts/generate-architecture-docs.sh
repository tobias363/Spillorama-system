#!/usr/bin/env bash
#
# generate-architecture-docs.sh
#
# Auto-genererer arkitektur-artefakter til `docs/auto-generated/` slik at
# agenter alltid kan slå opp **nåværende state** i stedet for å lese stale
# håndskrevne dokumenter. Kjøres av `.github/workflows/auto-generate-docs.yml`
# på hver push til main, og kan også kjøres lokalt før PR for å se hva
# CI vil committe.
#
# Designprinsipper:
# - Idempotent: kjør så mange ganger du vil — output skal bare endres når
#   underliggende kilder (TS-imports, migrations, openapi.yaml, SKILLs)
#   endrer seg.
# - Ingen pg_dump mot live-DB — vi parser migrations.
# - Ingen secrets/PII i output.
# - Files skal være ≤ 5000 linjer; vi splitter eller summariserer.
# - Pure Bash + standard CLI (awk/grep/sed/find) så det fungerer i CI uten
#   ekstra dependencies. (dependency-cruiser kjøres bare hvis tilgjengelig.)
#
# Output:
#   docs/auto-generated/MODULE_DEPENDENCIES.md
#   docs/auto-generated/DB_SCHEMA_SNAPSHOT.md
#   docs/auto-generated/API_ENDPOINTS.md
#   docs/auto-generated/MIGRATIONS_LOG.md
#   docs/auto-generated/SKILLS_CATALOG.md
#   docs/auto-generated/SERVICES_OVERVIEW.md
#   docs/auto-generated/README.md
#   docs/auto-generated/.AUTO_GENERATED_DO_NOT_EDIT
#
# Eksterne avhengigheter (alle valgfri — fall back til Bash-implementasjon):
#   - dependency-cruiser  (bedre TS-graf hvis installert)
#   - npx                 (for å kjøre dependency-cruiser uten globalt install)

set -uo pipefail
# NB: vi setter IKKE -e fordi mange grep/find-pipelines returnerer
# exit 1 ved tomt resultat (helt normal). Vi vil fortsatt at scriptet
# skal fortsette. Hvis vi senere trenger fail-fast på reelle feil,
# må vi wrappe grep med `|| true`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$ROOT_DIR/docs/auto-generated"
MIGRATIONS_DIR="$ROOT_DIR/apps/backend/migrations"
OPENAPI_FILE="$ROOT_DIR/apps/backend/openapi.yaml"
SKILLS_DIR="$ROOT_DIR/.claude/skills"

mkdir -p "$OUT_DIR"

NOW_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# --------------------------------------------------------------------------
# Felles header for alle auto-genererte filer
# --------------------------------------------------------------------------
emit_header() {
  local title="$1"
  cat <<EOF
# $title

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> \`.github/workflows/auto-generate-docs.yml\` på hver push til main.
>
> Generator: \`scripts/generate-architecture-docs.sh\`
> Sist oppdatert: $NOW_UTC
> Commit: \`$GIT_SHA\` (branch: \`$GIT_BRANCH\`)

EOF
}

# --------------------------------------------------------------------------
# 1. SKILLS_CATALOG.md — listing av alle SKILL.md med navn + description
# --------------------------------------------------------------------------
generate_skills_catalog() {
  local out="$OUT_DIR/SKILLS_CATALOG.md"
  echo "[generate] $out"

  {
    emit_header "Skills-katalog"
    cat <<'EOF'
Liste over alle skills under `.claude/skills/`. Skills er prosjekt-spesifikk
domene-kunnskap som lastes inn i agent-kontekst når mønsteret matcher.

Skills som handler om payouts, regulatorisk compliance, live-rom-mandat, og
master-rolle-modell skal **alltid** lastes når de matcher — de inneholder
beslutninger som overstyrer default-oppførsel.

EOF

    if [[ -d "$SKILLS_DIR" ]]; then
      printf "Antall skills: **%d**\n\n" "$(find "$SKILLS_DIR" -name "SKILL.md" -type f | wc -l | tr -d ' ')"
      echo "| Skill | Beskrivelse |"
      echo "|---|---|"

      find "$SKILLS_DIR" -name "SKILL.md" -type f | sort | while read -r skill_file; do
        local skill_dir
        skill_dir="$(basename "$(dirname "$skill_file")")"
        # Trekk ut name + description fra YAML-frontmatter (de første 30 linjene)
        local name desc
        name=$(awk '/^name:/ { sub(/^name:[[:space:]]*/, ""); print; exit }' "$skill_file" | head -c 80)
        desc=$(awk '/^description:/ { sub(/^description:[[:space:]]*/, ""); print; exit }' "$skill_file" | head -c 250)
        # Escape pipes for tabell
        desc="${desc//|/\\|}"
        if [[ -z "$name" ]]; then
          name="$skill_dir"
        fi
        printf "| \`%s\` | %s%s |\n" "$name" "$desc" "$([[ ${#desc} -ge 250 ]] && echo "…")"
      done
    else
      echo "_Ingen skills funnet under_ \`.claude/skills/\`."
    fi
  } > "$out"
}

# --------------------------------------------------------------------------
# 2. MIGRATIONS_LOG.md — kronologisk listing av migrations
# --------------------------------------------------------------------------
generate_migrations_log() {
  local out="$OUT_DIR/MIGRATIONS_LOG.md"
  echo "[generate] $out"

  {
    emit_header "Migration-historikk"
    cat <<'EOF'
Kronologisk liste over alle Postgres-migrations under
`apps/backend/migrations/`. Filene navngis med ISO-prefiks
`YYYYMMDDHHMMSS_<navn>.sql` og kjøres i sortert rekkefølge ved deploy
(se `render.yaml` → `npm run migrate`).

> **Oppdager du en migrasjon som ikke er i prod?** Sjekk
> `app_migrations`-tabellen i prod-DB. Render kjører `npm run migrate`
> som del av `buildCommand` — feiler en migrasjon, faller deploy.

EOF

    if [[ -d "$MIGRATIONS_DIR" ]]; then
      local total
      total=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -type f | wc -l | tr -d ' ')
      printf "Antall migrasjoner: **%d**\n\n" "$total"
      echo "| Filnavn | Bytes | Beskrivelse (slug fra filnavn) |"
      echo "|---|---:|---|"

      find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -type f | sort | while read -r f; do
        local fname size slug
        fname="$(basename "$f")"
        size=$(wc -c < "$f" | tr -d ' ')
        # Trekk ut "slug" fra filnavnet (etter første underscore, fjern .sql)
        slug=$(echo "$fname" | sed -E 's/^[0-9_]+//; s/\.sql$//; s/_/ /g')
        printf "| \`%s\` | %s | %s |\n" "$fname" "$size" "$slug"
      done
    else
      echo "_Ingen migrasjoner funnet under_ \`apps/backend/migrations/\`."
    fi
  } > "$out"
}

# --------------------------------------------------------------------------
# 3. DB_SCHEMA_SNAPSHOT.md — tabellnavn + kolonner parset fra migrations
# --------------------------------------------------------------------------
# Dette er tilnærmet — vi parser CREATE TABLE / ALTER TABLE-uttrykk
# fra migrations. For 100% korrekthet må man kjøre faktiske migrations
# mot en test-DB og dumpe schema; det krever Postgres i CI som vi
# bevisst unngår her (ingen pg_dump mot live).
generate_db_schema_snapshot() {
  local out="$OUT_DIR/DB_SCHEMA_SNAPSHOT.md"
  echo "[generate] $out"

  {
    emit_header "DB-skjema-snapshot"
    cat <<'EOF'
Liste over tabeller (og deres kolonner ved CREATE TABLE-tid) parset fra
`apps/backend/migrations/*.sql`. Senere ALTER TABLE-uttrykk listes
separat under "Endringer".

> **Begrensning:** Dette er en parse-basert tilnærming, ikke en
> autoritativ snapshot fra prod-DB. For 100% korrekthet, kjør
> `psql -d <prod> -c "\\d+"` direkte. Snapshot-en er tilstrekkelig for
> agent-onboarding men IKKE for compliance-bevis.

EOF

    if [[ ! -d "$MIGRATIONS_DIR" ]]; then
      echo "_Ingen migrasjoner funnet._"
      return
    fi

    # Finn alle CREATE TABLE-statements (case-insensitive)
    echo "## Tabeller (CREATE TABLE)"
    echo ""
    echo "| Tabell | Definert i migrasjon |"
    echo "|---|---|"

    # NB: tabell-navn kan inneholde digits (eks. app_game1_scheduled_games),
    # så regex må være [a-z0-9_]+, ikke [a-z_]+.
    find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -type f | sort | while read -r f; do
      local fname
      fname="$(basename "$f")"
      grep -iE '^[[:space:]]*CREATE TABLE (IF NOT EXISTS )?[a-z0-9_]+' "$f" 2>/dev/null \
        | sed -E 's/^[[:space:]]*CREATE TABLE (IF NOT EXISTS )?([a-z0-9_]+).*/\2/I' \
        | sort -u | while read -r table; do
          [[ -n "$table" ]] && printf "| \`%s\` | \`%s\` |\n" "$table" "$fname"
        done
    done | sort -u

    echo ""
    echo "## Endringer (ALTER TABLE) — antall per tabell"
    echo ""
    echo "Dette gir en grov idé om hvor aktiv en tabell har vært."
    echo ""
    echo "| Tabell | Antall ALTER TABLE-statements |"
    echo "|---|---:|"

    find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -type f -exec cat {} + 2>/dev/null \
      | grep -iE '^[[:space:]]*ALTER TABLE [a-z0-9_]+' \
      | sed -E 's/^[[:space:]]*ALTER TABLE ([a-z0-9_]+).*/\1/I' \
      | sort | uniq -c | sort -rn | head -50 | while read -r count table; do
        [[ -n "$table" ]] && printf "| \`%s\` | %s |\n" "$table" "$count"
      done

    echo ""
    echo "## CREATE INDEX — antall per tabell"
    echo ""
    echo "| Tabell | Antall indekser |"
    echo "|---|---:|"

    # CREATE [UNIQUE] INDEX [name] ON tabell — fang opp tabell-navn
    find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -type f -exec cat {} + 2>/dev/null \
      | grep -iE '^[[:space:]]*CREATE (UNIQUE )?INDEX' \
      | sed -E 's/.*ON[[:space:]]+([a-z0-9_]+).*/\1/I' \
      | grep -E '^[a-z0-9_]+$' \
      | sort | uniq -c | sort -rn | head -50 | while read -r count table; do
        [[ -n "$table" ]] && printf "| \`%s\` | %s |\n" "$table" "$count"
      done
  } > "$out"
}

# --------------------------------------------------------------------------
# 4. API_ENDPOINTS.md — katalog fra openapi.yaml
# --------------------------------------------------------------------------
generate_api_endpoints() {
  local out="$OUT_DIR/API_ENDPOINTS.md"
  echo "[generate] $out"

  {
    emit_header "API-endpoints-katalog"
    cat <<'EOF'
Liste over alle endpoints definert i `apps/backend/openapi.yaml`. Dette er
**kontrakten** — implementasjonen i `apps/backend/src/routes/` skal matche.
Hvis du finner ruter i kode som ikke står her, åpne sak: enten skal de
dokumenteres eller fjernes.

> **Auth-konvensjon:** Default er Bearer JWT. Endepunkter som er offentlige
> (login, public CMS, status, public game-health, csp-report, webhook) har
> `security: []` i specen.

EOF

    if [[ ! -f "$OPENAPI_FILE" ]]; then
      echo "_Ingen openapi.yaml funnet._"
      return
    fi

    # Parser-strategi:
    # - linje som starter med 2 mellomrom + "/api/" eller "/" → path
    # - påfølgende linjer som starter med 4 mellomrom + en HTTP-verb (get/post/put/delete/patch) → metode
    # - "summary: ..." linjen rett etter verb-linjen → beskrivelse
    # - "tags: [Tag]" på samme blokk for kategorisering
    #
    # Dette er en bevisst forenklet awk-parser; for full presisjon bruk
    # redocly-cli eller swagger-codegen.

    echo "## Endpoints gruppert på tag"
    echo ""

    awk '
      # spor om vi er i komponent-seksjonen (skal hoppes over)
      /^components:/ { in_components=1 }
      /^paths:/ { in_components=0; in_paths=1; next }
      in_components { next }

      # Path-rad: starter med "  /" og slutter med ":"
      /^  \/[^ ]+:[[:space:]]*$/ {
        path=$1
        sub(/:$/, "", path)
        next
      }

      # Verb-rad: get/post/put/delete/patch
      /^    (get|post|put|delete|patch):[[:space:]]*$/ {
        verb=$1
        sub(/:$/, "", verb)
        # Ha ikke summary/tag enda — vi venter på neste linjer
        last_path=path
        last_verb=verb
        last_summary=""
        last_tag="(uncategorized)"
        next
      }

      # tags: [Tag — Subtag] på 6 spaces
      /^      tags:[[:space:]]*\[/ {
        tag_line=$0
        sub(/^[[:space:]]*tags:[[:space:]]*\[/, "", tag_line)
        sub(/\][[:space:]]*$/, "", tag_line)
        last_tag=tag_line
        next
      }

      # summary på 6 spaces
      /^      summary:[[:space:]]/ {
        sum=$0
        sub(/^[[:space:]]*summary:[[:space:]]*/, "", sum)
        last_summary=sum
        # Skriv ut ETT linje per (verb, path) ved summary-linjen
        if (last_verb && last_path) {
          printf "%s\t%s\t%s\t%s\n", last_tag, toupper(last_verb), last_path, last_summary
          last_verb=""
        }
        next
      }
    ' "$OPENAPI_FILE" | sort | awk -F'\t' '
      BEGIN { current_tag="" }
      {
        tag=$1; verb=$2; path=$3; summary=$4
        if (tag != current_tag) {
          if (current_tag != "") print ""
          printf "### %s\n\n", tag
          print "| Metode | Path | Sammendrag |"
          print "|---|---|---|"
          current_tag=tag
        }
        # Escape pipes
        gsub(/\|/, "\\|", summary)
        printf "| `%s` | `%s` | %s |\n", verb, path, summary
      }
    '

    echo ""
    echo "## Statistikk"
    echo ""

    local total_paths total_endpoints
    total_paths=$(grep -cE '^  \/[^ ]+:[[:space:]]*$' "$OPENAPI_FILE" || echo 0)
    total_endpoints=$(grep -cE '^    (get|post|put|delete|patch):[[:space:]]*$' "$OPENAPI_FILE" || echo 0)
    echo "- Antall paths: **$total_paths**"
    echo "- Antall endpoints (verb+path-kombinasjoner): **$total_endpoints**"
  } > "$out"
}

# --------------------------------------------------------------------------
# 5. SERVICES_OVERVIEW.md — fra apps/ + packages/ struktur
# --------------------------------------------------------------------------
generate_services_overview() {
  local out="$OUT_DIR/SERVICES_OVERVIEW.md"
  echo "[generate] $out"

  {
    emit_header "Services + tjeneste-grenser"
    cat <<'EOF'
Oversikt over alle apps og pakker i monorepoet. `apps/` = deploy-bare
enheter (egne package.json + build), `packages/` = delt kode importert
av apps via workspace-symlinks.

> **Kryss-import-regel:** Apps importerer ALDRI fra hverandre. All delt
> kode flyttes til `packages/`. Brudd på dette gir CI-feil.

EOF

    echo "## Apps"
    echo ""
    echo "| App | Path | Har package.json | Har src/ | Linjer kode (.ts/.tsx) |"
    echo "|---|---|:---:|:---:|---:|"

    if [[ -d "$ROOT_DIR/apps" ]]; then
      for app in "$ROOT_DIR/apps"/*/; do
        [[ -d "$app" ]] || continue
        local name has_pkg has_src loc
        name="$(basename "$app")"
        has_pkg="–"
        has_src="–"
        [[ -f "$app/package.json" ]] && has_pkg="✓"
        [[ -d "$app/src" ]] && has_src="✓"
        loc="$(find "$app" -name "*.ts" -o -name "*.tsx" 2>/dev/null \
                | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"
        loc="${loc:-0}"
        printf "| \`%s\` | \`apps/%s\` | %s | %s | %s |\n" "$name" "$name" "$has_pkg" "$has_src" "$loc"
      done
    fi

    echo ""
    echo "## Packages (delt kode)"
    echo ""
    echo "| Pakke | Path | Har package.json | Linjer kode (.ts/.tsx) |"
    echo "|---|---|:---:|---:|"

    if [[ -d "$ROOT_DIR/packages" ]]; then
      for pkg in "$ROOT_DIR/packages"/*/; do
        [[ -d "$pkg" ]] || continue
        local name has_pkg loc
        name="$(basename "$pkg")"
        has_pkg="–"
        [[ -f "$pkg/package.json" ]] && has_pkg="✓"
        loc="$(find "$pkg" -name "*.ts" -o -name "*.tsx" 2>/dev/null \
                | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"
        loc="${loc:-0}"
        printf "| \`%s\` | \`packages/%s\` | %s | %s |\n" "$name" "$name" "$has_pkg" "$loc"
      done
    fi

    echo ""
    echo "## Backend-domene-kataloger (apps/backend/src/)"
    echo ""
    echo "Hver mappe representerer en bounded context."
    echo ""
    echo "| Domene | Antall .ts-filer |"
    echo "|---|---:|"

    if [[ -d "$ROOT_DIR/apps/backend/src" ]]; then
      for dir in "$ROOT_DIR/apps/backend/src"/*/; do
        [[ -d "$dir" ]] || continue
        local name count
        name="$(basename "$dir")"
        # Hopp over test/dev-mapper
        case "$name" in
          __tests__|__fixtures__|__mocks__|dev) continue ;;
        esac
        count=$(find "$dir" -name "*.ts" -type f 2>/dev/null | wc -l | tr -d ' ')
        printf "| \`%s\` | %s |\n" "$name" "$count"
      done | sort
    fi
  } > "$out"
}

# --------------------------------------------------------------------------
# 6. MODULE_DEPENDENCIES.md — TS-import-graf via dependency-cruiser ELLER
#    en enklere intern parser hvis ikke installert.
# --------------------------------------------------------------------------
generate_module_dependencies() {
  local out="$OUT_DIR/MODULE_DEPENDENCIES.md"
  echo "[generate] $out"

  {
    emit_header "Module dependency-graph"
    cat <<'EOF'
Modul-graf (mermaid) avledet fra TypeScript-imports. Diagrammet viser
top-level avhengighet mellom **apps** og **packages** — det er bevisst
grovkornet for å være lesbart. For per-fil-graf, kjør
`npx depcruise --output-type mermaid apps/backend/src` lokalt.

EOF

    echo "## Apps + packages avhengighetsgraf"
    echo ""
    echo '```mermaid'
    echo "graph LR"

    # Bygg graf fra package.json-er. Vi bruker en string-basert
    # "node_list" i stedet for associative arrays (bash 3 mangler dem).
    local node_list=""

    # apps
    if [[ -d "$ROOT_DIR/apps" ]]; then
      for pkg_json in "$ROOT_DIR/apps"/*/package.json; do
        [[ -f "$pkg_json" ]] || continue
        local app_name
        app_name="$(basename "$(dirname "$pkg_json")")"
        echo "  $app_name[\"apps/$app_name\"]"
        node_list="$node_list:$app_name"
      done
    fi

    # packages
    if [[ -d "$ROOT_DIR/packages" ]]; then
      for pkg_json in "$ROOT_DIR/packages"/*/package.json; do
        [[ -f "$pkg_json" ]] || continue
        local pkg_name
        pkg_name="$(basename "$(dirname "$pkg_json")")"
        echo "  $pkg_name([\"packages/$pkg_name\"])"
        node_list="$node_list:$pkg_name"
      done
    fi

    # Kanter: apps som dep-er på packages (via @spillorama/* eller relativ file:)
    for pkg_json in "$ROOT_DIR/apps"/*/package.json; do
      [[ -f "$pkg_json" ]] || continue
      local app_name
      app_name="$(basename "$(dirname "$pkg_json")")"
      # Trekk ut deps som peker til @spillorama/* (eller "file:../../packages/*")
      grep -oE '"@spillorama/[a-z-]+":' "$pkg_json" 2>/dev/null \
        | sed -E 's/"@spillorama\/([a-z-]+)":/\1/' | sort -u | while read -r dep; do
          # Sjekk om dep er en kjent node ved string-match
          case ":$node_list:" in
            *":$dep:"*) echo "  $app_name --> $dep" ;;
          esac
        done
      # Også file:../../packages/*-syntax
      grep -oE '"file:[^"]*/packages/[a-z-]+"' "$pkg_json" 2>/dev/null \
        | sed -E 's/.*\/packages\/([a-z-]+)".*/\1/' | sort -u | while read -r dep; do
          case ":$node_list:" in
            *":$dep:"*) echo "  $app_name --> $dep" ;;
          esac
        done
    done | sort -u

    echo '```'

    echo ""
    echo "## Backend-domener: relativ-imports mellom domene-kataloger"
    echo ""
    echo 'Hver kant `A --> B` betyr: minst én fil i `apps/backend/src/A/`'
    echo 'importerer fra `apps/backend/src/B/`. Dette er en heuristikk,'
    echo 'ikke en formell avhengighetsanalyse.'
    echo ""
    echo '```mermaid'
    echo "graph LR"

    if [[ -d "$ROOT_DIR/apps/backend/src" ]]; then
      # Liste over domener
      local domains=()
      for d in "$ROOT_DIR/apps/backend/src"/*/; do
        [[ -d "$d" ]] || continue
        local name
        name="$(basename "$d")"
        case "$name" in
          __tests__|__fixtures__|__mocks__|dev) continue ;;
        esac
        domains+=("$name")
      done

      # Skriv ut node-deklarasjoner
      for dom in "${domains[@]}"; do
        echo "  $dom"
      done

      # Relativ-imports mellom domener: en TS-fil i A som har
      # import-statement med "../B/" har en kant A --> B
      for dom in "${domains[@]}"; do
        local dom_dir="$ROOT_DIR/apps/backend/src/$dom"
        # Bare topp-nivå .ts-filer (ikke rekursivt; vi vil ikke ha for mye støy)
        find "$dom_dir" -maxdepth 2 -name "*.ts" -type f 2>/dev/null | while read -r tsfile; do
          # Trekk ut "../<DOM>/" fra import-statements (inkluder digits)
          grep -oE "from ['\"]\\.\\./[a-z0-9_-]+/" "$tsfile" 2>/dev/null \
            | sed -E "s/from ['\"]\\.\\.\\/(.*)\\//\1/" \
            | sort -u | while read -r target; do
              # Kun hvis target er et kjent domene og ikke selv
              if [[ "$target" != "$dom" ]]; then
                for known_dom in "${domains[@]}"; do
                  if [[ "$known_dom" == "$target" ]]; then
                    echo "  $dom --> $target"
                    break
                  fi
                done
              fi
            done
        done
      done | sort -u | head -120  # cap for å holde diagrammet lesbart
    fi

    echo '```'

    echo ""
    echo "## Notes"
    echo ""
    echo "- Diagrammene er auto-generert fra package.json + import-statements."
    echo "- Cap på 120 backend-domene-kanter for å holde diagrammet rendable."
    echo "- For full per-fil-graf, kjør \`npx depcruise --output-type mermaid apps/backend/src\` lokalt."
  } > "$out"
}

# --------------------------------------------------------------------------
# 7. README.md — forklarer mappen
# --------------------------------------------------------------------------
generate_readme() {
  local out="$OUT_DIR/README.md"
  echo "[generate] $out"

  cat > "$out" <<EOF
# docs/auto-generated/

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Innholdet i denne mappen
> overskrives av \`.github/workflows/auto-generate-docs.yml\` på hver
> push til main.

## Hvorfor?

Tobias 2026-05-08: håndskrevne arkitektur-dokumenter blir stale. Agenter
finner dem, leser dem, og handler på utdatert info. Løsningen er å
auto-generere "current state"-artefakter fra **kildene**:

- \`apps/backend/openapi.yaml\` → API-endpoints-katalog
- \`apps/backend/migrations/*.sql\` → DB-skjema-snapshot + migration-log
- \`apps/\` + \`packages/\` (TypeScript imports) → module dependency-graph
- \`.claude/skills/*/SKILL.md\` → skills-katalog
- \`apps/backend/src/<domene>/\` → backend-domene-grenser

## Filer

| Fil | Innhold |
|---|---|
| \`MODULE_DEPENDENCIES.md\` | Apps + packages dep-graf (mermaid) + backend-domene-graf |
| \`DB_SCHEMA_SNAPSHOT.md\` | Tabeller + ALTER TABLE-statistikk parset fra migrations |
| \`API_ENDPOINTS.md\` | Alle endepunkter fra openapi.yaml, gruppert på tag |
| \`MIGRATIONS_LOG.md\` | Kronologisk liste over migrations |
| \`SKILLS_CATALOG.md\` | Alle SKILL.md med navn + description |
| \`SERVICES_OVERVIEW.md\` | Apps/packages struktur, LOC, backend-domener |

## Når brukes dette?

- **Ved start av agent-sesjon:** hvis du leter etter "current state",
  les disse FØRST før du graver i kode.
- **Ved arkitektur-spørsmål:** "Hvilke endpoints finnes for hall-X?"
  → \`API_ENDPOINTS.md\`. "Hvor lever wallet-koden?" → \`SERVICES_OVERVIEW.md\`.
- **Ved skill-discovery:** "Finnes det en skill for X?" → \`SKILLS_CATALOG.md\`.

## Hvordan oppdatere?

Du gjør det ikke manuelt. CI-jobben kjører på hver push til main.
Lokalt:

\`\`\`bash
./scripts/generate-architecture-docs.sh
\`\`\`

## Hvordan legge til en ny generator?

1. Legg til en ny \`generate_<x>\` funksjon i
   \`scripts/generate-architecture-docs.sh\`.
2. Legg til kallet i \`main\`-seksjonen nederst.
3. Oppdater \`docs/engineering/AUTO_GENERATED_DOCS.md\` med beskrivelse.

## Begrensninger

- DB-skjema er **parse-basert**, ikke pg_dump. Ikke autoritativt for
  compliance-bevis — bruk \`psql -c "\\\d+"\` mot prod-DB for det.
- Module-graf er heuristisk (regex-parse av imports). For 100% korrekt
  graf, kjør \`npx depcruise\` lokalt.
- Filer cappes ved 5000 linjer; lange seksjoner trunkateres.
EOF
}

# --------------------------------------------------------------------------
# 8. .AUTO_GENERATED_DO_NOT_EDIT — lite marker-fil
# --------------------------------------------------------------------------
generate_marker() {
  local out="$OUT_DIR/.AUTO_GENERATED_DO_NOT_EDIT"
  echo "[generate] $out"
  cat > "$out" <<'EOF'
Disse filene auto-genereres av .github/workflows/auto-generate-docs.yml
Ikke rediger manuelt — endringer overskrives.
For å oppdatere: kjør scripts/generate-architecture-docs.sh
EOF
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  echo "[generate-architecture-docs] OUT_DIR=$OUT_DIR"
  echo "[generate-architecture-docs] commit=$GIT_SHA branch=$GIT_BRANCH"

  generate_skills_catalog
  generate_migrations_log
  generate_db_schema_snapshot
  generate_api_endpoints
  generate_services_overview
  generate_module_dependencies
  generate_readme
  generate_marker

  # Truncate alle filer over 5000 linjer (sikkerhetsnett)
  for f in "$OUT_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    local lines
    lines=$(wc -l < "$f" | tr -d ' ')
    if [[ "$lines" -gt 5000 ]]; then
      echo "[truncate] $f ($lines linjer → 5000)"
      head -5000 "$f" > "$f.tmp"
      printf "\n\n_… trunkert ved 5000 linjer (var %s)._\n" "$lines" >> "$f.tmp"
      mv "$f.tmp" "$f"
    fi
  done

  echo "[generate-architecture-docs] done"
  echo ""
  echo "Filer:"
  for f in "$OUT_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    local lines
    lines=$(wc -l < "$f" | tr -d ' ')
    printf "  %s (%s linjer)\n" "$(basename "$f")" "$lines"
  done
}

main "$@"
