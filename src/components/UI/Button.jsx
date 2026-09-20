export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-[#173f5f] text-white hover:bg-[#0f3049]',
    secondary: 'bg-[#e9e4da] text-[#20313d] hover:bg-[#ddd5c8]',
    ghost: 'text-[#4b6572] hover:bg-[#eee9df]',
  }
  return <button className={`min-h-11 rounded-xl px-4 font-semibold transition ${styles[variant]} ${className}`} {...props}>{children}</button>
}
