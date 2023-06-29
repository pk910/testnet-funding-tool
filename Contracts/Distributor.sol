// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

contract Distributor {

  function bytesToAddress(bytes memory b) internal pure returns(address addr) {
    assembly {
      addr := mload(add(b, 20))
    }
  }

  function distribute(bytes calldata addrs, uint256[] calldata values) public payable {
    uint32 addrsLen = uint32(addrs.length);
    uint32 pos = 0;
    uint32 idx = 0;
    while (pos < addrsLen) {
      payable(bytesToAddress(addrs[pos:pos+20])).call{
        value: values[idx]
      }("");
      unchecked { pos += 20; idx++; }
    }
  }

  function distributeGwei(bytes calldata addrs, uint64[] calldata values) public payable {
    uint32 addrsLen = uint32(addrs.length);
    uint32 pos = 0;
    uint32 idx = 0;
    while (pos < addrsLen) {
      payable(bytesToAddress(addrs[pos:pos+20])).call{
        value: uint256(values[idx]) * 1 gwei
      }("");
      unchecked { pos += 20; idx++; }
    }
  }

  function distributeEther(bytes calldata addrs, uint32[] calldata values) public payable {
    uint32 addrsLen = uint32(addrs.length);
    uint32 pos = 0;
    uint32 idx = 0;
    while (pos < addrsLen) {
      payable(bytesToAddress(addrs[pos:pos+20])).call{
        value: uint256(values[idx]) * 1 ether
      }("");
      unchecked { pos += 20; idx++; }
    }
  }

  function distributeEqual(bytes calldata addrs) public payable {
    uint32 addrsLen = uint32(addrs.length);
    uint256 amount = msg.value * 20 / addrsLen;
    uint32 pos = 0;
    while (pos < addrsLen) {
      payable(bytesToAddress(addrs[pos:pos+20])).call{value: amount}("");
      unchecked { pos += 20; }
    }
  }

}
