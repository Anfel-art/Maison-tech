import nodemailer from 'nodemailer';

// ─── Validación de configuración SMTP al arrancar ─────────────────────────────
const _smtpUser = process.env.SMTP_USER || '';
const _smtpPass = process.env.SMTP_PASS || '';
const _appUrl   = process.env.APP_URL   || '';

const SMTP_CONFIGURED = (
  _smtpUser.length > 0 &&
  !_smtpUser.includes('tu-email') &&
  _smtpPass.length > 0 &&
  !_smtpPass.includes('xxxx')
);

const APP_URL_CONFIGURED = (
  _appUrl.length > 0 &&
  !_appUrl.includes('localhost')
);

if (!SMTP_CONFIGURED) {
  console.warn('');
  console.warn('┌─────────────────────────────────────────────────────────────┐');
  console.warn('│  ⚠  SMTP no configurado                                     │');
  console.warn('│     Los emails de recuperación de contraseña NO se enviarán │');
  console.warn('│     Completá SMTP_USER y SMTP_PASS en el archivo .env       │');
  console.warn('└─────────────────────────────────────────────────────────────┘');
  console.warn('');
}

if (!APP_URL_CONFIGURED) {
  console.warn('[config] APP_URL apunta a localhost — los links de reset en emails serán inválidos en producción.');
  console.warn('[config] Actualizá APP_URL en .env con la URL pública de la app (ej: http://192.168.1.100:5173)');
}

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false, // true para puerto 465, false para 587 (STARTTLS)
  auth: {
    user: _smtpUser,
    pass: _smtpPass,
  },
});

const FROM    = process.env.SMTP_FROM || _smtpUser || 'MaisonTech <noreply@maisontech.app>';
const APP_URL = _appUrl || 'http://localhost:5173';

/**
 * Envía el email de recuperación de contraseña.
 * @param {string} toEmail - Email del destinatario
 * @param {string} nombre  - Nombre del usuario
 * @param {string} token   - Token de reset (sin hash)
 */
export async function sendPasswordReset(toEmail, nombre, token) {
  if (!SMTP_CONFIGURED) {
    throw new Error('SMTP no configurado. Completá SMTP_USER y SMTP_PASS en el archivo .env');
  }
  const resetUrl = `${APP_URL}?reset=${token}`;

  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: '🔑 Recuperación de contraseña — MaisonTech App',
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 20px;">
          <tr><td align="center">
            <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background:#4f46e5;padding:32px 40px;text-align:center;">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">MaisonTech App</h1>
                  <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Sistema de Gestión y Recaudación</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:40px;">
                  <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">Hola,</p>
                  <h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;">${nombre}</h2>
                  <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
                    Recibimos una solicitud para restablecer la contraseña de tu cuenta.
                    Hacé clic en el botón de abajo para crear una nueva contraseña.
                  </p>
                  <div style="text-align:center;margin:32px 0;">
                    <a href="${resetUrl}"
                       style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                              padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;
                              letter-spacing:0.3px;">
                      Restablecer contraseña
                    </a>
                  </div>
                  <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                    O copiá este enlace en tu navegador:
                  </p>
                  <p style="margin:0 0 24px;word-break:break-all;">
                    <a href="${resetUrl}" style="color:#4f46e5;font-size:12px;">${resetUrl}</a>
                  </p>
                  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
                  <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                    ⚠️ Este enlace expira en <strong>1 hora</strong>.<br>
                    Si no solicitaste este cambio, ignorá este email. Tu contraseña no cambiará.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;text-align:center;">
                  <p style="margin:0;color:#9ca3af;font-size:12px;">© 2025 MaisonTech App · Sistema de Recaudación</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
    text: `Hola ${nombre},\n\nPara restablecer tu contraseña, visitá este enlace (válido por 1 hora):\n${resetUrl}\n\nSi no solicitaste este cambio, ignorá este email.`,
  });
}
