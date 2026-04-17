#!/usr/bin/env python3
"""Generate professional PDF from the final security audit report."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.platypus.flowables import Flowable

# ── Colors ──────────────────────────────────────────────────────
ACCENT_BLUE    = HexColor("#0f3460")
ACCENT_RED     = HexColor("#c0392b")
ACCENT_ORANGE  = HexColor("#e67e22")
ACCENT_GREEN   = HexColor("#27ae60")
LIGHT_GRAY     = HexColor("#f5f6fa")
DARK_TEXT       = HexColor("#2c3e50")
MUTED_TEXT      = HexColor("#636e72")
KRITISK_BG     = HexColor("#fdedec")
KRITISK_BORDER = HexColor("#e74c3c")
HOY_BG         = HexColor("#fef9e7")
HOY_BORDER     = HexColor("#f39c12")
MEDIUM_BG      = HexColor("#eaf2f8")
MEDIUM_BORDER  = HexColor("#2980b9")
LAV_BG         = HexColor("#eafaf1")
LAV_BORDER     = HexColor("#27ae60")
TABLE_HEADER   = HexColor("#2c3e50")
TABLE_ALT      = HexColor("#f8f9fa")

OUTPUT_PATH = "/Users/tobiashaugen/Projects/Spillorama-system/docs/ENDELIG_SIKKERHETSRAPPORT_2026-04-10.pdf"


# ── Custom Flowables ────────────────────────────────────────────

class ColoredBox(Flowable):
    def __init__(self, content, width, border_color, bg_color, padding=8):
        Flowable.__init__(self)
        self.content = content
        self.box_width = width
        self.border_color = border_color
        self.bg_color = bg_color
        self.padding = padding
        self.content.wrapOn(None, width - 2*padding - 4, 1000)
        self.box_height = self.content.height + 2*padding

    def wrap(self, availWidth, availHeight):
        return (self.box_width, self.box_height)

    def draw(self):
        canvas = self.canv
        canvas.setFillColor(self.bg_color)
        canvas.rect(0, 0, self.box_width, self.box_height, fill=1, stroke=0)
        canvas.setStrokeColor(self.border_color)
        canvas.setLineWidth(3)
        canvas.line(0, 0, 0, self.box_height)
        self.content.drawOn(canvas, self.padding + 4, self.padding)


# ── Styles ──────────────────────────────────────────────────────

def get_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('DocTitle', parent=styles['Title'],
        fontSize=22, leading=28, textColor=DARK_TEXT,
        spaceAfter=6, alignment=TA_LEFT, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('DocSubtitle', parent=styles['Normal'],
        fontSize=10, leading=14, textColor=MUTED_TEXT,
        spaceAfter=2, fontName='Helvetica'))
    styles.add(ParagraphStyle('H1', parent=styles['Heading1'],
        fontSize=16, leading=22, textColor=ACCENT_BLUE,
        spaceBefore=20, spaceAfter=10, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('H2', parent=styles['Heading2'],
        fontSize=13, leading=18, textColor=DARK_TEXT,
        spaceBefore=14, spaceAfter=6, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('H3', parent=styles['Heading3'],
        fontSize=11, leading=15, textColor=DARK_TEXT,
        spaceBefore=10, spaceAfter=4, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('Body', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        spaceAfter=6, alignment=TA_JUSTIFY, fontName='Helvetica'))
    styles.add(ParagraphStyle('BodyBold', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        spaceAfter=6, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('BulletItem', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        leftIndent=16, bulletIndent=6, spaceAfter=3, fontName='Helvetica'))
    styles.add(ParagraphStyle('TableCell', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=DARK_TEXT, fontName='Helvetica'))
    styles.add(ParagraphStyle('TableHeader', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=white, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('FindingTitle', parent=styles['Normal'],
        fontSize=11, leading=15, textColor=DARK_TEXT,
        spaceAfter=4, fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle('Footer', parent=styles['Normal'],
        fontSize=7, leading=9, textColor=MUTED_TEXT,
        alignment=TA_CENTER, fontName='Helvetica'))
    styles.add(ParagraphStyle('BigNumber', parent=styles['Normal'],
        fontSize=28, leading=32, textColor=ACCENT_RED,
        fontName='Helvetica-Bold', alignment=TA_CENTER))
    styles.add(ParagraphStyle('BigLabel', parent=styles['Normal'],
        fontSize=9, leading=12, textColor=MUTED_TEXT,
        fontName='Helvetica', alignment=TA_CENTER))
    return styles


# ── Page Template ───────────────────────────────────────────────

def on_first_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(ACCENT_BLUE)
    canvas.rect(0, h - 8, w, 8, fill=1, stroke=0)
    canvas.setFillColor(MUTED_TEXT)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(w/2, 15, "Konfidensiell - kun for intern distribusjon")
    canvas.restoreState()

def on_later_pages(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(ACCENT_BLUE)
    canvas.rect(0, h - 4, w, 4, fill=1, stroke=0)
    canvas.setStrokeColor(LIGHT_GRAY)
    canvas.setLineWidth(0.5)
    canvas.line(30, 30, w - 30, 30)
    canvas.setFillColor(MUTED_TEXT)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(30, 18, "Endelig sikkerhetsrapport - Spillorama Bingo")
    canvas.drawRightString(w - 30, 18, f"Side {doc.page}")
    canvas.restoreState()


# ── Helper functions ────────────────────────────────────────────

def make_finding_box(title, body_text, border_color, bg_color, width, styles):
    content = Paragraph(f"<b>{title}</b><br/><br/>{body_text}", styles['Body'])
    return ColoredBox(content, width, border_color, bg_color)

def make_table(headers, rows, col_widths, styles):
    header_cells = [Paragraph(h, styles['TableHeader']) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), styles['TableCell']) for c in row])

    style_commands = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8.5),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#dee2e6")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_commands.append(('BACKGROUND', (0, i), (-1, i), TABLE_ALT))

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style_commands))
    return t


# ── Build Document ──────────────────────────────────────────────

def build():
    doc = SimpleDocTemplate(
        OUTPUT_PATH, pagesize=A4,
        leftMargin=30, rightMargin=30,
        topMargin=40, bottomMargin=40
    )
    styles = get_styles()
    W = doc.width
    story = []

    # ── Title Page ──
    story.append(Spacer(1, 60))
    story.append(Paragraph("Endelig sikkerhetsrapport", styles['DocTitle']))
    story.append(Paragraph("RNG, trekksikkerhet og spillintegritet i Spillorama Bingo", styles['DocSubtitle']))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT_BLUE))
    story.append(Spacer(1, 12))

    meta = [
        ("Dato:", "10. april 2026"),
        ("Utarbeidet av:", "Senior konsulent, endelig teknisk gjennomgang"),
        ("Grunnlag:", "Konsolidering av to uavhengige konsulentrapporter + egen kodegjennomgang"),
        ("Scope:", "RNG, trekning, claims, wallet-integritet, WebSocket-sikkerhet, persistering, recovery, compliance"),
        ("Klassifisering:", "Konfidensiell - kun for intern distribusjon"),
    ]
    for label, value in meta:
        story.append(Paragraph(f"<b>{label}</b> {value}", styles['Body']))

    story.append(Spacer(1, 30))

    # Summary stats boxes
    stats_data = [
        [Paragraph("8", styles['BigNumber']),
         Paragraph("7", styles['BigNumber']),
         Paragraph("4", styles['BigNumber']),
         Paragraph("2", styles['BigNumber'])],
        [Paragraph("P0 Blokkerende", styles['BigLabel']),
         Paragraph("P1 Maa lukkes", styles['BigLabel']),
         Paragraph("P2 Viktige", styles['BigLabel']),
         Paragraph("P3 Lave", styles['BigLabel'])],
    ]
    stats_table = Table(stats_data, colWidths=[W/4]*4)
    stats_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (0, -1), 1, KRITISK_BORDER),
        ('BOX', (1, 0), (1, -1), 1, HOY_BORDER),
        ('BOX', (2, 0), (2, -1), 1, MEDIUM_BORDER),
        ('BOX', (3, 0), (3, -1), 1, LAV_BORDER),
        ('BACKGROUND', (0, 0), (0, -1), KRITISK_BG),
        ('BACKGROUND', (1, 0), (1, -1), HOY_BG),
        ('BACKGROUND', (2, 0), (2, -1), MEDIUM_BG),
        ('BACKGROUND', (3, 0), (3, -1), LAV_BG),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 12),
    ]))
    story.append(stats_table)

    story.append(Spacer(1, 30))
    story.append(make_finding_box(
        "HOVEDKONKLUSJON",
        "Systemet skal ikke gaa live med ekte penger i dagens form. "
        "Tre uavhengige gjennomganger har identifisert 21 funn, hvorav 8 er blokkerende for pengespill. "
        "Estimert utbedringstid: 6-10 uker ekskludert ekstern sertifisering.",
        KRITISK_BORDER, KRITISK_BG, W, styles
    ))

    story.append(PageBreak())

    # ── 1. Sammendrag ──
    story.append(Paragraph("1. Sammendrag", styles['H1']))
    story.append(Paragraph(
        "Denne rapporten konsoliderer funn fra to uavhengige konsulentgjennomganger og en tredje "
        "verifiseringsrunde direkte mot gjeldende kode. Alle funn fra tidligere rapporter er "
        "verifisert som korrekte og fortsatt gjeldende. I tillegg er 9 nye vesentlige forhold identifisert.",
        styles['Body']))

    story.append(make_table(
        ["Alvorlighetsgrad", "Antall", "Nye i denne rapporten"],
        [
            ["P0 - Blokkerende for pengespill", "8", "2"],
            ["P1 - Maa lukkes i samme arbeidsstream", "7", "4"],
            ["P2 - Viktige, men sekundaere", "4", "2"],
            ["P3 - Lave", "2", "1"],
        ],
        [W*0.5, W*0.2, W*0.3], styles
    ))

    story.append(PageBreak())

    # ── 2. P0 Funn ──
    story.append(Paragraph("2. P0 - Blokkerende funn", styles['H1']))
    story.append(Paragraph(
        "Disse 8 funnene maa lukkes foer systemet kan haandtere ekte penger.",
        styles['Body']))

    p0_findings = [
        ("KRITISK-1: Ingen tredjeparts RNG-godkjenning",
         "For pengespill kreves sertifisering fra akkreditert testlab (BMM, GLI, eCOGRA). "
         "Ingen slik godkjenning foreligger. Dette er en regulatorisk forutsetning.",
         "Engasjer akkreditert testlab. Estimat: 4-8 uker (ekstern prosess)."),

        ("KRITISK-2: Aktiv spilltilstand kun i prosessminnet",
         "All spilltilstand lever i en intern Map i BingoEngine. Et serverkrasj under aktive "
         "spill betyr fullstendig tap av tilstand. Penger kan vaere trukket uten at runden kan fullfoeres.",
         "Definer autorativ state/replay-modell. Implementer fullstendig serialisering og recovery. Estimat: 2-3 uker."),

        ("KRITISK-3: Klartekstlogging av full trekkerekkefoelge",
         "Hele trekkesekken logges som RNG_DRAW_BAG ved spillstart. Enhver med loggtilgang kan se "
         "fremtidige trekk. Dette er en alvorlig innsiderisiko og regulatorisk brudd.",
         "Erstatt med kryptografisk hash-commit. Fjern klartekstlogging etter at sikker persistering er paa plass. Estimat: 2-3 dager."),

        ("KRITISK-4: BINGO-claim kan gi dobbeltutbetaling",
         "submitClaim() har guard for LINE via game.lineWinnerId, men ingen tilsvarende for BINGO "
         "foer wallet-overfoering. Ved samtidige claims finnes et race-vindu som kan gi dobbeltutbetaling.",
         "Innfoer atomisk single-winner-guard og romnivaa-laas. Estimat: 1-2 dager."),

        ("KRITISK-5: Snapshot kan ikke gjenskape neste trekk",
         "GameSnapshot lagrer drawnNumbers og remainingNumbers, men ikke drawBag (den ordnede "
         "restsekvensen). Recovery kan aldri bli korrekt, selv med hyppigere checkpointing.",
         "Utvid snapshotmodell med autorativ trekketilstand. Estimat: 2-4 dager."),

        ("KRITISK-6: Serialisering destruerer kryss-data per billett",
         "serializeGame() flater ut kryss per brett til en enkelt liste per spiller. "
         "For spillere med flere brett er det umulig aa rekonstruere hvilke kryss hoerer til hvilket brett.",
         "Behold kryss-struktur per billett i snapshotformatet. Estimat: 1-2 dager."),

        ("KRITISK-7: WebSocket-tilkobling krever ikke autentisering (NY)",
         "Socket.IO-serveren utfoerer ingen autentiseringssjekk ved tilkobling. "
         "Uautentiserte klienter kan koble seg til og lytte paa alle broadcast-meldinger "
         "inkludert romoppdateringer, trekk og claim-resultater.",
         "Implementer Socket.IO auth middleware med JWT-validering. Estimat: 0.5 dag."),

        ("KRITISK-8: Uarmerte spillere kan sende inn claims (NY)",
         "submitClaim() sjekker ikke om spilleren var armert (betalte buy-in) for gjeldende runde. "
         "En spiller som ikke deltok oekonomisk kan potensielt vinne premiepotten.",
         "Legg til armed-sjekk i submitClaim(). Estimat: 0.5 dag."),
    ]

    for title, desc, fix in p0_findings:
        story.append(Spacer(1, 6))
        story.append(KeepTogether([
            make_finding_box(title, desc, KRITISK_BORDER, KRITISK_BG, W, styles),
            Spacer(1, 4),
            Paragraph(f"<b>Tiltak:</b> {fix}", styles['BulletItem']),
        ]))

    story.append(PageBreak())

    # ── 3. P1 Funn ──
    story.append(Paragraph("3. P1 - Maa lukkes i samme arbeidsstream", styles['H1']))

    p1_findings = [
        ("HOEY-2: Motor-default for payoutPercent er 100%",
         "payoutPercent ?? 100 i BingoEngine er en farlig fallback. Nye kallestier som glemmer feltet gir 100% utbetaling.",
         "Fjern default, krev eksplisitt verdi. Estimat: 0.5 dag."),

        ("HOEY-4: Buy-in kan bli delvis committet uten rollback",
         "Wallet-debitering skjer foer room.currentGame etableres. Ved feil etter debitering finnes ingen rollback.",
         "Gjor oppstartssekvens atomisk eller kompensasjonsbasert. Estimat: 2-4 dager."),

        ("HOEY-6: Sluttstatus persisteres ikke ved automatisk spillslutt",
         "GAME_END-checkpoint skrives bare ved manuell endGame(). Avslutning via MAX_DRAWS_REACHED, "
         "DRAW_BAG_EMPTY og BINGO_CLAIMED setter kun status i minnet.",
         "Skriv endelig checkpoint for alle avslutningsbaner. Estimat: 1-2 dager."),

        ("HOEY-7: Redis-state og distribuert lock ikke innkoblet",
         "RoomStateStore og RedisSchedulerLock finnes i koden, men BingoEngine bruker intern Map "
         "og DrawScheduler oppretter lokal lock. Distribuert drift er ikke mulig.",
         "Koble inn state store og lock i live path. Estimat: 1-2 uker."),

        ("HOEY-8: WalletAdapter-idempotency ikke brukt (NY)",
         "WalletAdapter-interfacet stoetter idempotencyKey og PostgresWalletAdapter implementerer "
         "det korrekt. Men BingoEngine sender aldri med idempotency-noekkel. Den enkleste "
         "beskyttelsen mot dobbeltutbetaling er ikke aktivert.",
         "Send claim.id som idempotencyKey paa alle transfer-kall. Estimat: 0.5 dag."),

        ("HOEY-9: Rate limiting per socket, ikke per spiller (NY)",
         "Rate-begrensning spores paa socketId. Reconnect gir ny socketId og nullstilte tellere. "
         "Ondsinnet bruk kan omgaa rate limits ved aa reconnecte.",
         "Spoer rate limits paa walletId/playerId. Estimat: 1 dag."),

        ("HOEY-10: Checkpoint deaktivert som standard (NY)",
         "BINGO_CHECKPOINT_ENABLED har default false. I standard deploy er all checkpointing "
         "avslaaatt og utbetalinger skjer uten database-backup.",
         "Endre default til true. Krev eksplisitt opt-out i produksjon. Estimat: 0.5 dag."),

        ("HOEY-11: Redis-persistering er fire-and-forget (NY)",
         "RedisRoomStateStore.set() kaller persistAsync().catch(() => {}). Feil svelges. "
         "Serveren svarer klienten med suksess selv om Redis-skriving feilet.",
         "Gjor persist() synkron med feilhaandtering. Estimat: 1-2 dager."),
    ]

    for title, desc, fix in p1_findings:
        story.append(Spacer(1, 6))
        story.append(KeepTogether([
            make_finding_box(title, desc, HOY_BORDER, HOY_BG, W, styles),
            Spacer(1, 4),
            Paragraph(f"<b>Tiltak:</b> {fix}", styles['BulletItem']),
        ]))

    story.append(PageBreak())

    # ── 4. P2/P3 Funn ──
    story.append(Paragraph("4. P2 og P3 - Viktige og lave funn", styles['H1']))

    p2_findings = [
        ("MEDIUM-1: Manuell draw mangler minimumsintervall", MEDIUM_BORDER, MEDIUM_BG),
        ("MEDIUM-4: Admin-trekk logfoerer feil aktoer-ID (NY)", MEDIUM_BORDER, MEDIUM_BG),
        ("MEDIUM-5: Payout audit hash-kjede ikke implementert (NY)", MEDIUM_BORDER, MEDIUM_BG),
        ("MEDIUM-3: Ingen server-side gevinstdeteksjon", MEDIUM_BORDER, MEDIUM_BG),
    ]
    for title, bc, bg in p2_findings:
        story.append(make_finding_box(title, "", bc, bg, W, styles))
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 8))

    p3_findings = [
        ("LAV-1: Misvisende kommentarer og funksjonsnavn", LAV_BORDER, LAV_BG),
        ("LAV-3: Ingen WebSocket-meldingstoerrelse (NY)", LAV_BORDER, LAV_BG),
    ]
    for title, bc, bg in p3_findings:
        story.append(make_finding_box(title, "", bc, bg, W, styles))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ── 5. Testdekning ──
    story.append(Paragraph("5. Testdekning - vurdering", styles['H1']))
    story.append(Paragraph(
        "Relevante backend-tester passerer, men testbasen gir falsk trygghet om systemets sikkerhet:",
        styles['Body']))

    story.append(make_table(
        ["Kategori", "Dekning", "Risiko"],
        [
            ["Draw-scheduling", "100+ tester", "Lav"],
            ["Compliance (tapsbegrensning)", "10+ tester", "Lav"],
            ["Samtidige BINGO-claims", "Ingen", "Kritisk"],
            ["Checkpoint/recovery", "Ingen", "Kritisk"],
            ["Wallet-feil under utbetaling", "Ingen", "Kritisk"],
            ["Uarmert spiller sender claim", "Ingen", "Kritisk"],
            ["WebSocket-autentisering", "Ingen", "Hoey"],
            ["Produksjonsformat 3x5/60", "Nei", "Medium"],
        ],
        [W*0.45, W*0.25, W*0.3], styles
    ))

    story.append(PageBreak())

    # ── 6. Handlingsplan ──
    story.append(Paragraph("6. Anbefalt handlingsrekkefoelge", styles['H1']))

    phases = [
        ("Fase 0 - Umiddelbare sperrer (1-3 dager)",
         "Kan og boer lukkes uavhengig av arkitekturbeslutninger.",
         ["WebSocket auth middleware (KRITISK-7)",
          "Armed-sjekk i submitClaim (KRITISK-8)",
          "Aktiver wallet-idempotency (HOEY-8)",
          "Endre checkpoint-default til true (HOEY-10)"]),

        ("Fase 1 - Autorativ sannhetsmodell (1-2 uker)",
         "Designbeslutninger som maa tas foer detaljutbedringer.",
         ["Definer autorativ kilde for aktiv spilltilstand",
          "Design sikker persistering av trekkesekvens",
          "Definer snapshot/replay-modell for krasj-recovery",
          "Definer sluttstatusmodell for alle avslutningsbaner"]),

        ("Fase 2 - OEkonomiske og regulatoriske hull (2-3 uker)",
         "Lukke de direkte oekonomiske og regulatoriske hullene.",
         ["Fjern klartekstlogging av drawBag (KRITISK-3)",
          "Atomisk single-winner for BINGO (KRITISK-4)",
          "Endelig checkpoint for alle spillsluttbaner (HOEY-6)",
          "Atomisk oppstartssekvens (HOEY-4)"]),

        ("Fase 3 - Distribuert drift og robusthet (2-3 uker)",
         "Koble inn distribuert tilstand og robustifiser.",
         ["Integrer Redis state store i BingoEngine (HOEY-7)",
          "Synkron Redis-persistering (HOEY-11)",
          "Spiller-basert rate limiting (HOEY-9)",
          "Admin audit-trail (MEDIUM-4)"]),

        ("Fase 4 - Test, dokumentasjon og sertifisering (3-4 uker)",
         "Verifiser, dokumenter og sertifiser.",
         ["Concurrency-, recovery- og wallet-feiltester",
          "Dokumenter trekksikkerhetsmodell",
          "Uavhengig RNG-sertifisering (KRITISK-1)"]),
    ]

    for phase_title, phase_desc, items in phases:
        story.append(Paragraph(phase_title, styles['H2']))
        story.append(Paragraph(phase_desc, styles['Body']))
        for item in items:
            story.append(Paragraph(f"\u2022  {item}", styles['BulletItem']))
        story.append(Spacer(1, 6))

    story.append(PageBreak())

    # ── 7. Komplett prioritert tabell ──
    story.append(Paragraph("7. Komplett prioritert handlingsplan", styles['H1']))

    story.append(make_table(
        ["Prio", "ID", "Funn", "Estimat"],
        [
            ["P0", "KRITISK-1", "Ingen tredjeparts RNG-godkjenning", "4-8 uker"],
            ["P0", "KRITISK-7", "WebSocket uten autentisering (NY)", "0.5 dag"],
            ["P0", "KRITISK-8", "Uarmerte kan claime (NY)", "0.5 dag"],
            ["P0", "KRITISK-3", "Klartekstlogging av drawBag", "2-3 dager"],
            ["P0", "KRITISK-4", "BINGO-claim race", "1-2 dager"],
            ["P0", "KRITISK-5", "Snapshot mangler drawBag", "2-4 dager"],
            ["P0", "KRITISK-6", "Serialisering destruerer kryss", "1-2 dager"],
            ["P0", "KRITISK-2", "Spilltilstand kun i minnet", "2-3 uker"],
            ["P1", "HOEY-8", "Idempotency ikke brukt (NY)", "0.5 dag"],
            ["P1", "HOEY-10", "Checkpoint default false (NY)", "0.5 dag"],
            ["P1", "HOEY-11", "Redis fire-and-forget (NY)", "1-2 dager"],
            ["P1", "HOEY-6", "Sluttstatus ikke persistert", "1-2 dager"],
            ["P1", "HOEY-4", "Delvis buy-in commit", "2-4 dager"],
            ["P1", "HOEY-9", "Rate limit per socket (NY)", "1 dag"],
            ["P1", "HOEY-7", "Redis ikke innkoblet", "1-2 uker"],
            ["P2", "HOEY-2", "payoutPercent default 100", "0.5 dag"],
            ["P2", "MEDIUM-1", "Ingen draw cadence", "0.5 dag"],
            ["P2", "MEDIUM-4", "Admin audit trail feil (NY)", "0.5 dag"],
            ["P2", "MEDIUM-5", "Audit hash-kjede tom (NY)", "2-3 dager"],
            ["P3", "LAV-1", "Misvisende kommentarer", "0.5 dag"],
            ["P3", "LAV-3", "Ingen WS-meldingsgrense (NY)", "5 min"],
        ],
        [W*0.07, W*0.13, W*0.55, W*0.25], styles
    ))

    story.append(Spacer(1, 20))
    story.append(Paragraph(
        "<b>Samlet estimat ekskludert ekstern sertifisering: 6-10 uker</b>",
        styles['BodyBold']))

    story.append(PageBreak())

    # ── 8. Konklusjon ──
    story.append(Paragraph("8. Konklusjon og anbefaling", styles['H1']))
    story.append(Paragraph(
        "Spillorama Bingo har et forsvarlig kryptografisk fundament (node:crypto RNG, korrekt "
        "Fisher-Yates) og gjennomtenkt wallet-arkitektur (ACID-transaksjoner, idempotency-stoette). "
        "Men det er et betydelig gap mellom det som er designet og det som er operativt koblet inn.",
        styles['Body']))
    story.append(Paragraph(
        "De 8 P0-funnene representerer til sammen en risiko der:",
        styles['Body']))
    risks = [
        "Penger kan utbetales feil (dobbeltutbetaling, uarmert vinner)",
        "Spilltilstand kan gaa tapt uten mulighet for gjenoppretting",
        "Trekkerekkefoelgen kan observeres paa forhaand",
        "Uautentiserte parter kan observere spilltilstand",
    ]
    for r in risks:
        story.append(Paragraph(f"\u2022  {r}", styles['BulletItem']))

    story.append(Spacer(1, 16))
    story.append(make_finding_box(
        "ANBEFALING",
        "Stopp all utvikling av nye funksjoner. Alloker hele teamet til utbedring av P0- og P1-funn "
        "i den rekkefolgjen som er beskrevet i kapittel 6. Forst naar disse er lukket og verifisert, "
        "bor systemet sendes til uavhengig sertifisering.",
        ACCENT_BLUE, LIGHT_GRAY, W, styles
    ))

    story.append(Spacer(1, 40))
    story.append(HRFlowable(width="100%", thickness=1, color=MUTED_TEXT))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Slutt paa endelig rapport.", styles['Body']))

    # Build
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
