// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Benchmark stand-in for Circle's MessageTransmitterV2, installed over the real address on
/// an Anvil fork with `anvil_setCode`. It pays `burn.amount - burn.feeExecuted` to the caller from
/// its own pre-funded USDC balance, so a claim measures the factory's and ENS's work while Circle's
/// attestation check and mint, which are fixed costs outside this design, are excluded.
contract BenchTransmitter {
    address public constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    mapping(bytes32 => bool) public usedNonces;

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        bytes32 nonce;
        uint256 burnAmount;
        uint256 feeExecuted;
        assembly {
            nonce := calldataload(add(message.offset, 12))
            burnAmount := calldataload(add(message.offset, 216))
            feeExecuted := calldataload(add(message.offset, 312))
        }
        require(!usedNonces[nonce], "nonce used");
        usedNonces[nonce] = true;
        (bool ok, bytes memory data) =
            USDC.call(abi.encodeWithSignature("transfer(address,uint256)", msg.sender, burnAmount - feeExecuted));
        require(ok && abi.decode(data, (bool)), "pay failed");
        return true;
    }
}
