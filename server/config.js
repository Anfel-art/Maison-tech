export const CONFIG = {
  precioFicha: 500,
  pctLocatario: 0.40,
  pctCasa: 0.50,
  pctRecaudador: 0.10,
};

const _secret = process.env.JWT_SECRET;
if (!_secret || _secret === 'seprisa-dev-secret-change-in-production') {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET no configurado. Definilo en el archivo .env antes de iniciar en producción.');
    process.exit(1);
  } else {
    console.warn('[seguridad] JWT_SECRET usando valor por defecto — solo aceptable en desarrollo local.');
  }
}

export const JWT_SECRET = _secret || 'seprisa-dev-secret-change-in-production';
export const JWT_EXPIRES_IN = '8h';

// Advertir si APP_URL no usa HTTPS en producción (los links de reset de contraseña viajarán sin cifrar)
const _appUrl = process.env.APP_URL;
if (_appUrl && !_appUrl.startsWith('https://')) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] APP_URL debe usar HTTPS en producción. Los tokens de reset viajarán expuestos.');
    process.exit(1);
  } else {
    console.warn('[seguridad] APP_URL no usa HTTPS — aceptable solo en desarrollo local.');
  }
}
