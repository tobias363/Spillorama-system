/**
 * BIN-702 follow-up: velkomst-mail for spillere importert via Excel/CSV.
 *
 * Trigger: admin gjør bulk-import via /api/admin/players/bulk-import.
 * For hver vellykket importert spiller genereres et password-reset-token
 * (7 dagers TTL) og denne mailen sendes med en lenke som lar spilleren
 * sette sitt eget passord før første innlogging.
 *
 * Required context:
 *   - username: navn (displayName) for personlig hilsen
 *   - setPasswordLink: full URL til /reset-password/<token>
 *   - expiresInDays: TTL for lenken (typisk 7)
 *   - supportEmail: kontakt-adresse hvis lenken er utløpt
 */

export const KYC_IMPORTED_WELCOME_SUBJECT = "Velkommen til Spillorama Bingo";

export const KYC_IMPORTED_WELCOME_HTML = `<!doctype html>
<html lang="nb">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Velkommen til Spillorama Bingo</title>
</head>
<body style="background:#fff;font-family:Verdana,Geneva,sans-serif;font-size:14px;padding:0;margin:0;">
  <div style="background:#fbfbfb;width:100%;max-width:600px;margin:0 auto;box-shadow:0 0 4px 1px #e5e5e5;">
    <div style="background:#2e0000;color:#fff;font-weight:bold;padding:15px;font-size:18px;text-align:center;border-top-left-radius:10px;border-top-right-radius:10px;">
      Spillorama Bingo
    </div>
    <div style="width:100%;color:#000;text-align:center;background:#fff;border:1px solid #f5f5f5;padding:30px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;">
      <p style="margin:0 0 20px;">Hei <strong>{{username}}</strong>,</p>
      <p style="margin:0 0 20px;">
        Velkommen til Spillorama Bingo! En administrator har opprettet en
        spillerkonto for deg. Klikk på knappen under for å sette ditt eget
        passord og fullføre opprettelsen.
      </p>
      <div style="margin:25px auto;">
        <a href="{{setPasswordLink}}" style="display:inline-block;background:#2e0000;color:#feda02;text-transform:uppercase;font-weight:bold;font-size:16px;padding:15px 25px;border-radius:10px;text-decoration:none;">
          Sett passord
        </a>
      </div>
      <p style="margin:0 0 10px;font-size:12px;color:#555;">
        Lenken virker ikke? Kopier denne URL-en inn i nettleseren:<br>
        <span style="word-break:break-all;">{{setPasswordLink}}</span>
      </p>
      {{#if expiresInDays}}
      <p style="margin:20px 0 0;font-size:13px;color:#555;">
        Lenken utløper om {{expiresInDays}} dag(er). Hvis du ikke rekker
        å sette passordet i tide, kontakt support for å få en ny lenke.
      </p>
      {{/if}}
      <p style="margin:20px 0 0;">Hilsen<br>Spillorama Bingo</p>
      {{#if supportEmail}}
      <p style="margin:15px 0 0;font-size:12px;color:#555;">
        Har du spørsmål? Kontakt oss på {{supportEmail}}.
      </p>
      {{/if}}
    </div>
  </div>
</body>
</html>
`;

export const KYC_IMPORTED_WELCOME_TEXT = `Hei {{username}},

Velkommen til Spillorama Bingo! En administrator har opprettet en
spillerkonto for deg. Åpne lenken under i nettleseren for å sette
ditt eget passord:

{{setPasswordLink}}

{{#if expiresInDays}}Lenken utløper om {{expiresInDays}} dag(er).{{/if}}

Hvis du har spørsmål, kontakt oss{{#if supportEmail}} på {{supportEmail}}{{/if}}.

Hilsen
Spillorama Bingo
`;
