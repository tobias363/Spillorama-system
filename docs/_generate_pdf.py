#!/usr/bin/env python3
"""Generate professional PDF from the RNG consultant report."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, black, white, Color
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Preformatted
)
from reportlab.platypus.flowables import Flowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ── Colors ──────────────────────────────────────────────────────
DARK_BG       = HexColor("#1a1a2e")
ACCENT_BLUE   = HexColor("#0f3460")
ACCENT_RED    = HexColor("#c0392b")
ACCENT_ORANGE = HexColor("#e67e22")
ACCENT_GREEN  = HexColor("#27ae60")
LIGHT_GRAY    = HexColor("#f5f6fa")
MED_GRAY      = HexColor("#dcdde1")
DARK_TEXT      = HexColor("#2c3e50")
MUTED_TEXT     = HexColor("#636e72")
CODE_BG        = HexColor("#f8f9fa")
CODE_BORDER    = HexColor("#dee2e6")
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

OUTPUT_PATH = "/Users/tobiashaugen/Projects/Spillorama-system/docs/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.pdf"


# ── Custom Flowables ────────────────────────────────────────────

class ColoredBox(Flowable):
    """A colored box with left border accent."""
    def __init__(self, content, width, border_color, bg_color, padding=8):
        Flowable.__init__(self)
        self.content = content
        self.box_width = width
        self.border_color = border_color
        self.bg_color = bg_color
        self.padding = padding
        # Pre-calculate height
        self.content.wrapOn(None, width - 2*padding - 4, 1000)
        self.box_height = self.content.height + 2*padding

    def wrap(self, availWidth, availHeight):
        return (self.box_width, self.box_height)

    def draw(self):
        canvas = self.canv
        # Background
        canvas.setFillColor(self.bg_color)
        canvas.rect(0, 0, self.box_width, self.box_height, fill=1, stroke=0)
        # Left border
        canvas.setStrokeColor(self.border_color)
        canvas.setLineWidth(3)
        canvas.line(0, 0, 0, self.box_height)
        # Content
        self.content.drawOn(canvas, self.padding + 4, self.padding)


class CodeBlock(Flowable):
    """Monospaced code block with background."""
    def __init__(self, text, width, font_size=7.5):
        Flowable.__init__(self)
        self.text = text
        self.box_width = width
        self.font_size = font_size
        self.padding = 8
        lines = text.split('\n')
        self.line_height = font_size * 1.4
        self.box_height = len(lines) * self.line_height + 2 * self.padding

    def wrap(self, availWidth, availHeight):
        return (self.box_width, self.box_height)

    def draw(self):
        canvas = self.canv
        # Background
        canvas.setFillColor(CODE_BG)
        canvas.roundRect(0, 0, self.box_width, self.box_height, 3, fill=1, stroke=0)
        # Border
        canvas.setStrokeColor(CODE_BORDER)
        canvas.setLineWidth(0.5)
        canvas.roundRect(0, 0, self.box_width, self.box_height, 3, fill=0, stroke=1)
        # Text
        canvas.setFillColor(DARK_TEXT)
        canvas.setFont("Courier", self.font_size)
        lines = self.text.split('\n')
        y = self.box_height - self.padding - self.font_size
        for line in lines:
            canvas.drawString(self.padding, y, line)
            y -= self.line_height


# ── Styles ──────────────────────────────────────────────────────

def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'DocTitle', parent=styles['Title'],
        fontSize=22, leading=28, textColor=DARK_TEXT,
        spaceAfter=6, alignment=TA_LEFT, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'DocSubtitle', parent=styles['Normal'],
        fontSize=10, leading=14, textColor=MUTED_TEXT,
        spaceAfter=2, fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'H1', parent=styles['Heading1'],
        fontSize=16, leading=22, textColor=ACCENT_BLUE,
        spaceBefore=20, spaceAfter=10, fontName='Helvetica-Bold',
        borderWidth=0, borderPadding=0
    ))
    styles.add(ParagraphStyle(
        'H2', parent=styles['Heading2'],
        fontSize=13, leading=18, textColor=DARK_TEXT,
        spaceBefore=14, spaceAfter=6, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'H3', parent=styles['Heading3'],
        fontSize=11, leading=15, textColor=DARK_TEXT,
        spaceBefore=10, spaceAfter=4, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'Body', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        spaceAfter=6, alignment=TA_JUSTIFY, fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'BodyBold', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        spaceAfter=6, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'BulletItem', parent=styles['Normal'],
        fontSize=9.5, leading=14, textColor=DARK_TEXT,
        leftIndent=16, bulletIndent=6, spaceAfter=3,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'SmallMuted', parent=styles['Normal'],
        fontSize=8, leading=11, textColor=MUTED_TEXT,
        fontName='Helvetica-Oblique'
    ))
    styles.add(ParagraphStyle(
        'TableCell', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=DARK_TEXT,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=white,
        fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'FindingTitle', parent=styles['Normal'],
        fontSize=11, leading=15, textColor=DARK_TEXT,
        spaceAfter=4, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'CodeInline', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=DARK_TEXT,
        fontName='Courier'
    ))
    styles.add(ParagraphStyle(
        'TocEntry', parent=styles['Normal'],
        fontSize=10, leading=16, textColor=ACCENT_BLUE,
        leftIndent=10, fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'Footer', parent=styles['Normal'],
        fontSize=7, leading=9, textColor=MUTED_TEXT,
        alignment=TA_CENTER, fontName='Helvetica'
    ))
    return styles


# ── Page Template ───────────────────────────────────────────────

def on_first_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Top accent bar
    canvas.setFillColor(ACCENT_BLUE)
    canvas.rect(0, h - 8*mm, w, 8*mm, fill=1, stroke=0)
    # Footer
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED_TEXT)
    canvas.drawCentredString(w/2, 12*mm, "Konfidensiell - Kun for intern distribusjon")
    canvas.restoreState()

def on_later_pages(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Top accent line
    canvas.setStrokeColor(ACCENT_BLUE)
    canvas.setLineWidth(1.5)
    canvas.line(20*mm, h - 12*mm, w - 20*mm, h - 12*mm)
    # Header text
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED_TEXT)
    canvas.drawString(20*mm, h - 10*mm, "Konsulentrapport: RNG og Balltrekning - Spillorama Bingo")
    canvas.drawRightString(w - 20*mm, h - 10*mm, "9. april 2026")
    # Footer
    canvas.drawCentredString(w/2, 12*mm, f"Side {doc.page}")
    canvas.setStrokeColor(MED_GRAY)
    canvas.setLineWidth(0.5)
    canvas.line(20*mm, 16*mm, w - 20*mm, 16*mm)
    canvas.restoreState()


# ── Helper functions ────────────────────────────────────────────

def make_table(headers, rows, col_widths, styles):
    """Create a styled table."""
    s = styles
    header_row = [Paragraph(h, s['TableHeader']) for h in headers]
    data_rows = []
    for row in rows:
        data_rows.append([Paragraph(str(c), s['TableCell']) for c in row])

    all_data = [header_row] + data_rows
    t = Table(all_data, colWidths=col_widths, repeatRows=1)

    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('ALIGN', (0, 0), (-1, 0), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, MED_GRAY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, TABLE_ALT]),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t


def finding_box(title, content_parts, border_color, bg_color, avail_width, styles):
    """Create a finding section with colored left border."""
    s = styles
    elements = []
    elements.append(Paragraph(title, s['FindingTitle']))
    for part in content_parts:
        elements.append(part)
    return elements


def hr():
    return HRFlowable(width="100%", thickness=0.5, color=MED_GRAY, spaceBefore=8, spaceAfter=8)


# ── Build Document ──────────────────────────────────────────────

def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=20*mm, bottomMargin=22*mm
    )

    s = get_styles()
    story = []
    w = doc.width

    # ── Title Page ──────────────────────────────────────────────
    story.append(Spacer(1, 15*mm))
    story.append(Paragraph("Konsulentrapport", s['DocTitle']))
    story.append(Paragraph("RNG, Balltrekning og RTP i Spillorama Bingo", s['H1']))
    story.append(Spacer(1, 6*mm))

    meta = [
        ("<b>Dato:</b> 9. april 2026", s['DocSubtitle']),
        ("<b>Oppdragsgiver:</b> Prosjektleder, Spillorama", s['DocSubtitle']),
        ("<b>Utarbeidet av:</b> Senior ledende teknisk konsulent", s['DocSubtitle']),
        ("<b>Scope:</b> Random Number Generation (RNG), balltrekning, billettgenerering, RTP-mekanikk og operasjonell beredskap", s['DocSubtitle']),
        ("<b>Klassifisering:</b> Konfidensiell - kun for intern distribusjon", s['DocSubtitle']),
    ]
    for text, style in meta:
        story.append(Paragraph(text, style))

    story.append(Spacer(1, 10*mm))
    story.append(hr())
    story.append(Spacer(1, 4*mm))

    # ── TOC ─────────────────────────────────────────────────────
    story.append(Paragraph("Innholdsfortegnelse", s['H2']))
    toc_items = [
        "1. Sammendrag for ledelsen",
        "2. Systemarkitektur relevant for RNG og trekning",
        "3. Slik fungerer balltrekningen i detalj",
        "4. Slik fungerer billettgenerering",
        "5. Slik fungerer RTP og utbetalingsmekanikk",
        "6. Slik fungerer automatisk trekning (DrawScheduler)",
        "7. Funn og risikovurdering",
        "8. Prioritert handlingsplan",
        "9. Vedlegg: Relevante filer og kodereferanser",
    ]
    for item in toc_items:
        story.append(Paragraph(item, s['TocEntry']))

    story.append(PageBreak())

    # ── Section 1: Sammendrag ───────────────────────────────────
    story.append(Paragraph("1. Sammendrag for ledelsen", s['H1']))

    story.append(Paragraph(
        "Spillorama-bingosystemet bruker en kryptografisk sikker tilfeldighetskilde "
        "(<font face='Courier' size='8'>node:crypto</font>) for bade balltrekning og billettgenerering. "
        "Den underliggende algoritmen (Fisher-Yates shuffle) er korrekt implementert. "
        "Dette er et godt utgangspunkt.", s['Body']))

    story.append(Paragraph("<b>Imidlertid er det fem kritiske mangler som ma adresseres for systemet kan ga live med ekte penger:</b>", s['Body']))

    findings_summary = [
        "1. <b>Ingen uavhengig RNG-sertifisering</b> - koden er ikke testet eller godkjent av et akkreditert laboratorium.",
        "2. <b>All aktiv spilltilstand lever i prosessminnet</b> - en serverrestart mister pagaende spill.",
        "3. <b>Hele den forhandsbestemte trekkerekkfolgen logges i klartekst</b> - innsiderisiko.",
        "4. <b>Ingen mekanisme for a gjenopprette et spill etter krasj</b> - checkpoints dekker ikke mellom-trekk-tilstand.",
        "5. <b>payoutPercent har default 100%</b> - systemet gir bort hele potten hvis admin glemmer konfigurasjonen.",
    ]
    for item in findings_summary:
        story.append(Paragraph(item, s['BulletItem'], bulletText='\u2022'))

    story.append(Spacer(1, 4*mm))

    rec_text = (
        "<b>Min anbefaling:</b> Systemet kan ikke ga live med pengespill i navarende tilstand. "
        "De tre forste punktene er regulatoriske showstoppere. De to siste er operasjonelle risiko som vil koste penger."
    )
    rec_para = Paragraph(rec_text, s['Body'])
    story.append(ColoredBox(rec_para, w, ACCENT_RED, KRITISK_BG))
    story.append(Spacer(1, 4*mm))

    # ── Section 2: Arkitektur ───────────────────────────────────
    story.append(Paragraph("2. Systemarkitektur relevant for RNG og trekning", s['H1']))

    story.append(Paragraph("Overordnet flyt", s['H2']))

    flow_text = (
        "SPILLSTART (game:start / auto-start via DrawScheduler)\n"
        "  1. BingoEngine.startGame() kalles\n"
        "  2. makeShuffledBallBag(60) -> forhands-shufflet array [1..60]\n"
        "  3. generateTraditional75Ticket() -> 3x5 grid per spiller\n"
        "  4. drawBag lagres i GameState (i minnet)\n"
        "  5. Hele drawBag logges i RNG_DRAW_BAG audit-event\n"
        "\n"
        "TREKNING (draw:next / auto-draw via DrawScheduler)\n"
        "  1. drawNextNumber() kalles\n"
        "  2. game.drawBag.shift() -> popper neste forhandsbestemt tall\n"
        "  3. Tallet legges til game.drawnNumbers\n"
        "  4. Socket.IO broadcast: draw:new til alle i rommet\n"
        "  5. Sjekk: maxDrawsPerRound nadd? -> avslutt runde\n"
        "  6. Sjekk: drawBag tom? -> avslutt runde\n"
        "\n"
        "GEVINST (claim:submit)\n"
        "  1. Spiller sender LINE eller BINGO claim\n"
        "  2. Server validerer mot spillerens brett og markeringer\n"
        "  3. Utbetaling beregnes med cap-logikk\n"
        "  4. Wallet-overforing utfores\n"
        "  5. Compliance-ledger og payout-audit oppdateres\n"
        "  6. Checkpoint skrives til PostgreSQL"
    )
    story.append(CodeBlock(flow_text, w, font_size=7.5))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("Nokkelkomponenter", s['H2']))
    comp_table = make_table(
        ["Komponent", "Fil", "Ansvar"],
        [
            ["BingoEngine", "backend/src/game/BingoEngine.ts", "All forretningslogikk: spillstart, trekning, gevinst, compliance"],
            ["ticket.ts", "backend/src/game/ticket.ts", "Fisher-Yates shuffle, billettgenerering, monstersjekk"],
            ["DrawScheduler", "backend/src/draw-engine/DrawScheduler.ts", "Automatisk runde-start og auto-trekning med timing"],
            ["DrawWatchdog", "backend/src/draw-engine/DrawWatchdog.ts", "Overvaker stuck rom og frigir hengende laser"],
            ["DrawSchedulerLock", "backend/src/draw-engine/DrawSchedulerLock.ts", "Per-rom mutex med timeout"],
            ["PostgresBingoSystemAdapter", "backend/src/adapters/PostgresBingoSystemAdapter.ts", "Checkpoint-persistering til PostgreSQL"],
            ["SocketRateLimiter", "backend/src/middleware/socketRateLimit.ts", "Rate-begrensning per socket per hendelse"],
        ],
        [70, 170, w - 240],
        s
    )
    story.append(comp_table)

    story.append(PageBreak())

    # ── Section 3: Balltrekning ─────────────────────────────────
    story.append(Paragraph("3. Slik fungerer balltrekningen i detalj", s['H1']))

    story.append(Paragraph("3.1 Tilfeldighetskilde", s['H2']))
    story.append(Paragraph(
        "Systemet bruker <font face='Courier' size='8'>randomInt()</font> fra Node.js sitt "
        "<font face='Courier' size='8'>node:crypto</font>-modul. Denne funksjonen er bygget pa "
        "operativsystemets CSPRNG (Cryptographically Secure Pseudo-Random Number Generator):", s['Body']))
    story.append(Paragraph("\u2022  <b>Linux/macOS:</b> getrandom() / /dev/urandom", s['BulletItem']))
    story.append(Paragraph("\u2022  <b>Windows:</b> BCryptGenRandom()", s['BulletItem']))
    story.append(Spacer(1, 2*mm))

    ok_text = Paragraph(
        "<b>Korrekt valg for pengespill.</b> Math.random() brukes ikke noe sted i spillogikken "
        "(kun i ikke-spillkritisk kode som instans-ID-generering).", s['Body'])
    story.append(ColoredBox(ok_text, w, ACCENT_GREEN, LAV_BG))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("3.2 Shuffling-algoritme: Fisher-Yates", s['H2']))
    code_fy = (
        "// backend/src/game/ticket.ts, linje 7-14\n"
        "function shuffle<T>(values: T[]): T[] {\n"
        "  const arr = [...values];\n"
        "  for (let i = arr.length - 1; i > 0; i -= 1) {\n"
        "    const j = randomInt(i + 1);   // kryptografisk sikker\n"
        "    [arr[i], arr[j]] = [arr[j], arr[i]];\n"
        "  }\n"
        "  return arr;\n"
        "}"
    )
    story.append(CodeBlock(code_fy, w))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph("<b>Vurdering:</b> Fisher-Yates (Knuth shuffle) er den anerkjente standarden for uniform permutasjon. Implementasjonen er korrekt:", s['Body']))
    for point in [
        "Itererer bakover fra siste element",
        "Velger tilfeldig posisjon fra [0, i] (inklusiv)",
        "Bruker CSPRNG for hvert byttevalg",
        "Produserer uniform fordeling over alle n! permutasjoner",
    ]:
        story.append(Paragraph(point, s['BulletItem'], bulletText='\u2022'))

    story.append(Paragraph("3.3 Generering av trekkesekken", s['H2']))
    code_bag = (
        "// backend/src/game/ticket.ts, linje 31-33\n"
        "export function makeShuffledBallBag(maxNumber = 60): number[] {\n"
        "  return shuffle(Array.from({ length: maxNumber }, (_, i) => i + 1));\n"
        "}"
    )
    story.append(CodeBlock(code_bag, w))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "Ved spillstart genereres et array [1, 2, 3, ..., 60] som deretter stokkes med Fisher-Yates. "
        "Resultatet er en komplett, forhandsbestemt rekkefiolge for alle 60 baller.", s['Body']))

    story.append(Paragraph("3.4 Selve trekningen", s['H2']))
    code_draw = (
        "// backend/src/game/BingoEngine.ts, linje 678\n"
        "const nextNumber = game.drawBag.shift();"
    )
    story.append(CodeBlock(code_draw, w))
    story.append(Spacer(1, 2*mm))

    warn_text = Paragraph(
        "<b>drawNextNumber()</b> gjor bare en shift() - den popper forste element fra den forhands-stokka koen. "
        "Det er ingen tilleggstilfeldighet per trekk. Ball #1 til #60 er bestemt i det oyeblikket spillet starter.", s['Body'])
    story.append(ColoredBox(warn_text, w, ACCENT_ORANGE, HOY_BG))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("3.5 Begrensninger og stoppregler", s['H2']))
    rules_table = make_table(
        ["Regel", "Verdi", "Kilde"],
        [
            ["Maks baller i spillet", "60", "MAX_BINGO_BALLS = 60"],
            ["Maks trekk per runde", "30 (konfigurerbart)", "maxDrawsPerRound"],
            ["Minimum mellom runder", "30 sekunder", "minRoundIntervalMs"],
        ],
        [w*0.35, w*0.25, w*0.40],
        s
    )
    story.append(rules_table)
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph("Runden avsluttes automatisk ved:", s['Body']))
    for reason in [
        "<b>BINGO_CLAIMED</b> - en spiller har full bingo",
        "<b>MAX_DRAWS_REACHED</b> - maxDrawsPerRound nadd",
        "<b>DRAW_BAG_EMPTY</b> - alle baller trukket",
        "<b>MANUAL_END</b> - operator avslutter manuelt",
    ]:
        story.append(Paragraph(reason, s['BulletItem'], bulletText='\u2022'))

    story.append(PageBreak())

    # ── Section 4: Billettgenerering ────────────────────────────
    story.append(Paragraph("4. Slik fungerer billettgenerering", s['H1']))

    story.append(Paragraph("4.1 Billettformat", s['H2']))
    story.append(Paragraph(
        "Hver billett er et <b>3x5 grid</b> med 15 tall (ingen tomme celler, ingen free space):", s['Body']))
    ticket_code = (
        "Kolonne 1: 3 tilfeldige tall fra [1-12]\n"
        "Kolonne 2: 3 tilfeldige tall fra [13-24]\n"
        "Kolonne 3: 3 tilfeldige tall fra [25-36]\n"
        "Kolonne 4: 3 tilfeldige tall fra [37-48]\n"
        "Kolonne 5: 3 tilfeldige tall fra [49-60]"
    )
    story.append(CodeBlock(ticket_code, w))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph("Tallene i hver kolonne er sortert stigende.", s['Body']))

    story.append(Paragraph("4.2 Genereringsprosess", s['H2']))
    code_ticket = (
        "// backend/src/game/ticket.ts, linje 35-56\n"
        "export function generateTraditional75Ticket(): Ticket {\n"
        "  const columns = [\n"
        "    pickUniqueInRange(1, 12, 3),   // 3 av 12 mulige\n"
        "    pickUniqueInRange(13, 24, 3),\n"
        "    pickUniqueInRange(25, 36, 3),\n"
        "    pickUniqueInRange(37, 48, 3),\n"
        "    pickUniqueInRange(49, 60, 3)\n"
        "  ];\n"
        "  // ... bygg 3x5 grid fra kolonnene\n"
        "}"
    )
    story.append(CodeBlock(code_ticket, w))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph("Konfigurerbart 1-5 billetter per spiller per runde (begrenset av hall-konfigurasjon).", s['Body']))

    # ── Section 5: RTP ──────────────────────────────────────────
    story.append(Paragraph("5. Slik fungerer RTP og utbetalingsmekanikk", s['H1']))

    story.append(Paragraph("5.1 Begrepet RTP i dette systemet", s['H2']))
    story.append(Paragraph(
        "Spillorama bruker <b>ikke</b> en klassisk slot-RTP med vektet symbolfordeling. "
        "I stedet opererer systemet med et <b>budsjett-cap-system per runde</b>:", s['Body']))

    rtp_code = (
        "PrizePool     = entryFee x antall betalende spillere\n"
        "PayoutBudget  = PrizePool x (payoutPercent / 100)\n"
        "\n"
        "Eksempel: 80% payoutPercent, 10 spillere a 50 NOK:\n"
        "  PrizePool     = 50 x 10 = 500 NOK\n"
        "  PayoutBudget  = 500 x 0.80 = 400 NOK\n"
        "  Hus-margin    = 500 - 400 = 100 NOK (20%)"
    )
    story.append(CodeBlock(rtp_code, w))
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("5.2 Gevinstfordeling", s['H2']))
    prize_table = make_table(
        ["Gevinst", "Beregning", "Capped av"],
        [
            ["LINE (forste komplette rad/kolonne)", "30% av PrizePool", "remainingPayoutBudget, singlePrizeCap"],
            ["BINGO (alle tall markert)", "Resten av remainingPrizePool", "remainingPayoutBudget, singlePrizeCap"],
        ],
        [w*0.30, w*0.30, w*0.40],
        s
    )
    story.append(prize_table)
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("5.3 Prize Policy (gevinst-cap)", s['H2']))
    cap_table = make_table(
        ["Parameter", "Default"],
        [
            ["singlePrizeCap", "2 500 NOK per enkeltgevinst"],
            ["dailyExtraPrizeCap", "12 000 NOK per dag for ekstrapremier"],
        ],
        [w*0.40, w*0.60],
        s
    )
    story.append(cap_table)
    story.append(Spacer(1, 3*mm))

    story.append(Paragraph("5.4 Payout Audit Trail", s['H2']))
    story.append(Paragraph(
        "Utbetalinger registreres i en <b>hash-kjede</b> (append-only audit trail). "
        "Hvert event peker til forrige via previousHash, noe som gjor manipulasjon detekterbar.", s['Body']))

    story.append(PageBreak())

    # ── Section 6: DrawScheduler ────────────────────────────────
    story.append(Paragraph("6. Slik fungerer automatisk trekning (DrawScheduler)", s['H1']))

    story.append(Paragraph("6.1 Tick-loop", s['H2']))
    story.append(Paragraph(
        "DrawScheduler kjorer en setInterval hvert <b>250ms</b> (konfigurerbart). Hvert tick henter alle aktive "
        "rom-oppsummeringer, anvender ventende innstillingsendringer, og for hvert rom sjekkes auto-start og auto-draw.", s['Body']))

    story.append(Paragraph("6.2 Auto-draw av baller", s['H2']))
    story.append(Paragraph(
        "<b>Anchor-basert timing:</b> Neste trekk due = anchor + (count + 1) x intervalMs. "
        "Ingen drift over tid (i motsetning til ren setInterval). Handterer missed intervals "
        "ved re-anchoring i stedet for burst.", s['Body']))

    story.append(Paragraph("6.3 Watchdog", s['H2']))
    story.append(Paragraph(
        "DrawWatchdog kjorer separat (hvert 5 sekund) og sjekker om et RUNNING-rom ikke har hatt "
        "trekning innen 3 x drawInterval. Frigir hengende laser. Eskalerer etter 3 pafolgende stuck-deteksjoner.", s['Body']))

    story.append(Paragraph("6.4 Lock-mekanisme", s['H2']))
    lock_text = Paragraph(
        "Per-rom mutex med 5-sekunders timeout. Forhindrer dobbeltrekning. "
        "<b>In-process only - fungerer ikke med flere Node-instanser.</b>", s['Body'])
    story.append(ColoredBox(lock_text, w, ACCENT_ORANGE, HOY_BG))

    story.append(PageBreak())

    # ── Section 7: Funn ─────────────────────────────────────────
    story.append(Paragraph("7. Funn og risikovurdering", s['H1']))

    # KRITISK-1
    story.append(Spacer(1, 2*mm))
    k1_title = Paragraph("<font color='#e74c3c'>[KRITISK-1]</font> Ingen RNG-sertifisering eller tredjepartsgodkjenning", s['FindingTitle'])
    story.append(ColoredBox(k1_title, w, KRITISK_BORDER, KRITISK_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "Det finnes ingen referanser i kodebasen til GLI, eCOGRA, iTech Labs, BMM Testlabs, eller "
        "noen annen akkreditert testlab.", s['Body']))
    story.append(Paragraph("<b>Hva mangler:</b>", s['Body']))
    for item in [
        "Statistisk testing av RNG-output (NIST SP 800-22, Diehard, TestU01)",
        "Formell verifisering av Fisher-Yates av uavhengig part",
        "Dokumentert seed-/entropy-handtering",
        "Sertifiseringsrapport som bekrefter uniform og uforutsigbar output",
    ]:
        story.append(Paragraph(item, s['BulletItem'], bulletText='\u2022'))
    story.append(Paragraph(
        "<b>Anbefaling:</b> Engasjer et akkreditert testlaboratorium for a gjennomfore RNG-testing og sertifisering for live-drift.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # KRITISK-2
    k2_title = Paragraph("<font color='#e74c3c'>[KRITISK-2]</font> All aktiv spilltilstand lever i prosessminnet", s['FindingTitle'])
    story.append(ColoredBox(k2_title, w, KRITISK_BORDER, KRITISK_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "BingoEngine lagrer alle rom, spillere, aktive spill, trekkesekker, markeringer og "
        "gevinstkrav i Map-objekter i Node.js-prosessens heap-minne. En serverrestart betyr at "
        "alle aktive spill forsvinner umiddelbart og spillere som har betalt innskudd mister penger.", s['Body']))
    story.append(Paragraph(
        "Checkpoints skrives <b>ikke</b> etter hver trekning. En krasj mellom trekk #15 og trekk #16 "
        "betyr at snapshotet i databasen viser tilstand ved spillstart - ikke navarende trekkstatus.", s['Body']))
    story.append(Paragraph(
        "<b>Anbefaling:</b> Skriv checkpoint etter hver trekning. Implementer replay/recovery. "
        "Flytt romtilstand til Redis eller PostgreSQL.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # KRITISK-3
    k3_title = Paragraph("<font color='#e74c3c'>[KRITISK-3]</font> Forhandsbestemt trekkerekkefiolge logges i klartekst", s['FindingTitle'])
    story.append(ColoredBox(k3_title, w, KRITISK_BORDER, KRITISK_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "Ved spillstart logges hele drawBag (alle 60 tall i trekkerekkefiolge) som strukturert JSON. "
        "Enhver person med tilgang til serverlogger kan se hvilke tall som kommer for de er trukket.", s['Body']))
    story.append(Paragraph(
        "<b>Anbefaling:</b> Logg kun SHA-256 hash av drawBag. Full sekvens kun tilgjengelig via "
        "tidsforseglet audit-endepunkt etter runden er avsluttet.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # HOY-1
    h1_title = Paragraph("<font color='#f39c12'>[HOY-1]</font> Ingen entropy-injeksjon mellom trekk", s['FindingTitle'])
    story.append(ColoredBox(h1_title, w, HOY_BORDER, HOY_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "Hele trekksekvensen er fastlast ved spillstart. Ingen periodevis re-seeding, "
        "ingen tilleggstilfeldighet per trekk, ingen verifiserbar commitment scheme. "
        "Ma avklares med Lotteritilsynet.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # HOY-2
    h2_title = Paragraph("<font color='#f39c12'>[HOY-2]</font> payoutPercent default er 100%", s['FindingTitle'])
    story.append(ColoredBox(h2_title, w, HOY_BORDER, HOY_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "Hvis operator glemmer a sette payoutPercent, betaler systemet ut 100% av potten. "
        "Huset tjener ingenting. I automatisert drift (DrawScheduler) er dette spesielt farlig.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # HOY-3
    h3_title = Paragraph("<font color='#f39c12'>[HOY-3]</font> Checkpoint-hull mellom trekk og utbetaling", s['FindingTitle'])
    story.append(ColoredBox(h3_title, w, HOY_BORDER, HOY_BG))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        "onCheckpoint() kalles bare ved BUY_IN, PAYOUT og GAME_END. Under selve trekningen "
        "lagres ingenting til disk. Kommentaren i koden bekrefter at trekk bare spores i minnet.", s['Body']))
    story.append(Spacer(1, 3*mm))

    # MEDIUM findings
    for mid, desc in [
        ("MEDIUM-1", "Ingen rate-begrensning pa manuell trekning via admin REST-endepunkt."),
        ("MEDIUM-2", "Billetter genereres uavhengig av hverandre - ingen duplikat-sjekk."),
        ("MEDIUM-3", "Ingen server-side automatisk markering - spillere ma aktivt kalle ticket:mark."),
        ("MEDIUM-4", "Single-instance lock skalerer ikke - fungerer ikke med flere Node-instanser."),
    ]:
        m_title = Paragraph(f"<font color='#2980b9'>[{mid}]</font> {desc}", s['Body'])
        story.append(ColoredBox(m_title, w, MEDIUM_BORDER, MEDIUM_BG))
        story.append(Spacer(1, 2*mm))

    # LAV
    for lav, desc in [
        ("LAV-1", "Feil dokumentasjon i types.ts - kommentar sier 5x5, grid er 3x5."),
        ("LAV-2", "Funksjonsnavn generateTraditional75Ticket er misvisende - det er 60-balls bingo."),
    ]:
        l_title = Paragraph(f"<font color='#27ae60'>[{lav}]</font> {desc}", s['Body'])
        story.append(ColoredBox(l_title, w, LAV_BORDER, LAV_BG))
        story.append(Spacer(1, 2*mm))

    story.append(PageBreak())

    # ── Section 8: Handlingsplan ────────────────────────────────
    story.append(Paragraph("8. Prioritert handlingsplan", s['H1']))

    action_table = make_table(
        ["Prio", "ID", "Funn", "Tiltak", "Estimat"],
        [
            ["P0", "KRITISK-1", "Ingen RNG-sertifisering", "Engasjer akkreditert testlab", "4-8 uker"],
            ["P0", "KRITISK-2", "Spilltilstand i minne", "Per-trekk persistering + replay", "2-3 uker"],
            ["P0", "KRITISK-3", "DrawBag i klartekst", "Hash logg-output, audit-endepunkt", "2-3 dager"],
            ["P1", "HOY-1", "Ingen per-trekk entropy", "Avklar med Lotteritilsynet", "1 uke"],
            ["P1", "HOY-2", "payoutPercent default 100%", "Fjern default, krev konfigurasjon", "0.5 dag"],
            ["P1", "HOY-3", "Checkpoint-hull", "Checkpoint per N trekk", "2-3 dager"],
            ["P2", "MEDIUM-1", "Ingen rate-limit draw", "Min-intervall i drawNextNumber()", "0.5 dag"],
            ["P2", "MEDIUM-2", "Uavhengig billetter", "Duplikat-deteksjon", "1 dag"],
            ["P2", "MEDIUM-3", "Ingen auto-mark", "Server-side gevinstsjekk", "2-3 dager"],
            ["P2", "MEDIUM-4", "Single-instance lock", "Redis-basert distribuert las", "1 uke"],
            ["P3", "LAV-1", "Feil kommentar", "Korriger kommentar", "5 min"],
            ["P3", "LAV-2", "Misvisende funksjonsnavn", "Rename funksjon", "0.5 dag"],
        ],
        [30, 55, 100, 145, w - 330],
        s
    )
    story.append(action_table)
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("Kritisk sti for go-live", s['H2']))
    timeline = (
        "Uke 1-2:  HOY-2 (payoutPercent) + KRITISK-3 (logg-beskyttelse)\n"
        "          + HOY-3 (checkpoint-hull) + start KRITISK-2 (persistering)\n"
        "\n"
        "Uke 2-4:  Fullfior KRITISK-2 + MEDIUM-4 (distribuert las)\n"
        "          + MEDIUM-1 (rate-limit) + HOY-1 (regulatorisk avklaring)\n"
        "\n"
        "Uke 4-8:  KRITISK-1 (RNG-sertifisering, ekstern prosess)\n"
        "          + MEDIUM-2 + MEDIUM-3 (parallelt)"
    )
    story.append(CodeBlock(timeline, w))

    story.append(PageBreak())

    # ── Section 9: Vedlegg ──────────────────────────────────────
    story.append(Paragraph("9. Vedlegg: Relevante filer og kodereferanser", s['H1']))

    story.append(Paragraph("Kjerne-RNG og trekning", s['H2']))
    ref1 = make_table(
        ["Fil", "Linjer", "Innhold"],
        [
            ["backend/src/game/ticket.ts", "1-108", "shuffle(), makeShuffledBallBag(), generateTraditional75Ticket()"],
            ["backend/src/game/BingoEngine.ts", "613", "drawBag: makeShuffledBallBag(MAX_BINGO_BALLS)"],
            ["backend/src/game/BingoEngine.ts", "663-704", "drawNextNumber() - der neste ball trekkes"],
            ["backend/src/game/BingoEngine.ts", "624-633", "RNG_DRAW_BAG audit-logg"],
            ["backend/src/game/BingoEngine.ts", "736-1013", "submitClaim() - gevinstvalidering og utbetaling"],
        ],
        [150, 50, w - 200],
        s
    )
    story.append(ref1)
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("RTP og utbetaling", s['H2']))
    ref2 = make_table(
        ["Fil", "Linjer", "Innhold"],
        [
            ["backend/src/game/BingoEngine.ts", "601-602", "PrizePool og PayoutBudget beregning"],
            ["backend/src/game/BingoEngine.ts", "819-908", "LINE-gevinst med RTP-cap"],
            ["backend/src/game/BingoEngine.ts", "910-999", "BINGO-gevinst med RTP-cap"],
            ["backend/src/game/BingoEngine.ts", "1317+", "upsertPrizePolicy() - gevinst-cap-system"],
            ["backend/src/game/types.ts", "30-32", "rtpBudgetBefore/After/Capped i ClaimRecord"],
        ],
        [150, 50, w - 200],
        s
    )
    story.append(ref2)
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("Automasjon og overvaking", s['H2']))
    ref3 = make_table(
        ["Fil", "Linjer", "Innhold"],
        [
            ["backend/src/draw-engine/DrawScheduler.ts", "1-609", "Komplett auto-start/auto-draw scheduler"],
            ["backend/src/draw-engine/DrawWatchdog.ts", "1-172", "Stuck-room deteksjon"],
            ["backend/src/draw-engine/DrawSchedulerLock.ts", "1-135", "Per-rom mutex"],
            ["backend/src/draw-engine/DrawErrorClassifier.ts", "-", "Feilklassifisering for scheduler"],
        ],
        [175, 40, w - 215],
        s
    )
    story.append(ref3)
    story.append(Spacer(1, 4*mm))

    story.append(Paragraph("Persistering og crash recovery", s['H2']))
    ref4 = make_table(
        ["Fil", "Linjer", "Innhold"],
        [
            ["backend/src/adapters/PostgresBingoSystemAdapter.ts", "1-297", "Checkpoint-system, schema, recovery"],
            ["backend/src/store/RoomStateStore.ts", "1-100+", "Serialisering av romtilstand (BIN-170)"],
            ["backend/src/middleware/socketRateLimit.ts", "16-29", "Default rate limits per socket-hendelse"],
        ],
        [200, 50, w - 250],
        s
    )
    story.append(ref4)

    story.append(Spacer(1, 10*mm))
    story.append(hr())
    story.append(Paragraph("<b>Slutt pa rapport.</b>", s['Body']))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        "Denne rapporten er basert pa fullstendig gjennomgang av kildekoden i Spillorama-system-repoet "
        "per 9. april 2026. Alle kodereferanser er verifisert mot gjeldende kode.", s['SmallMuted']))

    # ── Build ───────────────────────────────────────────────────
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_pdf()
