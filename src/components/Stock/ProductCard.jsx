import { Badge } from '../UI/Badge'
import { Button } from '../UI/Button'
import { formatNumber } from '../../utils/format'

export function ProductCard({ product, onAdjust }) {
    return <article className="rounded-2xl border border-[#e5dfd4] bg-white p-4 shadow-[0_8px_24px_rgba(32,49,61,0.05)]"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-[#8b9897]">{product.sku}</p><h3 className="mt-1 font-['Space_Grotesk'] text-lg font-bold text-[#20313d]">{product.name}</h3><p className="mt-1 text-sm text-[#718087]">{product.material} · {product.customer}</p></div><Badge status={product.status} /></div><div className="mt-5 flex items-end justify-between"><div><p className="text-xs text-[#8b9897]">คงเหลือ</p><p className="font-['Space_Grotesk'] text-3xl font-bold text-[#173f5f]">{formatNumber(product.qty)} <span className="text-sm font-medium">{product.unit}</span></p></div><Button onClick={() => onAdjust(product)}>ปรับจำนวน</Button></div></article>
}
