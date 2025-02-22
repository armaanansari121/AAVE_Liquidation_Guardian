// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SyncEventEmitter
 * @dev A simple contract that emits a Sync event with the same signature as Uniswap V2 pairs
 */
contract SyncEventEmitter {
    // This event has the same signature as the Sync event in Uniswap V2 pairs
    // It is emitted when the reserves of a pair are updated
    event Sync(uint112 reserve0, uint112 reserve1);
    
    /**
     * @dev Emits a Sync event with the provided reserve values
     * @param reserve0 The first token reserve amount
     * @param reserve1 The second token reserve amount
     * @return bool True if the event was successfully emitted
     */
    function emitSyncEvent(uint112 reserve0, uint112 reserve1) external returns (bool) {
        emit Sync(reserve0, reserve1);
        return true;
    }
}