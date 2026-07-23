import defaultLogo from '../assets/default-logo.png'
import { getCompanyCache } from '../context/CompanyContext'

/**
 * Fuente del logo de la empresa para embeber en documentos, PDFs y vistas.
 * Usa el logo subido en Configuración (endpoint público /api/settings/logo) si existe;
 * si no, cae al logo por defecto del producto.
 *
 * @param {string} origin - window.location.origin para URLs absolutas en PDFs/ventanas
 *                          nuevas. Dejar vacío ('') para <img> dentro de la app.
 * @returns {string} src listo para usar en un <img>.
 */
export function companyLogoSrc(origin = '') {
  return getCompanyCache().has_logo
    ? `${origin}/api/settings/logo`
    : `${origin}${defaultLogo}`
}
