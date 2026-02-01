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
    // Pool: CLANKER (token0) / WETH (token1)
    // Educational pool with ~$25 each side
    //
    // NOTE: Update these values based on current market prices!
    // To calculate sqrtPriceX96:
    //   1. Get price ratio: price = token1/token0 = WETH_per_CLANKER
    //   2. If 1 CLANKER = 0.000004 WETH, then price = 0.000004
    //   3. sqrtPriceX96 = sqrt(price) * 2^96
    //
    // Example: If CLANKER = $0.01 and WETH = $2500:
    //   - 1 CLANKER = 0.000004 WETH (0.01 / 2500)
    //   - sqrt(0.000004) = 0.002
    //   - sqrtPriceX96 = 0.002 * 2^96 = 158,456,325,028,528,675,187,087
    //
    uint256 public token0Amount = 2500e18;      // CLANKER (~$25 at $0.01/CLANKER)
    uint256 public token1Amount = 0.01 ether;   // WETH (~$25 at $2500/ETH)

    // Starting price: sqrtPriceX96 for CLANKER/WETH
    // Assuming 1 CLANKER = 0.000004 WETH ($0.01 / $2500)
    // sqrt(0.000004) * 2^96 = 158,456,325,028,528,675,187,087
    uint160 startingPrice = 158456325028528675187087;

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
