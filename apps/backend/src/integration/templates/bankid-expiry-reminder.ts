/**
 * BIN-588: BankID/KYC re-verification reminder.
 *
 * Ported from legacy `App/Views/templateHtml/bankid_reminder.html`.
 * Used by BIN-582 daily BankID-expiry cron.
 *
 * Required context:
 *   username, verificationType ("BankID" | "KYC" | ...),
 *   daysRemaining, expiryDate (formatted), expiryDateISO.
 */

export const BANKID_EXPIRY_SUBJECT = "Påminnelse: BankID-verifisering utløper snart – Spillorama Bingo";

export const BANKID_EXPIRY_HTML = `<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{verificationType}} – Påminnelse om reverifisering</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;color:#333;font-family:Arial,sans-serif;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 0 20px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;text-align:center;padding:30px 20px;">
      <div style="font-size:32px;font-weight:bold;margin-bottom:10px;">Spillorama Bingo</div>
      <h1 style="font-size:24px;margin:0 0 8px;">Påminnelse om reverifisering</h1>
      <p style="font-size:15px;opacity:0.9;margin:0;">{{verificationType}}</p>
    </div>
    <div style="padding:40px 30px;">
      <p style="font-size:17px;margin:0 0 16px;">Hei {{username}},</p>
      <div style="background:linear-gradient(135deg,#ff9a9e 0%,#fecfef 100%);border-left:5px solid #e74c3c;padding:20px;margin:20px 0;border-radius:5px;">
        <h3 style="color:#e74c3c;margin:0 0 8px;">🔔 {{verificationType}} må reverifiseres</h3>
        <p style="margin:0;">Din aldersverifisering utløper snart. Uten gyldig verifisering kan du ikke fortsette å spille.</p>
      </div>
      <p style="font-size:16px;margin:20px 0;">Antall dager igjen:</p>
      <div style="font-size:28px;font-weight:bold;color:#e74c3c;text-align:center;margin:15px 0;">
        {{daysRemaining}} dag(er)
      </div>
      <div style="font-size:16px;font-weight:bold;color:#2c3e50;text-align:center;margin:10px 0;">
        Utløpsdato: <time datetime="{{expiryDateISO}}">{{expiryDate}}</time>
      </div>
      <p style="font-size:15px;margin:20px 0;text-align:center;">
        Vennligst logg inn og fullfør reverifiseringen i god tid før utløp.
      </p>
      <div style="background:#fff3cd;border:1px solid #ffeaa7;padding:15px;border-radius:5px;margin:20px 0;">
        <p style="color:#856404;font-weight:bold;margin:0;">
          Etter utløp vil uttak og innskudd være sperret inntil reverifisering er fullført.
        </p>
      </div>
      <p style="font-size:13px;color:#666;margin-top:30px;text-align:center;">
        Dette er en automatisk påminnelse. Ikke svar på denne e-posten.
      </p>
    </div>
    <div style="background:#2c3e50;color:#fff;text-align:center;padding:25px 20px;">
      <p style="margin:0 0 8px;"><strong>Spillorama Bingo</strong></p>
      <p style="margin:0 0 8px;font-size:13px;opacity:0.85;">Din pålitelige bingoplattform</p>
      <p style="margin:0;font-size:12px;opacity:0.8;">© 2026 Spillorama Bingo. Alle rettigheter reservert.</p>
    </div>
  </div>
</body>
</html>
`;

export const BANKID_EXPIRY_TEXT = `Hei {{username}},

Din {{verificationType}}-verifisering utløper om {{daysRemaining}} dag(er) ({{expiryDate}}).

Uten gyldig verifisering blir uttak og innskudd sperret. Logg inn og fullfør reverifiseringen i god tid før utløp.

Dette er en automatisk påminnelse fra Spillorama Bingo.
`;
