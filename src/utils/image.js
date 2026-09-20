export function resizeImage(file, options = {}) {
    const { width = 800, height = 700, quality = 0.82 } = options

    return new Promise((resolve, reject) => {
        const image = new Image()
        const reader = new FileReader()

        reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'))
        reader.onload = () => {
            image.src = reader.result
        }
        image.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้อง'))
        image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height

            const scale = Math.max(width / image.width, height / image.height)
            const drawWidth = image.width * scale
            const drawHeight = image.height * scale
            const offsetX = (width - drawWidth) / 2
            const offsetY = (height - drawHeight) / 2
            const context = canvas.getContext('2d')
            context.fillStyle = '#ffffff'
            context.fillRect(0, 0, width, height)
            context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)

            const dataUrl = canvas.toDataURL('image/jpeg', quality)
            resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
        }
        reader.readAsDataURL(file)
    })
}
