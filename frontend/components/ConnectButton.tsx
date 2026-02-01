'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className="btn btn-secondary font-mono text-sm"
      >
        {address?.slice(0, 6)}...{address?.slice(-4)}
      </button>
    )
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      className="btn btn-primary font-mono text-sm"
    >
      Connect Wallet
    </button>
  )
}
