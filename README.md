# DynamicFee Hook

A Uniswap V4 hook that dynamically adjusts LP fees based on swap size. Part of [v4hooks.dev](https://v4hooks.dev).

## Overview

This hook demonstrates the **beforeSwap** lifecycle with fee override capability. Larger swaps pay proportionally higher fees:

| Swap Size | Fee |
|-----------|-----|
| < 0.01 ETH | 0.05% |
| 0.01 - 0.1 ETH | 0.10% |
| 0.1 - 1 ETH | 0.30% |
| > 1 ETH | 0.50% |

## How It Works

1. **Hook intercepts swap** - `beforeSwap` is called with swap parameters
2. **Calculate fee tier** - Based on `amountSpecified`, determine the fee
3. **Override fee** - Return fee with `OVERRIDE_FEE_FLAG` to replace pool's base fee

### Key Concepts

- **DYNAMIC_FEE_FLAG**: Pool must be created with this flag to allow fee overrides
- **OVERRIDE_FEE_FLAG**: Returned fee must be OR'd with this to signal override
- **beforeSwap only**: No delta modification, just fee adjustment

## Project Structure

```
dynamicfee/
├── src/
│   └── DynamicFee.sol         # Hook contract
├── test/
│   ├── DynamicFee.t.sol       # Tests
│   └── utils/                 # Test utilities
├── script/
│   ├── 00_DeployHook.s.sol    # Deploy hook
│   ├── 01_CreatePool.s.sol    # Create pool with DYNAMIC_FEE_FLAG
│   └── 02_Swap.s.sol          # Test swaps
├── frontend/                   # Next.js frontend
│   ├── app/
│   ├── components/
│   └── lib/
└── README.md
```

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) >= 18

### Setup

```bash
# Install dependencies
forge install

# Build
forge build

# Test
forge test -vvv
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deployment

### 1. Deploy Hook

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your keys
# Then deploy
forge script script/00_DeployHook.s.sol --rpc-url base_mainnet --broadcast
```

### 2. Update Hook Address

After deployment, update the hook address in:
- `script/01_CreatePool.s.sol`
- `script/02_Swap.s.sol`
- `frontend/lib/contracts.ts`
- `frontend/app/page.tsx`

### 3. Create Pool

```bash
forge script script/01_CreatePool.s.sol --rpc-url base_mainnet --broadcast
```

### 4. Deploy Frontend

```bash
cd frontend
npm run build
# Deploy to Vercel
```

## Contract

### DynamicFee.sol

```solidity
contract DynamicFee is BaseHook {
    // Fee tiers
    uint24 public constant BASE_FEE = 500;      // 0.05%
    uint24 public constant MEDIUM_FEE = 1000;   // 0.10%
    uint24 public constant HIGH_FEE = 3000;     // 0.30%
    uint24 public constant MAX_FEE = 5000;      // 0.50%

    function _beforeSwap(...) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        uint256 swapSize = _abs(params.amountSpecified);
        uint24 fee = _calculateFee(swapSize);

        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            fee | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}
```

## Hook Permissions

| Permission | Enabled | Purpose |
|------------|---------|---------|
| beforeSwap | Yes | Intercept and override fee |
| beforeSwapReturnDelta | No | Not modifying amounts |
| All others | No | Not needed |

## License

MIT

## Author

Built by [Igor Yuzovitskiy](https://github.com/igoryuzo) as part of [v4hooks.dev](https://v4hooks.dev).
