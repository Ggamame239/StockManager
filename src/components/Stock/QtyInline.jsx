import { Button } from '../UI/Button'

export function QtyInline({ product, onAdjust }) {
  return <div className="flex gap-2"><Button className="flex-1" onClick={() => onAdjust(product, 'IN')}>รับเข้า</Button><Button className="flex-1" variant="secondary" onClick={() => onAdjust(product, 'OUT')}>เบิกออก</Button></div>
}
