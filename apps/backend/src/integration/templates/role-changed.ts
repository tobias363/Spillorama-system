/**
 * BIN-588: role-changed notification.
 *
 * Sent when an admin changes a user's role (e.g. PLAYER → SUPPORT,
 * HALL_OPERATOR → ADMIN). Informing the affected user that their
 * access level changed is both a user-experience courtesy and a
 * compliance signal — if the change is unauthorised, the user can
 * respond before damage is done.
 *
 * Required context:
 *   username, previousRole, newRole, changedAt, supportEmail
 */

export const ROLE_CHANGED_SUBJECT = "Kontoen din har fått ny rolle – Spillorama Bingo";

export const ROLE_CHANGED_HTML = `<!doctype html>
<html lang="nb">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ny rolle på kontoen din</title>
</head>
<body style="background:#fff;font-family:Verdana,Geneva,sans-serif;font-size:14px;padding:0;margin:0;">
  <div style="background:#fbfbfb;width:100%;max-width:600px;margin:0 auto;box-shadow:0 0 4px 1px #e5e5e5;">
    <div style="background:#2e0000;color:#fff;font-weight:bold;padding:15px;font-size:18px;text-align:center;border-top-left-radius:10px;border-top-right-radius:10px;">
      Spillorama Bingo
    </div>
    <div style="width:100%;color:#000;text-align:center;background:#fff;border:1px solid #f5f5f5;padding:30px;border-bottom-left-radius:10px;border-bottom-right-radius:10px;">
      <p style="margin:0 0 20px;">Hei <strong>{{username}}</strong>,</p>
      <p style="margin:0 0 20px;">
        En administrator har endret rollen din på Spillorama-kontoen.
      </p>
      <div style="background:#fff3cd;border:1px solid #ffeaa7;padding:15px;border-radius:5px;margin:20px 0;text-align:left;">
        <p style="margin:0 0 8px;"><strong>Tidligere rolle:</strong> {{previousRole}}</p>
        <p style="margin:0 0 8px;"><strong>Ny rolle:</strong> {{newRole}}</p>
        <p style="margin:0;"><strong>Endret:</strong> {{changedAt}}</p>
      </div>
      <p style="margin:0 0 20px;">
        Endringen trer i kraft umiddelbart. Neste gang du logger inn vil tilgangsnivået ditt reflektere den nye rollen.
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:#555;">
        Hvis du ikke gjenkjenner denne endringen, ta umiddelbart kontakt med kundeservice.
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

export const ROLE_CHANGED_TEXT = `Hei {{username}},

En administrator har endret rollen din på Spillorama-kontoen.

Tidligere rolle: {{previousRole}}
Ny rolle: {{newRole}}
Endret: {{changedAt}}

Endringen trer i kraft umiddelbart.

Hvis du ikke gjenkjenner denne endringen, ta umiddelbart kontakt med kundeservice.

Hilsen
Spillorama Bingo
`;
