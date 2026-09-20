import { Badge } from '../UI/Badge'
import { formatNumber } from '../../utils/format'
import { getProductImageUrl } from '../../services/stockService'

export function ProductTable({ products }) {
    return <div className="product-table"><table><thead><tr><th>รูป</th><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>วัสดุ</th><th>ลูกค้า</th><th>คงเหลือ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="product-image">{product.imageId ? <img src={getProductImageUrl(product.imageId)} alt="" /> : '□'}</div></td><td><strong>{product.sku}</strong></td><td>{product.name}</td><td><span className="material-tag">{product.material}</span></td><td>{product.customer}</td><td className="quantity">{formatNumber(product.qty)} <small>{product.unit}</small></td><td><Badge status={product.status} /></td><td><div className="row-actions"><button>ปรับ</button><button aria-label="แก้ไข">✎</button><button aria-label="ประวัติ">▤</button><button aria-label="ลบ">▮</button></div></td></tr>)}</tbody></table>{!products.length && <p className="empty-state">ไม่พบรายการสินค้า</p>}</div>
}
