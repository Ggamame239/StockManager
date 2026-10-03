export function Header({ logo = '/icon.svg', onRefresh = () => window.location.reload(), module = 'stock', onModuleChange = (nextModule) => window.dispatchEvent(new CustomEvent('app-module-change', { detail: nextModule })) }) {
  const title = module === 'po' ? 'PO Tracker' : 'Stock Management System'
  return <header className="app-header"><div className="brand"><div className="brand-icon"><img src={logo} alt="P.tech interprecision" /></div><div><strong>{title}</strong><span>Purchase Order and Stock Management</span></div></div><div className="header-actions"><nav className="module-nav" aria-label="Module navigation"><button className={module === 'stock' ? 'active' : ''} onClick={() => onModuleChange('stock')}>Stock</button><button className={module === 'po' ? 'active' : ''} onClick={() => onModuleChange('po')}>PO Tracker</button></nav><button onClick={onRefresh} className="refresh-button" aria-label="Refresh data">Refresh</button></div></header>
}

