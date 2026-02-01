import { http, createConfig } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || ''
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'

export const config = createConfig({
  chains: [baseSepolia, base],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(baseRpcUrl),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
