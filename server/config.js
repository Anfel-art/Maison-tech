export const CONFIG = {
  precioFicha: 500,
  pctLocatario: 0.40,
  pctCasa: 0.50,
  pctRecaudador: 0.10,
};

// En producción usar variable de entorno: JWT_SECRET=<secreto-largo-aleatorio>
export const JWT_SECRET = process.env.JWT_SECRET || 'seprisa-dev-secret-change-in-production';
export const JWT_EXPIRES_IN = '8h';
