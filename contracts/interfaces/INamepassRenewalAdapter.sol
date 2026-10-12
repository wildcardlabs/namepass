// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Stable interface between the factory and a view-only ENS adapter.
/// @dev Version 2. The adapter never holds funds. It returns a plan that the payer executes
/// under an exact approval and an exact balance check.
interface INamepassRenewalAdapter {
    function interfaceVersion() external view returns (uint256);
    /// @dev The payer the adapter was built for. Returns the factory.
    function gateway() external view returns (address);
    function factory() external view returns (address);
    function paymentToken() external view returns (address);
    function quote(string calldata label, uint256 budget) external view returns (uint64 duration, uint256 amountNeeded);
    function renewableBy(string calldata label) external view returns (address);
    function nameState(string calldata label) external view returns (uint64 expiry, address renewer);
    /// @notice Who to pay, for how long, how much, and the exact call that renews.
    function plan(string calldata label, uint256 budget)
        external
        view
        returns (address renewer, uint64 duration, uint256 price, bytes memory data);
}
