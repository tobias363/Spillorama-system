/**
 * REQ-097: account-blocked notification.
 *
 * Sendes når en admin/SUPPORT blokkerer en spillerkonto. Informerer
 * spilleren om grunnen og varigheten — viktig både for UX og som
 * compliance-signal (uautorisert blokkering skal kunne kontestereres).
 *
 * Required context:
 *   username, reason, blockedUntilHuman, supportEmail
 *
 * `blockedUntilHuman` skal være en lesbar dato/uttrykk (f.eks.
 * "31. desember 2026 kl. 23:59" eller "permanent inntil opphevet av
 * support"). Routeren formatterer dette på norsk før send.
 */

export const ACCOUNT_BLOCKED_SUBJECT = "Kontoen din er blokkert – Spillorama Bingo";

export const ACCOUNT_BLOCKED_HTML = `<!doctype html>
<html lang="nb">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kontoen din er blokkert</title>
</head>
<body style="background:#fff;font-family:Verdana,Geneva,sans-serif;font-size:14px;padding:0;margin:0;">
  <div style="background:#fbfbfb;width:100%;max-width:600px;margin:0 auto;box-shadow:0 0 4px 1px #e5e5e5;">
    <div style="background:#2e0000;color:#fff;font-weight:bold;padding:15px;font-size:18px;text-align:center;border-top-left-radius:10px;border-top-right-radius:10px;">
      Spillorama Bingo
    </div>
    <div style="width:100%;color:#000;text-align:left;background:#fff;border:1px solid #f5f5f5;padding:30px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;">
      <p style="margin:0 0 20px;">Hei <strong>{{username}}</strong>,</p>
      <p style="margin:0 0 20px;">
        Vi informerer om at kontoen din på Spillorama er blokkert av en
        administrator. Du kan ikke logge inn eller spille før blokkeringen
        oppheves.
      </p>
      {{#if reason}}
      <p style="margin:0 0 20px;padding:15px;background:#fff5f5;border-left:3px solid #c53030;">
        <strong>Begrunnelse:</strong> {{reason}}
      </p>
      {{/if}}
      <p style="margin:0 0 20px;">
        <strong>Varighet:</strong> {{blockedUntilHuman}}
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:#555;">
        Hvis du mener dette er en feil eller har spørsmål om beslutningen,
        ta kontakt med kundeservice.
      </p>
      <p style="margin:20px 0 0;">Hilsen<br>Spillorama Bingo</p>
      {{#if supportEmail}}
      <p style="margin:15px 0 0;font-size:12px;color:#555;">
        Kontakt: {{supportEmail}}
      </p>
      {{/if}}
    </div>
  </div>
</body>
</html>
`;

export const ACCOUNT_BLOCKED_TEXT = `Hei {{username}},

Vi informerer om at kontoen din på Spillorama er blokkert av en administrator.
Du kan ikke logge inn eller spille før blokkeringen oppheves.

{{#if reason}}Begrunnelse: {{reason}}
{{/if}}Varighet: {{blockedUntilHuman}}

Hvis du mener dette er en feil eller har spørsmål om beslutningen, ta kontakt med kundeservice{{#if supportEmail}} på {{supportEmail}}{{/if}}.

Hilsen
Spillorama Bingo
`;
