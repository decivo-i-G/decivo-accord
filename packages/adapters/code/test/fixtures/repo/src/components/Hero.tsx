import { cn } from '@/lib/utils'
import logo from './logo#ffffff.svg'

const ACCENT = '#487a98'

export function Hero({ dark }: { dark: boolean }) {
  return (
    <section
      className={cn('bg-[#487A98] text-white p-[13px]', dark && 'text-[rgba(0,0,0,0.5)]')}
      style={{ color: '#4a7d9b', padding: 24, margin: '0', borderRadius: '8px', width: '320px', background: 'linear-gradient(#16222b, #3c6681)' }}
    >
      <a href="#add">Mehr</a>
      {/* accord-ignore */}
      <span style={{ color: '#123456' }}>ignored</span>
      <img src={logo} alt="" />
      <p>{ACCENT}</p>
    </section>
  )
}
