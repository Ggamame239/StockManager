export function resizeImage(file, options = {}) {
    const { maxWidth = 1200, maxHeight = 1200, quality = 0.82 } = options

    return new Promise((resolve, reject) => {
        const image = new Image()
        const reader = new FileReader()

        reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'))
        reader.onload = () => {
            image.src = reader.result
        }
        image.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้อง'))
        image.onload = () => {
            const ratio = Math.min(1, maxWidth / image.width, maxHeight / image.height)
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(image.width * ratio))
            canvas.height = Math.max(1, Math.round(image.height * ratio))
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)

            const dataUrl = canvas.toDataURL('image/jpeg', quality)
            resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
        }
        reader.readAsDataURL(file)
    })
}
