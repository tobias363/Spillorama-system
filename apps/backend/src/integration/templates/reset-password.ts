/**
 * BIN-588: password-reset template.
 *
 * Ported from legacy `App/Views/templateHtml/forgot_mail_template.html`.
 * Required context: username, resetLink, expiresInHours, supportEmail.
 */

export const RESET_PASSWORD_SUBJECT = "Tilbakestill passordet ditt – Spillorama Bingo";

export const RESET_PASSWORD_HTML = `<!doctype html>
<html lang="nb">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tilbakestill passord</title>
</head>
<body style="background:#fff;font-family:Verdana,Geneva,sans-serif;font-size:14px;padding:0;margin:0;">
  <div style="background:#fbfbfb;width:100%;max-width:600px;margin:0 auto;box-shadow:0 0 4px 1px #e5e5e5;">
    <div style="background:#2e0000;color:#fff;font-weight:bold;padding:15px;font-size:18px;text-align:center;border-top-left-radius:10px;border-top-right-radius:10px;">
      Spillorama Bingo
    </div>
    <div style="width:100%;color:#000;text-align:center;background:#fff;border:1px solid #f5f5f5;padding:30px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;">
      <p style="margin:0 0 20px;">Hei <strong>{{username}}</strong>,</p>
      <p style="margin:0 0 20px;">
        Vi mottok en forespørsel om å tilbakestille passordet ditt. Klikk på knappen under for å sette et nytt passord.
      </p>
      <div style="margin:25px auto;">
        <a href="{{resetLink}}" style="display:inline-block;background:#2e0000;color:#feda02;text-transform:uppercase;font-weight:bold;font-size:16px;padding:15px 25px;border-radius:10px;text-decoration:none;">
          Tilbakestill passord
        </a>
      </div>
      <p style="margin:0 0 10px;font-size:12px;color:#555;">
        Lenken virker ikke? Kopier denne URL-en inn i nettleseren:<br>
        <span style="word-break:break-all;">{{resetLink}}</span>
      </p>
      {{#if expiresInHours}}
      <p style="margin:20px 0 0;font-size:13px;color:#555;">
        Lenken utløper om {{expiresInHours}} time(r).
      </p>
      {{/if}}
      <p style="margin:20px 0 0;font-size:12px;color:#555;">
        Hvis du ikke ba om å tilbakestille passordet, kan du trygt ignorere denne e-posten.
      </p>
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

export const RESET_PASSWORD_TEXT = `Hei {{username}},

Vi mottok en forespørsel om å tilbakestille passordet ditt.
Åpne denne lenken i nettleseren for å sette et nytt passord:

{{resetLink}}

Hvis du ikke ba om å tilbakestille passordet, kan du trygt ignorere denne e-posten.

Hilsen
Spillorama Bingo
`;
