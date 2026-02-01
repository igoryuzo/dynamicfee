// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/console.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {DynamicFee} from "../src/DynamicFee.sol";

/// @notice Execute test swaps at different sizes to verify dynamic fee
contract SwapScript is BaseScript {
    // Hook address - UPDATE THIS after deployment
    IHooks dynamicFeeHook = IHooks(address(0)); // TODO: Set after running 00_DeployHook

    function run() external {
        require(address(dynamicFeeHook) != address(0), "Set dynamicFeeHook address first!");

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,  // Must match pool creation
            tickSpacing: 60,
            hooks: dynamicFeeHook
        });
        bytes memory hookData = new bytes(0);

        // Test different swap sizes
        uint256[] memory swapSizes = new uint256[](4);
        swapSizes[0] = 0.005 ether;  // Should get 0.05% fee
        swapSizes[1] = 0.05 ether;   // Should get 0.10% fee
        swapSizes[2] = 0.5 ether;    // Should get 0.30% fee
        swapSizes[3] = 2 ether;      // Should get 0.50% fee

        DynamicFee hook = DynamicFee(address(dynamicFeeHook));

        vm.startBroadcast();

        // Approve tokens
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);

        for (uint256 i = 0; i < swapSizes.length; i++) {
            uint24 expectedFee = hook.getFeeForSize(swapSizes[i]);
            console.log("Swap size:", swapSizes[i]);
            console.log("Expected fee (bips * 100):", expectedFee);

            // Execute swap
            swapRouter.swapExactTokensForTokens({
                amountIn: swapSizes[i],
                amountOutMin: 0,
                zeroForOne: true,
                poolKey: poolKey,
                hookData: hookData,
                receiver: address(this),
                deadline: block.timestamp + 30
            });

            console.log("Swap executed successfully!");
            console.log("---");
        }

        vm.stopBroadcast();
    }
}
