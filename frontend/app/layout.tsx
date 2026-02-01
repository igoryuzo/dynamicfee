import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'DynamicFee | Size-Based LP Fees for Uniswap V4',
  description: 'Dynamic fee hook that adjusts LP fees based on swap size. Larger swaps pay higher fees.',
  openGraph: {
    title: 'DynamicFee | Size-Based LP Fees for Uniswap V4',
    description: 'Dynamic fee hook that adjusts LP fees based on swap size. Larger swaps pay higher fees.',
    url: 'https://dynamicfee.v4hooks.dev',
  },
  themeColor: '#00ffd0',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
