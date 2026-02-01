// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/console.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {BaseScript} from "./base/BaseScript.sol";

import {DynamicFee} from "../src/DynamicFee.sol";

/// @notice Mines the address and deploys the DynamicFee Hook contract
contract DeployHookScript is BaseScript {
    function run() public {
        // DynamicFee only needs BEFORE_SWAP_FLAG
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);

        // Mine a salt that will produce a hook address with the correct flags
        bytes memory constructorArgs = abi.encode(poolManager);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(DynamicFee).creationCode, constructorArgs);

        // Deploy the hook using CREATE2
        vm.startBroadcast();
        DynamicFee dynamicFee = new DynamicFee{salt: salt}(poolManager);
        vm.stopBroadcast();

        require(address(dynamicFee) == hookAddress, "DeployHookScript: Hook Address Mismatch");

        console.log("DynamicFee Hook deployed to:", address(dynamicFee));
        console.log("");
        console.log("Update BaseScript.sol with this hook address!");
    }
}
