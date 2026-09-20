import { Button } from '../UI/Button'
import { Input } from '../UI/Input'

export function ProductForm({ onSubmit, onCancel }) {
  return <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(Object.fromEntries(new FormData(event.currentTarget))) }}><Input name="sku" label="SKU" required /><Input name="name" label="ชื่อสินค้า" required /><Input name="customer" label="ลูกค้า" /><div className="grid grid-cols-2 gap-3"><Input name="qty" label="จำนวน" type="number" min="0" defaultValue="0" /><Input name="minQty" label="ขั้นต่ำ" type="number" min="0" defaultValue="0" /></div><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>ยกเลิก</Button><Button type="submit">บันทึกสินค้า</Button></div></form>
}
