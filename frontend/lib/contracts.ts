export const DYNAMICFEE_ABI = [
  {
    type: 'function',
    name: 'getFeeForSize',
    inputs: [{ name: 'size', type: 'uint256' }],
    outputs: [{ name: 'fee', type: 'uint24' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'getFeeTiers',
    inputs: [],
    outputs: [
      { name: 'fees', type: 'uint24[4]' },
      { name: 'thresholds', type: 'uint256[3]' },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'BASE_FEE',
    inputs: [],
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MEDIUM_FEE',
    inputs: [],
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'HIGH_FEE',
    inputs: [],
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_FEE',
    inputs: [],
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SMALL_THRESHOLD',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MEDIUM_THRESHOLD',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'LARGE_THRESHOLD',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'DynamicFeeApplied',
    inputs: [
      { name: 'poolId', type: 'bytes32', indexed: true },
      { name: 'swapSize', type: 'uint256', indexed: false },
      { name: 'feeApplied', type: 'uint24', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const

// Deployment addresses - update after deploying
export const ADDRESSES = {
  // Base Sepolia
  84532: {
    dynamicFee: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    poolManager: '0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829' as `0x${string}`,
  },
  // Base Mainnet - TODO: Update after deployment
  8453: {
    dynamicFee: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b' as `0x${string}`,
  },
} as const

export type SupportedChainId = keyof typeof ADDRESSES

// Fee tier configuration (matches contract)
export const FEE_TIERS = {
  BASE: { fee: 500, percent: '0.05%', label: 'Base', threshold: 0 },
  MEDIUM: { fee: 1000, percent: '0.10%', label: 'Medium', threshold: 0.01 },
  HIGH: { fee: 3000, percent: '0.30%', label: 'High', threshold: 0.1 },
  MAX: { fee: 5000, percent: '0.50%', label: 'Max', threshold: 1 },
} as const
