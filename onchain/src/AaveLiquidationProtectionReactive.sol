// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../lib/reactive-lib/src/interfaces/IReactive.sol";
import "../lib/reactive-lib/src/abstract-base/AbstractReactive.sol";

contract AaveLiquidationProtectionReactive is IReactive, AbstractReactive {
    // Events
    event Subscribed(
        address indexed service_address,
        address indexed _contract,
        uint256 indexed topic_0
    );

    event HealthFactorChecked(uint256 currentHealthFactor, uint256 threshold);

    event CallbackSent();
    event Done();

    // Constants
    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 private constant UNISWAP_V2_SYNC_TOPIC_0 =
        0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1;
    uint256 private constant POSITION_PROTECTED_TOPIC_0 =
        0xc36075e656a1ae37433e843be9f03b48aa277aa3174cadf877d8d58fe686215d; 
    uint64 private constant CALLBACK_GAS_LIMIT = 1000000;

    // State variables
    bool private triggered;
    address private lendingPool;
    address private protectionManager; // The callback contract
    address private user;
    address private uniswapPair; // Single pair to monitor
    uint256 private healthFactorThreshold;
    uint256 private targetHealthFactor;

    // Constructor
    constructor(
        address _lendingPool,
        address _protectionManager,
        address _uniswapPair,
        address _user,
        uint256 _healthFactorThreshold,
        uint256 _targetHealthFactor
    ) payable {
        triggered = false;
        lendingPool = _lendingPool;
        protectionManager = _protectionManager;
        uniswapPair = _uniswapPair;
        user = _user;
        healthFactorThreshold = _healthFactorThreshold;
        targetHealthFactor = _targetHealthFactor;

        // Subscribe to Uniswap events for the pair
        if (!vm) {
            service.subscribe(
                SEPOLIA_CHAIN_ID,
                uniswapPair,
                UNISWAP_V2_SYNC_TOPIC_0,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
            emit Subscribed(
                address(service),
                uniswapPair,
                UNISWAP_V2_SYNC_TOPIC_0
            );

            // Subscribe to protection manager events to track completion
            service.subscribe(
                SEPOLIA_CHAIN_ID,
                protectionManager,
                POSITION_PROTECTED_TOPIC_0,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        }
    }

    // Main reactive function
    function react(LogRecord calldata log) external vmOnly {
        if (isPairSyncEvent(log)) {
            if (triggered) {
                return;
            }
            
            bytes memory payload = abi.encodeWithSignature(
                "protectPosition(address,address,address,uint256)",
                address(0), // sender parameter (ignored)
                user,
                lendingPool,
                targetHealthFactor
            );

            triggered = true;
            emit CallbackSent();
            emit Callback(
                log.chain_id,
                protectionManager,
                CALLBACK_GAS_LIMIT,
                payload
            );
        } else if (isCompletionEvent(log)){
            // Mark as done if we see the protection event from our manager
            triggered = false;
            emit Done();
        }
    }

    // Helper function to check if the event is a Sync event from our monitored pair
    function isPairSyncEvent(LogRecord calldata log)
        internal
        view
        returns (bool)
    {
        return log.topic_0 == UNISWAP_V2_SYNC_TOPIC_0 && log._contract == uniswapPair;
    }

    // Check if the event is the completion event from our protection manager
    function isCompletionEvent(LogRecord calldata log)
        internal
        view
        returns (bool)
    {
        return
            log._contract == protectionManager &&
            log.topic_0 == POSITION_PROTECTED_TOPIC_0;
    }
}