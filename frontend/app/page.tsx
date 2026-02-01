'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAccount, useReadContract, useWatchContractEvent, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { base } from 'wagmi/chains'
import { formatEther, parseEther, maxUint256, encodeAbiParameters, toHex, keccak256 } from 'viem'
import { DYNAMICFEE_ABI, ADDRESSES, FEE_TIERS } from '@/lib/contracts'
import { ConnectButton } from '@/components/ConnectButton'

// Pre-configured pool - WETH/MOLT on Base Mainnet
// NOTE: Update these after deployment
const POOL_KEY = {
  currency0: '0x4200000000000000000000000000000000000006' as `0x${string}`, // WETH
  currency1: '0xB695559b26BB2c9703ef1935c37AeaE9526bab07' as `0x${string}`, // MOLT
  fee: 0x800000, // DYNAMIC_FEE_FLAG (0x800000)
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`, // TODO: Update after deployment
}

// Official Uniswap V4 contracts on Base
const UNIVERSAL_ROUTER = '0x6ff5693b99212da76ad316178a184ab56d299b43' as `0x${string}`
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as `0x${string}`
const POOL_MANAGER = '0x498581fF718922c3f8e6A244956aF099B2652b2b' as `0x${string}`

// Compute PoolId from PoolKey
const POOL_ID = keccak256(
  encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [POOL_KEY.currency0, POOL_KEY.currency1, POOL_KEY.fee, POOL_KEY.tickSpacing, POOL_KEY.hooks]
  )
)

// Command and Action constants
const Commands = {
  V4_SWAP: 0x10,
}

const Actions = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
}

// ERC20 ABI for approvals
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// Permit2 ABI
const PERMIT2_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    stateMutability: 'view',
  },
] as const

// Universal Router ABI
const UNIVERSAL_ROUTER_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

// Helper to encode V4 swap
function encodeV4Swap(
  poolKey: typeof POOL_KEY,
  zeroForOne: boolean,
  amountIn: bigint,
  minAmountOut: bigint
): { commands: `0x${string}`, inputs: `0x${string}`[] } {
  const commands = toHex(new Uint8Array([Commands.V4_SWAP]))

  const actions = toHex(new Uint8Array([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE_ALL,
    Actions.TAKE_ALL,
  ]))

  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            type: 'tuple',
            name: 'poolKey',
            components: [
              { type: 'address', name: 'currency0' },
              { type: 'address', name: 'currency1' },
              { type: 'uint24', name: 'fee' },
              { type: 'int24', name: 'tickSpacing' },
              { type: 'address', name: 'hooks' },
            ],
          },
          { type: 'bool', name: 'zeroForOne' },
          { type: 'uint128', name: 'amountIn' },
          { type: 'uint128', name: 'amountOutMinimum' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
    ],
    [
      {
        poolKey: {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        },
        zeroForOne: zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x' as `0x${string}`,
      },
    ]
  )

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [inputCurrency, amountIn]
  )

  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [outputCurrency, minAmountOut]
  )

  const input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actions, [swapParams, settleParams, takeParams]]
  )

  return {
    commands,
    inputs: [input],
  }
}

// Calculate fee tier based on amount
function getFeeTier(amountEth: number): typeof FEE_TIERS[keyof typeof FEE_TIERS] {
  if (amountEth >= FEE_TIERS.MAX.threshold) return FEE_TIERS.MAX
  if (amountEth >= FEE_TIERS.HIGH.threshold) return FEE_TIERS.HIGH
  if (amountEth >= FEE_TIERS.MEDIUM.threshold) return FEE_TIERS.MEDIUM
  return FEE_TIERS.BASE
}

export default function Home() {
  const { address, isConnected } = useAccount()
  const [recentSwaps, setRecentSwaps] = useState<Array<{
    swapSize: bigint
    feeApplied: number
    timestamp: bigint
    txHash: string
    logIndex: number
  }>>([])
  const [swapDirection, setSwapDirection] = useState<'wethToMolt' | 'moltToWeth'>('wethToMolt')
  const [swapAmount, setSwapAmount] = useState('0.01')
  const [swapStep, setSwapStep] = useState<'idle' | 'approving' | 'swapping' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const addresses = ADDRESSES[8453] // Base Mainnet
  const isDeployed = addresses.dynamicFee !== '0x0000000000000000000000000000000000000000'

  // Calculate current fee tier based on input amount
  const currentFeeTier = useMemo(() => {
    const amount = parseFloat(swapAmount) || 0
    return getFeeTier(amount)
  }, [swapAmount])

  // Check allowances
  const inputToken = swapDirection === 'wethToMolt' ? POOL_KEY.currency0 : POOL_KEY.currency1
  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useReadContract({
    address: inputToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, PERMIT2] : undefined,
    query: { enabled: !!address && isDeployed },
  })

  const { data: permit2Allowance, refetch: refetchPermit2Allowance } = useReadContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: address ? [address, inputToken, UNIVERSAL_ROUTER] : undefined,
    query: { enabled: !!address && isDeployed },
  })

  // Watch for DynamicFeeApplied events
  useWatchContractEvent({
    address: addresses.dynamicFee,
    abi: DYNAMICFEE_ABI,
    eventName: 'DynamicFeeApplied',
    chainId: base.id,
    onLogs(logs) {
      logs.forEach((log) => {
        if (log.args && log.transactionHash) {
          const txHash = log.transactionHash
          const logIndex = log.logIndex ?? 0

          setRecentSwaps((prev) => {
            const isDuplicate = prev.some(
              (swap) => swap.txHash === txHash && swap.logIndex === logIndex
            )
            if (isDuplicate) return prev

            return [
              {
                swapSize: log.args.swapSize as bigint,
                feeApplied: Number(log.args.feeApplied),
                timestamp: log.args.timestamp as bigint,
                txHash,
                logIndex,
              },
              ...prev.slice(0, 4),
            ]
          })
        }
      })
    },
    enabled: isDeployed,
  })

  // Transaction hooks
  const { writeContract: writeErc20Approve, data: erc20ApproveHash, isPending: isErc20ApprovePending } = useWriteContract()
  const { isLoading: isErc20ApproveConfirming, isSuccess: isErc20ApproveSuccess } = useWaitForTransactionReceipt({ hash: erc20ApproveHash })

  const { writeContract: writePermit2Approve, data: permit2ApproveHash, isPending: isPermit2ApprovePending } = useWriteContract()
  const { isLoading: isPermit2ApproveConfirming, isSuccess: isPermit2ApproveSuccess } = useWaitForTransactionReceipt({ hash: permit2ApproveHash })

  const { writeContract: writeSwap, data: swapHash, isPending: isSwapPending } = useWriteContract()
  const { isLoading: isSwapConfirming, isSuccess: isSwapSuccess } = useWaitForTransactionReceipt({ hash: swapHash })

  useEffect(() => {
    if (isErc20ApproveSuccess && swapStep === 'approving') {
      refetchErc20Allowance()
      setTimeout(() => approvePermit2ForRouter(), 1000)
    }
  }, [isErc20ApproveSuccess])

  useEffect(() => {
    if (isPermit2ApproveSuccess && swapStep === 'approving') {
      refetchPermit2Allowance()
      setTimeout(() => executeSwap(), 1000)
    }
  }, [isPermit2ApproveSuccess])

  useEffect(() => {
    if (isSwapSuccess && swapStep === 'swapping') {
      setSwapStep('success')
      setTimeout(() => setSwapStep('idle'), 3000)
    }
  }, [isSwapSuccess])

  const approvePermit2ForRouter = () => {
    if (!address) return
    const amountIn = parseEther(swapAmount)
    const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60

    writePermit2Approve({
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'approve',
      args: [inputToken, UNIVERSAL_ROUTER, BigInt(amountIn), expiration],
    }, {
      onError: (error) => {
        setSwapStep('error')
        setErrorMessage(error.message.slice(0, 150))
        setTimeout(() => setSwapStep('idle'), 5000)
      }
    })
  }

  const executeSwap = () => {
    if (!address) return
    setSwapStep('swapping')

    const amountIn = parseEther(swapAmount)
    const zeroForOne = swapDirection === 'wethToMolt'
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)

    const { commands, inputs } = encodeV4Swap(POOL_KEY, zeroForOne, amountIn, 0n)

    writeSwap({
      address: UNIVERSAL_ROUTER,
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute',
      args: [commands, inputs, deadline],
    }, {
      onError: (error) => {
        setSwapStep('error')
        setErrorMessage(error.message.slice(0, 150))
        setTimeout(() => setSwapStep('idle'), 5000)
      }
    })
  }

  const handleSwap = () => {
    if (!address) return
    setErrorMessage('')

    const amountIn = parseEther(swapAmount)
    const erc20AllowanceAmount = (erc20Allowance as bigint | undefined) ?? 0n

    if (erc20AllowanceAmount < amountIn) {
      setSwapStep('approving')
      writeErc20Approve({
        address: inputToken,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2, maxUint256],
      }, {
        onError: (error) => {
          setSwapStep('error')
          setErrorMessage(error.message.slice(0, 150))
          setTimeout(() => setSwapStep('idle'), 5000)
        }
      })
      return
    }

    const permit2Data = permit2Allowance as readonly [bigint, number, number] | undefined
    const permit2Amount = permit2Data ? permit2Data[0] : 0n
    if (permit2Amount < amountIn) {
      setSwapStep('approving')
      approvePermit2ForRouter()
      return
    }

    executeSwap()
  }

  const isLoading = swapStep === 'approving' || swapStep === 'swapping' ||
    isErc20ApprovePending || isErc20ApproveConfirming ||
    isPermit2ApprovePending || isPermit2ApproveConfirming ||
    isSwapPending || isSwapConfirming

  // Convert fee to percentage string
  const feeToPercent = (fee: number) => `${(fee / 10000).toFixed(2)}%`

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border py-6">
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
          <a href="/" className="font-mono text-lg font-bold text-cyan flex items-center gap-2">
            <span className="opacity-50">&gt;</span>
            dynamicFee
          </a>
          <div className="flex items-center gap-4">
            {isDeployed && (
              <a
                href={`https://basescan.org/address/${addresses.dynamicFee}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary hover:text-cyan font-mono text-sm hidden md:block"
              >
                View Contract &rarr;
              </a>
            )}
            <a
              href="https://github.com/igoryuzo/dynamicfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary hover:text-cyan font-mono text-sm hidden md:block"
            >
              GitHub &rarr;
            </a>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 border-b border-border">
        <div className="max-w-6xl mx-auto px-6">
          <div className="hero-label mb-6">Uniswap V4 Hook Demo</div>
          <h1 className="font-mono text-4xl md:text-5xl font-bold leading-tight mb-6 max-w-4xl">
            Dynamic LP fees based on <span className="text-cyan">swap size</span>
          </h1>
          <p className="text-secondary text-lg max-w-2xl leading-relaxed font-light">
            This hook demonstrates <span className="text-cyan">beforeSwap</span> with fee override.
            Larger swaps pay proportionally higher fees (0.05% → 0.50%).
          </p>
        </div>
      </section>

      {/* Fee Calculator Section */}
      <section className="py-12 border-b border-border">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center gap-3 mb-8">
            <span className="w-3 h-3 rounded-full bg-cyan animate-pulse"></span>
            <h2 className="section-title">Fee Calculator</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Input & Current Fee */}
            <div className="card">
              <h3 className="font-mono font-bold mb-4 text-primary">Your Swap Size</h3>
              <div className="mb-6">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.001"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  className="w-full mb-4"
                />
                <div className="flex justify-between text-sm font-mono">
                  <span className="text-dim">0 ETH</span>
                  <span className="text-cyan text-2xl font-bold">{parseFloat(swapAmount).toFixed(4)} ETH</span>
                  <span className="text-dim">2 ETH</span>
                </div>
              </div>

              <div className="bg-elevated rounded-lg p-6 text-center">
                <div className="text-dim text-sm font-mono mb-2">Current Fee</div>
                <div className="text-4xl font-mono font-bold text-cyan mb-2">
                  {currentFeeTier.percent}
                </div>
                <div className="text-secondary text-sm font-mono">
                  {currentFeeTier.label} Tier ({currentFeeTier.fee} bips)
                </div>
              </div>
            </div>

            {/* Fee Tiers Visualization */}
            <div className="card">
              <h3 className="font-mono font-bold mb-4 text-primary">Fee Tiers</h3>
              <div className="space-y-4">
                {Object.entries(FEE_TIERS).map(([key, tier]) => {
                  const isActive = currentFeeTier.fee === tier.fee
                  const widthPercent = (tier.fee / 5000) * 100
                  return (
                    <div
                      key={key}
                      className={`p-3 rounded-lg border transition-all ${
                        isActive
                          ? 'border-cyan bg-cyan/10'
                          : 'border-border bg-elevated'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-mono text-sm">
                          {tier.label}
                          {isActive && <span className="text-cyan ml-2">← Current</span>}
                        </span>
                        <span className={`font-mono font-bold ${isActive ? 'text-cyan' : 'text-primary'}`}>
                          {tier.percent}
                        </span>
                      </div>
                      <div className="w-full bg-deep rounded h-2 overflow-hidden">
                        <div
                          className={`h-full rounded transition-all ${isActive ? 'bg-cyan' : 'bg-secondary'}`}
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>
                      <div className="text-xs text-dim font-mono mt-1">
                        {tier.threshold === 0
                          ? '< 0.01 ETH'
                          : tier.threshold === 1
                          ? '> 1 ETH'
                          : `≥ ${tier.threshold} ETH`}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Feed Section */}
      {isDeployed && recentSwaps.length > 0 && (
        <section className="py-12 border-b border-border">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-center gap-3 mb-8">
              <span className="w-3 h-3 rounded-full bg-cyan animate-pulse"></span>
              <h2 className="section-title">Live Fee Events</h2>
            </div>

            <div className="card">
              <div className="space-y-2">
                {recentSwaps.map((swap, i) => (
                  <div
                    key={`${swap.txHash}-${swap.logIndex}`}
                    className="flex justify-between items-center p-3 bg-elevated rounded border border-border"
                  >
                    <div className="font-mono text-sm">
                      <span className="text-primary">
                        {Number(formatEther(swap.swapSize)).toFixed(6)} ETH
                      </span>
                      <span className="text-dim mx-2">→</span>
                      <span className="text-cyan font-bold">
                        {feeToPercent(swap.feeApplied)} fee
                      </span>
                    </div>
                    <div className="text-dim text-xs font-mono">
                      {new Date(Number(swap.timestamp) * 1000).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Try It Section */}
      <section className="py-12 border-b border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6">
          <div className="section-label">Try It Yourself</div>
          <h2 className="section-title mb-2">Test the dynamic fee</h2>
          <p className="text-secondary text-sm mb-8">
            Swap through the pool and see the fee change based on your swap size.
          </p>

          <div className="card max-w-md mx-auto">
            {!isDeployed ? (
              <div className="text-center py-8">
                <p className="text-secondary mb-4 font-mono text-sm">Hook not deployed yet</p>
                <p className="text-dim text-xs font-mono">Check back after deployment to Base Mainnet</p>
              </div>
            ) : !isConnected ? (
              <div className="text-center py-8">
                <p className="text-secondary mb-4 font-mono text-sm">Connect your wallet to swap</p>
                <ConnectButton />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Direction Toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setSwapDirection('wethToMolt')}
                    disabled={isLoading}
                    className={`flex-1 py-3 px-4 rounded font-mono text-sm transition-all ${
                      swapDirection === 'wethToMolt'
                        ? 'bg-cyan text-deep font-bold'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                  >
                    WETH → MOLT
                  </button>
                  <button
                    onClick={() => setSwapDirection('moltToWeth')}
                    disabled={isLoading}
                    className={`flex-1 py-3 px-4 rounded font-mono text-sm transition-all ${
                      swapDirection === 'moltToWeth'
                        ? 'bg-cyan text-deep font-bold'
                        : 'bg-elevated text-secondary hover:text-primary'
                    }`}
                  >
                    MOLT → WETH
                  </button>
                </div>

                {/* Amount Input */}
                <div>
                  <label className="block text-secondary text-sm mb-2 font-mono">
                    Amount ({swapDirection === 'wethToMolt' ? 'WETH' : 'MOLT'})
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={swapAmount}
                      onChange={(e) => setSwapAmount(e.target.value)}
                      disabled={isLoading}
                      className="flex-1"
                      placeholder="0.01"
                    />
                    <div className="flex gap-1">
                      {swapDirection === 'wethToMolt' ? (
                        <>
                          <button onClick={() => setSwapAmount('0.005')} disabled={isLoading}
                            className="px-3 py-2 bg-elevated rounded text-xs font-mono text-secondary hover:text-cyan">
                            0.005
                          </button>
                          <button onClick={() => setSwapAmount('0.05')} disabled={isLoading}
                            className="px-3 py-2 bg-elevated rounded text-xs font-mono text-secondary hover:text-cyan">
                            0.05
                          </button>
                          <button onClick={() => setSwapAmount('0.5')} disabled={isLoading}
                            className="px-3 py-2 bg-elevated rounded text-xs font-mono text-secondary hover:text-cyan">
                            0.5
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setSwapAmount('100')} disabled={isLoading}
                            className="px-3 py-2 bg-elevated rounded text-xs font-mono text-secondary hover:text-cyan">
                            100
                          </button>
                          <button onClick={() => setSwapAmount('1000')} disabled={isLoading}
                            className="px-3 py-2 bg-elevated rounded text-xs font-mono text-secondary hover:text-cyan">
                            1000
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Fee Preview */}
                <div className="bg-elevated rounded p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-secondary text-sm font-mono">Expected Fee:</span>
                    <span className="text-cyan font-bold font-mono">{currentFeeTier.percent}</span>
                  </div>
                </div>

                {/* Swap Button */}
                <button
                  onClick={handleSwap}
                  disabled={isLoading || !swapAmount}
                  className={`btn w-full py-4 font-mono text-sm font-bold ${
                    swapStep === 'success'
                      ? 'bg-green-500 text-white'
                      : swapStep === 'error'
                      ? 'bg-red-alert text-white'
                      : 'btn-primary'
                  }`}
                >
                  {swapStep === 'approving' && 'Approving...'}
                  {swapStep === 'swapping' && 'Swapping...'}
                  {swapStep === 'success' && 'Swap Successful!'}
                  {swapStep === 'error' && 'Error - Try Again'}
                  {swapStep === 'idle' && `Swap (${currentFeeTier.percent} fee)`}
                </button>

                {errorMessage && (
                  <p className="text-red-alert text-xs font-mono text-center break-all">{errorMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-12 border-b border-border">
        <div className="max-w-6xl mx-auto px-6">
          <div className="section-label">How It Works</div>
          <h2 className="section-title mb-8">The beforeSwap fee override</h2>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="card">
              <div className="font-mono text-3xl text-cyan mb-4">01</div>
              <h3 className="font-mono font-bold mb-2">Hook Intercepts</h3>
              <p className="text-secondary text-sm leading-relaxed">
                When a swap is initiated, the PoolManager calls our <code className="text-cyan">beforeSwap</code> function with the swap parameters.
              </p>
            </div>
            <div className="card">
              <div className="font-mono text-3xl text-cyan mb-4">02</div>
              <h3 className="font-mono font-bold mb-2">Calculate Fee</h3>
              <p className="text-secondary text-sm leading-relaxed">
                We look at the swap size and determine which fee tier applies: 0.05%, 0.10%, 0.30%, or 0.50%.
              </p>
            </div>
            <div className="card">
              <div className="font-mono text-3xl text-cyan mb-4">03</div>
              <h3 className="font-mono font-bold mb-2">Override Fee</h3>
              <p className="text-secondary text-sm leading-relaxed">
                We return the fee with <code className="text-cyan">OVERRIDE_FEE_FLAG</code>, telling the PoolManager to use our calculated fee.
              </p>
            </div>
          </div>

          {/* Code Preview */}
          <div className="terminal">
            <div className="terminal-header">
              <span className="terminal-dot"></span>
              <span className="terminal-dot"></span>
              <span className="terminal-dot"></span>
              <span className="font-mono text-xs text-dim ml-4">DynamicFee.sol</span>
            </div>
            <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
              <div className="text-dim">{'/// @notice Calculate fee based on swap size'}</div>
              <div><span className="text-pink-400">function</span> <span className="text-green-400">_calculateFee</span>(uint256 size) <span className="text-pink-400">internal pure</span> {'{'}</div>
              <div className="pl-4"><span className="text-pink-400">if</span> (size &lt; <span className="text-purple-400">0.01 ether</span>) <span className="text-pink-400">return</span> <span className="text-cyan">500</span>;  <span className="text-dim">// 0.05%</span></div>
              <div className="pl-4"><span className="text-pink-400">if</span> (size &lt; <span className="text-purple-400">0.1 ether</span>) <span className="text-pink-400">return</span> <span className="text-cyan">1000</span>; <span className="text-dim">// 0.10%</span></div>
              <div className="pl-4"><span className="text-pink-400">if</span> (size &lt; <span className="text-purple-400">1 ether</span>) <span className="text-pink-400">return</span> <span className="text-cyan">3000</span>; <span className="text-dim">// 0.30%</span></div>
              <div className="pl-4"><span className="text-pink-400">return</span> <span className="text-cyan">5000</span>; <span className="text-dim">// 0.50%</span></div>
              <div>{'}'}</div>
              <div className="mt-4 text-dim">{'/// @notice Return fee with override flag'}</div>
              <div><span className="text-pink-400">return</span> (selector, ZERO_DELTA, fee | <span className="text-cyan">OVERRIDE_FEE_FLAG</span>);</div>
            </div>
          </div>
        </div>
      </section>

      {/* Key Concepts Section */}
      <section className="py-12 border-b border-border">
        <div className="max-w-6xl mx-auto px-6">
          <div className="section-label">Key Concepts</div>
          <h2 className="section-title mb-8">Understanding Dynamic Fees</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-mono font-bold mb-3 text-cyan">DYNAMIC_FEE_FLAG</h3>
              <p className="text-secondary text-sm leading-relaxed mb-4">
                Pools that want hooks to override fees must be created with <code className="text-cyan">DYNAMIC_FEE_FLAG</code> as the fee parameter. This signals to the PoolManager that fee overrides are allowed.
              </p>
              <div className="bg-elevated rounded p-3 font-mono text-xs">
                <div>fee: <span className="text-cyan">LPFeeLibrary.DYNAMIC_FEE_FLAG</span></div>
              </div>
            </div>

            <div className="card">
              <h3 className="font-mono font-bold mb-3 text-cyan">OVERRIDE_FEE_FLAG</h3>
              <p className="text-secondary text-sm leading-relaxed mb-4">
                When returning from <code className="text-cyan">beforeSwap</code>, we OR the fee with <code className="text-cyan">OVERRIDE_FEE_FLAG</code> to tell the PoolManager to use our fee instead of the pool's base fee.
              </p>
              <div className="bg-elevated rounded p-3 font-mono text-xs">
                <div>fee | <span className="text-cyan">LPFeeLibrary.OVERRIDE_FEE_FLAG</span></div>
              </div>
            </div>

            <div className="card">
              <h3 className="font-mono font-bold mb-3 text-cyan">beforeSwap Permissions</h3>
              <p className="text-secondary text-sm leading-relaxed mb-4">
                This hook only needs <code className="text-cyan">beforeSwap: true</code>. We don't modify swap amounts (no delta return), just the fee charged.
              </p>
              <div className="bg-elevated rounded p-3 font-mono text-xs">
                <div className="text-green-400">✓ beforeSwap: true</div>
                <div className="text-dim">✗ beforeSwapReturnDelta: false</div>
              </div>
            </div>

            <div className="card">
              <h3 className="font-mono font-bold mb-3 text-cyan">Use Cases</h3>
              <p className="text-secondary text-sm leading-relaxed mb-4">
                Dynamic fees enable sophisticated pricing: volume-based fees, volatility-adjusted fees, time-based fees, or MEV-aware fees.
              </p>
              <div className="bg-elevated rounded p-3 font-mono text-xs text-dim">
                <div>• Larger trades → Higher fees</div>
                <div>• High volatility → Higher fees</div>
                <div>• Low liquidity → Higher fees</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="font-mono text-sm text-dim">
            Built by{' '}
            <a href="https://github.com/igoryuzo" className="text-secondary hover:text-cyan">
              Igor Yuzovitskiy
            </a>
            {' '}• Part of{' '}
            <a href="https://v4hooks.dev" className="text-secondary hover:text-cyan">
              v4hooks.dev
            </a>
            {' '}•{' '}
            <a href="https://github.com/igoryuzo/dynamicfee" className="text-secondary hover:text-cyan">
              View Source
            </a>
          </p>
        </div>
      </footer>
    </main>
  )
}
