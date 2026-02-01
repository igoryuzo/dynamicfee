// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @title DynamicFee Hook
/// @notice A Uniswap V4 hook that dynamically adjusts LP fees based on swap size
/// @dev Demonstrates beforeSwap hook with fee override capability
/// @dev Larger swaps pay proportionally higher fees (0.05% -> 0.50%)
contract DynamicFee is BaseHook {
    using PoolIdLibrary for PoolKey;

    // Fee tiers (in hundredths of a bip, so 500 = 0.05%)
    // 1 bip = 0.01%, so 100 = 1 bip = 0.01%
    uint24 public constant BASE_FEE = 500;      // 0.05%
    uint24 public constant MEDIUM_FEE = 1000;   // 0.10%
    uint24 public constant HIGH_FEE = 3000;     // 0.30%
    uint24 public constant MAX_FEE = 5000;      // 0.50%

    // Size thresholds (in wei)
    uint256 public constant SMALL_THRESHOLD = 0.01 ether;   // < 0.01 ETH: base fee
    uint256 public constant MEDIUM_THRESHOLD = 0.1 ether;   // 0.01-0.1 ETH: medium fee
    uint256 public constant LARGE_THRESHOLD = 1 ether;      // 0.1-1 ETH: high fee
    // > 1 ETH: max fee

    /// @notice Emitted when a swap occurs with dynamic fee
    event DynamicFeeApplied(
        PoolId indexed poolId,
        uint256 swapSize,
        uint24 feeApplied,
        uint256 timestamp
    );

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    /// @notice Returns the hook permissions - only beforeSwap is enabled
    /// @dev We need beforeSwap to intercept and apply dynamic fees
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,           // Required - intercept swaps to apply dynamic fee
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,  // Not modifying amounts, just fee
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Called before every swap - calculates and returns dynamic fee
    /// @dev The fee is returned with OVERRIDE_FEE_FLAG to override the pool's base fee
    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        // Get the absolute swap size
        uint256 swapSize = _abs(params.amountSpecified);

        // Calculate dynamic fee based on swap size
        uint24 fee = _calculateFee(swapSize);

        // Emit event for tracking
        emit DynamicFeeApplied(key.toId(), swapSize, fee, block.timestamp);

        // Return:
        // - selector: confirms hook execution
        // - ZERO_DELTA: we don't modify swap amounts
        // - fee with OVERRIDE_FEE_FLAG: tells PoolManager to use this fee instead of pool's base fee
        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            fee | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    /// @notice Calculate fee based on swap size
    /// @param size The absolute amount being swapped (in wei)
    /// @return fee The fee to apply (in hundredths of a bip)
    function _calculateFee(uint256 size) internal pure returns (uint24) {
        if (size < SMALL_THRESHOLD) return BASE_FEE;      // < 0.01 ETH: 0.05%
        if (size < MEDIUM_THRESHOLD) return MEDIUM_FEE;   // 0.01-0.1 ETH: 0.10%
        if (size < LARGE_THRESHOLD) return HIGH_FEE;      // 0.1-1 ETH: 0.30%
        return MAX_FEE;                                    // > 1 ETH: 0.50%
    }

    /// @notice Public view function to get fee for a given swap size
    /// @dev Useful for frontends to display expected fee before swap
    /// @param size The swap size in wei
    /// @return fee The fee tier that would be applied
    function getFeeForSize(uint256 size) external pure returns (uint24) {
        return _calculateFee(size);
    }

    /// @notice Get all fee tiers and thresholds
    /// @dev Useful for frontends to display fee tier information
    /// @return fees Array of fee values [BASE, MEDIUM, HIGH, MAX]
    /// @return thresholds Array of threshold values [SMALL, MEDIUM, LARGE]
    function getFeeTiers() external pure returns (uint24[4] memory fees, uint256[3] memory thresholds) {
        fees = [BASE_FEE, MEDIUM_FEE, HIGH_FEE, MAX_FEE];
        thresholds = [SMALL_THRESHOLD, MEDIUM_THRESHOLD, LARGE_THRESHOLD];
    }

    /// @notice Helper to get absolute value
    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
