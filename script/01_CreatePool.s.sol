// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/console.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {LiquidityHelpers} from "./base/LiquidityHelpers.sol";

/// @notice Creates a pool with dynamic fee flag and adds initial liquidity
contract CreatePoolScript is BaseScript, LiquidityHelpers {
    using CurrencyLibrary for Currency;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////

    // IMPORTANT: For dynamic fee hooks, the fee field MUST be DYNAMIC_FEE_FLAG
    // This tells the PoolManager to accept fee overrides from the hook
    uint24 lpFee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 tickSpacing = 60; // Standard tick spacing

    // Hook address - UPDATE THIS after deployment
    IHooks dynamicFeeHook = IHooks(address(0)); // TODO: Set after running 00_DeployHook

    // --- liquidity position configuration --- //
    // Current market price: 1 WETH = 3,098,610 MOLT
    // For ~$10 each side:
    uint256 public token0Amount = 0.004 ether;  // WETH (~$10)
    uint256 public token1Amount = 12395e18;     // MOLT (~$10 at market price)

    // Starting price: sqrtPriceX96 = sqrt(price) * 2^96
    // price = MOLT/WETH = 3,098,610
    // sqrt(3,098,610) = 1760.2869
    // sqrtPriceX96 = 1760.2869 * 2^96 = 139,458,766,000,000,000,000,000,000,000,000
    uint160 startingPrice = 139458766000000000000000000000000;

    // range of the position
    int24 tickLower;
    int24 tickUpper;
    /////////////////////////////////////

    function run() external {
        require(address(dynamicFeeHook) != address(0), "Set dynamicFeeHook address first!");

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: lpFee,  // DYNAMIC_FEE_FLAG - enables hook fee override
            tickSpacing: tickSpacing,
            hooks: dynamicFeeHook
        });

        bytes memory hookData = new bytes(0);

        int24 currentTick = TickMath.getTickAtSqrtPrice(startingPrice);

        tickLower = truncateTickSpacing((currentTick - 750 * tickSpacing), tickSpacing);
        tickUpper = truncateTickSpacing((currentTick + 750 * tickSpacing), tickSpacing);

        // Converts token amounts to liquidity units
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            startingPrice,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            token0Amount,
            token1Amount
        );

        // slippage limits
        uint256 amount0Max = token0Amount + 1;
        uint256 amount1Max = token1Amount + 1;

        (bytes memory actions, bytes[] memory mintParams) = _mintLiquidityParams(
            poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, deployerAddress, hookData
        );

        // multicall parameters
        bytes[] memory params = new bytes[](2);

        // Initialize Pool with DYNAMIC_FEE_FLAG
        params[0] = abi.encodeWithSelector(positionManager.initializePool.selector, poolKey, startingPrice, hookData);

        // Mint Liquidity
        params[1] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector, abi.encode(actions, mintParams), block.timestamp + 3600
        );

        // If the pool is an ETH pair, native tokens are to be transferred
        uint256 valueToPass = currency0.isAddressZero() ? amount0Max : 0;

        vm.startBroadcast();
        tokenApprovals();

        // Multicall to atomically create pool & add liquidity
        positionManager.multicall{value: valueToPass}(params);
        vm.stopBroadcast();

        console.log("Pool created with Dynamic Fee Hook!");
        console.log("Hook address:", address(dynamicFeeHook));
        console.log("Fee flag: DYNAMIC_FEE_FLAG (hook controls fee)");
    }
}
