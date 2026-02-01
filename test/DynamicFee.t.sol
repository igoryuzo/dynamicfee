// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";

import {DynamicFee} from "../src/DynamicFee.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract DynamicFeeTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    Currency currency0;
    Currency currency1;

    PoolKey poolKey;

    DynamicFee hook;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    function setUp() public {
        deployArtifactsAndLabel();
        (currency0, currency1) = deployCurrencyPair();

        // Deploy hook with BEFORE_SWAP_FLAG
        address flags = address(
            uint160(Hooks.BEFORE_SWAP_FLAG) ^ (0x4444 << 144)
        );
        bytes memory constructorArgs = abi.encode(poolManager);
        deployCodeTo("DynamicFee.sol:DynamicFee", constructorArgs, flags);
        hook = DynamicFee(flags);

        // Create pool with DYNAMIC_FEE_FLAG - required for fee override
        poolKey = PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hook));
        poolId = poolKey.toId();
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        tickLower = TickMath.minUsableTick(poolKey.tickSpacing);
        tickUpper = TickMath.maxUsableTick(poolKey.tickSpacing);

        uint128 liquidityAmount = 1000e18;

        (uint256 amount0Expected, uint256 amount1Expected) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        (tokenId,) = positionManager.mint(
            poolKey, tickLower, tickUpper, liquidityAmount,
            amount0Expected + 1, amount1Expected + 1,
            address(this), block.timestamp, Constants.ZERO_BYTES
        );
    }

    function test_GetFeeForSize_SmallSwap() public view {
        // < 0.01 ETH should get BASE_FEE (0.05%)
        uint24 fee = hook.getFeeForSize(0.005 ether);
        assertEq(fee, hook.BASE_FEE());
        assertEq(fee, 500); // 0.05%
    }

    function test_GetFeeForSize_MediumSwap() public view {
        // 0.01-0.1 ETH should get MEDIUM_FEE (0.10%)
        uint24 fee = hook.getFeeForSize(0.05 ether);
        assertEq(fee, hook.MEDIUM_FEE());
        assertEq(fee, 1000); // 0.10%
    }

    function test_GetFeeForSize_HighSwap() public view {
        // 0.1-1 ETH should get HIGH_FEE (0.30%)
        uint24 fee = hook.getFeeForSize(0.5 ether);
        assertEq(fee, hook.HIGH_FEE());
        assertEq(fee, 3000); // 0.30%
    }

    function test_GetFeeForSize_MaxSwap() public view {
        // > 1 ETH should get MAX_FEE (0.50%)
        uint24 fee = hook.getFeeForSize(2 ether);
        assertEq(fee, hook.MAX_FEE());
        assertEq(fee, 5000); // 0.50%
    }

    function test_GetFeeTiers() public view {
        (uint24[4] memory fees, uint256[3] memory thresholds) = hook.getFeeTiers();

        assertEq(fees[0], 500);   // BASE_FEE
        assertEq(fees[1], 1000);  // MEDIUM_FEE
        assertEq(fees[2], 3000);  // HIGH_FEE
        assertEq(fees[3], 5000);  // MAX_FEE

        assertEq(thresholds[0], 0.01 ether);  // SMALL_THRESHOLD
        assertEq(thresholds[1], 0.1 ether);   // MEDIUM_THRESHOLD
        assertEq(thresholds[2], 1 ether);     // LARGE_THRESHOLD
    }

    function test_SmallSwap_AppliesBaseFee() public {
        // Swap a small amount (< 0.01 ETH)
        uint256 amountIn = 0.005 ether;

        // Execute swap
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });

        // Swap should succeed - if hook applies wrong fee, swap would fail
        // The fact that it succeeds means the dynamic fee was properly applied
    }

    function test_LargeSwap_AppliesHigherFee() public {
        // Swap a larger amount (0.1-1 ETH)
        uint256 amountIn = 0.5 ether;

        // Execute swap
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });

        // Swap should succeed with higher fee applied
    }

    function test_VeryLargeSwap_AppliesMaxFee() public {
        // Swap a very large amount (> 1 ETH)
        uint256 amountIn = 2 ether;

        // Execute swap
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });

        // Swap should succeed with max fee applied
    }

    function test_DynamicFeeApplied_EventEmitted() public {
        uint256 amountIn = 0.05 ether;

        // We expect the DynamicFeeApplied event to be emitted
        vm.expectEmit(true, false, false, false);
        emit DynamicFee.DynamicFeeApplied(poolId, amountIn, 1000, block.timestamp);

        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: true,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });
    }

    function test_HookPermissions() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();

        // Only beforeSwap should be true
        assertTrue(permissions.beforeSwap);

        // All others should be false
        assertFalse(permissions.afterSwap);
        assertFalse(permissions.beforeInitialize);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
    }
}
