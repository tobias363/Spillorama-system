# Module dependency-graph

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-15T19:15:47Z
> Commit: `8ad1a4ef` (branch: `main`)

Modul-graf (mermaid) avledet fra TypeScript-imports. Diagrammet viser
top-level avhengighet mellom **apps** og **packages** — det er bevisst
grovkornet for å være lesbart. For per-fil-graf, kjør
`npx depcruise --output-type mermaid apps/backend/src` lokalt.

## Apps + packages avhengighetsgraf

```mermaid
graph LR
  admin-web["apps/admin-web"]
  backend["apps/backend"]
  game-client(["packages/game-client"])
  shared-types(["packages/shared-types"])
  backend --> shared-types
```

## Backend-domener: relativ-imports mellom domene-kataloger

Hver kant `A --> B` betyr: minst én fil i `apps/backend/src/A/`
importerer fra `apps/backend/src/B/`. Dette er en heuristikk,
ikke en formell avhengighetsanalyse.

```mermaid
graph LR
  adapters
  admin
  agent
  auth
  boot
  compliance
  draw-engine
  errors
  game
  integration
  jobs
  media
  middleware
  notifications
  observability
  payments
  platform
  ports
  routes
  scripts
  security
  services
  sockets
  spillevett
  store
  util
  wallet
  adapters --> errors
  adapters --> game
  adapters --> util
  adapters --> wallet
  admin --> adapters
  admin --> compliance
  admin --> errors
  admin --> game
  admin --> integration
  admin --> jobs
  admin --> payments
  admin --> platform
  admin --> util
  agent --> adapters
  agent --> compliance
  agent --> errors
  agent --> game
  agent --> integration
  agent --> platform
  agent --> ports
  agent --> util
  auth --> errors
  auth --> platform
  auth --> util
  boot --> admin
  boot --> game
  boot --> util
  compliance --> adapters
  compliance --> errors
  compliance --> game
  compliance --> payments
  compliance --> util
  draw-engine --> errors
  draw-engine --> util
  game --> adapters
  game --> admin
  game --> agent
  game --> compliance
  game --> errors
  game --> observability
  game --> platform
  game --> sockets
  game --> store
  game --> util
  integration --> adapters
  integration --> util
  jobs --> admin
  jobs --> agent
  jobs --> compliance
  jobs --> errors
  jobs --> game
  jobs --> notifications
  jobs --> payments
  jobs --> store
  jobs --> util
  jobs --> wallet
  media --> errors
  middleware --> game
  middleware --> observability
  middleware --> util
  notifications --> util
  observability --> adapters
  observability --> admin
  observability --> game
  observability --> jobs
  observability --> platform
  observability --> util
  payments --> adapters
  payments --> errors
  payments --> game
  payments --> util
  platform --> adapters
  platform --> errors
  platform --> game
  platform --> util
  ports --> adapters
  ports --> admin
  ports --> compliance
  ports --> game
  ports --> platform
  routes --> adapters
  routes --> admin
  routes --> agent
  routes --> auth
  routes --> compliance
  routes --> draw-engine
  routes --> errors
  routes --> game
  routes --> integration
  routes --> jobs
  routes --> media
  routes --> notifications
  routes --> observability
  routes --> payments
  routes --> platform
  routes --> security
  routes --> sockets
  routes --> spillevett
  routes --> store
  routes --> util
  routes --> wallet
  security --> adapters
  security --> errors
  security --> util
  services --> adapters
  services --> compliance
  services --> game
  services --> ports
  services --> util
  sockets --> adapters
  sockets --> errors
  sockets --> game
  sockets --> middleware
  sockets --> observability
  sockets --> platform
  sockets --> util
  spillevett --> adapters
  spillevett --> compliance
  spillevett --> errors
  spillevett --> game
```

## Notes

- Diagrammene er auto-generert fra package.json + import-statements.
- Cap på 120 backend-domene-kanter for å holde diagrammet rendable.
- For full per-fil-graf, kjør `npx depcruise --output-type mermaid apps/backend/src` lokalt.
