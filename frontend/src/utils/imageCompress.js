const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.8
const MIN_SIZE_TO_COMPRESS = 500 * 1024 // no vale la pena comprimir archivos ya livianos

// Comprime imágenes grandes antes de subirlas (fotos de celular suelen pesar
// 3-12MB): redimensiona al lado mayor y reexporta como JPEG ~80% calidad.
// No toca archivos que no sean imagen, GIF (rompería la animación), o que ya
// sean livianos. Si algo falla o el resultado no achica nada, devuelve el
// archivo original — nunca bloquea la subida.
export async function compressImage(file) {
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif' || file.size < MIN_SIZE_TO_COMPRESS) {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
