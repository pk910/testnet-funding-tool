// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract Distributor {

  function distribute(address[] calldata addrs, uint256[] calldata values) public payable {
    uint256 i = 0;
    uint256 balance = msg.value;
    uint256 addrsLen = addrs.length;
    while (i < addrsLen) {
        require(balance >= values[i], "not enough funds");
        balance -= values[i];

        (bool sent, ) = payable(addrs[i]).call{value: values[i]}("");
        require(sent, "failed to send ether");

        i++;
    }
  }

}
