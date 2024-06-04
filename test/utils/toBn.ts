import { BigNumber } from "ethers";

export const toBn = (value): BigNumber => {
  return BigNumber.from(value.toString());
}
