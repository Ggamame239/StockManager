export function Header({ logo = '/logo.svg', onRefresh = () => window.location.reload() }) {
  return <header className="app-header"><div className="brand"><div className="brand-icon"><img src={logo} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} />📦</div><div><strong>ระบบจัดการสต็อคสินค้า</strong><span>Stock Management System · โรงกลึง / โรงงานอุตสาหกรรม</span></div></div><button onClick={onRefresh} className="refresh-button" aria-label="รีเฟรชข้อมูล">🔄</button></header>
}
