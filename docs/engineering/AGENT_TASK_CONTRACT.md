# Agent Task Contract

**Status:** Autoritativ fra 2026-05-15.
**Eier:** PM-AI.
**Formaal:** PM skal spawne implementer-agenter med fakta, ikke fritekst fra hukommelse.

---

## Hvorfor dette finnes

Tobias rapporterte 2026-05-15 at flere agenter i forrige sesjon misforstod hva
som ble sagt. I et live-room pengespill med ekte penger er det ikke akseptabelt
at implementer-agenten jobber fra antakelser, utydelig scope eller manglende
evidence.

Agent Task Contract er derfor standard prompt-kilde for high-risk arbeid. Den
samler:

- konkret objective
- fil-scope
- evidence pack
- relevante skills via scope-mapping
- context-pack fra repoet
- hard constraints og non-goals
- immutable skill-doc-protokoll
- delivery report-krav

## Bruk

PM genererer kontrakt foer agent-spawn:

```bash
npm run agent:contract -- \
  --agent "Agent A — purchase_open seed/tick fix" \
  --objective "Prove and fix why scheduled games skip purchase_open" \
  --files apps/backend/src/game/Game1ScheduleTickService.ts \
  --files apps/backend/scripts/seed-demo-pilot-day.ts \
  --evidence /tmp/purchase-open-forensics-2026-05-15T20-23-37Z.md \
  --risk P0 \
  --output /tmp/agent-contract-purchase-open.md
```

Deretter limer PM hele `/tmp/agent-contract-*.md` inn i agent-prompten.

## Regler

1. PM skal ikke spawne implementation-agent paa high-risk kode uten kontrakt.
2. Agenten maa behandle kontrakten som source of truth.
3. Fakta maa kunne spores til file:line, DB-rad, logglinje, Sentry issue,
   PostHog-session eller test-output.
4. Hypoteser maa merkes som hypoteser. De skal ikke skrives som root cause foer
   de er bevist.
5. Hvis evidence motsier objective, skal agenten stoppe og melde konflikt foer
   kodeendring.
6. Agenten skal oppdatere skill, PITFALLS_LOG og AGENT_EXECUTION_LOG i samme PR
   naar tasken endrer pilot/wallet/compliance/live-room/PM-workflow-atferd.
7. Agent Delivery Report er obligatorisk foer PM aapner eller merger PR.

## Naar kontrakt er paakrevd

Kontrakt er paakrevd for:

- Spill 1/2/3 runtime, scheduled-games, master-flow, wallet eller compliance.
- Live-test-feil som er sett 2+ ganger.
- Endringer der Postgres/Sentry/PostHog/live-monitor brukes som evidence.
- Alle parallelle agent-boelger der flere agenter jobber samtidig.
- Agent-tasker der Tobias har uttrykt at tidligere agenter misforstod scope.

Kontrakt kan droppes for:

- Ren typo i docs.
- Mekanisk formattering.
- Dependabot eller config-pin uten produktatferd.

Hvis i tvil, generer kontrakt. Kostnaden er lavere enn en misforstaatt agent.

**Unntak ved P1 incident:** Under aktivt P1-incident (live-rom henger, prod nede, wallet-feil) vinner [`INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md`](../operations/INCIDENT_MODE_VS_KNOWLEDGE_PROTOCOL.md) over kontrakt-flyt. Hotfix-PR kan bruke `gate-bypass: hotfix-incident-YYYY-MM-DD` + `[bypass-knowledge-protocol: hotfix]`. Knowledge-update gjenopptas innen 24 timer post-stabilisering. Se ADR-0024 for bypass-policy.

## Verifikasjon ved agent-leveranse

PM skal avvise leveransen hvis en av disse mangler:

- Agenten viser hva den leste foer endring.
- Agenten forklarer root cause med konkrete bevis.
- Agenten lister invariants som ble bevart.
- Agenten dokumenterer tester som ble kjort eller hvorfor de ikke kunne kjoeres.
- Agenten oppdaterer relevante kunnskapsartefakter eller gir konkret, reviserbar
  grunn for at de ikke gjelder.

Relaterte filer:

- `scripts/generate-agent-contract.sh`
- `scripts/generate-context-pack.sh`
- `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md`
- `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md`
