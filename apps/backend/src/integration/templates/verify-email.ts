/**
 * BIN-588: e-mail verification template.
 *
 * Ported from legacy `App/Views/templateHtml/forgot_mail_template.html`
 * but specialised for the "please verify your e-mail" flow.
 *
 * Required context fields:
 *   username, verifyLink, supportEmail
 */

export const VERIFY_EMAIL_SUBJECT = "Bekreft e-postadressen din – Spillorama Bingo";

export const VERIFY_EMAIL_HTML = `<!doctype html>
<html lang="nb">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bekreft e-postadressen din</title>
</head>
<body style="background:#fff;font-family:Verdana,Geneva,sans-serif;font-size:14px;padding:0;margin:0;">
  <div style="background:#fbfbfb;width:100%;max-width:600px;margin:0 auto;box-shadow:0 0 4px 1px #e5e5e5;">
    <div style="background:#2e0000;color:#fff;font-weight:bold;padding:15px;font-size:18px;text-align:center;border-top-left-radius:10px;border-top-right-radius:10px;">
      Spillorama Bingo
    </div>
    <div style="width:100%;color:#000;text-align:center;background:#fff;border:1px solid #f5f5f5;padding:30px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;">
      <p style="margin:0 0 20px;">Hei <strong>{{username}}</strong>,</p>
      <p style="margin:0 0 20px;">
        Takk for at du registrerte deg hos Spillorama. For å aktivere kontoen må du bekrefte e-postadressen din.
      </p>
      <div style="margin:25px auto;">
        <a href="{{verifyLink}}" style="display:inline-block;background:#2e0000;color:#feda02;text-transform:uppercase;font-weight:bold;font-size:16px;padding:15px 25px;border-radius:10px;text-decoration:none;">
          Bekreft e-post
        </a>
      </div>
      <p style="margin:0 0 10px;font-size:12px;color:#555;">
        Lenken virker ikke? Kopier denne URL-en inn i nettleseren:<br>
        <span style="word-break:break-all;">{{verifyLink}}</span>
      </p>
      <p style="margin:20px 0 0;">Hilsen<br>Spillorama Bingo</p>
      {{#if supportEmail}}
      <p style="margin:20px 0 0;font-size:12px;color:#555;">
        Har du spørsmål? Kontakt oss på {{supportEmail}}.
      </p>
      {{/if}}
    </div>
  </div>
</body>
</html>
`;

export const VERIFY_EMAIL_TEXT = `Hei {{username}},

Takk for at du registrerte deg hos Spillorama. For å aktivere kontoen må du bekrefte e-postadressen din.

Åpne denne lenken i nettleseren din:
{{verifyLink}}

Hilsen
Spillorama Bingo
`;
